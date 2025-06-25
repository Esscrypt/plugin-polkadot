import type { IAgentRuntime, Memory, State, HandlerCallback, Content } from '@elizaos/core';
import { composePromptFromState, parseJSONObjectFromText } from '@elizaos/core';
import { elizaLogger, ModelType } from '@elizaos/core';
import { WalletProvider, initWalletProvider } from '../providers/wallet';
import { z } from 'zod';

export interface CreateWalletContent extends Content {
    encryptionPassword?: string;
    keypairPassword?: string;
    hardDerivation?: string;
    softDerivation?: string;
}

// Define a schema for input JSON that must include a password.
export const passwordSchema = z.object({
    encryptionPassword: z.string().optional().nullable(),
    keypairPassword: z.string().optional().nullable(),
    hardDerivation: z.string().optional().nullable(),
    softDerivation: z.string().optional().nullable(),
});

// Define a template to guide object building
export const passwordTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.
  Example response:
  \`\`\`json
  {
    "encryptionPassword": "<your password here>",
    "keypairPassword": "<optional password for keypair>",
    "hardDerivation": "<optional hard derivation path>",
    "softDerivation": "<optional soft derivation path>"
  }
  \`\`\`
  
  {{recentMessages}}

  If an encryption password is not provided in the latest message, return null for the encryption password.

  Respond with a JSON markdown block containing only the extracted values.`;

/**
 * Builds and validates a password object using the provided runtime, message, and state.
 * This function mimics the object building approach used in the mint NFT action.
 */
export async function buildCreateWalletDetails(
    runtime: IAgentRuntime,
    _message: Memory,
    state: State,
): Promise<{ content: CreateWalletContent; wasPasswordGenerated: boolean }> {
    const prompt = composePromptFromState({
        state,
        template: passwordTemplate,
    });

    let parsedResponse: CreateWalletContent | null = null;
    for (let i = 0; i < 5; i++) {
        const response = await runtime.useModel(ModelType.TEXT_SMALL, {
            prompt,
        });
        // try parsing to a json object
        const parsedResponse = parseJSONObjectFromText(response) as CreateWalletContent | null;
        // see if it contains objective and attachmentIds
        if (parsedResponse) {
            break;
        }
    }

    let wasPasswordGenerated = false;

    // If passwordData is undefined or encryptionPassword is not available, generate one.
    if (!parsedResponse?.encryptionPassword) {
        const generatedPassword = Math.random().toString(36).slice(-12); // Generate a 12-character random password
        elizaLogger.log('Encryption password not provided by user, generating one.');
        // Ensure passwordData is an object before spreading. If it was undefined, initialize it.
        // If passwordData was undefined, initialize with a default text. Otherwise, use existing passwordData.
        const baseData = parsedResponse || { text: '' }; // Provide default text if passwordData is null/undefined
        parsedResponse = { ...baseData, encryptionPassword: generatedPassword };
        wasPasswordGenerated = true;
    }

    // At this point, passwordData is guaranteed to be defined and have an encryptionPassword.
    const createWalletContent: CreateWalletContent = parsedResponse;

    return { content: createWalletContent, wasPasswordGenerated };
}

export class CreateWalletAction {
    private runtime: IAgentRuntime;
    private walletProvider: WalletProvider;

    constructor(runtime: IAgentRuntime) {
        this.runtime = runtime;
    }

    async initialize(): Promise<void> {
        this.walletProvider = await initWalletProvider(this.runtime);
    }

    async createWallet(params: {
        encryptionPassword: string;
        keypairPassword?: string;
        hardDerivation?: string;
        softDerivation?: string;
    }): Promise<{
        walletAddress: string;
        mnemonic: string;
        walletNumber: number;
    }> {
        const { walletProvider, mnemonic, walletNumber } = await WalletProvider.generateNew(
            this.walletProvider,
            params.encryptionPassword,
            {
                password: params.keypairPassword,
                hardDerivation: params.hardDerivation,
                softDerivation: params.softDerivation,
            },
        );
        const walletAddress = walletProvider.getAddress();

        // Store the new wallet in cache
        await WalletProvider.storeWalletInCache(walletAddress, walletProvider);

        return { walletAddress, mnemonic, walletNumber };
    }
}

export default {
    name: 'CREATE_POLKADOT_WALLET',
    similes: ['NEW_POLKADOT_WALLET', 'MAKE_NEW_POLKADOT_WALLET'],
    description:
        'Creates a new Polkadot wallet on demand. Returns the public address and mnemonic backup (store it securely). The wallet keypair is also encrypted to a file using the provided password. Optionally supports keypair password and derivation paths.',
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: Record<string, unknown>,
        callback?: HandlerCallback,
    ) => {
        elizaLogger.log('Starting CREATE_POLKADOT_WALLET action...');

        // Build password details using the object building approach
        const { content: createWalletContent, wasPasswordGenerated: isPasswordGenerated } =
            await buildCreateWalletDetails(runtime, message, state);

        elizaLogger.debug('createWalletContent', createWalletContent);

        if (!createWalletContent || typeof createWalletContent.encryptionPassword !== 'string') {
            elizaLogger.error('Failed to obtain encryption password.');
            if (callback) {
                callback({
                    text: 'Unable to process create wallet request. Could not obtain an encryption password.',
                    content: {
                        error: 'Invalid create wallet. Password could not be determined or generated.',
                    },
                });
            }
            return false;
        }

        try {
            // Generate a new wallet using the provided password and options
            const action = new CreateWalletAction(runtime);
            await action.initialize();

            const { walletAddress, mnemonic, walletNumber } = await action.createWallet({
                encryptionPassword: createWalletContent.encryptionPassword,
                keypairPassword: createWalletContent.keypairPassword,
                hardDerivation: createWalletContent.hardDerivation,
                softDerivation: createWalletContent.softDerivation,
            });

            // Build the user message based on what options were used
            let userMessageText = `
New Polkadot wallet created! 🎉

Wallet Number: ${walletNumber}
This wallet number can be used to load and interact with your wallet in future sessions.`;

            if (isPasswordGenerated) {
                userMessageText += `\n\nGenerated Encryption Password: ${createWalletContent.encryptionPassword}
⚠️ IMPORTANT: Please store this password securely. You'll need it to access your wallet backup.`;
            }

            userMessageText += `\n\nWallet Address: ${walletAddress}`;

            if (createWalletContent.keypairPassword) {
                userMessageText += `\nKeypair Password: ${createWalletContent.keypairPassword}`;
            }
            if (createWalletContent.hardDerivation) {
                userMessageText += `\nHard Derivation: ${createWalletContent.hardDerivation}`;
            }
            if (createWalletContent.softDerivation) {
                userMessageText += `\nSoft Derivation: ${createWalletContent.softDerivation}`;
            }

            userMessageText += `\n\n⚠️ IMPORTANT: Please securely store your mnemonic phrase:\n${mnemonic}`;

            const result = {
                status: 'success',
                walletAddress,
                walletNumber,
                mnemonic,
                keypairPassword: createWalletContent.keypairPassword,
                hardDerivation: createWalletContent.hardDerivation,
                softDerivation: createWalletContent.softDerivation,
                message: 'New Polkadot wallet created. Store the mnemonic securely for recovery.',
            };

            if (callback) {
                callback({
                    text: userMessageText,
                    content: result,
                });
            }

            return true;
        } catch (error) {
            elizaLogger.error('Error creating wallet:', error);
            if (callback) {
                callback({
                    text: `Error creating wallet: ${error.message}`,
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
                    text: "Please create a new Polkadot wallet with keypair password 'secret' and hard derivation 'test'",
                    action: 'CREATE_POLKADOT_WALLET',
                },
            },
            {
                name: '{{user2}}',
                content: {
                    text: 'New Polkadot wallet created!\nYour password was used to encrypt the wallet keypair, but never stored.\nWallet Address: EQAXxxxxxxxxxxxxxxxxxxxxxx\nWallet Number: 1\nKeypair Password: secret\nHard Derivation: test\n\nPlease securely store your mnemonic:',
                },
            },
        ],
        [
            {
                name: '{{user1}}',
                content: {
                    text: 'Please create a new wallet',
                    action: 'CREATE_POLKADOT_WALLET',
                },
            },
            {
                name: '{{user2}}',
                content: {
                    text: 'New Polkadot wallet created!\nWallet Number: 1\nWallet Address: EQAXxxxxxxxxxxxxxxxxxxxxxx\n\nPlease securely store your mnemonic:',
                },
            },
        ],
    ],
};
