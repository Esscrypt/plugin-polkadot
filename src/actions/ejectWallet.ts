import type { IAgentRuntime, Memory, State, HandlerCallback, Content } from '@elizaos/core';
import { logger, ModelType, composePromptFromState, parseJSONObjectFromText } from '@elizaos/core';
import { WalletProvider, initWalletProvider } from '../providers/wallet';
import { z } from 'zod';

export interface EjectWalletContent extends Content {
    password?: string;
    walletAddress?: string;
    walletNumber?: number;
}

function isEjectWalletContent(content: Content): content is EjectWalletContent {
    return (
        (typeof content.password === 'string' ||
            content.password === undefined ||
            content.password === null) &&
        (typeof content.walletAddress === 'string' ||
            content.walletAddress === undefined ||
            content.walletAddress === null) &&
        (typeof content.walletNumber === 'number' ||
            content.walletNumber === undefined ||
            content.walletNumber === null)
    );
}

// Define a schema for input JSON
const ejectWalletSchema = z.object({
    password: z.string().optional().nullable(),
    walletAddress: z.string().optional().nullable(),
    walletNumber: z.number().optional().nullable(),
});

// Define a template to guide object building
const ejectWalletTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.
Example response:
\`\`\`json
{
  "password": "my_password",
  "walletAddress": "EQAXxxxxxxxxxxxxxxxxxxxxxx",
  "walletNumber": 1
}
\`\`\`

{{recentMessages}}

Respond with a JSON markdown block containing only the extracted values`;

/**
 * Builds and validates eject wallet details using the provided runtime, message, and state.
 */
export async function buildEjectWalletDetails(
    runtime: IAgentRuntime,
    _message: Memory,
    state: State,
): Promise<EjectWalletContent> {
    const prompt = composePromptFromState({
        state,
        template: ejectWalletTemplate,
    });

    let parsedResponse: EjectWalletContent | null = null;
    for (let i = 0; i < 5; i++) {
        const response = await runtime.useModel(ModelType.TEXT_SMALL, {
            prompt,
        });
        parsedResponse = parseJSONObjectFromText(response) as EjectWalletContent | null;
        if (parsedResponse) {
            break;
        }
    }

    //zod validate the response
    const validatedResponse = ejectWalletSchema.safeParse(parsedResponse);

    if (!validatedResponse.success) {
        throw new Error('Failed to extract a valid Polkadot address from the message');
    }

    return validatedResponse.data as EjectWalletContent;
}

export default {
    name: 'EJECT_POLKADOT_WALLET',
    similes: ['EXPORT_POLKADOT_WALLET', 'RECOVER_WALLET', 'EJECT_WALLET'],
    description:
        "Ejects an existing Polkadot wallet either by wallet number or from an encrypted backup file. Returns the wallet's mnemonic.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: Record<string, unknown>,
        callback?: HandlerCallback,
    ) => {
        logger.log('Starting EJECT_POLKADOT_WALLET action...');

        const ejectWalletContent = await buildEjectWalletDetails(runtime, message, state);

        if (!isEjectWalletContent(ejectWalletContent)) {
            if (callback) {
                callback({
                    text: 'Unable to process eject wallet request. Please provide either a wallet number or wallet address.',
                    content: {
                        error: 'Invalid eject wallet request. Missing required parameters.',
                    },
                });
            }
            return false;
        }

        try {
            logger.debug('ejectWalletContent', ejectWalletContent);
            const { password, walletAddress, walletNumber } = ejectWalletContent;

            // Initialize the wallet provider
            const walletProvider = await initWalletProvider(runtime);

            let mnemonic: string;
            let address: string;

            // Try to load by wallet number first
            if (walletNumber) {
                const targetWallet = await WalletProvider.loadWalletByNumber(
                    walletProvider,
                    walletNumber,
                    password,
                );
                if (!targetWallet) {
                    throw new Error(
                        `Failed to load wallet #${walletNumber}. Please check the wallet number and password.`,
                    );
                }
                address = targetWallet.getAddress();

                // Try to get mnemonic from decrypted data first
                const walletData = await WalletProvider.getWalletData(targetWallet, walletNumber);
                if (walletData?.decryptedKeyring?.mnemonic) {
                    mnemonic = walletData.decryptedKeyring.mnemonic;
                } else if (password) {
                    // Fall back to file system if no decrypted data in cache
                    logger.log(
                        `No decrypted data in cache for wallet #${walletNumber}, falling back to file system`,
                    );
                    const result = await WalletProvider.ejectWalletFromFile(
                        walletProvider,
                        address,
                        password,
                    );
                    mnemonic = result.mnemonic;
                } else {
                    throw new Error(
                        `No decrypted data found for wallet #${walletNumber} and no password provided for file system fallback`,
                    );
                }
            }
            // Fall back to file-based ejection if address is provided
            else if (walletAddress && password) {
                const result = await WalletProvider.ejectWalletFromFile(
                    walletProvider,
                    walletAddress,
                    password,
                );
                mnemonic = result.mnemonic;
                address = walletAddress;
            } else {
                throw new Error(
                    'Please provide either a wallet number or both wallet address and password.',
                );
            }

            const result = {
                status: 'success',
                walletAddress: address,
                mnemonic,
                message: `
Wallet ejected successfully.
Your Decrypted mnemonic is:\n\n ${mnemonic}.
Please store it securely.`,
            };

            if (callback) {
                callback({
                    text: `Wallet ejected successfully.\n\nYour Decrypted mnemonic is:\n\n ${mnemonic}.\n\nPlease store it securely.`,
                    content: result,
                });
            }

            return true;
        } catch (error) {
            logger.error('Error ejecting wallet:', error);
            if (callback) {
                callback({
                    text: `Error ejecting wallet: ${error.message}`,
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
                    text: 'Please eject my Polkadot wallet #1 with password my_password',
                    action: 'EJECT_POLKADOT_WALLET',
                },
            },
            {
                name: '{{user2}}',
                content: {
                    text: 'Wallet ejected successfully. Your Decrypted mnemonic is: mnemonic. Please store it securely.',
                },
            },
        ],
        [
            {
                name: '{{user1}}',
                content: {
                    text: 'Please eject my Polkadot wallet with address 1234567890 and password my_password',
                    action: 'EJECT_POLKADOT_WALLET',
                },
            },
            {
                name: '{{user2}}',
                content: {
                    text: 'Wallet ejected successfully. Your Decrypted mnemonic is: mnemonic. Please store it securely.',
                },
            },
        ],
    ],
};
