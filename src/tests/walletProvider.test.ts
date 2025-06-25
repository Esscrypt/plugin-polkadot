import type { IAgentRuntime } from '@elizaos/core';
import { CacheManager } from '../utils/cache';

import { describe, it, vi, beforeAll, beforeEach, afterEach, expect } from 'vitest';
import {
    WalletProvider,
    WalletSourceType,
    type WalletProviderConstructionParams,
    PROVIDER_CONFIG,
    initWalletProvider,
    WALLET_CACHE_KEY,
    type OptimizedWalletCache,
} from '../providers/wallet';

import { mnemonicGenerate } from '@polkadot/util-crypto';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { CONFIG_KEYS } from '../enviroment';

const cacheManager = new CacheManager();

const mockGetSetting = vi.fn();
const mockedAgentRuntime = {
    character: { name: 'TestAgent' },
    getCache: vi.fn().mockImplementation((key: string) => {
        return cacheManager.get(key);
    }),
    setCache: vi.fn().mockImplementation((key: string, value: unknown) => {
        cacheManager.set(key, value);
    }),
    getSetting: mockGetSetting,
} as unknown as IAgentRuntime;

// Global mock for fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

const TEST_PASSWORD = 'testPassword123';

describe('WalletProvider', () => {
    let testMnemonic: string;
    let walletProvider: WalletProvider;
    let testBackupDir: string;

    beforeAll(async () => {
        testMnemonic = mnemonicGenerate(12);
        mockGetSetting.mockImplementation((key: string) => {
            if (key === 'COINMARKETCAP_API_KEY') return 'test_cmc_key';
            if (key === CONFIG_KEYS.POLKADOT_PRIVATE_KEY) return testMnemonic;
            return null;
        });
    });

    beforeEach(async () => {
        // Create a temporary test directory
        testBackupDir = path.join(process.cwd(), 'walet_provider_test_wallet_backups');

        // Clean up any existing test directory
        if (fs.existsSync(testBackupDir)) {
            fs.rmSync(testBackupDir, { recursive: true, force: true });
        }

        // Create fresh test directory
        fs.mkdirSync(testBackupDir, { recursive: true });

        // Override the backup directory for testing
        PROVIDER_CONFIG.WALLET_BACKUP_DIRNAME = 'walet_provider_test_wallet_backups';

        mockFetch.mockClear();

        // Initialize the cache with an empty structure
        await mockedAgentRuntime.setCache(WALLET_CACHE_KEY, {
            wallets: {},
            numberToAddress: {},
        });

        // Initialize a base wallet provider
        const baseWalletProvider = await initWalletProvider(mockedAgentRuntime);

        // Generate a new wallet
        const { walletProvider: newWalletProvider } = await WalletProvider.generateNew(
            baseWalletProvider,
            TEST_PASSWORD,
        );

        // Use the newly generated wallet
        walletProvider = newWalletProvider;

        // Get the address
        const address = walletProvider.getAddress();
        console.log('Wallet address:', address);

        // Debug: Check cache state after storing wallet
        // const cacheAfterStore =
        //     await walletProvider.cacheManager.get<OptimizedWalletCache>(WALLET_CACHE_KEY);
        // console.log('Cache after storing wallet:', JSON.stringify(cacheAfterStore, null, 2));
    });

    afterEach(async () => {
        // Clean up test directory after each test
        if (fs.existsSync(testBackupDir)) {
            fs.rmSync(testBackupDir, { recursive: true, force: true });
        }

        // Clear the cache
        await WalletProvider.clearAllWalletsFromCache(walletProvider);
    });

    describe('Initialization', () => {
        it('should create a wallet from mnemonic', () => {
            expect(walletProvider).toBeInstanceOf(WalletProvider);
            expect(walletProvider.keyring.getPairs()).toHaveLength(1);
            expect(walletProvider.getAddress()).toBeDefined();
        });

        it('should throw error when keypair is not loaded', () => {
            const params: WalletProviderConstructionParams = {
                runtime: mockedAgentRuntime,
                source: {
                    type: WalletSourceType.FROM_MNEMONIC,
                    mnemonic:
                        'invalid mnemonic that is definitely not valid and will cause an error',
                },
            };
            expect(() => new WalletProvider(params)).toThrow();
        });
    });

    describe('Wallet Generation, Backup, and Import', () => {
        let encryptedBackup: string;
        let originalAddress: string;

        it('should generate a new wallet, encrypt mnemonic, and save to file', async () => {
            const {
                walletProvider: newWalletProvider,
                mnemonic,
                encryptedBackup: backup,
            } = await WalletProvider.generateNew(walletProvider, TEST_PASSWORD);

            expect(newWalletProvider).toBeInstanceOf(WalletProvider);
            expect(mnemonic).toBeTypeOf('string');
            expect(backup).toBeTypeOf('string');
            originalAddress = newWalletProvider.getAddress();
            expect(originalAddress).toBeDefined();

            // Verify file was created
            const fileName = `${originalAddress}_wallet_backup.json`;
            const filePath = path.join(testBackupDir, fileName);
            expect(fs.existsSync(filePath)).toBe(true);
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            expect(fileContent).toBe(backup);

            encryptedBackup = backup;
        });

        it('should import a wallet from an encrypted JSON string', async () => {
            expect(encryptedBackup).toBeDefined();
            const importedWallet = await WalletProvider.importWallet(
                encryptedBackup,
                TEST_PASSWORD,
                mockedAgentRuntime,
            );
            expect(importedWallet.getAddress()).toBe(originalAddress);
        });

        it('should import a wallet from an encrypted file', async () => {
            expect(originalAddress).toBeDefined();
            expect(encryptedBackup).toBeDefined();

            const fileName = `${originalAddress}_wallet_backup.json`;
            const filePath = path.join(testBackupDir, fileName);
            fs.writeFileSync(filePath, encryptedBackup);

            const importedWallet = await WalletProvider.importWalletFromFile(
                mockedAgentRuntime,
                originalAddress,
                TEST_PASSWORD,
            );
            expect(importedWallet.getAddress()).toBe(originalAddress);
        });

        it('should fail to import with an incorrect password (from JSON string)', async () => {
            expect(encryptedBackup).toBeDefined();
            await expect(
                WalletProvider.importWallet(encryptedBackup, 'wrongPassword', mockedAgentRuntime),
            ).rejects.toThrow(/Decryption failed|Failed to initialize/i);
        });
    });

    describe('Key Management', () => {
        it('should allow removing a keypair from the keyring', () => {
            const initialPairs = walletProvider.keyring.getPairs();
            expect(initialPairs.length).toBeGreaterThan(0);
            const addressToRemove = initialPairs[0].address;

            walletProvider.keyring.removePair(addressToRemove);
            expect(
                walletProvider.keyring.getPairs().find((p) => p.address === addressToRemove),
            ).toBeUndefined();
        });
    });

    describe('Cache Management', () => {
        it('should store wallet in cache', async () => {
            const address = walletProvider.getAddress();
            expect(address).toBeDefined();

            await WalletProvider.storeWalletInCache(address, walletProvider);
            const cache =
                await walletProvider.runtime.getCache<OptimizedWalletCache>(WALLET_CACHE_KEY);
            expect(cache).toBeDefined();
            expect(cache?.wallets[address]).toBeDefined();
        });

        it('should clear all wallets from cache', async () => {
            await WalletProvider.clearAllWalletsFromCache(walletProvider);
            const cache = await mockedAgentRuntime.getCache<OptimizedWalletCache>(WALLET_CACHE_KEY);
            expect(cache).toEqual({
                wallets: {},
                numberToAddress: {},
            });
        });
    });

    describe('Wallet Loading', () => {
        it('should load wallet by address from cache', async () => {
            const address = walletProvider.getAddress();

            const loadedWallet = await WalletProvider.loadWalletByAddress(walletProvider, address);
            expect(loadedWallet).toBeInstanceOf(WalletProvider);
            expect(loadedWallet?.getAddress()).toBe(address);
        });

        it('should load wallet by number from cache', async () => {
            const address = walletProvider.getAddress();
            expect(address).toBeDefined();

            // Get the wallet number from cache
            const walletNumber = await walletProvider.getWalletNumber();
            expect(walletNumber).toBeDefined();
            expect(walletNumber).toBeGreaterThan(0);

            const loadedWallet = await WalletProvider.loadWalletByNumber(
                walletProvider,
                walletNumber,
            );
            expect(loadedWallet).toBeInstanceOf(WalletProvider);
            expect(loadedWallet?.getAddress()).toBe(address);
        });
    });

    describe('Wallet Data', () => {
        it('should get wallet data by number', async () => {
            const address = walletProvider.getAddress();
            expect(address).toBeDefined();

            const walletNumber = await walletProvider.getWalletNumber();
            expect(walletNumber).toBeDefined();
            expect(walletNumber).toBeGreaterThan(0);

            const walletData = await WalletProvider.getWalletData(walletProvider, walletNumber);
            expect(walletData).toBeDefined();
            expect(walletData?.address).toBe(address);
        });

        it('should get wallet by address', async () => {
            const address = walletProvider.getAddress();
            expect(address).toBeDefined();

            const walletData = await WalletProvider.getWalletByAddress(walletProvider, address);
            expect(walletData).toBeDefined();
            expect(walletData?.address).toBe(address);
        });
    });
});
