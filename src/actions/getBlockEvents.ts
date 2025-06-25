import type { IAgentRuntime, Memory, State, HandlerCallback, Content } from '@elizaos/core';
import {
    elizaLogger,
    ModelType,
    composePromptFromState,
    parseJSONObjectFromText,
} from '@elizaos/core';
import { PolkadotApiService } from '../services/api-service';
import { z } from 'zod';

export interface GetBlockEventsContent extends Content {
    blockNumberOrHash: string;
    filterModule?: string;
    limit?: number;
}

export interface BlockEvent {
    index: number;
    section: string;
    method: string;
    dataCount: number;
    phase: string;
    summary: string;
}

interface EventData {
    [key: string]: unknown;
}

// Use a more flexible approach for Polkadot Codec types
interface PolkadotEvent {
    section: { toString(): string };
    method: { toString(): string };
    data: { toJSON(): EventData[] };
}

interface PolkadotPhase {
    isApplyExtrinsic?: boolean;
    asApplyExtrinsic?: { toString(): string };
    isFinalization?: boolean;
    isInitialization?: boolean;
    type?: string;
}

// Use unknown for the complex Polkadot API types, then type guard them
interface EventRecord {
    event: unknown;
    phase: unknown;
}

export const blockEventsSchema = z.object({
    blockNumberOrHash: z.string().min(1, 'Block number or hash is required'),
    filterModule: z
        .string()
        .optional()
        .nullable()
        .transform((val) => (val === 'null' || val === null ? undefined : val)),
    limit: z
        .union([z.number(), z.string()])
        .optional()
        .nullable()
        .transform((val) => {
            if (val === 'null' || val === null || val === undefined) return undefined;
            const num = typeof val === 'string' ? parseInt(val) : val;
            return Number.isNaN(num) ? undefined : Math.min(Math.max(num, 1), 1000);
        }),
});

export const blockEventsTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.
  
  Extract the block number or hash from the message. Optionally extract a module filter (like "balances", "system", "staking") and a limit for the number of events.
  
  IMPORTANT: 
  - For filterModule: use the actual module name if specified, or omit the field entirely if not mentioned
  - For limit: use the actual number if specified, or omit the field entirely if not mentioned
  - Do NOT use the string "null" - either include the field with a value or omit it entirely
  
  Example response:
  \`\`\`json
  {
    "blockNumberOrHash": "12345678",
    "filterModule": "balances",
    "limit": 50
  }
  \`\`\`
  or
  \`\`\`json
  {
    "blockNumberOrHash": "0x1a2b3c4d5e6f..."
  }
  \`\`\`
  or 
  \`\`\`json
  {
    "blockNumberOrHash": "12345678",
    "limit": 10
  }
  \`\`\`
  
  {{recentMessages}}

  Respond with a JSON markdown block containing only the extracted values.`;

export async function buildGetBlockEventsDetails(
    runtime: IAgentRuntime,
    _message: Memory,
    state: State,
): Promise<GetBlockEventsContent> {
    //compose the prompt
    const prompt = composePromptFromState({
        state,
        template: blockEventsTemplate,
    });

    //use the model to get the response
    const parsedResponse: GetBlockEventsContent | null = null;
    for (let i = 0; i < 5; i++) {
        const response = await runtime.useModel(ModelType.TEXT_SMALL, {
            prompt,
        });
        const parsedResponse = parseJSONObjectFromText(response) as GetBlockEventsContent | null;
        if (parsedResponse) {
            break;
        }
    }

    //zod validate the response
    const validatedResponse = blockEventsSchema.safeParse(parsedResponse);

    if (!validatedResponse.success) {
        throw new Error('Failed to extract a valid block number or hash from the message');
    }

    return validatedResponse.data as GetBlockEventsContent;
}

// Helper function to create a readable summary for different event types
function createEventSummary(section: string, method: string, data: EventData[]): string {
    const eventKey = `${section}.${method}`;

    switch (eventKey) {
        case 'balances.Transfer':
            if (data.length >= 3) {
                return `${data[0]} → ${data[1]} (${data[2]} units)`;
            }
            break;
        case 'balances.Deposit':
            if (data.length >= 2) {
                return `${data[0]} (+${data[1]} units)`;
            }
            break;
        case 'system.ExtrinsicSuccess':
            return 'Extrinsic executed successfully';
        case 'system.ExtrinsicFailed':
            return 'Extrinsic failed';
        case 'staking.Reward':
            if (data.length >= 2) {
                return `${data[0]} rewarded ${data[1]} units`;
            }
            break;
        case 'democracy.Proposed':
            return 'New proposal created';
        case 'democracy.Voted':
            return 'Vote cast';
        case 'treasury.Deposit':
            if (data.length >= 1) {
                return `Treasury deposit: ${data[0]} units`;
            }
            break;
        default:
            // For unknown events, just show the count of data items
            if (data.length === 0) {
                return 'No data';
            }
            if (data.length === 1) {
                return '1 data item';
            }
            return `${data.length} data items`;
    }

    return data.length === 0 ? 'No data' : `${data.length} data items`;
}

export class GetBlockEventsAction {
    private runtime: IAgentRuntime;

    constructor(runtime: IAgentRuntime) {
        this.runtime = runtime;
    }

    async getBlockEvents(params: {
        blockNumberOrHash: string;
        filterModule?: string;
        limit?: number;
    }): Promise<{
        blockNumber: string;
        blockHash: string;
        totalEvents: number;
        filteredEvents: number;
        events: BlockEvent[];
        filterApplied?: string;
        limitApplied?: number;
    }> {
        try {
            const apiService = await PolkadotApiService.start(this.runtime);
            const api = await apiService.getConnection();

            let blockHash: string;
            let blockNumber: string;

            if (params.blockNumberOrHash.startsWith('0x')) {
                // This is a hash
                blockHash = params.blockNumberOrHash;
                const header = await api.rpc.chain.getHeader(blockHash);
                blockNumber = header.number.toString();
            } else {
                // This is a block number
                blockNumber = params.blockNumberOrHash;
                blockHash = (await api.rpc.chain.getBlockHash(parseInt(blockNumber))).toString();
            }

            // Get events for the block - use unknown to handle Codec type
            const eventsAtBlock = await api.query.system.events.at(blockHash);

            // Convert Codec to array - use unknown first, then cast to iterable
            const eventsArray = Array.from(eventsAtBlock as unknown as Iterable<EventRecord>);
            let processedEvents: BlockEvent[] = eventsArray.map(
                (eventRecord: EventRecord, index) => {
                    // Type guard and extract event details
                    const event = eventRecord.event as PolkadotEvent;
                    const phase = eventRecord.phase as PolkadotPhase;

                    // Extract event details using the codec methods
                    const section = event.section.toString();
                    const method = event.method.toString();
                    const data = event.data.toJSON() as EventData[];

                    // Determine phase description
                    let phaseDesc = 'Unknown';
                    try {
                        if (phase.isApplyExtrinsic) {
                            phaseDesc = `Extrinsic ${
                                phase.asApplyExtrinsic?.toString() || 'Unknown'
                            }`;
                        } else if (phase.isFinalization) {
                            phaseDesc = 'Finalization';
                        } else if (phase.isInitialization) {
                            phaseDesc = 'Initialization';
                        } else {
                            phaseDesc = phase.type || 'Unknown';
                        }
                    } catch {
                        phaseDesc = 'Unknown';
                    }

                    // Create a readable summary instead of showing raw data
                    const summary = createEventSummary(section, method, data);

                    return {
                        index,
                        section,
                        method,
                        dataCount: data.length,
                        phase: phaseDesc,
                        summary,
                    };
                },
            );

            const totalEvents = processedEvents.length;

            // Apply module filter if specified
            if (params.filterModule) {
                processedEvents = processedEvents.filter(
                    (event) => event.section.toLowerCase() === params.filterModule?.toLowerCase(),
                );
            }

            const filteredEvents = processedEvents.length;

            // Apply limit if specified
            if (params.limit && params.limit < processedEvents.length) {
                processedEvents = processedEvents.slice(0, params.limit);
            }

            return {
                blockNumber,
                blockHash: blockHash.toString(),
                totalEvents,
                filteredEvents,
                events: processedEvents,
                filterApplied: params.filterModule,
                limitApplied: params.limit,
            };
        } catch (error) {
            elizaLogger.error(
                `Error fetching events for block ${params.blockNumberOrHash}:`,
                error,
            );
            throw new Error(`Failed to retrieve block events: ${(error as Error).message}`);
        }
    }
}

export default {
    name: 'GET_BLOCK_EVENTS',
    similes: ['VIEW_BLOCK_EVENTS', 'BLOCK_EVENTS', 'POLKADOT_EVENTS', 'GET_EVENTS'],
    description:
        'Retrieves all events that occurred in a specific Polkadot block, with optional filtering by module and limiting.',
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: Record<string, unknown>,
        callback?: HandlerCallback,
    ) => {
        elizaLogger.log('Starting GET_BLOCK_EVENTS action...');

        try {
            const getBlockEventsContent = await buildGetBlockEventsDetails(runtime, message, state);

            elizaLogger.debug('getBlockEventsContent', getBlockEventsContent);

            if (
                !getBlockEventsContent ||
                typeof getBlockEventsContent.blockNumberOrHash !== 'string'
            ) {
                elizaLogger.error('Failed to obtain a valid block number or hash.');
                if (callback) {
                    callback({
                        text: "I couldn't process your block events request. Please provide a valid block number or hash.",
                        content: { error: 'Invalid block number or hash format.' },
                    });
                }
                return false;
            }

            const action = new GetBlockEventsAction(runtime);
            const eventsInfo = await action.getBlockEvents({
                blockNumberOrHash: getBlockEventsContent.blockNumberOrHash,
                filterModule: getBlockEventsContent.filterModule,
                limit: getBlockEventsContent.limit,
            });

            // Format events for display - cleaner formatting
            const eventsDisplay = eventsInfo.events
                .map((event, idx) => {
                    return `${idx + 1}. ${event.section}.${event.method} (${event.phase})\n   └─ ${
                        event.summary
                    }`;
                })
                .join('\n');

            const showingText =
                eventsInfo.events.length < eventsInfo.filteredEvents
                    ? ` (showing first ${eventsInfo.events.length})`
                    : '';

            const filterText = eventsInfo.filterApplied
                ? `\nFilter: ${eventsInfo.filterApplied} module events only`
                : '';

            const moreEventsText =
                eventsInfo.events.length < eventsInfo.filteredEvents
                    ? `\n\n📋 ${
                          eventsInfo.filteredEvents - eventsInfo.events.length
                      } more events available. Use a higher limit to see more.`
                    : '';

            const userMessageText = `
📦 Block Events for Block ${eventsInfo.blockNumber}
Hash: ${eventsInfo.blockHash.slice(0, 20)}...

Summary:
• Total Events: ${eventsInfo.totalEvents}
• Filtered Events: ${eventsInfo.filteredEvents}${showingText}${filterText}

${
    eventsInfo.events.length > 0
        ? `Events:\n${eventsDisplay}${moreEventsText}`
        : '❌ No events found with the applied filters.'
}`;

            const result = {
                status: 'success',
                blockNumber: eventsInfo.blockNumber,
                blockHash: eventsInfo.blockHash,
                totalEvents: eventsInfo.totalEvents,
                filteredEvents: eventsInfo.filteredEvents,
                events: eventsInfo.events,
                filterApplied: eventsInfo.filterApplied,
                limitApplied: eventsInfo.limitApplied,
            };

            if (callback) {
                callback({
                    text: userMessageText,
                    content: result,
                });
            }

            return true;
        } catch (error) {
            elizaLogger.error('Error retrieving block events:', error);
            if (callback) {
                callback({
                    text: `Error retrieving block events: ${(error as Error).message}`,
                    content: { error: (error as Error).message },
                });
            }
            return false;
        }
    },
    validate: async (_runtime: IAgentRuntime) => true,
    examples: [
        [
            {
                name: '{{user1}}',
                content: {
                    text: 'What events happened in block 12345678?',
                    action: 'GET_BLOCK_EVENTS',
                },
            },
            {
                name: '{{user1}}',
                content: {
                    text: '📦 Block Events for Block 12345678\nHash: 0x8d7c0cce1768da5c...\n\nSummary:\n• Total Events: 8\n• Filtered Events: 8 (showing first 5)\n\nEvents:\n1. system.ExtrinsicSuccess (Extrinsic 1)\n   └─ Extrinsic executed successfully\n\n2. balances.Transfer (Extrinsic 2)\n   └─ 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY → 5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty (10000000000 units)\n\n3. system.ExtrinsicSuccess (Extrinsic 2)\n   └─ Extrinsic executed successfully\n\n4. treasury.Deposit (Finalization)\n   └─ Treasury deposit: 1000000000 units\n\n5. balances.Deposit (Finalization)\n   └─ 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY (+500000000 units)\n\n📋 3 more events available. Use a higher limit to see more.',
                },
            },
        ],
        [
            {
                name: '{{user1}}',
                content: {
                    text: 'Show me only the balances events from block 0x8d7c0cce1768da5c1725def400ce1a337369cbba4c4844d6f9b8bab255c9bb07',
                    action: 'GET_BLOCK_EVENTS',
                },
            },
            {
                name: '{{user1}}',
                content: {
                    text: '📦 Block Events for Block 12345678\nHash: 0x8d7c0cce1768da5c...\n\nSummary:\n• Total Events: 8\n• Filtered Events: 3\nFilter: balances module events only\n\nEvents:\n1. balances.Transfer (Extrinsic 2)\n   └─ 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY → 5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty (10000000000 units)\n\n2. balances.Deposit (Finalization)\n   └─ 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY (+500000000 units)\n\n3. balances.Reserved (Finalization)\n   └─ 2 data items',
                },
            },
        ],
        [
            {
                name: '{{user1}}',
                content: {
                    text: 'Get the first 3 events from block 12345678',
                    action: 'GET_BLOCK_EVENTS',
                },
            },
            {
                name: '{{user1}}',
                content: {
                    text: '📦 Block Events for Block 12345678\nHash: 0x8d7c0cce1768da5c...\n\nSummary:\n• Total Events: 8\n• Filtered Events: 8 (showing first 3)\n\nEvents:\n1. system.ExtrinsicSuccess (Extrinsic 1)\n   └─ Extrinsic executed successfully\n\n2. balances.Transfer (Extrinsic 2)\n   └─ 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY → 5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty (10000000000 units)\n\n3. system.ExtrinsicSuccess (Extrinsic 2)\n   └─ Extrinsic executed successfully\n\n📋 5 more events available. Use a higher limit to see more.',
                },
            },
        ],
    ],
};
