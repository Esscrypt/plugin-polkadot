import type { IAgentRuntime, Memory, Provider, State, ProviderResult } from '@elizaos/core';
import { logger } from '@elizaos/core';

import * as path from 'node:path'; // Changed to use node: protocol
import type BigNumber from 'bignumber.js';

import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady, mnemonicGenerate } from '@polkadot/util-crypto';
import type { KeyringOptions } from '@polkadot/keyring/types';
import { z } from 'zod'; // Add Zod import

import fs from 'node:fs';
import { fetchPrices, getFormattedPortfolio } from '../utils/wallet';
import { encrypt, decrypt } from '../utils/encryption';

export const PROVIDER_CONFIG = {
    NATIVE_TOKEN_SYMBOL: 'DOT',
    COINMARKETCAP_API_URL: 'https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest',
    MAX_RETRIES: 3,
    RETRY_DELAY: 2000,
    NATIVE_TOKEN_DECIMALS: BigInt(10000000000),
    WALLET_BACKUP_DIRNAME: 'polkadot_wallet_backups',
    DEFAULT_KEYRING_TYPE: 'ed25519' as const,
    DEFAULT_KEYRING_SS58_FORMAT: 42, // substrate generic, 2 for kusama, 0 for polkadot
};

interface WalletData {
    source: WalletProviderSource;
    address: string;
    createdAt: number;
    decryptedKeyring?: {
        type: KeyringOptions['type'];
        mnemonic: string;
        options: KeyringOptions;
    };
}

export interface OptimizedWalletCache {
    wallets: {
        [address: string]: {
            number: number;
            createdAt: number;
            sourceType: WalletSourceType;
            encryptedData?: string;
            mnemonicData?: {
                mnemonic: string;
                options: KeyringOptions;
            };
        };
    };
    numberToAddress: {
        [number: number]: string;
    };
}

// Replace multiple cache keys with a single one
export const WALLET_CACHE_KEY = 'polkadot/wallets';

// --- Enum and Interfaces for Constructor --- //
export enum WalletSourceType { // Exported for potential external use
    FROM_MNEMONIC = 'fromMnemonic',
    FROM_ENCRYPTED_JSON = 'fromEncryptedJson',
}

// Zod schema for KeyringOptions
const keyringOptionsSchema = z.object({
    type: z.enum(['ed25519', 'sr25519', 'ecdsa']).optional(), // Made optional to handle potential older backups
    ss58Format: z.number().optional(), // Made optional for flexibility
    genesisHash: z.union([z.string(), z.instanceof(Uint8Array)]).optional(),
    // parentAddress: z.string().optional(), // Add if needed, keeping it simple for now
});

// This interface defines the structure of the data stored in the encrypted backup file.
// And a corresponding Zod schema for validation.
interface DecryptedWalletBackupData {
    mnemonic: string;
    options: KeyringOptions; // Contains type, ss58Format for the keyring
    password?: string; // Optional password for deriving the keypair (part of SURI)
    hardDerivation?: string; // Optional hard derivation path (part of SURI)
    softDerivation?: string; // Optional soft derivation path (part of SURI)
}

const decryptedWalletBackupDataSchema = z.object({
    mnemonic: z.string().min(12), // Basic mnemonic validation
    options: keyringOptionsSchema,
    password: z.string().optional(),
    hardDerivation: z.string().optional(),
    softDerivation: z.string().optional(),
});

interface WalletSourceFromMnemonic {
    type: WalletSourceType.FROM_MNEMONIC;
    mnemonic: string;
    keyringOptions?: KeyringOptions;
    password?: string;
    hardDerivation?: string;
    softDerivation?: string;
}
interface WalletSourceFromEncryptedJson {
    type: WalletSourceType.FROM_ENCRYPTED_JSON;
    encryptedJson: string;
    password: string;
}

type WalletProviderSource = WalletSourceFromMnemonic | WalletSourceFromEncryptedJson;

export interface WalletProviderConstructionParams {
    // Exporting for potential external use
    source: WalletProviderSource;
    runtime: IAgentRuntime;
}
// --- End Interfaces --- //

export class WalletProvider {
    runtime: IAgentRuntime;
    keyring: Keyring;
    coinMarketCapApiKey: string;
    walletNumber: number | null = null;
    source: WalletProviderSource;

    constructor(params: WalletProviderConstructionParams) {
        this.runtime = params.runtime;
        this.coinMarketCapApiKey = process.env.COINMARKETCAP_API_KEY || '';
        if (!this.coinMarketCapApiKey) {
            logger.warn('COINMARKETCAP_API_KEY is not set. Price fetching will likely fail.');
        }

        const { source } = params;
        this.source = source;

        try {
            // Reinstating the in-constructor dispatch map
            const dispatchMap: Record<WalletSourceType, () => void> = {
                [WalletSourceType.FROM_MNEMONIC]: () =>
                    this._initializeFromMnemonic(source as WalletSourceFromMnemonic),
                [WalletSourceType.FROM_ENCRYPTED_JSON]: () =>
                    this._initializeFromEncryptedJson(source as WalletSourceFromEncryptedJson),
            };

            // Execute the appropriate initialization function from the map
            dispatchMap[source.type]();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`WalletProvider constructor failed: ${message}`);
            throw new Error(`Failed to initialize WalletProvider: ${message}`);
        }

        if (!this.keyring || this.keyring.getPairs().length === 0) {
            throw new Error(
                `Keypair not loaded into keyring after initialization from source: ${source.type}`,
            );
        }
    }

    static async storeWalletInCache(
        address: string,
        wallet: WalletProvider,
        walletNumber?: number,
    ): Promise<void> {
        logger.debug('Starting storeWalletInCache for address:', address);

        let cache: OptimizedWalletCache;
        try {
            const cachedData =
                await wallet.runtime.getCache<OptimizedWalletCache>(WALLET_CACHE_KEY);
            if (cachedData) {
                logger.debug('Retrieved existing cache');
                cache = cachedData;
            } else {
                logger.debug('No existing cache found, creating new one');
                cache = {
                    wallets: {},
                    numberToAddress: {},
                };
            }
        } catch (error) {
            logger.error('Error retrieving cache, creating new one:', {
                error:
                    error instanceof Error
                        ? {
                              message: error.message,
                              stack: error.stack,
                              name: error.name,
                          }
                        : error,
            });
            cache = {
                wallets: {},
                numberToAddress: {},
            };
        }

        const finalWalletNumber =
            walletNumber ?? (await WalletProvider.getWalletNumberFromCache(address, cache));
        logger.debug('Assigned wallet number:', finalWalletNumber);

        // Only store serializable data
        const walletData = {
            number: finalWalletNumber,
            createdAt: Date.now(),
            sourceType: wallet.source.type,
            ...(wallet.source.type === WalletSourceType.FROM_MNEMONIC && {
                mnemonicData: {
                    mnemonic: wallet.source.mnemonic,
                    options: wallet.source.keyringOptions || {
                        type: PROVIDER_CONFIG.DEFAULT_KEYRING_TYPE,
                        ss58Format: PROVIDER_CONFIG.DEFAULT_KEYRING_SS58_FORMAT,
                    },
                },
            }),
            ...(wallet.source.type === WalletSourceType.FROM_ENCRYPTED_JSON && {
                encryptedData: wallet.source.encryptedJson,
            }),
        };

        cache.wallets[address] = walletData;
        cache.numberToAddress[finalWalletNumber] = address;

        try {
            await wallet.runtime.setCache(WALLET_CACHE_KEY, cache);
            logger.debug('Successfully stored wallet in cache');
        } catch (error) {
            logger.error('Failed to store wallet in cache:', {
                error:
                    error instanceof Error
                        ? {
                              message: error.message,
                              stack: error.stack,
                              name: error.name,
                          }
                        : error,
            });
            throw new Error(
                `Failed to store wallet in cache: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    }

    private static async getWalletNumberFromCache(
        address: string,
        cache: OptimizedWalletCache,
    ): Promise<number | null> {
        return cache.wallets[address]?.number || null;
    }

    private static getNextWalletNumberFromFilesystem(): number {
        const backupDir = path.join(process.cwd(), PROVIDER_CONFIG.WALLET_BACKUP_DIRNAME);
        if (!fs.existsSync(backupDir)) {
            return 1;
        }

        try {
            const files = fs.readdirSync(backupDir);
            if (files.length === 0) {
                return 1;
            }
            return files.length; // Fixed: return the actual number of files
        } catch (_error) {
            logger.warn(
                'Error reading backup directory for wallet numbering, defaulting to 1:',
                _error,
            );
            return 1;
        }
    }

    static async clearWalletFromCache(wallet: WalletProvider, address: string): Promise<void> {
        const cache = await wallet.runtime.getCache<OptimizedWalletCache>(WALLET_CACHE_KEY);
        if (!cache) return;

        const walletNumber = cache.wallets[address]?.number;
        if (walletNumber) {
            delete cache.numberToAddress[walletNumber];
        }
        delete cache.wallets[address];

        await wallet.runtime.setCache(WALLET_CACHE_KEY, cache);
    }

    static async clearAllWalletsFromCache(wallet: WalletProvider): Promise<void> {
        await wallet.runtime.setCache(WALLET_CACHE_KEY, {
            wallets: {},
            numberToAddress: {},
        });
    }

    static async loadWalletByAddress(
        wallet: WalletProvider,
        address: string,
        password?: string,
    ): Promise<WalletProvider> {
        // First check cache
        const cache = await wallet.runtime.getCache<OptimizedWalletCache>(WALLET_CACHE_KEY);
        if (cache?.wallets[address]) {
            const walletData = cache.wallets[address];
            if (walletData.mnemonicData) {
                return new WalletProvider({
                    runtime: wallet.runtime,
                    source: {
                        type: WalletSourceType.FROM_MNEMONIC,
                        mnemonic: walletData.mnemonicData.mnemonic,
                        keyringOptions: walletData.mnemonicData.options,
                    },
                });
            }
            if (walletData.encryptedData && password) {
                return new WalletProvider({
                    runtime: wallet.runtime,
                    source: {
                        type: WalletSourceType.FROM_ENCRYPTED_JSON,
                        encryptedJson: walletData.encryptedData,
                        password,
                    },
                });
            }
            if (walletData.encryptedData && !password) {
                throw new Error(
                    `Wallet found in cache but no password provided for address ${address}`,
                );
            }
        }

        // If not in cache, check file system
        const backupDir = path.join(process.cwd(), PROVIDER_CONFIG.WALLET_BACKUP_DIRNAME);
        const fileName = `${address}_wallet_backup.json`;
        const filePath = path.join(backupDir, fileName);

        if (!fs.existsSync(filePath)) {
            throw new Error(`No stored data found for wallet address ${address}`);
        }

        if (!password) {
            throw new Error(
                `Wallet found in file system but no password provided for address ${address}`,
            );
        }

        const encryptedFileContent = fs.readFileSync(filePath, {
            encoding: 'utf-8',
        });

        const walletProvider = new WalletProvider({
            runtime: wallet.runtime,
            source: {
                type: WalletSourceType.FROM_ENCRYPTED_JSON,
                encryptedJson: encryptedFileContent,
                password,
            },
        });

        // Store in cache for future use
        await WalletProvider.storeWalletInCache(address, walletProvider);
        return walletProvider;
    }

    static async loadWalletByNumber(
        wallet: WalletProvider,
        number: number,
        password?: string,
    ): Promise<WalletProvider> {
        // First check cache
        const cache = await wallet.runtime.getCache<OptimizedWalletCache>(WALLET_CACHE_KEY);
        if (cache?.numberToAddress[number]) {
            const address = cache.numberToAddress[number];
            const walletData = cache.wallets[address];

            if (walletData.mnemonicData) {
                return new WalletProvider({
                    runtime: wallet.runtime,
                    source: {
                        type: WalletSourceType.FROM_MNEMONIC,
                        mnemonic: walletData.mnemonicData.mnemonic,
                        keyringOptions: walletData.mnemonicData.options,
                    },
                });
            }
            if (walletData.encryptedData && password) {
                return new WalletProvider({
                    runtime: wallet.runtime,
                    source: {
                        type: WalletSourceType.FROM_ENCRYPTED_JSON,
                        encryptedJson: walletData.encryptedData,
                        password,
                    },
                });
            }
            if (walletData.encryptedData && !password) {
                throw new Error(`Wallet #${number} found in cache but no password provided`);
            }
        }

        // If not in cache, check file system
        const backupDir = path.join(process.cwd(), PROVIDER_CONFIG.WALLET_BACKUP_DIRNAME);
        if (!fs.existsSync(backupDir)) {
            throw new Error(`No wallet found with number ${number}`);
        }

        const files = fs.readdirSync(backupDir);
        if (number <= 0 || number > files.length) {
            throw new Error(`No wallet found with number ${number}`);
        }

        if (!password) {
            throw new Error(`Wallet #${number} found in file system but no password provided`);
        }

        const targetFile = files[number - 1];
        const filePath = path.join(backupDir, targetFile);
        const encryptedFileContent = fs.readFileSync(filePath, {
            encoding: 'utf-8',
        });

        const walletProvider = new WalletProvider({
            runtime: wallet.runtime,
            source: {
                type: WalletSourceType.FROM_ENCRYPTED_JSON,
                encryptedJson: encryptedFileContent,
                password,
            },
        });

        // Store in cache for future use
        await WalletProvider.storeWalletInCache(walletProvider.getAddress(), walletProvider);
        return walletProvider;
    }

    // Private helper to initialize keyring from detailed components
    private _initKeyringFromDetails(
        mnemonic: string,
        keyringOptions: KeyringOptions,
        keypairPassword?: string, // Password for the keypair itself (goes into SURI)
        hardDerivation?: string,
        softDerivation?: string,
        pairName = 'derived pair', // Added pairName as parameter
    ): void {
        this.keyring = new Keyring(keyringOptions);
        let suri = mnemonic;
        if (keypairPassword) {
            suri = `${suri}///${keypairPassword}`;
        }
        if (hardDerivation) {
            suri = `${suri}//${hardDerivation}`;
        }
        if (softDerivation) {
            suri = `${suri}/${softDerivation}`;
        }
        logger.debug('Generated SURI for keyring init:', suri, 'with options:', keyringOptions);
        this.keyring.addFromUri(suri, { name: pairName }, keyringOptions.type);
    }

    // Private handler methods for initialization logic
    private _initializeFromMnemonic(source: WalletSourceFromMnemonic): void {
        try {
            logger.debug('Initializing wallet from mnemonic');
            const opts = source.keyringOptions || {
                type: PROVIDER_CONFIG.DEFAULT_KEYRING_TYPE,
                ss58Format: PROVIDER_CONFIG.DEFAULT_KEYRING_SS58_FORMAT,
            };
            logger.debug('Using keyring options:', opts);

            this._initKeyringFromDetails(
                source.mnemonic,
                opts,
                source.password, // This is the keypair password from the source
                source.hardDerivation,
                source.softDerivation,
                'main pair', // Specific name for this initialization path
            );
            logger.debug('Wallet initialized successfully from mnemonic');
        } catch (error) {
            logger.error('Error initializing from mnemonic:', {
                error:
                    error instanceof Error
                        ? {
                              message: error.message,
                              stack: error.stack,
                              name: error.name,
                          }
                        : error,
            });
            throw new Error(`Failed to initialize wallet from mnemonic: ${error.message}`);
        }
    }

    private _initializeFromEncryptedJson(source: WalletSourceFromEncryptedJson): void {
        try {
            logger.debug('Initializing wallet from encrypted JSON');
            logger.debug('Encrypted data length:', source.encryptedJson.length);

            const decryptedJson = decrypt(source.encryptedJson, source.password); // source.password is for decryption
            logger.debug('Decrypted JSON length:', decryptedJson.length);
            // logger.debug('Decrypted JSON content:', decryptedJson); // Avoid logging potentially sensitive mnemonics

            let walletData: DecryptedWalletBackupData;
            try {
                logger.debug('Attempting to parse and validate decrypted JSON for wallet data');
                const parsedJson: unknown = JSON.parse(decryptedJson);
                walletData = decryptedWalletBackupDataSchema.parse(
                    parsedJson,
                ) as DecryptedWalletBackupData;
                logger.debug('Successfully parsed and validated wallet data structure');
            } catch (parseError) {
                logger.error('JSON Parse or Validation Error:', {
                    error:
                        parseError instanceof Error
                            ? {
                                  message: parseError.message,
                                  stack: parseError.stack,
                                  name: parseError.name,
                              }
                            : parseError,
                    // json: decryptedJson, // Avoid logging potentially sensitive mnemonics
                });
                throw new Error(`Failed to parse decrypted wallet data: ${parseError.message}`);
            }

            if (!walletData.mnemonic || !walletData.options) {
                logger.error(
                    'Missing required fields (mnemonic or options) in parsed wallet data.',
                );
                throw new Error('Decrypted data missing required fields (mnemonic or options)');
            }

            // Ensure options has a type, default if not present (though it should be by generator)
            const keyringInitOptions = walletData.options;
            if (!keyringInitOptions.type) {
                logger.warn(
                    'Keyring type missing in decrypted options, defaulting to ed25519 as per PROVIDER_CONFIG',
                );
                keyringInitOptions.type = PROVIDER_CONFIG.DEFAULT_KEYRING_TYPE;
            }
            if (
                keyringInitOptions.ss58Format === undefined ||
                keyringInitOptions.ss58Format === null
            ) {
                logger.warn(
                    'ss58Format missing in decrypted options, defaulting as per PROVIDER_CONFIG',
                );
                keyringInitOptions.ss58Format = PROVIDER_CONFIG.DEFAULT_KEYRING_SS58_FORMAT;
            }

            this._initKeyringFromDetails(
                walletData.mnemonic,
                keyringInitOptions, // These are the KeyringOptions from the backup (type, ss58Format)
                walletData.password, // This is the keypair password from the backup for the SURI
                walletData.hardDerivation,
                walletData.softDerivation,
                'imported main pair', // Specific name for this initialization path
            );
            logger.debug('Wallet initialized successfully from encrypted JSON');
        } catch (error) {
            logger.error('Error initializing from encrypted JSON:', {
                error:
                    error instanceof Error
                        ? {
                              message: error.message,
                              stack: error.stack,
                              name: error.name,
                          }
                        : error,
            });
            throw new Error(`Failed to initialize wallet from encrypted data: ${error.message}`);
        }
    }

    async fetchPrices(): Promise<{ nativeToken: { usd: BigNumber } }> {
        return fetchPrices(this.runtime, this.coinMarketCapApiKey);
    }

    getAddress(): string {
        const pairs = this.keyring.getPairs();
        if (pairs.length === 0) {
            throw new Error('No keypairs available in the keyring to get an address.');
        }
        return pairs[0].address;
    }

    async getWalletNumber(): Promise<number | null> {
        if (this.walletNumber !== null) {
            return this.walletNumber;
        }

        const address = this.getAddress();

        const cache = await this.runtime.getCache<OptimizedWalletCache>(WALLET_CACHE_KEY);
        const number = cache?.wallets[address]?.number;
        this.walletNumber = number !== undefined ? Number(number) : null;
        return this.walletNumber;
    }

    static async getWalletData(wallet: WalletProvider, number: number): Promise<WalletData | null> {
        const cache = await wallet.runtime.getCache<OptimizedWalletCache>(WALLET_CACHE_KEY);
        if (!cache?.numberToAddress[number]) return null;

        const address = cache.numberToAddress[number];
        const walletData = cache.wallets[address];
        if (!walletData) return null;

        return {
            source: {
                type: walletData.sourceType,
                ...(walletData.mnemonicData && {
                    mnemonic: walletData.mnemonicData.mnemonic,
                    keyringOptions: walletData.mnemonicData.options,
                }),
                ...(walletData.encryptedData && {
                    encryptedJson: walletData.encryptedData,
                }),
            } as WalletProviderSource,
            address,
            createdAt: walletData.createdAt,
        };
    }

    static async getWalletByAddress(
        wallet: WalletProvider,
        address: string,
    ): Promise<WalletData | null> {
        const cache = await wallet.runtime.getCache<OptimizedWalletCache>(WALLET_CACHE_KEY);
        if (!cache?.wallets[address]) return null;

        const walletData = cache.wallets[address];
        return {
            source: {
                type: walletData.sourceType,
                ...(walletData.mnemonicData && {
                    mnemonic: walletData.mnemonicData.mnemonic,
                    keyringOptions: walletData.mnemonicData.options,
                }),
                ...(walletData.encryptedData && {
                    encryptedJson: walletData.encryptedData,
                }),
            } as WalletProviderSource,
            address,
            createdAt: walletData.createdAt,
        };
    }

    static async generateNew(
        wallet: WalletProvider,
        password: string,
        options?: {
            password?: string;
            hardDerivation?: string;
            softDerivation?: string;
            keyringOptions?: KeyringOptions;
        },
    ): Promise<{
        walletProvider: WalletProvider;
        mnemonic: string;
        encryptedBackup: string;
        walletNumber: number;
    }> {
        const mnemonic = mnemonicGenerate(24);

        const keyringOptions: KeyringOptions = options?.keyringOptions || {
            type: PROVIDER_CONFIG.DEFAULT_KEYRING_TYPE,
            ss58Format: PROVIDER_CONFIG.DEFAULT_KEYRING_SS58_FORMAT,
        };

        // Create a clean object with only the necessary properties
        const dataToEncrypt: DecryptedWalletBackupData = {
            mnemonic,
            options: keyringOptions, // This is KeyringOptions (type, ss58Format)
            password: options?.password, // This is the keypair password for SURI
            hardDerivation: options?.hardDerivation,
            softDerivation: options?.softDerivation,
        };

        // Ensure proper JSON stringification
        const jsonString = JSON.stringify(dataToEncrypt);

        try {
            const encryptedMnemonicAndOptions = encrypt(jsonString, password);

            const newWalletProvider = new WalletProvider({
                runtime: wallet.runtime,
                source: {
                    type: WalletSourceType.FROM_MNEMONIC,
                    mnemonic,
                    keyringOptions,
                    password: options?.password,
                    hardDerivation: options?.hardDerivation,
                    softDerivation: options?.softDerivation,
                },
            });

            const backupDir = path.join(process.cwd(), PROVIDER_CONFIG.WALLET_BACKUP_DIRNAME);
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }
            const address = newWalletProvider.getAddress();

            const fileName = `${address}_wallet_backup.json`;
            const filePath = path.join(backupDir, fileName);

            if (!fs.existsSync(path.dirname(filePath))) {
                fs.mkdirSync(path.dirname(filePath), { recursive: true });
            }

            fs.writeFileSync(filePath, encryptedMnemonicAndOptions, {
                encoding: 'utf-8',
            });
            logger.log(`Wallet backup saved to ${filePath}`);

            // Get the next wallet number from filesystem
            const walletNumber = WalletProvider.getNextWalletNumberFromFilesystem();

            // Store wallet data in cache using the existing method with the wallet number
            await WalletProvider.storeWalletInCache(address, newWalletProvider, walletNumber);
            newWalletProvider.walletNumber = walletNumber;

            return {
                walletProvider: newWalletProvider,
                mnemonic,
                encryptedBackup: encryptedMnemonicAndOptions,
                walletNumber,
            };
        } catch (error) {
            logger.error('Error in wallet generation:', {
                error:
                    error instanceof Error
                        ? {
                              message: error.message,
                              stack: error.stack,
                              name: error.name,
                          }
                        : error,
            });
            throw error;
        }
    }

    static async importWalletFromFile(
        runtime: IAgentRuntime,
        walletAddressForBackupName: string,
        password: string,
    ): Promise<WalletProvider> {
        const backupDir = path.join(process.cwd(), PROVIDER_CONFIG.WALLET_BACKUP_DIRNAME);
        const fileName = `${walletAddressForBackupName}_wallet_backup.json`;
        const filePath = path.join(backupDir, fileName);

        if (!fs.existsSync(filePath)) {
            throw new Error(`Wallet backup file does not exist at: ${filePath}`);
        }

        const encryptedFileContent = fs.readFileSync(filePath, {
            encoding: 'utf-8',
        });

        const constructionParams: WalletProviderConstructionParams = {
            runtime: runtime,
            source: {
                type: WalletSourceType.FROM_ENCRYPTED_JSON,
                encryptedJson: encryptedFileContent,
                password,
            },
        };
        return new WalletProvider(constructionParams);
    }

    static async ejectWalletFromFile(
        wallet: WalletProvider, // wallet instance needed for cache clearing
        walletAddressForBackupName: string,
        password: string, // Password for decrypting the file
    ): Promise<DecryptedWalletBackupData> {
        const backupDir = path.join(process.cwd(), PROVIDER_CONFIG.WALLET_BACKUP_DIRNAME);
        const fileName = `${walletAddressForBackupName}_wallet_backup.json`;
        const filePath = path.join(backupDir, fileName);

        if (!fs.existsSync(filePath)) {
            throw new Error(`Wallet backup file does not exist at: ${filePath}`);
        }

        const encryptedFileContent = fs.readFileSync(filePath, {
            encoding: 'utf-8',
        });
        logger.debug('Read encrypted file content, length:', encryptedFileContent.length);

        const decryptedFileJson = decrypt(encryptedFileContent, password);
        logger.debug('Decrypted file content length:', decryptedFileJson.length); // Avoid logging content

        try {
            const parsedJson: unknown = JSON.parse(decryptedFileJson);
            const walletData = decryptedWalletBackupDataSchema.parse(
                parsedJson,
            ) as DecryptedWalletBackupData;
            logger.debug('Successfully parsed and validated wallet data from ejected file'); // Avoid logging directly
            logger.log(`Wallet ejected from file ${filePath}, revealing mnemonic and options.`);

            // Get the cache from the current instance
            await WalletProvider.clearWalletFromCache(wallet, walletAddressForBackupName);

            return walletData;
        } catch (parseError) {
            logger.error('JSON Parse or Validation Error in ejectWalletFromFile:', {
                error:
                    parseError instanceof Error
                        ? {
                              message: parseError.message,
                              stack: parseError.stack,
                              name: parseError.name,
                          }
                        : parseError,
                json: decryptedFileJson,
            });
            throw new Error(`Failed to parse decrypted wallet data: ${parseError.message}`);
        }
    }

    static async importWallet(
        encryptedMnemonicAndOptions: string,
        password: string,
        runtime: IAgentRuntime,
    ): Promise<WalletProvider> {
        const constructionParams: WalletProviderConstructionParams = {
            runtime: runtime,
            source: {
                type: WalletSourceType.FROM_ENCRYPTED_JSON,
                encryptedJson: encryptedMnemonicAndOptions,
                password,
            },
        };
        const walletProvider = new WalletProvider(constructionParams);

        logger.log(
            `Wallet imported successfully via encrypted JSON, address: ${walletProvider.getAddress()}`,
        );
        return walletProvider;
    }

    // New method to import mnemonic, encrypt, store, and cache
    static async importMnemonicAndStore(
        runtime: IAgentRuntime,
        mnemonic: string,
        encryptionPassword: string,
        options?: {
            keypairPassword?: string;
            hardDerivation?: string;
            softDerivation?: string;
            keyringOptions?: KeyringOptions;
        },
    ): Promise<{
        walletProvider: WalletProvider;
        address: string;
        encryptedBackup: string;
        walletNumber: number;
    }> {
        await cryptoWaitReady();

        const keyringOpts: KeyringOptions = options?.keyringOptions || {
            type: PROVIDER_CONFIG.DEFAULT_KEYRING_TYPE,
            ss58Format: PROVIDER_CONFIG.DEFAULT_KEYRING_SS58_FORMAT,
        };

        // Data to be encrypted and stored
        const dataToEncrypt: DecryptedWalletBackupData = {
            mnemonic,
            options: keyringOpts, // This is KeyringOptions (type, ss58Format)
            password: options?.keypairPassword, // This is the keypair password for SURI
            hardDerivation: options?.hardDerivation,
            softDerivation: options?.softDerivation,
        };

        const jsonStringToEncrypt = JSON.stringify(dataToEncrypt);
        const encryptedBackup = encrypt(jsonStringToEncrypt, encryptionPassword);

        // Create a new WalletProvider instance from the imported mnemonic
        const newWalletProvider = new WalletProvider({
            runtime: runtime,
            source: {
                type: WalletSourceType.FROM_MNEMONIC,
                mnemonic: mnemonic,
                keyringOptions: keyringOpts,
                password: options?.keypairPassword, // Pass through optional keypair password
                hardDerivation: options?.hardDerivation, // Pass through optional hard derivation
                softDerivation: options?.softDerivation, // Pass through optional soft derivation
            },
        });

        const address = newWalletProvider.getAddress();

        // Save encrypted backup to file
        const backupDir = path.join(process.cwd(), PROVIDER_CONFIG.WALLET_BACKUP_DIRNAME);
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }
        const fileName = `${address}_wallet_backup.json`;
        const filePath = path.join(backupDir, fileName);
        fs.writeFileSync(filePath, encryptedBackup, { encoding: 'utf-8' });
        logger.log(`Wallet backup for imported mnemonic saved to ${filePath}`);

        // Assign a wallet number and cache the wallet
        const walletNumber = WalletProvider.getNextWalletNumberFromFilesystem();
        await WalletProvider.storeWalletInCache(address, newWalletProvider, walletNumber);
        newWalletProvider.walletNumber = walletNumber; // Set on the instance as well

        return {
            walletProvider: newWalletProvider,
            address,
            encryptedBackup,
            walletNumber,
        };
    }
}

export const initWalletProvider = async (runtime: IAgentRuntime) => {
    let mnemonic = runtime.getSetting('POLKADOT_PRIVATE_KEY');
    if (!mnemonic) {
        logger.error('POLKADOT_PRIVATE_KEY is missing');
        mnemonic = mnemonicGenerate(24);
    }

    const mnemonicsArray = mnemonic.split(' ');
    if (mnemonicsArray.length < 12 || mnemonicsArray.length > 24) {
        throw new Error(
            `POLKADOT_PRIVATE_KEY mnemonic seems invalid (length: ${mnemonicsArray.length})`,
        );
    }

    const keyringOptions: KeyringOptions = {
        type: PROVIDER_CONFIG.DEFAULT_KEYRING_TYPE,
        ss58Format: PROVIDER_CONFIG.DEFAULT_KEYRING_SS58_FORMAT,
    };

    await cryptoWaitReady();

    const walletProvider = new WalletProvider({
        runtime: runtime,
        source: {
            type: WalletSourceType.FROM_MNEMONIC,
            mnemonic,
            keyringOptions,
        },
    });

    logger.log(`Wallet initialized from settings, address: ${walletProvider.getAddress()}`);
    return walletProvider;
};

export const nativeWalletProvider: Provider = {
    name: 'polkadot_wallet',
    async get(runtime: IAgentRuntime, _message: Memory, _state?: State): Promise<ProviderResult> {
        const walletProvider = await initWalletProvider(runtime);
        if (runtime.getSetting('COINMARKETCAP_API_KEY')) {
            try {
                const formattedPortfolio = await getFormattedPortfolio(
                    runtime,
                    walletProvider.coinMarketCapApiKey,
                    walletProvider.getAddress(),
                );
                logger.log(formattedPortfolio);
                return { text: formattedPortfolio };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.error(
                    `Error in ${PROVIDER_CONFIG.NATIVE_TOKEN_SYMBOL.toUpperCase()} wallet provider:`,
                    message,
                );
                return { text: null };
            }
        }

        return { text: null };
    },
};
