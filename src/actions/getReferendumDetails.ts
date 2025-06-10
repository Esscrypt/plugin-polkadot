import type { IAgentRuntime, Memory, State, HandlerCallback, Content } from '@elizaos/core';
import { elizaLogger, ModelClass, generateObject, composeContext } from '@elizaos/core';
import { z } from 'zod';
import { PolkadotApiService } from '../services/api-service';

export interface GetReferendumDetailsContent extends Content {
    referendumId: number;
}

export interface DetailedReferendumInfo {
    id: number;
    trackId: number;
    trackName: string;
    status: string;
    proposalHash?: string;
    proposalLength?: number;
    enactmentDelay?: number;
    submitted?: string;
    submissionDeposit?: {
        who: string;
        amount: string;
        formattedAmount: string;
    };
    decisionDeposit?: {
        who: string;
        amount: string;
        formattedAmount: string;
    };
    deciding?: {
        since: string;
        confirming?: string;
    };
    tally?: {
        ayes: string;
        nays: string;
        support: string;
        formattedAyes: string;
        formattedNays: string;
        formattedSupport: string;
    };
    inQueue?: boolean;
    alarm?: string[];
    completionBlock?: string;
    origin?: string;
}

interface ReferendumInfoData {
    ongoing?: {
        track: number;
        proposal?: {
            lookup?: {
                hash: string;
                len?: number;
            };
            inline?: string;
        };
        origin?: {
            origins: string;
        };
        enactment?: {
            after: number;
        };
        submitted?: string | number;
        submissionDeposit?: {
            who: string;
            amount?: string | number;
        };
        decisionDeposit?: {
            who: string;
            amount?: string | number;
        };
        deciding?: {
            since?: string | number;
            confirming?: string | number;
        };
        tally?: {
            ayes?: string | number;
            nays?: string | number;
            support?: string | number;
        };
        inQueue?: boolean;
        alarm?: string | number | (string | number)[];
    };
    approved?: string[] | { since: string };
    rejected?: string[];
    cancelled?: string[];
    timedOut?: string[];
    killed?: string[];
}

interface ReferendumApiResponse {
    isSome: boolean;
    unwrap: () => {
        toJSON: () => ReferendumInfoData;
    };
}

export const referendumDetailsSchema = z.object({
    referendumId: z.union([z.number(), z.string()]).transform((val) => {
        const num = typeof val === 'string' ? parseInt(val) : val;
        if (Number.isNaN(num) || num < 0) {
            throw new Error('Invalid referendum ID');
        }
        return num;
    }),
});

export const referendumDetailsTemplate = `Respond with a JSON markdown block containing only the extracted referendum ID.
  
  Extract the referendum ID number from the user's message. Look for patterns like:
  - "referendum 123"
  - "proposal 456"
  - "ref 789"
  - "referendum #42"
  - "show me referendum 100"
  - "details for 200"
  - just a plain number if the context is about referenda
  
  The referendum ID must be a valid positive number.
  
  Example responses:
  \`\`\`json
  {
    "referendumId": 123
  }
  \`\`\`
  
  {{recentMessages}}

  Respond with a JSON markdown block containing only the referendum ID.`;

export async function buildGetReferendumDetailsRequest(
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
): Promise<{ content: GetReferendumDetailsContent }> {
    const currentState = state || (await runtime.composeState(message));

    const context = composeContext({
        state: currentState,
        template: referendumDetailsTemplate,
    });

    const result = await generateObject({
        runtime,
        context,
        schema: referendumDetailsSchema as z.ZodTypeAny,
        modelClass: ModelClass.MEDIUM,
    });

    const detailsData = result.object as GetReferendumDetailsContent;

    return { content: detailsData };
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
function formatReferendumStatus(referendumInfo: ReferendumInfoData): string {
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

export class GetReferendumDetailsAction {
    private runtime: IAgentRuntime;

    constructor(runtime: IAgentRuntime) {
        this.runtime = runtime;
    }

    async getReferendumDetails(referendumId: number): Promise<DetailedReferendumInfo> {
        try {
            const apiService = await PolkadotApiService.start(this.runtime);
            const api = await apiService.getConnection();

            // Get the total referendum count to validate the ID
            const referendumCount = await api.query.referenda.referendumCount();
            const totalCount = parseInt(referendumCount.toString());

            if (referendumId >= totalCount) {
                throw new Error(
                    `Referendum ${referendumId} does not exist. Latest referendum is ${
                        totalCount - 1
                    }.`,
                );
            }

            // Fetch the specific referendum
            const referendumInfo = await api.query.referenda.referendumInfoFor(referendumId);

            const typedReferendumInfo = referendumInfo as unknown as ReferendumApiResponse;

            if (!typedReferendumInfo.isSome) {
                throw new Error(`Referendum ${referendumId} not found or has no data.`);
            }

            const info = typedReferendumInfo.unwrap().toJSON();
            elizaLogger.info(info);

            // Extract track ID
            let trackId: number;
            if (
                info.ongoing &&
                typeof info.ongoing === 'object' &&
                info.ongoing.track !== undefined
            ) {
                trackId = info.ongoing.track;
            } else {
                // For completed referenda, track info is not preserved
                trackId = -1;
            }

            const status = formatReferendumStatus(info);

            // Build detailed referendum info
            const referendum: DetailedReferendumInfo = {
                id: referendumId,
                trackId,
                trackName: getTrackName(trackId),
                status,
            };

            // Extract common details for ongoing referenda
            if (info.ongoing) {
                // Proposal information
                referendum.proposalHash =
                    info.ongoing.proposal?.lookup?.hash ||
                    info.ongoing.proposal?.inline ||
                    'unknown';
                referendum.proposalLength = info.ongoing.proposal?.lookup?.len;

                // Origin information
                referendum.origin = info.ongoing.origin?.origins || 'unknown';

                // Enactment delay
                referendum.enactmentDelay = info.ongoing.enactment?.after;

                // Submission details
                referendum.submitted = info.ongoing.submitted?.toString();

                // Deposits
                if (info.ongoing.submissionDeposit) {
                    referendum.submissionDeposit = {
                        who: info.ongoing.submissionDeposit.who,
                        amount: info.ongoing.submissionDeposit.amount?.toString() || '0',
                        formattedAmount: formatTokenAmount(
                            info.ongoing.submissionDeposit.amount?.toString() || '0',
                        ),
                    };
                }

                if (info.ongoing.decisionDeposit) {
                    referendum.decisionDeposit = {
                        who: info.ongoing.decisionDeposit.who,
                        amount: info.ongoing.decisionDeposit.amount?.toString() || '0',
                        formattedAmount: formatTokenAmount(
                            info.ongoing.decisionDeposit.amount?.toString() || '0',
                        ),
                    };
                }

                // Deciding phase
                if (info.ongoing.deciding) {
                    referendum.deciding = {
                        since: info.ongoing.deciding.since?.toString(),
                        confirming: info.ongoing.deciding.confirming?.toString(),
                    };
                }

                // Tally
                if (info.ongoing.tally) {
                    referendum.tally = {
                        ayes: info.ongoing.tally.ayes?.toString() || '0',
                        nays: info.ongoing.tally.nays?.toString() || '0',
                        support: info.ongoing.tally.support?.toString() || '0',
                        formattedAyes: formatTokenAmount(
                            info.ongoing.tally.ayes?.toString() || '0',
                        ),
                        formattedNays: formatTokenAmount(
                            info.ongoing.tally.nays?.toString() || '0',
                        ),
                        formattedSupport: formatTokenAmount(
                            info.ongoing.tally.support?.toString() || '0',
                        ),
                    };
                }

                // Queue status
                referendum.inQueue = info.ongoing.inQueue || false;

                // Alarm
                if (info.ongoing.alarm) {
                    referendum.alarm = Array.isArray(info.ongoing.alarm)
                        ? info.ongoing.alarm.map((a) => a.toString())
                        : [info.ongoing.alarm.toString()];
                }
            } else {
                // For completed referenda, extract completion block if available
                if (info.approved && Array.isArray(info.approved) && info.approved[0]) {
                    referendum.completionBlock = info.approved[0].toString();
                } else if (info.rejected && Array.isArray(info.rejected) && info.rejected[0]) {
                    referendum.completionBlock = info.rejected[0].toString();
                } else if (info.cancelled && Array.isArray(info.cancelled) && info.cancelled[0]) {
                    referendum.completionBlock = info.cancelled[0].toString();
                } else if (info.timedOut && Array.isArray(info.timedOut) && info.timedOut[0]) {
                    referendum.completionBlock = info.timedOut[0].toString();
                } else if (info.killed && Array.isArray(info.killed) && info.killed[0]) {
                    referendum.completionBlock = info.killed[0].toString();
                }
            }

            return referendum;
        } catch (error) {
            elizaLogger.error(`Error fetching referendum ${referendumId}:`, error);
            throw new Error(`Failed to retrieve referendum ${referendumId}: ${error.message}`);
        }
    }
}

export default {
    name: 'GET_REFERENDUM_DETAILS',
    similes: [
        'VIEW_REFERENDUM_DETAILS',
        'REFERENDUM_INFO',
        'GET_REFERENDUM_INFO',
        'SHOW_REFERENDUM',
        'REFERENDUM_DETAILS',
        'PROPOSAL_DETAILS',
    ],
    description:
        "Retrieves detailed information about a specific governance referendum from Polkadot's OpenGov system by referendum ID.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: Record<string, unknown>,
        callback?: HandlerCallback,
    ) => {
        elizaLogger.log('Starting GET_REFERENDUM_DETAILS action...');

        try {
            const { content: detailsContent } = await buildGetReferendumDetailsRequest(
                runtime,
                message,
                state,
            );

            elizaLogger.debug('detailsContent', detailsContent);

            const action = new GetReferendumDetailsAction(runtime);
            const referendum = await action.getReferendumDetails(detailsContent.referendumId);

            // Format details for display
            let userMessageText = `
🏛️ Referendum ${referendum.id} Details

Overview:
• Track: ${referendum.trackName} (${
                referendum.trackId === -1 ? 'track info not preserved' : `ID: ${referendum.trackId}`
            })
• Status: ${referendum.status.toUpperCase()}`;

            if (referendum.origin) {
                userMessageText += `
• Origin: ${referendum.origin}`;
            }

            if (referendum.completionBlock) {
                userMessageText += `
• Completed at block: ${referendum.completionBlock}`;
            }

            if (referendum.proposalHash) {
                userMessageText += `

Proposal:
• Hash: ${referendum.proposalHash}`;

                if (referendum.proposalLength) {
                    userMessageText += `
• Length: ${referendum.proposalLength} bytes`;
                }

                if (referendum.enactmentDelay) {
                    userMessageText += `
• Enactment delay: ${referendum.enactmentDelay} blocks`;
                }
            }

            if (referendum.submitted) {
                userMessageText += `

Timeline:
• Submitted at block: ${referendum.submitted}`;

                if (referendum.deciding) {
                    userMessageText += `
• Deciding since block: ${referendum.deciding.since}`;
                    if (referendum.deciding.confirming) {
                        userMessageText += `
• Confirming since block: ${referendum.deciding.confirming}`;
                    }
                }
            }

            if (referendum.tally) {
                const ayesPercent =
                    referendum.tally.ayes !== '0' && referendum.tally.nays !== '0'
                        ? (
                              (BigInt(referendum.tally.ayes) * BigInt(100)) /
                              (BigInt(referendum.tally.ayes) + BigInt(referendum.tally.nays))
                          ).toString()
                        : 'N/A';

                userMessageText += `

🗳️ Voting Results:
• Ayes: ${referendum.tally.formattedAyes}`;

                if (ayesPercent !== 'N/A') {
                    userMessageText += ` (${ayesPercent}%)`;
                }

                userMessageText += `
• Nays: ${referendum.tally.formattedNays}
• Support: ${referendum.tally.formattedSupport}`;
            }

            if (referendum.submissionDeposit || referendum.decisionDeposit) {
                userMessageText += `

Deposits:`;

                if (referendum.submissionDeposit) {
                    userMessageText += `
• Submission: ${referendum.submissionDeposit.formattedAmount} by ${referendum.submissionDeposit.who}`;
                }

                if (referendum.decisionDeposit) {
                    userMessageText += `
• Decision: ${referendum.decisionDeposit.formattedAmount} by ${referendum.decisionDeposit.who}`;
                }
            }

            if (referendum.alarm) {
                userMessageText += `

⏰ Alarm: Set for block ${referendum.alarm[0]}`;
            }

            if (referendum.inQueue !== undefined) {
                userMessageText += `

Queue Status: ${referendum.inQueue ? 'In queue' : 'Not in queue'}`;
            }

            const result = {
                status: 'success',
                referendum,
            };

            if (callback) {
                callback({
                    text: userMessageText,
                    content: result,
                });
            }

            return true;
        } catch (error) {
            elizaLogger.error('Error retrieving referendum details:', error);
            if (callback) {
                callback({
                    text: `Error retrieving referendum details: ${error.message}`,
                    content: { error: error.message },
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
                    text: 'Show me details for referendum 586',
                    action: 'GET_REFERENDUM_DETAILS',
                },
            },
            {
                user: '{{user1}}',
                content: {
                    text: '🏛️ Referendum 586 Details\n\nOverview:\n• Track: medium_spender (ID: 33)\n• Status: ONGOING\n• Origin: MediumSpender\n\nProposal:\n• Hash: 0xad649d315fe4c18ce3f9b9c09c698c0c860508cb3bcccdbce5adede355a26850\n• Length: 60 bytes\n• Enactment delay: 100 blocks\n\nTimeline:\n• Submitted at block: 26316166\n• Deciding since block: 26318566\n\n🗳️ Voting Results:\n• Ayes: 105.0 DOT (100%)\n• Nays: 0 DOT\n• Support: 35.0 DOT\n\nDeposits:\n• Submission: 1.0 DOT by 136byv85...n5Rz\n• Decision: 200.0 DOT by 136byv85...n5Rz\n\n⏰ Alarm: Set for block 26721700\n\nQueue Status: Not in queue',
                },
            },
        ],
        [
            {
                user: '{{user1}}',
                content: {
                    text: 'Get referendum 500 info',
                    action: 'GET_REFERENDUM_DETAILS',
                },
            },
            {
                user: '{{user1}}',
                content: {
                    text: '🏛️ Referendum 500 Details\n\nOverview:\n• Track: unknown (track info not preserved)\n• Status: APPROVED\n• Completed at block: 24567890\n\n💡 Note: This referendum has been completed. Detailed voting information and track data are not preserved on-chain for completed referenda.',
                },
            },
        ],
        [
            {
                user: '{{user1}}',
                content: {
                    text: "What's the status of proposal 123?",
                    action: 'GET_REFERENDUM_DETAILS',
                },
            },
            {
                user: '{{user1}}',
                content: {
                    text: '🏛️ Referendum 123 Details\n\nOverview:\n• Track: treasurer (ID: 11)\n• Status: ONGOING\n• Origin: Treasurer\n\nProposal:\n• Hash: 0x1234567890abcdef1234567890abcdef12345678\n• Length: 45 bytes\n• Enactment delay: 50 blocks\n\nTimeline:\n• Submitted at block: 26200000\n• Deciding since block: 26202000\n\n🗳️ Voting Results:\n• Ayes: 5,432.1 DOT (92%)\n• Nays: 456.7 DOT\n• Support: 1,234.5 DOT\n\nDeposits:\n• Submission: 10.0 DOT by 5GrwvaEF...Xb26\n• Decision: 100.0 DOT by 5GrwvaEF...Xb26\n\nQueue Status: Not in queue',
                },
            },
        ],
    ],
};
