import type { IAgentRuntime, Memory, State, HandlerCallback, Content } from '@elizaos/core';
import { elizaLogger, ModelClass, generateObject, composeContext } from '@elizaos/core';
import { z } from 'zod';
import { formatBalance } from '@polkadot/util';
import { PolkadotApiService } from '../services/api-service';

export interface GetBalanceContent extends Content {
    address: string;
}

export const addressSchema = z.object({
    address: z.string().min(1, 'Address is required'),
});

export const addressTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.
  Example response:
  \`\`\`json
  {
    "address": "15JRT5GjLAZkuvmpwmjCUp1RRLr7Y6Gnusz37ia37h2Xn5Rz"
  }
  \`\`\`
  
  {{recentMessages}}

  Respond with a JSON markdown block containing only the extracted values.`;

export async function buildGetBalanceDetails(
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
): Promise<{ content: GetBalanceContent }> {
    const currentState = state || (await runtime.composeState(message));

    const context = composeContext({
        state: currentState,
        template: addressTemplate,
    });

    const result = await generateObject({
        runtime,
        context,
        schema: addressSchema as z.ZodTypeAny,
        modelClass: ModelClass.MEDIUM,
    });

    const addressData = result.object as GetBalanceContent;

    if (!addressData || !addressData.address) {
        throw new Error('Failed to extract a valid Polkadot address from the message');
    }

    return { content: addressData };
}

export class GetBalanceAction {
    private runtime: IAgentRuntime;

    constructor(runtime: IAgentRuntime) {
        this.runtime = runtime;
    }

    async getBalance(params: { address: string }): Promise<{
        address: string;
        freeBalance: string;
        reservedBalance: string;
        totalBalance: string;
        formattedFreeBalance: string;
        formattedReservedBalance: string;
        formattedTotalBalance: string;
        tokenSymbol: string;
        tokenDecimals: number;
    }> {
        try {
            elizaLogger.debug('Initializing getBalance for address:', params.address);
            const apiService = await PolkadotApiService.start(this.runtime);
            const api = await apiService.getConnection();
            elizaLogger.debug('API connection established');

            const accountInfo = await api.query.system.account(params.address);
            elizaLogger.debug('Account info retrieved:', accountInfo.toHuman());
            const balance = accountInfo.toJSON() as { data: { free: string; reserved: string } };

            const properties = await api.rpc.system.properties();
            elizaLogger.debug('Chain properties retrieved:', properties.toHuman());
            const tokenSymbol = properties.tokenSymbol.unwrap()[0].toString();
            const tokenDecimals = properties.tokenDecimals.unwrap()[0].toNumber();
            elizaLogger.debug('Token details:', { tokenSymbol, tokenDecimals });

            formatBalance.setDefaults({
                decimals: tokenDecimals,
                unit: tokenSymbol,
            });

            const formatOptions = {
                withSi: false,
                forceUnit: tokenSymbol,
            };

            const freeBalance = balance.data.free.toString();
            const reservedBalance = balance.data.reserved.toString();
            const totalBalance = (
                BigInt(balance.data.free) + BigInt(balance.data.reserved)
            ).toString();
            elizaLogger.debug('Balance calculations completed:', {
                freeBalance,
                reservedBalance,
                totalBalance,
            });

            const formattedFreeBalance = `${formatBalance(
                balance.data.free,
                formatOptions,
            )} ${tokenSymbol}`;
            const formattedReservedBalance = `${formatBalance(
                balance.data.reserved,
                formatOptions,
            )} ${tokenSymbol}`;
            const formattedTotalBalance = `${formatBalance(
                BigInt(balance.data.free) + BigInt(balance.data.reserved),
                formatOptions,
            )} ${tokenSymbol}`;
            elizaLogger.debug('Formatted balances:', {
                formattedFreeBalance,
                formattedReservedBalance,
                formattedTotalBalance,
            });

            return {
                address: params.address,
                freeBalance,
                reservedBalance,
                totalBalance,
                formattedFreeBalance,
                formattedReservedBalance,
                formattedTotalBalance,
                tokenSymbol,
                tokenDecimals,
            };
        } catch (error) {
            elizaLogger.error(`Error fetching balance for address ${params.address}:`, error);
            throw new Error(`Failed to retrieve balance: ${(error as Error).message}`);
        }
    }
}

export default {
    name: 'GET_POLKADOT_BALANCE',
    similes: ['CHECK_POLKADOT_BALANCE', 'VIEW_POLKADOT_BALANCE', 'POLKADOT_BALANCE'],
    description:
        'Retrieves the balance information for a Polkadot address, including free, reserved, and total balances.',
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: Record<string, unknown>,
        callback?: HandlerCallback,
    ) => {
        elizaLogger.log('Starting GET_POLKADOT_BALANCE action...');

        try {
            const { content: getBalanceContent } = await buildGetBalanceDetails(
                runtime,
                message,
                state,
            );

            elizaLogger.debug('getBalanceContent', getBalanceContent);

            if (!getBalanceContent || typeof getBalanceContent.address !== 'string') {
                elizaLogger.error('Failed to obtain a valid address.');
                if (callback) {
                    callback({
                        text: "I couldn't process your balance request. Please provide a valid Polkadot address.",
                        content: { error: 'Invalid address format or missing address.' },
                    });
                }
                return false;
            }

            const action = new GetBalanceAction(runtime);
            const balanceInfo = await action.getBalance({
                address: getBalanceContent.address,
            });

            const userMessageText = `
Balance Information for: ${balanceInfo.address}

Free Balance: ${balanceInfo.formattedFreeBalance}
Reserved Balance: ${balanceInfo.formattedReservedBalance}
Total Balance: ${balanceInfo.formattedTotalBalance}

Note: Free balance is the amount available for transfers and transactions. Reserved balance is locked for various on-chain activities.`;

            const result = {
                status: 'success',
                address: balanceInfo.address,
                freeBalance: balanceInfo.freeBalance,
                reservedBalance: balanceInfo.reservedBalance,
                totalBalance: balanceInfo.totalBalance,
                formattedFreeBalance: balanceInfo.formattedFreeBalance,
                formattedReservedBalance: balanceInfo.formattedReservedBalance,
                formattedTotalBalance: balanceInfo.formattedTotalBalance,
                tokenSymbol: balanceInfo.tokenSymbol,
                tokenDecimals: balanceInfo.tokenDecimals,
            };

            if (callback) {
                callback({
                    text: userMessageText,
                    content: result,
                });
            }

            return true;
        } catch (error) {
            elizaLogger.error('Error retrieving balance:', error);
            if (callback) {
                callback({
                    text: `Error retrieving balance: ${(error as Error).message}`,
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
                    text: 'What is the balance of 15JRT5GjLAZkuvmpwmjCUp1RRLr7Y6Gnusz37ia37h2Xn5Rz?',
                    action: 'GET_POLKADOT_BALANCE',
                },
            },
            {
                user: '{{user1}}',
                content: {
                    text: 'Balance Information for: 15JRT5GjLAZkuvmpwmjCUp1RRLr7Y6Gnusz37ia37h2Xn5Rz\n\nFree Balance: 10.5000 DOT\nReserved Balance: 0.0000 DOT\nTotal Balance: 10.5000 DOT\n\nNote: Free balance is the amount available for transfers and transactions. Reserved balance is locked for various on-chain activities.',
                },
            },
        ],
        [
            {
                user: '{{user1}}',
                content: {
                    text: 'Check the DOT balance in this address: 15JRT5GjLAZkuvmpwmjCUp1RRLr7Y6Gnusz37ia37h2Xn5Rz',
                    action: 'GET_POLKADOT_BALANCE',
                },
            },
            {
                user: '{{user1}}',
                content: {
                    text: 'Balance Information for: 15JRT5GjLAZkuvmpwmjCUp1RRLr7Y6Gnusz37ia37h2Xn5Rz\n\nFree Balance: 10.5000 DOT\nReserved Balance: 0.0000 DOT\nTotal Balance: 10.5000 DOT\n\nNote: Free balance is the amount available for transfers and transactions. Reserved balance is locked for various on-chain activities.',
                },
            },
        ],
    ],
};
