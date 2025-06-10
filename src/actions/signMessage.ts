import type { IAgentRuntime, Memory, State, HandlerCallback, Content } from '@elizaos/core';
import { elizaLogger, ModelClass, generateObject, composeContext } from '@elizaos/core';
import { WalletProvider, initWalletProvider, WALLET_CACHE_KEY } from '../providers/wallet';
import { stringToU8a, u8aToHex } from '@polkadot/util'; // For message and signature conversion
import { z } from 'zod';
import type { OptimizedWalletCache } from '../providers/wallet';

// Interface for the content expected by this action
export interface SignMessageContent extends Content {
    messageToSign: string;
    walletNumber?: number;
    walletAddress?: string;
    walletPassword?: string;
}

export interface SignMessageResult {
    status: 'success';
    signature: string;
    walletAddress: string;
    walletNumber: number;
    message: string;
}

// Type guard for SignMessageContent
function isSignMessageContent(content: Content): content is SignMessageContent {
    return typeof (content as SignMessageContent).messageToSign === 'string';
}

// Zod schema for input validation
const signMessageSchema = z.object({
    messageToSign: z.string().min(1, 'Message to sign cannot be empty.'),
    walletNumber: z.number().optional().nullable(),
    walletAddress: z.string().optional().nullable(),
    walletPassword: z.string().optional().nullable(),
});

// Template for AI to extract the message
const signMessageTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.
Example response:
\`\`\`json
{
  "messageToSign": "This is the message I want to sign.",
  "walletNumber": 1,
  "walletAddress": "5GrwvaEF5zXb26FfGZWvt2fBvXN1Jz2yXzL9Vvns8wQMXwXb",
  "walletPassword": "optional-password-if-specified"
}
\`\`\`

{{recentMessages}}

Respond with a JSON markdown block containing only the extracted values`;

/**
 * Builds and validates sign message details object using the provided runtime, message, and state.
 */
export async function buildSignMessageDetails(
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
): Promise<SignMessageContent> {
    const currentState = state || (await runtime.composeState(message));
    const context = composeContext({
        state: currentState,
        template: signMessageTemplate,
    });

    const result = await generateObject({
        runtime,
        context,
        schema: signMessageSchema as z.ZodTypeAny,
        modelClass: ModelClass.SMALL,
    });

    return result.object as SignMessageContent;
}

export class SignMessageAction {
    private walletProvider: WalletProvider;

    constructor(walletProvider: WalletProvider) {
        this.walletProvider = walletProvider;
    }

    async signMessage(
        messageToSign: string,
        walletNumber?: number,
        walletAddress?: string,
        password?: string,
    ): Promise<SignMessageResult> {
        // Validate message is not empty first
        const messageU8a = stringToU8a(String(messageToSign));
        if (messageU8a.length === 0) {
            throw new Error('Cannot sign an empty message');
        }

        let targetWallet: WalletProvider | null = this.walletProvider;
        let currentWalletNumber: number | null = null;

        // Try to load by wallet number first
        if (walletNumber) {
            targetWallet = await WalletProvider.loadWalletByNumber(
                this.walletProvider,
                walletNumber,
                password,
            );
            if (!targetWallet) {
                throw new Error(
                    `Failed to load wallet #${walletNumber}. Please check the wallet number.`,
                );
            }
            currentWalletNumber = walletNumber;
        }
        // Fall back to loading by address if number fails or address is provided
        else if (walletAddress) {
            targetWallet = await WalletProvider.loadWalletByAddress(
                this.walletProvider,
                walletAddress,
                password,
            );
            if (!targetWallet) {
                throw new Error(
                    `Failed to load wallet with address ${walletAddress}. Please check the address.`,
                );
            }
            // Get wallet number from cache
            const cache =
                await targetWallet.cacheManager.get<OptimizedWalletCache>(WALLET_CACHE_KEY);
            currentWalletNumber = cache?.wallets[walletAddress]?.number || null;
        }

        const pairs = targetWallet.keyring.getPairs();
        if (pairs.length === 0) {
            throw new Error('No key pairs found in the wallet.');
        }

        // Use the first key pair to sign the message
        const keypair = pairs[0];
        const signature = keypair.sign(messageU8a);

        // Store the wallet in cache
        await WalletProvider.storeWalletInCache(keypair.address, targetWallet);

        return {
            status: 'success',
            signature: u8aToHex(signature),
            walletAddress: keypair.address,
            walletNumber: currentWalletNumber || 1, // Default to 1 if no number found
            message: `Message signed successfully. Signature: ${u8aToHex(signature)}`,
        };
    }
}

export default {
    name: 'SIGN_POLKADOT_MESSAGE',
    similes: ['SIGN_MESSAGE', 'SIGN_DATA', 'SIGN_TRANSACTION'],
    description: 'Signs a message using a Polkadot wallet. Returns the signature.',
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: Record<string, unknown>,
        callback?: HandlerCallback,
    ) => {
        elizaLogger.log('Starting SIGN_POLKADOT_MESSAGE action...');

        const signMessageContent = await buildSignMessageDetails(runtime, message, state);

        if (!isSignMessageContent(signMessageContent)) {
            if (callback) {
                callback({
                    text: 'Unable to process sign message request. Please provide a message to sign and either a wallet number or wallet address.',
                    content: {
                        error: 'Invalid sign message request. Missing required parameters.',
                    },
                });
            }
            return false;
        }

        try {
            elizaLogger.debug('signMessageContent', signMessageContent);
            const { messageToSign, walletNumber, walletAddress } = signMessageContent;

            // Initialize the wallet provider
            const walletProvider = await initWalletProvider(runtime);
            const signAction = new SignMessageAction(walletProvider);

            const result = await signAction.signMessage(
                String(messageToSign),
                walletNumber,
                walletAddress,
            );

            if (callback) {
                callback({
                    text: `Message signed successfully.\n\nSignature: ${result.signature}`,
                    content: result,
                });
            }

            return true;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            elizaLogger.error('Error signing message:', errorMessage);
            if (callback) {
                callback({
                    text: `Error signing message: ${errorMessage}`,
                    content: { error: errorMessage },
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
                    text: "Please sign the message 'hello world' with my Polkadot wallet.",
                    action: 'SIGN_POLKADOT_MESSAGE',
                },
            },
            {
                user: '{{user2}}',
                content: {
                    text: 'Message signed successfully!\nSigner: 5GrwvaEF5zXb26FfGZWvt2fBvXN1Jz2yXzL9Vvns8wQMXwXb\nSignature: 0xabcd1234...',
                },
            },
        ],
        [
            {
                user: '{{user1}}',
                content: {
                    text: "Can you sign this for me: 'test message 123'",
                    action: 'SIGN_POLKADOT_MESSAGE',
                },
            },
            {
                user: '{{user2}}',
                content: {
                    text: 'Message signed successfully!\nSigner: 5GrwvaEF5zXb26FfGZWvt2fBvXN1Jz2yXzL9Vvns8wQMXwXb\nSignature: 0xfedc9876...',
                },
            },
        ],
    ],
};
