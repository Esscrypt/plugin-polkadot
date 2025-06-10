import type { IAgentRuntime, Memory, State, HandlerCallback, Content } from '@elizaos/core';
import { elizaLogger, ModelClass, generateObject, composeContext } from '@elizaos/core';
import { WALLET_CACHE_KEY, WalletProvider, initWalletProvider } from '../providers/wallet';
import type { OptimizedWalletCache } from '../providers/wallet';
import { stringToU8a, hexToU8a } from '@polkadot/util';
import { z } from 'zod';

export interface ValidateSignatureContent extends Content {
    message: string;
    signature: string;
    walletNumber?: number;
    walletPassword?: string;
    walletAddress?: string;
}

export interface ValidateSignatureResult {
    status: 'success';
    isValid: boolean;
    walletAddress: string;
    walletNumber: number;
    message: string;
}

// Zod schema for input validation
const validateSignatureSchema = z.object({
    message: z.string().min(1, 'Message cannot be empty.'),
    signature: z.string().min(1, 'Signature cannot be empty.'),
    walletNumber: z.number().optional().nullable(),
    walletPassword: z.string().optional().nullable(),
    walletAddress: z.string().optional().nullable(),
});

// Template for AI to extract the values
const validateSignatureTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.
Example response:
\`\`\`json
{
  "message": "This is the message to verify",
  "signature": "0x...",
  "walletNumber": 1,
  "walletPassword": "optional-password-if-specified",
  "walletAddress": "optional-address-if-specified"
}
\`\`\`

{{recentMessages}}

Respond with a JSON markdown block containing only the extracted values`;

export class ValidateAction {
    private walletProvider: WalletProvider;

    constructor(walletProvider: WalletProvider) {
        this.walletProvider = walletProvider;
    }

    async validateSignature(
        messageToVerify: string,
        signature: string,
        walletNumber?: number,
        walletAddress?: string,
        password?: string,
    ): Promise<ValidateSignatureResult> {
        if (!walletNumber && !walletAddress) {
            throw new Error(
                'Unable to validate signature. Please provide a wallet number or address.',
            );
        }
        // Validate inputs first
        if (!messageToVerify) {
            throw new Error('Cannot validate signature for an empty message');
        }
        if (!signature) {
            throw new Error('Cannot validate an empty signature');
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

        // Use the first key pair to verify the signature
        const keypair = pairs[0];
        const messageU8a = stringToU8a(String(messageToVerify));
        const signatureU8a = hexToU8a(signature);
        const isValid = keypair.verify(messageU8a, signatureU8a, keypair.publicKey);

        // Store the wallet in cache
        await WalletProvider.storeWalletInCache(keypair.address, targetWallet);

        return {
            status: 'success',
            isValid,
            walletAddress: keypair.address,
            walletNumber: currentWalletNumber || 1, // Default to 1 if no number found
            message: `Signature validation ${isValid ? 'succeeded' : 'failed'}.`,
        };
    }
}

/**
 * Builds and validates signature verification details object using the provided runtime, message, and state.
 */
export async function buildValidateSignatureDetails(
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
): Promise<ValidateSignatureContent> {
    const currentState = state || (await runtime.composeState(message));
    const context = composeContext({
        state: currentState,
        template: validateSignatureTemplate,
    });

    const result = await generateObject({
        runtime,
        context,
        schema: validateSignatureSchema as z.ZodTypeAny,
        modelClass: ModelClass.SMALL,
    });

    return result.object as ValidateSignatureContent;
}

// Type guard for validate signature content
const isValidateSignatureContent = (content: unknown): content is ValidateSignatureContent => {
    return (
        typeof content === 'object' &&
        content !== null &&
        'message' in content &&
        'signature' in content &&
        (('walletNumber' in content && typeof content.walletNumber === 'number') ||
            ('walletAddress' in content && typeof content.walletAddress === 'string'))
    );
};

export default {
    name: 'VALIDATE_POLKADOT_SIGNATURE',
    similes: ['VERIFY_SIGNATURE', 'CHECK_SIGNATURE', 'VALIDATE_SIGNATURE'],
    description:
        'Validates a signature for a message using a Polkadot wallet. Returns whether the signature is valid.',
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: Record<string, unknown>,
        callback?: HandlerCallback,
    ) => {
        elizaLogger.log('Starting VALIDATE_POLKADOT_SIGNATURE action...');

        const validateSignatureContent = await buildValidateSignatureDetails(
            runtime,
            message,
            state,
        );

        if (!isValidateSignatureContent(validateSignatureContent)) {
            if (callback) {
                callback({
                    text: 'Unable to process validate signature request. Please provide a message, signature, and either a wallet number or wallet address.',
                    content: {
                        error: 'Invalid validate signature request. Missing required parameters.',
                    },
                });
            }
            return false;
        }

        try {
            elizaLogger.debug('validateSignatureContent', validateSignatureContent);
            const {
                message: messageToVerify,
                signature,
                walletNumber,
                walletAddress,
            } = validateSignatureContent;

            // Initialize the wallet provider
            const walletProvider = await initWalletProvider(runtime);
            const validateAction = new ValidateAction(walletProvider);

            const result = await validateAction.validateSignature(
                messageToVerify,
                signature,
                walletNumber,
                walletAddress,
            );

            if (callback) {
                callback({
                    text: result.message,
                    content: result,
                });
            }

            return true;
        } catch (error) {
            elizaLogger.error('Error validating signature:', error);
            if (callback) {
                callback({
                    text: `Error validating signature: ${error.message}`,
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
                    text: "Please verify this signature: 0x1234... for message 'hello world'",
                    action: 'VALIDATE_POLKADOT_SIGNATURE',
                },
            },
            {
                user: '{{user2}}',
                content: {
                    text: 'Signature is valid for address 5GrwvaEF5zXb26FfGZWvt2fBvXN1Jz2yXzL9Vvns8wQMXwXb',
                },
            },
        ],
        [
            {
                user: '{{user1}}',
                content: {
                    text: "Check if signature 0x5678... is valid for message 'test' using wallet #1",
                    action: 'VALIDATE_POLKADOT_SIGNATURE',
                },
            },
            {
                user: '{{user2}}',
                content: {
                    text: 'Signature is valid for address 5GrwvaEF5zXb26FfGZWvt2fBvXN1Jz2yXzL9Vvns8wQMXwXb',
                },
            },
        ],
    ],
};
