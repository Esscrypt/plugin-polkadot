import type { IAgentRuntime, Memory, State, HandlerCallback, Content } from '@elizaos/core';
import { logger, ModelType, composePromptFromState, parseJSONObjectFromText } from '@elizaos/core';
import { WalletProvider, initWalletProvider } from '../providers/wallet';
import { z } from 'zod';
import { PolkadotApiService } from 'src/services/api-service';

export interface TransferFundsContent extends Content {
    recipientAddress: string;
    amount: string;
    walletNumber?: number;
    walletAddress?: string;
    password?: string;
}

// Define a schema for input JSON
export const transferFundsSchema = z.object({
    recipientAddress: z.string(),
    amount: z.string(),
    walletNumber: z.number().optional().nullable(),
    walletAddress: z.string().optional().nullable(),
    password: z.string().optional().nullable(),
});

// Define a template to guide object building
export const transferFundsTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.
  Example response:
  \`\`\`json
  {
    "recipientAddress": "<recipient address>",
    "amount": "<numeric amount only, without asset symbol>",
    "walletNumber": <optional wallet number>,
    "walletAddress": "<optional wallet address>",
    "password": "<optional password>"
  }
  \`\`\`
  
  {{recentMessages}}

  If a wallet number or address is not provided in the latest message, return null for those values.
  If a password is not provided in the latest message, return null for the password.

  IMPORTANT: For the "amount" field, extract ONLY the numeric value without any asset symbols or currency names. 
  For example, if the user says "transfer 1000 PAS", the amount should be "1000", not "1000 PAS".

  Respond with a JSON markdown block containing only the extracted values.`;

/**
 * Builds and validates a transfer funds object using the provided runtime, message, and state.
 */
export async function buildTransferFundsDetails(
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
): Promise<TransferFundsContent> {
    // Compose the current state (or create one based on the message)
    const currentState = state || (await runtime.composeState(message));

    // Compose a context to drive the object generation
    const prompt = composePromptFromState({
        state: currentState,
        template: transferFundsTemplate,
    });

    // Generate an object using the defined schema
    let parsedResponse: TransferFundsContent | null = null;
    for (let i = 0; i < 5; i++) {
        const response = await runtime.useModel(ModelType.TEXT_SMALL, {
            prompt,
        });
        parsedResponse = parseJSONObjectFromText(response) as TransferFundsContent | null;
        if (parsedResponse) {
            break;
        }
    }

    //zod validate the response
    const validatedResponse = transferFundsSchema.safeParse(parsedResponse);

    if (!validatedResponse.success) {
        throw new Error('Failed to extract a valid transfer funds details from the message');
    }

    return validatedResponse.data as TransferFundsContent;
}

export class TransferFundsAction {
    private runtime: IAgentRuntime;
    private walletProvider: WalletProvider;

    constructor(runtime: IAgentRuntime) {
        this.runtime = runtime;
    }

    async initialize(): Promise<void> {
        this.walletProvider = await initWalletProvider(this.runtime);
    }

    async transferFunds(params: {
        recipientAddress: string;
        amount: string;
        walletNumber?: number;
        walletAddress?: string;
        password?: string;
        dryRun?: boolean;
    }): Promise<{
        status: string;
        txHash: string;
        message: string;
    }> {
        // Load the appropriate wallet
        let targetWallet: WalletProvider;
        if (params.walletNumber) {
            targetWallet = await WalletProvider.loadWalletByNumber(
                this.walletProvider,
                params.walletNumber,
                params.password,
            );
        } else if (params.walletAddress) {
            targetWallet = await WalletProvider.loadWalletByAddress(
                this.walletProvider,
                params.walletAddress,
                params.password,
            );
        } else {
            targetWallet = this.walletProvider;
        }

        // Get the keypair from the wallet
        const keypair = targetWallet.keyring.getPairs()[0];
        if (!keypair) {
            throw new Error('No keypair found in the wallet');
        }

        const apiService = await PolkadotApiService.start(this.runtime);
        const api = await apiService.getConnection();
        logger.debug('API connection established');

        const properties = await api.rpc.system.properties();

        const tokenDecimals = properties.tokenDecimals.unwrap()[0].toNumber();

        // Convert amount to the smallest unit (planck)
        const amount = BigInt(params.amount) * BigInt(10 ** tokenDecimals);

        // Create the transfer extrinsic
        const transfer = api.tx.balances.transferAllowDeath(params.recipientAddress, amount);

        if (params.dryRun) {
            // Simulate the transfer without actually sending it
            logger.debug(
                `DRY RUN: Transfer of ${params.amount} DOT to ${params.recipientAddress} would be initiated.`,
            );

            return {
                status: 'success',
                txHash: '0xDRY_RUN_SIMULATION',
                message: `DRY RUN: Transfer of ${params.amount} DOT to ${params.recipientAddress} would be initiated.`,
            };
        }

        // Sign and send the transaction
        const hash = await transfer.signAndSend(keypair);

        logger.debug(
            `Transfer of ${params.amount} DOT to ${
                params.recipientAddress
            } initiated. Transaction hash: ${hash.toHex()}`,
        );

        return {
            status: 'success',
            txHash: hash.toHex(),
            message: `Transfer of ${params.amount} DOT to ${
                params.recipientAddress
            } initiated. Transaction hash: ${hash.toHex()}`,
        };
    }
}

export default {
    name: 'POLKADOT_TRANSFER',
    similes: [
        'SEND_POLKADOT_FUNDS',
        'SEND',
        'TRANSFER_POLKADOT_FUNDS',
        'SEND_DOT',
        'TRANSFER',
        'NATIVE_TRANSFER',
    ],
    description: 'Transfers native tokens to another address.',
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: Record<string, unknown>,
        callback?: HandlerCallback,
    ) => {
        logger.log('Starting POLKADOT_TRANSFER action...');

        // Build transfer details using the object building approach
        const transferFundsContent = await buildTransferFundsDetails(runtime, message, state);

        logger.debug('transferFundsContent', transferFundsContent);

        if (
            !transferFundsContent ||
            !transferFundsContent.recipientAddress ||
            !transferFundsContent.amount
        ) {
            logger.error('Failed to obtain required transfer details.');
            if (callback) {
                callback({
                    text: 'Unable to process transfer request. Could not obtain recipient address or amount.',
                    content: {
                        error: 'Invalid transfer request. Required details could not be determined.',
                    },
                });
            }
            return false;
        }

        try {
            // Initialize the transfer action
            const action = new TransferFundsAction(runtime);
            await action.initialize();

            // Execute the transfer
            const result = await action.transferFunds({
                recipientAddress: transferFundsContent.recipientAddress,
                amount: transferFundsContent.amount,
                walletNumber: transferFundsContent.walletNumber,
                walletAddress: transferFundsContent.walletAddress,
                password: transferFundsContent.password,
            });

            if (callback) {
                callback({
                    text: result.message,
                    content: result,
                });
            }

            return true;
        } catch (error) {
            logger.error('Error transferring funds:', error);
            if (callback) {
                callback({
                    text: `Error transferring funds: ${error.message}`,
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
                name: '{{user1}}',
                content: {
                    text: 'Please transfer 1 DOT to 5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
                    action: 'POLKADOT_TRANSFER',
                },
            },
            {
                name: '{{user2}}',
                content: {
                    text: 'Transfer of 1 DOT to 5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty initiated. Transaction hash: 0x...',
                },
            },
        ],
        [
            {
                name: '{{user1}}',
                content: {
                    text: 'Send 0.5 DOT to 5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty from wallet #2',
                    action: 'POLKADOT_TRANSFER',
                },
            },
            {
                name: '{{user2}}',
                content: {
                    text: 'Transfer of 0.5 DOT to 5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty from wallet #2 initiated. Transaction hash: 0x...',
                },
            },
        ],
    ],
};
