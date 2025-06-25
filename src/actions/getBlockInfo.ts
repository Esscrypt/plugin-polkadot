import type { IAgentRuntime, Memory, State, HandlerCallback, Content } from '@elizaos/core';
import {
    elizaLogger,
    ModelType,
    composePromptFromState,
    parseJSONObjectFromText,
} from '@elizaos/core';
import { z } from 'zod';
import { PolkadotApiService } from '../services/api-service';

export interface GetBlockInfoContent extends Content {
    blockNumberOrHash: string;
}

// Define proper types for API responses
interface PolkadotBlock {
    block: {
        header: {
            number: { toString: () => string };
            parentHash: { toString: () => string };
            stateRoot: { toString: () => string };
            extrinsicsRoot: { toString: () => string };
        };
        extrinsics: { toArray: () => unknown[] };
    };
}

interface PolkadotTimestamp {
    toNumber: () => number;
}

interface PolkadotEvents {
    toJSON: () => unknown[];
}

export const blockInfoSchema = z.object({
    blockNumberOrHash: z.string().min(1, 'Block number or hash is required'),
});

export const blockInfoTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.
  Example response:
  \`\`\`json
  {
    "blockNumberOrHash": "12345678" 
  }
  \`\`\`
  or
  \`\`\`json
  {
    "blockNumberOrHash": "0x1a2b3c4d5e6f..."
  }
  \`\`\`
  
  {{recentMessages}}

  Respond with a JSON markdown block containing only the extracted values.`;

export async function buildGetBlockInfoDetails(
    runtime: IAgentRuntime,
    _message: Memory,
    state: State,
): Promise<GetBlockInfoContent> {
    const prompt = composePromptFromState({
        state,
        template: blockInfoTemplate,
    });

    const parsedResponse: GetBlockInfoContent | null = null;
    for (let i = 0; i < 5; i++) {
        const response = await runtime.useModel(ModelType.TEXT_SMALL, {
            prompt,
        });
        const parsedResponse = parseJSONObjectFromText(response) as GetBlockInfoContent | null;
        if (parsedResponse) {
            break;
        }
    }

    //zod validate the response
    const validatedResponse = blockInfoSchema.safeParse(parsedResponse);

    if (!validatedResponse.success) {
        throw new Error('Failed to extract a valid block number or hash from the message');
    }

    return validatedResponse.data as GetBlockInfoContent;
}

// Helper function to format timestamp
function formatTimestamp(timestamp: string): string {
    if (timestamp === 'Unknown') {
        return 'Unknown';
    }

    try {
        const date = new Date(timestamp);
        return `${date.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
    } catch {
        return timestamp;
    }
}

export class GetBlockInfoAction {
    private runtime: IAgentRuntime;

    constructor(runtime: IAgentRuntime) {
        this.runtime = runtime;
    }

    async getBlockInfo(params: { blockNumberOrHash: string }): Promise<{
        number: string;
        hash: string;
        parentHash: string;
        stateRoot: string;
        extrinsicsRoot: string;
        timestamp: string;
        extrinsicsCount: number;
        eventsCount: number;
    }> {
        try {
            const apiService = await PolkadotApiService.start(this.runtime);
            const api = await apiService.getConnection();
            let blockHash: string;
            if (params.blockNumberOrHash.startsWith('0x')) {
                // This is a hash
                blockHash = params.blockNumberOrHash;
            } else {
                // This is a block number
                const hashResult = await api.rpc.chain.getBlockHash(
                    parseInt(params.blockNumberOrHash),
                );
                blockHash = hashResult.toString();
            }

            // Get block with extended data
            const [blockResult, eventsResult, timestampResult] = await Promise.allSettled([
                api.rpc.chain.getBlock(blockHash),
                api.query.system.events.at(blockHash),
                api.query.timestamp?.now
                    ? api.query.timestamp.now.at(blockHash)
                    : Promise.resolve(null),
            ]);

            if (blockResult.status === 'rejected') {
                throw blockResult.reason;
            }
            if (eventsResult.status === 'rejected') {
                throw eventsResult.reason;
            }

            const signedBlock = blockResult.value as unknown as PolkadotBlock;
            const eventsRaw = eventsResult.value as unknown as PolkadotEvents;
            const timestamp = timestampResult.status === 'fulfilled' ? timestampResult.value : null;

            const block = signedBlock.block;
            const blockNumber = block.header.number.toString();

            // Convert events to proper format first with proper typing
            const events = eventsRaw.toJSON() as unknown[];

            // Extract block data
            const blockInfo = {
                number: blockNumber,
                hash: blockHash.toString(),
                parentHash: block.header.parentHash.toString(),
                stateRoot: block.header.stateRoot.toString(),
                extrinsicsRoot: block.header.extrinsicsRoot.toString(),
                timestamp:
                    timestamp !== null && timestamp !== undefined
                        ? new Date(
                              (timestamp as unknown as PolkadotTimestamp).toNumber(),
                          ).toISOString()
                        : 'Unknown',
                extrinsicsCount: block.extrinsics.toArray().length, // Convert to array first
                eventsCount: Array.isArray(events) ? events.length : 0,
            };

            return blockInfo;
        } catch (error) {
            elizaLogger.error(`Error fetching block info for ${params.blockNumberOrHash}:`, error);
            throw new Error(`Failed to retrieve block info: ${(error as Error).message}`);
        }
    }
}

export default {
    name: 'GET_BLOCK_INFO',
    similes: ['VIEW_BLOCK_INFO', 'BLOCK_DETAILS', 'POLKADOT_BLOCK_INFO'],
    description: 'Retrieves detailed information about a Polkadot block by its number or hash.',
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: Record<string, unknown>,
        callback?: HandlerCallback,
    ) => {
        elizaLogger.log('Starting GET_BLOCK_INFO action...');

        try {
            const getBlockInfoContent = await buildGetBlockInfoDetails(runtime, message, state);

            elizaLogger.debug('getBlockInfoContent', getBlockInfoContent);

            if (!getBlockInfoContent || typeof getBlockInfoContent.blockNumberOrHash !== 'string') {
                elizaLogger.error('Failed to obtain a valid block number or hash.');
                if (callback) {
                    callback({
                        text: "I couldn't process your block info request. Please provide a valid block number or hash.",
                        content: { error: 'Invalid block number or hash format.' },
                    });
                }
                return false;
            }

            const action = new GetBlockInfoAction(runtime);
            const blockInfo = await action.getBlockInfo({
                blockNumberOrHash: getBlockInfoContent.blockNumberOrHash,
            });

            const timeInfo =
                blockInfo.timestamp !== 'Unknown'
                    ? `\n⏰ Time: ${formatTimestamp(blockInfo.timestamp)}`
                    : '';

            const userMessageText = `
📦 Block ${blockInfo.number} Information

Basic Details:
• Number: ${blockInfo.number}
• Hash: ${blockInfo.hash}
• Parent: ${blockInfo.parentHash}${timeInfo}

Merkle Roots:
• State Root: ${blockInfo.stateRoot}
• Extrinsics Root: ${blockInfo.extrinsicsRoot}

Block Content:
• 📋 Extrinsics: ${blockInfo.extrinsicsCount}
• 📝 Events: ${blockInfo.eventsCount}

📊 This block processed ${blockInfo.extrinsicsCount} transaction${
                blockInfo.extrinsicsCount === 1 ? '' : 's'
            } and generated ${blockInfo.eventsCount} event${
                blockInfo.eventsCount === 1 ? '' : 's'
            }.`;

            const result = {
                status: 'success',
                number: blockInfo.number,
                hash: blockInfo.hash,
                parentHash: blockInfo.parentHash,
                stateRoot: blockInfo.stateRoot,
                extrinsicsRoot: blockInfo.extrinsicsRoot,
                timestamp: blockInfo.timestamp,
                extrinsicsCount: blockInfo.extrinsicsCount,
                eventsCount: blockInfo.eventsCount,
            };

            if (callback) {
                callback({
                    text: userMessageText,
                    content: result,
                });
            }

            return true;
        } catch (error) {
            elizaLogger.error('Error retrieving block info:', error);
            if (callback) {
                callback({
                    text: `Error retrieving block info: ${(error as Error).message}`,
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
                    text: "What's the information for block 12345678?",
                    action: 'GET_BLOCK_INFO',
                },
            },
            {
                name: '{{user1}}',
                content: {
                    text: '📦 Block 12345678 Information\n\nBasic Details:\n• Number: 12345678\n• Hash: 0x8d7c0cce1768da5c...\n• Parent: 0x557be0d61c75e187...\n⏰ Time: 2023-06-15 12:34:56 UTC\n\nMerkle Roots:\n• State Root: 0x7b8f01096c356d77...\n• Extrinsics Root: 0x8a65db1f6cc5a7e5...\n\nBlock Content:\n• 📋 Extrinsics: 3\n• 📝 Events: 8\n\n📊 This block processed 3 transactions and generated 8 events.',
                },
            },
        ],
        [
            {
                name: '{{user1}}',
                content: {
                    text: 'Show me the details of block 0x8d7c0cce1768da5c1725def400ce1a337369cbba4c4844d6f9b8bab255c9bb07',
                    action: 'GET_BLOCK_INFO',
                },
            },
            {
                name: '{{user1}}',
                content: {
                    text: '📦 Block 12345678 Information\n\nBasic Details:\n• Number: 12345678\n• Hash: 0x8d7c0cce1768da5c...\n• Parent: 0x557be0d61c75e187...\n⏰ Time: 2023-06-15 12:34:56 UTC\n\nMerkle Roots:\n• State Root: 0x7b8f01096c356d77...\n• Extrinsics Root: 0x8a65db1f6cc5a7e5...\n\nBlock Content:\n• 📋 Extrinsics: 3\n• 📝 Events: 8\n\n📊 This block processed 3 transactions and generated 8 events.',
                },
            },
        ],
    ],
};
