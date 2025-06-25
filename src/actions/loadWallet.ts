import type { IAgentRuntime, Memory, State, HandlerCallback, Content } from '@elizaos/core';
import {
    elizaLogger,
    ModelType,
    composePromptFromState,
    parseJSONObjectFromText,
} from '@elizaos/core';
import { WalletProvider, initWalletProvider } from '../providers/wallet';
import { z } from 'zod';

// Interface for the content expected by this action
export interface LoadWalletContent extends Content {
    walletNumber?: number;
    walletAddress?: string;
    walletPassword?: string;
}

// Type guard for LoadWalletContent
function isLoadWalletContent(content: Content): content is LoadWalletContent {
    return (
        (typeof content.walletNumber === 'number' ||
            content.walletNumber === undefined ||
            content.walletNumber === null) &&
        (typeof content.walletAddress === 'string' ||
            content.walletAddress === undefined ||
            content.walletAddress === null) &&
        (typeof content.walletPassword === 'string' ||
            content.walletPassword === undefined ||
            content.walletPassword === null)
    );
}

// Zod schema for input validation
const loadWalletSchema = z.object({
    walletNumber: z.number().optional().nullable(),
    walletAddress: z.string().optional().nullable(),
    walletPassword: z.string().optional().nullable(),
});

// Template for AI to extract the wallet details
const loadWalletTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.
Example response:
\`\`\`json
{
  "walletNumber": 1,
  "walletAddress": "5GrwvaEF5zXb26FfGZWvt2fBvXN1Jz2yXzL9Vvns8wQMXwXb",
  "walletPassword": "password"
}
\`\`\`

{{recentMessages}}

Respond with a JSON markdown block containing only the extracted values`;

/**
 * Builds and validates load wallet details object using the provided runtime, message, and state.
 */
export async function buildLoadWalletDetails(
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
): Promise<LoadWalletContent> {
    const currentState = state || (await runtime.composeState(message));
    const prompt = composePromptFromState({
        state: currentState,
        template: loadWalletTemplate,
    });

    const parsedResponse: LoadWalletContent | null = null;
    for (let i = 0; i < 5; i++) {
        const response = await runtime.useModel(ModelType.TEXT_SMALL, {
            prompt,
        });
        const parsedResponse = parseJSONObjectFromText(response) as LoadWalletContent | null;
        if (parsedResponse) {
            break;
        }
    }

    //zod validate the response
    const validatedResponse = loadWalletSchema.safeParse(parsedResponse);

    if (!validatedResponse.success) {
        throw new Error('Failed to extract a valid wallet number or address from the message');
    }

    return parsedResponse;
}

export default {
    name: 'LOAD_POLKADOT_WALLET',
    similes: ['LOAD_WALLET', 'OPEN_WALLET', 'ACCESS_WALLET'],
    description:
        "Loads an existing Polkadot wallet either by wallet number or address. Returns the wallet's address.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: Record<string, unknown>,
        callback?: HandlerCallback,
    ) => {
        elizaLogger.log('Starting LOAD_POLKADOT_WALLET action...');

        const loadWalletContent = await buildLoadWalletDetails(runtime, message, state);

        if (!isLoadWalletContent(loadWalletContent)) {
            if (callback) {
                callback({
                    text: 'Unable to process load wallet request. Please provide either a wallet number or wallet address.',
                    content: {
                        error: 'Invalid load wallet request. Missing required parameters.',
                    },
                });
            }
            return false;
        }

        try {
            elizaLogger.debug('loadWalletContent', loadWalletContent);
            const { walletNumber, walletAddress, walletPassword } = loadWalletContent;

            // Initialize the wallet provider
            const walletProvider = await initWalletProvider(runtime);

            let targetWallet: WalletProvider | null = null;

            // Try to load by wallet number first
            if (walletNumber) {
                targetWallet = await WalletProvider.loadWalletByNumber(
                    walletProvider,
                    walletNumber,
                    walletPassword,
                );
                if (!targetWallet) {
                    throw new Error(
                        `Failed to load wallet #${walletNumber}. Please check the wallet number or password.`,
                    );
                }
            }
            // Fall back to loading by address if number fails or address is provided
            else if (walletAddress) {
                targetWallet = await WalletProvider.loadWalletByAddress(
                    walletProvider,
                    walletAddress,
                    walletPassword,
                );
                if (!targetWallet) {
                    throw new Error(
                        `Failed to load wallet with address ${walletAddress}. Please check the address or password.`,
                    );
                }
            }

            const address = targetWallet.getAddress();
            const currentWalletNumber = await targetWallet.getWalletNumber();

            // Store the wallet in cache
            await WalletProvider.storeWalletInCache(address, targetWallet);

            const result = {
                status: 'success',
                walletAddress: address,
                walletNumber: currentWalletNumber,
                message: `Wallet loaded successfully. Your wallet address is: ${address}${
                    currentWalletNumber ? ` (Wallet #${currentWalletNumber})` : ''
                }`,
            };

            if (callback) {
                callback({
                    text: `Wallet loaded successfully.\n\nYour wallet address is: ${address}${
                        currentWalletNumber ? ` (Wallet #${currentWalletNumber})` : ''
                    }`,
                    content: result,
                });
            }

            return true;
        } catch (error) {
            elizaLogger.error('Error loading wallet:', error);
            if (callback) {
                callback({
                    text: `Error loading wallet: ${error.message}`,
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
                    text: 'Please load my Polkadot wallet #1 with password my_password',
                    action: 'LOAD_POLKADOT_WALLET',
                },
            },
            {
                name: '{{user2}}',
                content: {
                    text: 'Wallet loaded successfully!\nWallet #1\nAddress: 5GrwvaEF5zXb26FfGZWvt2fBvXN1Jz2yXzL9Vvns8wQMXwXb\n\nThe wallet is now ready for use.',
                },
            },
        ],
        [
            {
                name: '{{user1}}',
                content: {
                    text: 'Please load my Polkadot wallet with address 5GrwvaEF5zXb26FfGZWvt2fBvXN1Jz2yXzL9Vvns8wQMXwXb and password my_password',
                    action: 'LOAD_POLKADOT_WALLET',
                },
            },
            {
                name: '{{user2}}',
                content: {
                    text: 'Wallet loaded successfully!\nWallet #1\nAddress: 5GrwvaEF5zXb26FfGZWvt2fBvXN1Jz2yXzL9Vvns8wQMXwXb\n\nThe wallet is now ready for use.',
                },
            },
        ],
    ],
};
