import type { IAgentRuntime, Memory, State, HandlerCallback, Content } from '@elizaos/core';
import { logger, ModelType, composePromptFromState, parseJSONObjectFromText } from '@elizaos/core';
import { WalletProvider, initWalletProvider, PROVIDER_CONFIG } from '../providers/wallet';
import { z } from 'zod';
import type { KeyringOptions } from '@polkadot/keyring/types';

export interface ImportWalletContent extends Content {
    mnemonic: string;
    encryptionPassword?: string;
    keypairPassword?: string;
    hardDerivation?: string;
    softDerivation?: string;
    keyringType?: KeyringOptions['type'];
    ss58Format?: number;
}

// Define a schema for input JSON that must include a mnemonic.
export const importWalletSchema = z.object({
    mnemonic: z.string().min(12, { message: 'Mnemonic must be at least 12 words long.' }), // Basic validation
    encryptionPassword: z.string().optional().nullable(),
    keypairPassword: z.string().optional().nullable(),
    hardDerivation: z.string().optional().nullable(),
    softDerivation: z.string().optional().nullable(),
    keyringType: z.enum(['ed25519', 'sr25519', 'ecdsa']).optional().nullable(),
    ss58Format: z.number().optional().nullable(),
});

// Define a template to guide object building for import details
export const importWalletTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.
The mnemonic is essential.
Example response:
\`\`\`json
{
  "mnemonic": "word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12",
  "encryptionPassword": "<your password here>",
  "keypairPassword": "<optional password for keypair>",
  "hardDerivation": "<optional hard derivation path>",
  "softDerivation": "<optional soft derivation path>",
  "keyringType": "ed25519",
  "ss58Format": 42
}
\`\`\`

{{recentMessages}}

If a mnemonic is not provided in the latest message, you MUST ask the user for it.
If an encryption password is not provided in the latest message, return null for the encryption password.

Respond with a JSON markdown block containing only the extracted values.`;

// Function to build and validate import wallet details (To be implemented)
export async function buildImportWalletDetails(
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
): Promise<{ content: ImportWalletContent; wasEncryptionPasswordGenerated: boolean }> {
    const currentState = state || (await runtime.composeState(message));

    const prompt = composePromptFromState({
        state: currentState,
        template: importWalletTemplate,
    });

    let parsedResponse: ImportWalletContent | null = null;
    for (let i = 0; i < 5; i++) {
        const response = await runtime.useModel(ModelType.TEXT_SMALL, {
            prompt,
        });
        parsedResponse = parseJSONObjectFromText(response) as ImportWalletContent | null;
        if (parsedResponse) {
            break;
        }
    }

    let importData = parsedResponse;
    let wasEncryptionPasswordGenerated = false;

    if (!importData) {
        // This case should ideally be handled by asking the user for a mnemonic
        // For now, we'll throw an error or return a specific state if no data is extracted.
        // This part might need refinement based on how you want to handle missing mnemonics.
        logger.error('Could not extract import wallet details from the message.');
        throw new Error(
            'Mnemonic is required to import a wallet. Please provide your mnemonic phrase.',
        );
    }

    if (!importData.mnemonic) {
        logger.warn('Mnemonic was not extracted. This should be prompted by the template.');
        // Depending on strictness, you might throw an error here or let the handler ask the user.
        throw new Error('Mnemonic is required and was not found in your message.');
    }

    // If encryptionPassword is not available, generate one.
    if (!importData.encryptionPassword) {
        const generatedPassword = Math.random().toString(36).slice(-12); // Generate a 12-character random password
        logger.log('Encryption password not provided by user for import, generating one.');
        importData = { ...importData, encryptionPassword: generatedPassword };
        wasEncryptionPasswordGenerated = true;
    }

    return { content: importData, wasEncryptionPasswordGenerated };
}

// Action class (To be implemented)
export class ImportWalletAction {
    private runtime: IAgentRuntime;
    private walletProvider: WalletProvider;

    constructor(runtime: IAgentRuntime) {
        this.runtime = runtime;
    }

    async initialize(): Promise<void> {
        this.walletProvider = await initWalletProvider(this.runtime);
    }

    async importWallet(params: ImportWalletContent): Promise<{
        walletAddress: string;
        walletNumber: number;
        encryptedBackup: string;
    }> {
        logger.debug('Importing wallet with params:', params);

        const keyringOptions: KeyringOptions = {
            type: params.keyringType || PROVIDER_CONFIG.DEFAULT_KEYRING_TYPE,
            ss58Format:
                params.ss58Format === undefined || params.ss58Format === null
                    ? PROVIDER_CONFIG.DEFAULT_KEYRING_SS58_FORMAT
                    : params.ss58Format,
        };

        const { address, encryptedBackup, walletNumber } =
            await WalletProvider.importMnemonicAndStore(
                this.runtime,
                params.mnemonic,
                params.encryptionPassword,
                {
                    keypairPassword: params.keypairPassword,
                    hardDerivation: params.hardDerivation,
                    softDerivation: params.softDerivation,
                    keyringOptions: keyringOptions,
                },
            );

        logger.log(`Imported wallet successfully. Address: ${address}, Number: ${walletNumber}`);

        return { walletAddress: address, walletNumber, encryptedBackup };
    }
}

// Main action export (To be implemented)
export default {
    name: 'IMPORT_POLKADOT_WALLET',
    similes: ['RESTORE_POLKADOT_WALLET', 'LOAD_POLKADOT_WALLET_FROM_MNEMONIC'],
    description:
        'Imports a Polkadot wallet using a mnemonic phrase. Returns the public address and wallet number. The wallet keypair is encrypted to a file using the provided or a generated password. Optionally supports keypair password, derivation paths, and keyring configuration.',
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: Record<string, unknown>,
        callback?: HandlerCallback,
    ) => {
        logger.log('Starting IMPORT_POLKADOT_WALLET action...');

        try {
            const { content: importWalletContent, wasEncryptionPasswordGenerated } =
                await buildImportWalletDetails(runtime, message, state);

            logger.debug('importWalletContent', importWalletContent);

            if (!importWalletContent.mnemonic) {
                // This should ideally be caught by buildImportWalletDetails, but as a safeguard:
                logger.error('Mnemonic is missing after buildImportWalletDetails.');
                if (callback) {
                    callback({
                        text: 'Unable to process import wallet request. Mnemonic is required.',
                        content: { error: 'Mnemonic is required but was not provided.' },
                    });
                }
                return false;
            }

            // Ensure encryptionPassword is a string (it's generated if not provided)
            if (typeof importWalletContent.encryptionPassword !== 'string') {
                logger.error('Encryption password was not set or generated.');
                if (callback) {
                    callback({
                        text: 'Unable to process import wallet request. Could not determine encryption password.',
                        content: { error: 'Encryption password missing.' },
                    });
                }
                return false;
            }

            const action = new ImportWalletAction(runtime);
            // No need to call action.initialize() separately as WalletProvider.importMnemonicAndStore handles cryptoWaitReady
            // and initWalletProvider is not strictly needed for the importMnemonicAndStore flow directly within the action method itself.
            // The runtime.cacheManager is passed directly.

            const { walletAddress, walletNumber } = await action.importWallet(importWalletContent);

            let userMessageText = `
Polkadot wallet imported successfully! 🎉

Wallet Number: ${walletNumber}
This wallet number can be used to load and interact with your wallet in future sessions.

Wallet Address: ${walletAddress}`;

            if (wasEncryptionPasswordGenerated) {
                userMessageText += `\n\nGenerated Encryption Password: ${importWalletContent.encryptionPassword}
⚠️ IMPORTANT: Please store this password securely. You'll need it to access your wallet backup.`;
            }

            if (importWalletContent.keypairPassword) {
                userMessageText += `\nKeypair Password: ${importWalletContent.keypairPassword}`;
            }
            if (importWalletContent.hardDerivation) {
                userMessageText += `\nHard Derivation: ${importWalletContent.hardDerivation}`;
            }
            if (importWalletContent.softDerivation) {
                userMessageText += `\nSoft Derivation: ${importWalletContent.softDerivation}`;
            }
            if (importWalletContent.keyringType) {
                userMessageText += `\nKeyring Type: ${importWalletContent.keyringType}`;
            }
            if (
                importWalletContent.ss58Format !== undefined &&
                importWalletContent.ss58Format !== null
            ) {
                userMessageText += `\nSS58 Format: ${importWalletContent.ss58Format}`;
            }

            const result = {
                status: 'success',
                walletAddress,
                walletNumber,
                message: 'Polkadot wallet imported successfully from mnemonic.',
            };

            if (callback) {
                callback({
                    text: userMessageText,
                    content: result,
                });
            }

            return true;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('Error importing wallet:', errorMessage, error);
            if (callback) {
                callback({
                    text: `Error importing wallet: ${errorMessage}`,
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
                name: '{{user1}}',
                content: {
                    text: "Please import my Polkadot wallet. My mnemonic is 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima' and I want to use 'mySecurePassword123' for encryption.",
                    action: 'IMPORT_POLKADOT_WALLET',
                },
            },
            {
                name: '{{user2}}',
                content: {
                    text: 'Polkadot wallet imported successfully! 🎉\n\nWallet Number: 2\nWallet Address: 5ExampleAddressxxxxxxxxxxxxxxxxx\n\nEncryption Password: mySecurePassword123',
                },
            },
        ],
        [
            {
                name: '{{user1}}',
                content: {
                    text: "Import a wallet with mnemonic 'mystery puzzle session diamond ... (12 to 24 words) ... rocket science' and use password 'anotherPass', keyring type sr25519 and ss58 format 2.",
                    action: 'IMPORT_POLKADOT_WALLET',
                },
            },
            {
                name: '{{user2}}',
                content: {
                    text: 'Polkadot wallet imported successfully! 🎉\n\nWallet Number: 3\nWallet Address: 5AnotherExampleAddressyyyyyyyy\n\nEncryption Password: anotherPass\nKeyring Type: sr25519\nSS58 Format: 2',
                },
            },
        ],
        [
            {
                name: '{{user1}}',
                content: {
                    text: "Import wallet: 'word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12'",
                    action: 'IMPORT_POLKADOT_WALLET',
                },
            },
            {
                name: '{{user2}}',
                content: {
                    // Assuming a password was generated
                    text: 'Polkadot wallet imported successfully! 🎉\n\nWallet Number: 4\nWallet Address: 5YetAnotherAddresszzzzzzzzzzzz\n\nGenerated Encryption Password: <generated_password_here>',
                },
            },
        ],
    ],
};
