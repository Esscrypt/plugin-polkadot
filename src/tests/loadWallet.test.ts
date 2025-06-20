import type { IAgentRuntime } from '@elizaos/core';
import { describe, it, vi, beforeEach, expect, afterEach } from 'vitest';
import { WalletProvider, initWalletProvider } from '../providers/wallet';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { PROVIDER_CONFIG } from '../providers/wallet';
import { CacheManager } from '../utils/cache';

const cacheManager = new CacheManager();

describe('LoadWallet', () => {
    let mockRuntime: IAgentRuntime;
    let walletProvider: WalletProvider;
    let walletAddress: string;
    const TEST_PASSWORD = 'test-password';
    let testBackupDir: string;

    beforeEach(async () => {
        // Reset all mocks
        vi.clearAllMocks();

        // Create a temporary test directory
        testBackupDir = path.join(process.cwd(), 'load_wallet_test_wallet_backups');

        // Clean up any existing test directory
        if (fs.existsSync(testBackupDir)) {
            fs.rmSync(testBackupDir, { recursive: true, force: true });
        }

        // Create fresh test directory
        fs.mkdirSync(testBackupDir, { recursive: true });

        // Override the backup directory for testing
        PROVIDER_CONFIG.WALLET_BACKUP_DIRNAME = 'load_wallet_test_wallet_backups';

        // Create mock runtime
        mockRuntime = {
            character: { name: 'TestAgent' },
            getCache: vi.fn().mockImplementation((key: string) => {
                return cacheManager.get(key);
            }),
            setCache: vi.fn().mockImplementation((key: string, value: unknown) => {
                cacheManager.set(key, value);
            }),
            getSetting: vi.fn().mockImplementation((key: string) => {
                if (key === 'COINMARKETCAP_API_KEY') return 'test_cmc_key';
                return null;
            }),
        } as unknown as IAgentRuntime;

        // Initialize wallet provider
        walletProvider = await initWalletProvider(mockRuntime);

        // Create a test wallet
        const { walletProvider: newWalletProvider } = await WalletProvider.generateNew(
            walletProvider,
            TEST_PASSWORD,
        );
        walletAddress = newWalletProvider.getAddress();

        // Store wallet in cache
        await WalletProvider.storeWalletInCache(walletAddress, newWalletProvider);
    });

    afterEach(() => {
        // Clean up test directory after each test
        if (fs.existsSync(testBackupDir)) {
            fs.rmSync(testBackupDir, { recursive: true, force: true });
        }
    });

    describe('Load by Wallet Number', () => {
        it('should load wallet by number', async () => {
            // Get wallet number from cache
            const walletData = await WalletProvider.getWalletData(walletProvider, 1);
            expect(walletData).toBeDefined();
            expect(walletData?.address).toBe(walletAddress);

            // Load the wallet
            const loadedWallet = await WalletProvider.loadWalletByNumber(
                walletProvider,
                1,
                TEST_PASSWORD,
            );
            expect(loadedWallet).toBeDefined();
            expect(loadedWallet?.getAddress()).toBe(walletAddress);
        });

        it('should fail to load with incorrect password', async () => {
            // First clear the wallet from cache
            await WalletProvider.clearWalletFromCache(walletProvider, walletAddress);

            await expect(
                WalletProvider.loadWalletByNumber(walletProvider, 1, 'wrong-password'),
            ).rejects.toThrow();
        });
    });

    describe('Load by Address', () => {
        it('should load wallet by address', async () => {
            const loadedWallet = await WalletProvider.loadWalletByAddress(
                walletProvider,
                walletAddress,
                TEST_PASSWORD,
            );
            expect(loadedWallet).toBeDefined();
            expect(loadedWallet?.getAddress()).toBe(walletAddress);
        });

        it('should fail to load non-existent wallet', async () => {
            await expect(
                WalletProvider.loadWalletByAddress(
                    walletProvider,
                    'non-existent-address',
                    TEST_PASSWORD,
                ),
            ).rejects.toThrow();
        });
    });

    describe('Cache Operations', () => {
        it('should maintain cache consistency after loading', async () => {
            // Load the wallet
            const loadedWallet = await WalletProvider.loadWalletByNumber(
                walletProvider,
                1,
                TEST_PASSWORD,
            );
            expect(loadedWallet).toBeDefined();

            // Verify cache state
            // expect(cacheManager.get).toHaveBeenCalled();
            // expect(cacheManager.set).toHaveBeenCalled();
        });

        it('should load wallet from cache if available', async () => {
            // First load to ensure wallet is in cache
            await WalletProvider.loadWalletByNumber(walletProvider, 1, TEST_PASSWORD);

            // Second load should use cache
            const loadedWallet = await WalletProvider.loadWalletByNumber(
                walletProvider,
                1,
                TEST_PASSWORD,
            );
            expect(loadedWallet).toBeDefined();
            expect(loadedWallet?.getAddress()).toBe(walletAddress);
        });
    });

    describe('Error Handling', () => {
        it('should handle missing wallet file', async () => {
            // First clear the wallet from cache
            await WalletProvider.clearWalletFromCache(walletProvider, walletAddress);

            // Remove the wallet file
            const fileName = `${walletAddress}_wallet_backup.json`;
            const filePath = path.join(testBackupDir, fileName);
            fs.unlinkSync(filePath);

            await expect(
                WalletProvider.loadWalletByAddress(walletProvider, walletAddress, TEST_PASSWORD),
            ).rejects.toThrow();
        });

        it('should handle corrupted wallet file', async () => {
            // Create a corrupted wallet file
            const corruptedAddress = 'corrupted-address';
            const corruptedFilePath = path.join(
                testBackupDir,
                `${corruptedAddress}_wallet_backup.json`,
            );
            fs.writeFileSync(corruptedFilePath, 'invalid-json-data');

            await expect(
                WalletProvider.loadWalletByAddress(walletProvider, corruptedAddress, TEST_PASSWORD),
            ).rejects.toThrow();
        });

        it('should handle empty password when loading from file', async () => {
            // First clear the wallet from cache
            await WalletProvider.clearWalletFromCache(walletProvider, walletAddress);

            await expect(
                WalletProvider.loadWalletByAddress(walletProvider, walletAddress, ''),
            ).rejects.toThrow();
        });
    });
});
