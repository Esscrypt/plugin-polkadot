import type { IAgentRuntime, ICacheManager, Memory, Provider, State } from '@elizaos/core';
import { elizaLogger } from '@elizaos/core';
import { CacheManager, MemoryCacheAdapter } from '@elizaos/core';

import * as path from 'node:path'; // Changed to use node: protocol
import type BigNumber from 'bignumber.js';
import { CONFIG_KEYS } from '../enviroment';

import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady, mnemonicGenerate } from '@polkadot/util-crypto';
import type { KeyringOptions } from '@polkadot/keyring/types';

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
    cacheManager: ICacheManager;
    source: WalletProviderSource;
}
// --- End Interfaces --- //

export class WalletProvider {
    keyring: Keyring;
    cacheManager: ICacheManager;
    coinMarketCapApiKey: string;
    walletNumber: number | null = null;
    source: WalletProviderSource;

    constructor(params: WalletProviderConstructionParams) {
        this.cacheManager =
            process.env[CONFIG_KEYS.USE_CACHE_MANAGER] !== 'false'
                ? params.cacheManager
                : new CacheManager(new MemoryCacheAdapter());
        this.coinMarketCapApiKey = process.env.COINMARKETCAP_API_KEY || '';
        if (!this.coinMarketCapApiKey) {
            elizaLogger.warn('COINMARKETCAP_API_KEY is not set. Price fetching will likely fail.');
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
            elizaLogger.error(`WalletProvider constructor failed: ${message}`);
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
        elizaLogger.debug('Starting storeWalletInCache for address:', address);

        let cache: OptimizedWalletCache;
        try {
            const cachedData =
                await wallet.cacheManager.get<OptimizedWalletCache>(WALLET_CACHE_KEY);
            if (cachedData) {
                elizaLogger.debug('Retrieved existing cache');
                cache = cachedData;
            } else {
                elizaLogger.debug('No existing cache found, creating new one');
                cache = {
                    wallets: {},
                    numberToAddress: {},
                };
            }
        } catch (error) {
            elizaLogger.error('Error retrieving cache, creating new one:', {
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
        elizaLogger.debug('Assigned wallet number:', finalWalletNumber);

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
            await wallet.cacheManager.set(WALLET_CACHE_KEY, cache);
            elizaLogger.debug('Successfully stored wallet in cache');
        } catch (error) {
            elizaLogger.error('Failed to store wallet in cache:', {
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
            // If no files exist, this is the first wallet
            if (files.length === 0) {
                return 1;
            }
            // Otherwise, this wallet gets the next number
            return files.length;
        } catch (_error) {
            return 1;
        }
    }

    static async clearWalletFromCache(wallet: WalletProvider, address: string): Promise<void> {
        const cache = await wallet.cacheManager.get<OptimizedWalletCache>(WALLET_CACHE_KEY);
        if (!cache) return;

        const walletNumber = cache.wallets[address]?.number;
        if (walletNumber) {
            delete cache.numberToAddress[walletNumber];
        }
        delete cache.wallets[address];

        await wallet.cacheManager.set(WALLET_CACHE_KEY, cache);
    }

    static async clearAllWalletsFromCache(wallet: WalletProvider): Promise<void> {
        await wallet.cacheManager.set(WALLET_CACHE_KEY, {
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
        const cache = await wallet.cacheManager.get<OptimizedWalletCache>(WALLET_CACHE_KEY);
        if (cache?.wallets[address]) {
            const walletData = cache.wallets[address];
            if (walletData.mnemonicData) {
                return new WalletProvider({
                    cacheManager: wallet.cacheManager,
                    source: {
                        type: WalletSourceType.FROM_MNEMONIC,
                        mnemonic: walletData.mnemonicData.mnemonic,
                        keyringOptions: walletData.mnemonicData.options,
                    },
                });
            }
            if (walletData.encryptedData && password) {
                return new WalletProvider({
                    cacheManager: wallet.cacheManager,
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
            cacheManager: wallet.cacheManager,
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
        const cache = await wallet.cacheManager.get<OptimizedWalletCache>(WALLET_CACHE_KEY);
        if (cache?.numberToAddress[number]) {
            const address = cache.numberToAddress[number];
            const walletData = cache.wallets[address];

            if (walletData.mnemonicData) {
                return new WalletProvider({
                    cacheManager: wallet.cacheManager,
                    source: {
                        type: WalletSourceType.FROM_MNEMONIC,
                        mnemonic: walletData.mnemonicData.mnemonic,
                        keyringOptions: walletData.mnemonicData.options,
                    },
                });
            }
            if (walletData.encryptedData && password) {
                return new WalletProvider({
                    cacheManager: wallet.cacheManager,
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
            cacheManager: wallet.cacheManager,
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

    // Private handler methods for initialization logic
    private _initializeFromMnemonic(source: WalletSourceFromMnemonic): void {
        try {
            elizaLogger.debug('Initializing wallet from mnemonic');
            const opts = source.keyringOptions || {
                type: PROVIDER_CONFIG.DEFAULT_KEYRING_TYPE,
                ss58Format: PROVIDER_CONFIG.DEFAULT_KEYRING_SS58_FORMAT,
            };
            elizaLogger.debug('Using keyring options:', opts);

            this.keyring = new Keyring(opts);

            // Build the SURI with optional password and derivations
            let suri = source.mnemonic;
            if (source.password) {
                suri = `${suri}///${source.password}`;
            }
            if (source.hardDerivation) {
                suri = `${suri}//${source.hardDerivation}`;
            }
            if (source.softDerivation) {
                suri = `${suri}/${source.softDerivation}`;
            }
            elizaLogger.debug('Generated SURI:', suri);

            this.keyring.addFromUri(suri, { name: 'main pair' }, opts.type);
            elizaLogger.debug('Wallet initialized successfully');
        } catch (error) {
            elizaLogger.error('Error initializing from mnemonic:', {
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
            elizaLogger.debug('Initializing wallet from encrypted JSON');
            elizaLogger.debug('Encrypted data length:', source.encryptedJson.length);

            const decryptedJson = decrypt(source.encryptedJson, source.password);
            elizaLogger.debug('Decrypted JSON length:', decryptedJson.length);
            elizaLogger.debug('Decrypted JSON content:', decryptedJson);

            let MnemonicAndOptions: {
                mnemonic: string;
                options: KeyringOptions;
            };
            try {
                elizaLogger.debug('Attempting to parse decrypted JSON');
                MnemonicAndOptions = JSON.parse(decryptedJson) as {
                    mnemonic: string;
                    options: KeyringOptions;
                };
                elizaLogger.debug('Successfully parsed wallet data:', MnemonicAndOptions);
            } catch (parseError) {
                elizaLogger.error('JSON Parse Error:', {
                    error:
                        parseError instanceof Error
                            ? {
                                  message: parseError.message,
                                  stack: parseError.stack,
                                  name: parseError.name,
                              }
                            : parseError,
                    json: decryptedJson,
                });
                throw new Error(`Failed to parse decrypted wallet data: ${parseError.message}`);
            }

            if (!MnemonicAndOptions.mnemonic || !MnemonicAndOptions.options) {
                elizaLogger.error('Missing required fields in parsed data:', MnemonicAndOptions);
                throw new Error('Decrypted data missing required fields (mnemonic or options)');
            }

            this.keyring = new Keyring(MnemonicAndOptions.options);
            this.keyring.addFromUri(
                MnemonicAndOptions.mnemonic,
                { name: 'imported main pair' },
                MnemonicAndOptions.options.type,
            );
            elizaLogger.debug('Wallet initialized successfully');
        } catch (error) {
            elizaLogger.error('Error initializing from encrypted JSON:', {
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
        return fetchPrices(this.cacheManager, this.coinMarketCapApiKey);
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

        const cache = await this.cacheManager.get<OptimizedWalletCache>(WALLET_CACHE_KEY);
        const number = cache?.wallets[address]?.number;
        this.walletNumber = number !== undefined ? Number(number) : null;
        return this.walletNumber;
    }

    static async getWalletData(wallet: WalletProvider, number: number): Promise<WalletData | null> {
        const cache = await wallet.cacheManager.get<OptimizedWalletCache>(WALLET_CACHE_KEY);
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
        const cache = await wallet.cacheManager.get<OptimizedWalletCache>(WALLET_CACHE_KEY);
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
        const dataToEncrypt = {
            mnemonic,
            options: keyringOptions,
            ...(options?.password && { password: options.password }),
            ...(options?.hardDerivation && {
                hardDerivation: options.hardDerivation,
            }),
            ...(options?.softDerivation && {
                softDerivation: options.softDerivation,
            }),
        };

        // Ensure proper JSON stringification
        const jsonString = JSON.stringify(dataToEncrypt);

        try {
            const encryptedMnemonicAndOptions = encrypt(jsonString, password);

            const walletProvider = new WalletProvider({
                cacheManager: wallet.cacheManager,
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
            const address = walletProvider.getAddress();

            const fileName = `${address}_wallet_backup.json`;
            const filePath = path.join(backupDir, fileName);

            if (!fs.existsSync(path.dirname(filePath))) {
                fs.mkdirSync(path.dirname(filePath), { recursive: true });
            }

            fs.writeFileSync(filePath, encryptedMnemonicAndOptions, {
                encoding: 'utf-8',
            });
            elizaLogger.log(`Wallet backup saved to ${filePath}`);

            // Get the next wallet number from filesystem
            const walletNumber = WalletProvider.getNextWalletNumberFromFilesystem();

            // Store wallet data in cache using the existing method with the wallet number
            await WalletProvider.storeWalletInCache(address, walletProvider, walletNumber);

            return {
                walletProvider,
                mnemonic,
                encryptedBackup: encryptedMnemonicAndOptions,
                walletNumber,
            };
        } catch (error) {
            elizaLogger.error('Error in wallet generation:', {
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
            cacheManager: runtime.cacheManager,
            source: {
                type: WalletSourceType.FROM_ENCRYPTED_JSON,
                encryptedJson: encryptedFileContent,
                password,
            },
        };
        return new WalletProvider(constructionParams);
    }

    static async ejectWalletFromFile(
        wallet: WalletProvider,
        walletAddressForBackupName: string,
        password: string,
    ): Promise<{ mnemonic: string; options: KeyringOptions }> {
        const backupDir = path.join(process.cwd(), PROVIDER_CONFIG.WALLET_BACKUP_DIRNAME);
        const fileName = `${walletAddressForBackupName}_wallet_backup.json`;
        const filePath = path.join(backupDir, fileName);

        if (!fs.existsSync(filePath)) {
            throw new Error(`Wallet backup file does not exist at: ${filePath}`);
        }

        const encryptedFileContent = fs.readFileSync(filePath, {
            encoding: 'utf-8',
        });
        elizaLogger.debug('Read encrypted file content, length:', encryptedFileContent.length);

        const decryptedFileJson = decrypt(encryptedFileContent, password);
        elizaLogger.debug('Decrypted file content:', decryptedFileJson);

        try {
            const mnemonicAndOptions = JSON.parse(decryptedFileJson) as {
                mnemonic: string;
                options: KeyringOptions;
            };
            elizaLogger.debug('Successfully parsed wallet data:', mnemonicAndOptions);
            elizaLogger.log(
                `Wallet ejected from file ${filePath}, revealing mnemonic and options.`,
            );

            // Get the cache from the current instance
            await WalletProvider.clearWalletFromCache(wallet, walletAddressForBackupName);

            return mnemonicAndOptions;
        } catch (parseError) {
            elizaLogger.error('JSON Parse Error in ejectWalletFromFile:', {
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
            cacheManager: runtime.cacheManager,
            source: {
                type: WalletSourceType.FROM_ENCRYPTED_JSON,
                encryptedJson: encryptedMnemonicAndOptions,
                password,
            },
        };
        const walletProvider = new WalletProvider(constructionParams);

        elizaLogger.log(
            `Wallet imported successfully via encrypted JSON, address: ${walletProvider.getAddress()}`,
        );
        return walletProvider;
    }
}

export const initWalletProvider = async (runtime: IAgentRuntime) => {
    let mnemonic = runtime.getSetting(CONFIG_KEYS.POLKADOT_PRIVATE_KEY);
    if (!mnemonic) {
        elizaLogger.error(`${CONFIG_KEYS.POLKADOT_PRIVATE_KEY} is missing`);
        mnemonic = mnemonicGenerate(24);
    }

    const mnemonicsArray = mnemonic.split(' ');
    if (mnemonicsArray.length < 12 || mnemonicsArray.length > 24) {
        throw new Error(
            `${CONFIG_KEYS.POLKADOT_PRIVATE_KEY} mnemonic seems invalid (length: ${mnemonicsArray.length})`,
        );
    }

    const keyringOptions: KeyringOptions = {
        type: PROVIDER_CONFIG.DEFAULT_KEYRING_TYPE,
        ss58Format: PROVIDER_CONFIG.DEFAULT_KEYRING_SS58_FORMAT,
    };

    await cryptoWaitReady();

    const walletProvider = new WalletProvider({
        cacheManager: runtime.cacheManager,
        source: {
            type: WalletSourceType.FROM_MNEMONIC,
            mnemonic,
            keyringOptions,
        },
    });

    elizaLogger.log(`Wallet initialized from settings, address: ${walletProvider.getAddress()}`);
    return walletProvider;
};

export const nativeWalletProvider: Provider = {
    async get(runtime: IAgentRuntime, _message: Memory, _state?: State): Promise<string | null> {
        const walletProvider = await initWalletProvider(runtime);
        if (runtime.getSetting('COINMARKETCAP_API_KEY')) {
            try {
                const formattedPortfolio = await getFormattedPortfolio(
                    runtime,
                    walletProvider.cacheManager,
                    walletProvider.coinMarketCapApiKey,
                    walletProvider.getAddress(),
                );
                elizaLogger.log(formattedPortfolio);
                return formattedPortfolio;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                elizaLogger.error(
                    `Error in ${PROVIDER_CONFIG.NATIVE_TOKEN_SYMBOL.toUpperCase()} wallet provider:`,
                    message,
                );
                return null;
            }
        }

        return null;
    },
};
