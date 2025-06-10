import type { IAgentRuntime, Memory, State, HandlerCallback, Content } from '@elizaos/core';
import { elizaLogger, ModelClass, generateObject, composeContext } from '@elizaos/core';
import { z } from 'zod';
import { PolkadotApiService } from '../services/api-service';

export interface GetReferendaContent extends Content {
    limit?: number;
}

export interface ReferendumInfo {
    id: number;
    trackId: number;
    trackName: string;
    status: string;
    proposalHash?: string;
    submitted?: string;
    submissionDeposit?: {
        who: string;
        amount: string;
    };
    decisionDeposit?: {
        who: string;
        amount: string;
    };
    deciding?: {
        since: string;
        confirming?: string;
    };
    tally?: {
        ayes: string;
        nays: string;
        support: string;
    };
    alarm?: string;
}

// Define proper types for API responses
interface ReferendumApiResponse {
    isSome: boolean;
    unwrap: () => {
        toJSON: () => ReferendumData;
    };
}

interface ReferendumData {
    ongoing?: OngoingReferendum;
    approved?: unknown;
    rejected?: unknown;
    cancelled?: unknown;
    timedOut?: unknown;
    killed?: unknown;
}

interface OngoingReferendum {
    track: number;
    proposal?: {
        lookup?: { hash: string };
        inline?: string;
    };
    submitted?: number;
    submissionDeposit?: {
        who: string;
        amount?: number;
    };
    decisionDeposit?: {
        who: string;
        amount?: number;
    };
    deciding?: {
        since?: number;
        confirming?: number;
    };
    tally?: {
        ayes?: number;
        nays?: number;
        support?: number;
    };
    alarm?: number;
}

export const referendaSchema = z.object({
    limit: z
        .union([z.number(), z.string()])
        .optional()
        .nullable()
        .transform((val) => {
            if (val === 'null' || val === null || val === undefined) return undefined;
            const num = typeof val === 'string' ? parseInt(val) : val;
            return Number.isNaN(num) ? undefined : Math.min(Math.max(num, 1), 50);
        }),
});

export const referendaTemplate = `Respond with a JSON markdown block containing only the extracted values.
  
  Extract the number of referenda the user wants to see from their message.
  Look for numbers like "show me 5 referenda", "get 10 proposals", "last 3 governance items", etc.
  
  If no specific number is mentioned, omit the limit field to use the default.
  Maximum limit is 50.
  
  Example responses:
  \`\`\`json
  {
    "limit": 10
  }
  \`\`\`
  or
  \`\`\`json
  {}
  \`\`\`
  
  {{recentMessages}}

  Respond with a JSON markdown block containing only the extracted values.`;

export async function buildGetReferendaDetails(
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
): Promise<{ content: GetReferendaContent }> {
    const currentState = state || (await runtime.composeState(message));

    const context = composeContext({
        state: currentState,
        template: referendaTemplate,
    });

    const result = await generateObject({
        runtime,
        context,
        schema: referendaSchema as z.ZodTypeAny,
        modelClass: ModelClass.MEDIUM,
    });

    const referendaData = result.object as GetReferendaContent;

    return { content: referendaData };
}

// Helper function to get track name from track ID
function getTrackName(trackId: number): string {
    if (trackId === -1) {
        return 'unknown';
    }

    const trackNames: { [key: number]: string } = {
        0: 'root',
        1: 'whitelisted_caller',
        10: 'staking_admin',
        11: 'treasurer',
        12: 'lease_admin',
        13: 'fellowship_admin',
        14: 'general_admin',
        15: 'auction_admin',
        20: 'referendum_canceller',
        21: 'referendum_killer',
        30: 'small_tipper',
        31: 'big_tipper',
        32: 'small_spender',
        33: 'medium_spender',
        34: 'big_spender',
    };

    return trackNames[trackId] || `track_${trackId}`;
}

// Helper function to format referendum status
function formatReferendumStatus(referendumInfo: ReferendumData): string {
    if (referendumInfo.ongoing) {
        return 'ongoing';
    }
    if (referendumInfo.approved) {
        return 'approved';
    }
    if (referendumInfo.rejected) {
        return 'rejected';
    }
    if (referendumInfo.cancelled) {
        return 'cancelled';
    }
    if (referendumInfo.timedOut) {
        return 'timedout';
    }
    if (referendumInfo.killed) {
        return 'killed';
    }
    return 'unknown';
}

// Helper function to format large numbers
function formatTokenAmount(amount: string, decimals = 10, symbol = 'DOT'): string {
    const value = BigInt(amount);
    const divisor = BigInt(10 ** decimals);
    const quotient = value / divisor;
    const remainder = value % divisor;

    if (remainder === BigInt(0)) {
        return `${quotient} ${symbol}`;
    }
    const decimal = remainder.toString().padStart(decimals, '0').replace(/0+$/, '');
    return `${quotient}.${decimal} ${symbol}`;
}

export class GetReferendaAction {
    private runtime: IAgentRuntime;

    constructor(runtime: IAgentRuntime) {
        this.runtime = runtime;
    }

    async getReferenda(limit = 10): Promise<{
        totalCount: number;
        returnedCount: number;
        referenda: ReferendumInfo[];
    }> {
        try {
            const apiService = await PolkadotApiService.start(this.runtime);
            const api = await apiService.getConnection();

            // Get the total referendum count
            const referendumCount = await api.query.referenda.referendumCount();
            const totalCount = parseInt(referendumCount.toString());

            const referenda: ReferendumInfo[] = [];
            const maxLimit = Math.min(limit, 20); // Cap at 50

            // Fetch referendum info for recent referenda (working backwards from latest)
            for (let i = totalCount - 1; i >= 0 && referenda.length < maxLimit; i--) {
                try {
                    const referendumInfo = await api.query.referenda.referendumInfoFor(i);

                    const apiResponse = referendumInfo as unknown as ReferendumApiResponse;
                    if (apiResponse.isSome) {
                        const info = apiResponse.unwrap().toJSON();

                        // Extract track ID
                        let trackId: number;
                        if (
                            info.ongoing &&
                            typeof info.ongoing === 'object' &&
                            info.ongoing.track !== undefined
                        ) {
                            trackId = info.ongoing.track;
                        } else {
                            // For completed referenda, track info is not preserved, in the future we could snapshot the api to get histroical
                            trackId = -1; // Use -1 to indicate unknown track
                        }

                        const status = formatReferendumStatus(info);

                        // Extract referendum data
                        const referendum: ReferendumInfo = {
                            id: i,
                            trackId,
                            trackName: getTrackName(trackId),
                            status,
                        };

                        // Add additional details for ongoing referenda
                        if (info.ongoing) {
                            referendum.proposalHash =
                                info.ongoing.proposal?.lookup?.hash ||
                                info.ongoing.proposal?.inline ||
                                'unknown';
                            referendum.submitted = info.ongoing.submitted?.toString();

                            if (info.ongoing.submissionDeposit) {
                                referendum.submissionDeposit = {
                                    who: info.ongoing.submissionDeposit.who,
                                    amount:
                                        info.ongoing.submissionDeposit.amount?.toString() || '0',
                                };
                            }

                            if (info.ongoing.decisionDeposit) {
                                referendum.decisionDeposit = {
                                    who: info.ongoing.decisionDeposit.who,
                                    amount: info.ongoing.decisionDeposit.amount?.toString() || '0',
                                };
                            }

                            if (info.ongoing.deciding) {
                                referendum.deciding = {
                                    since: info.ongoing.deciding.since?.toString(),
                                    confirming: info.ongoing.deciding.confirming?.toString(),
                                };
                            }

                            if (info.ongoing.tally) {
                                referendum.tally = {
                                    ayes: info.ongoing.tally.ayes?.toString() || '0',
                                    nays: info.ongoing.tally.nays?.toString() || '0',
                                    support: info.ongoing.tally.support?.toString() || '0',
                                };
                            }

                            if (info.ongoing.alarm) {
                                referendum.alarm = info.ongoing.alarm.toString();
                            }
                        }

                        referenda.push(referendum);
                    }
                } catch (error) {
                    // Skip referenda that can't be fetched
                    elizaLogger.debug(`Skipping referendum ${i}: ${(error as Error).message}`);
                }
            }

            return {
                totalCount,
                returnedCount: referenda.length,
                referenda,
            };
        } catch (error) {
            elizaLogger.error('Error fetching referenda:', error);
            throw new Error(`Failed to retrieve referenda: ${(error as Error).message}`);
        }
    }
}

export default {
    name: 'GET_REFERENDA',
    similes: [
        'VIEW_REFERENDA',
        'POLKADOT_REFERENDA',
        'GET_GOVERNANCE_REFERENDA',
        'GOVERNANCE_PROPOSALS',
        'VIEW_PROPOSALS',
        'SHOW_REFERENDA',
    ],
    description:
        "Retrieves recent governance referenda from Polkadot's OpenGov system. Shows referendum details including track, status, voting results, and deposits.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: Record<string, unknown>,
        callback?: HandlerCallback,
    ) => {
        elizaLogger.log('Starting GET_REFERENDA action...');

        try {
            const { content: getReferendaContent } = await buildGetReferendaDetails(
                runtime,
                message,
                state,
            );

            elizaLogger.debug('getReferendaContent', getReferendaContent);

            const action = new GetReferendaAction(runtime);
            const referendaInfo = await action.getReferenda(getReferendaContent.limit || 10);

            // Format referenda for display
            const referendaDisplay = referendaInfo.referenda
                .map((ref, idx) => {
                    let details = `${idx + 1}. Referendum ${ref.id} (${ref.trackName})
   Status: ${ref.status.toUpperCase()}`;

                    if (ref.tally) {
                        const ayes = formatTokenAmount(ref.tally.ayes, 3);
                        const nays = formatTokenAmount(ref.tally.nays, 3);
                        details += `
   Votes: ${ayes} AYE, ${nays} NAY`;
                    }

                    if (ref.deciding) {
                        details += `
   Deciding since block: ${ref.deciding.since}`;
                        if (ref.deciding.confirming) {
                            details += ` (confirming since: ${ref.deciding.confirming})`;
                        }
                    }

                    if (ref.submissionDeposit) {
                        const deposit = formatTokenAmount(ref.submissionDeposit.amount, 3);
                        details += `
   Deposit: ${deposit} by ${ref.submissionDeposit.who}`;
                    }

                    return details;
                })
                .join('\n\n');

            const userMessageText = `
🏛️ Polkadot Governance Referenda

Summary:
• Total Referenda: ${referendaInfo.totalCount}
• Showing: ${referendaInfo.returnedCount}

${
    referendaInfo.referenda.length > 0
        ? `Recent Referenda:\n${referendaDisplay}`
        : '❌ No referenda found.'
}

💡 Note: Completed referenda show "unknown" track as this information is not preserved on-chain.`;

            const result = {
                status: 'success',
                totalCount: referendaInfo.totalCount,
                returnedCount: referendaInfo.returnedCount,
                referenda: referendaInfo.referenda,
            };

            if (callback) {
                callback({
                    text: userMessageText,
                    content: result,
                });
            }

            return true;
        } catch (error) {
            elizaLogger.error('Error retrieving referenda:', error);
            if (callback) {
                callback({
                    text: `Error retrieving referenda: ${(error as Error).message}`,
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
                user: '{{user1}}',
                content: {
                    text: 'What are the current governance referenda?',
                    action: 'GET_REFERENDA',
                },
            },
            {
                user: '{{user1}}',
                content: {
                    text: "Here's a list of current ongoing referenda...",
                },
            },
        ],
        [
            {
                user: '{{user1}}',
                content: {
                    text: 'Show me the last 5 governance proposals',
                    action: 'GET_REFERENDA',
                },
            },
            {
                user: '{{user1}}',
                content: {
                    text: "Here's a list of the 5 latest referenda...",
                },
            },
        ],
        [
            {
                user: '{{user1}}',
                content: {
                    text: 'Get me 20 referenda',
                    action: 'GET_REFERENDA',
                },
            },
            {
                user: '{{user1}}',
                content: {
                    text: "Here's a list of the last 20 referenda...",
                },
            },
        ],
    ],
};
