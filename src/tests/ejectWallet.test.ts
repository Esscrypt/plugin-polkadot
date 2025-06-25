import type { IAgentRuntime } from '@elizaos/core';
import { describe, it, vi, beforeEach, expect, afterEach } from 'vitest';
import { WalletProvider, initWalletProvider } from '../providers/wallet';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { PROVIDER_CONFIG } from '../providers/wallet';
import { CONFIG_KEYS } from '../enviroment';
import { CacheManager } from '../utils/cache';

const cacheManager = new CacheManager();

describe('EjectWallet', () => {
    let mockRuntime: IAgentRuntime;
    let walletProvider: WalletProvider;
    let walletAddress: string;
    let testBackupDir: string;
    const TEST_PASSWORD = 'test-password';

    beforeEach(async () => {
        // Reset all mocks
        vi.clearAllMocks();

        // Set environment variable to use mock cache manager
        process.env[CONFIG_KEYS.USE_CACHE_MANAGER] = 'true';

        // Create a temporary test directory
        // Create a temporary test directory
        testBackupDir = path.join(process.cwd(), 'eject_wallet_test_wallet_backups');

        // Clean up any existing test directory
        if (fs.existsSync(testBackupDir)) {
            fs.rmSync(testBackupDir, { recursive: true, force: true });
        }

        // Create fresh test directory
        fs.mkdirSync(testBackupDir, { recursive: true });

        // Override the backup directory for testing
        PROVIDER_CONFIG.WALLET_BACKUP_DIRNAME = 'eject_wallet_test_wallet_backups';

        // Create mock runtime
        mockRuntime = {
            character: { name: 'TestAgent' },
            // return real in-memory values
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
        expect(walletAddress).toBeDefined();
        const walletNumber = await newWalletProvider.getWalletNumber();
        expect(walletNumber).toEqual(1);

        // Store wallet in cache
        await WalletProvider.storeWalletInCache(walletAddress, newWalletProvider);
    });

    afterEach(async () => {
        // Clean up test directory after each test
        if (fs.existsSync(testBackupDir)) {
            fs.rmSync(testBackupDir, { recursive: true, force: true });
        }
        // Reset environment variable
        delete process.env[CONFIG_KEYS.USE_CACHE_MANAGER];
        await WalletProvider.clearAllWalletsFromCache(walletProvider);
    });

    describe('Eject by Wallet Number', () => {
        it('should eject wallet by number', async () => {
            // Get wallet number from cache
            const walletData = await WalletProvider.getWalletData(walletProvider, 1);
            expect(walletData).toBeDefined();
            expect(walletData?.address).toBe(walletAddress);

            // Eject the wallet
            const result = await WalletProvider.ejectWalletFromFile(
                walletProvider,
                walletAddress,
                TEST_PASSWORD,
            );
            expect(result).toBeDefined();
            expect(result.mnemonic).toBeDefined();
            expect(result.mnemonic.length).toBeGreaterThan(0);
        });

        it('should fail to eject with incorrect password', async () => {
            await expect(
                WalletProvider.ejectWalletFromFile(walletProvider, walletAddress, 'wrong-password'),
            ).rejects.toThrow();
        });
    });

    describe('Eject by Address', () => {
        it('should eject wallet by address', async () => {
            const result = await WalletProvider.ejectWalletFromFile(
                walletProvider,
                walletAddress,
                TEST_PASSWORD,
            );
            expect(result).toBeDefined();
            expect(result.mnemonic).toBeDefined();
            expect(result.mnemonic.length).toBeGreaterThan(0);
        });

        it('should fail to eject non-existent wallet', async () => {
            await expect(
                WalletProvider.ejectWalletFromFile(
                    walletProvider,
                    'non-existent-address',
                    TEST_PASSWORD,
                ),
            ).rejects.toThrow();
        });
    });

    describe('Cache Operations', () => {
        it('should clear wallet from cache after ejection', async () => {
            // Eject the wallet
            await WalletProvider.ejectWalletFromFile(walletProvider, walletAddress, TEST_PASSWORD);

            // Verify wallet is no longer in cache
            const walletData = await WalletProvider.getWalletData(walletProvider, 1);
            expect(walletData).toBeNull();
        });

        it('should maintain cache consistency after ejection', async () => {
            // Eject the wallet
            await WalletProvider.ejectWalletFromFile(walletProvider, walletAddress, TEST_PASSWORD);

            // Verify cache state
            // expect(cacheManager.get).toHaveBeenCalled();
            // expect(cacheManager.set).toHaveBeenCalled();
        });
    });

    describe('Error Handling', () => {
        it('should handle missing wallet file', async () => {
            // Delete the wallet file
            const filePath = path.join(testBackupDir, `${walletAddress}_wallet_backup.json`);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }

            await expect(
                WalletProvider.ejectWalletFromFile(walletProvider, walletAddress, TEST_PASSWORD),
            ).rejects.toThrow();
        });

        it('should handle corrupted wallet file', async () => {
            // Write invalid data to the wallet file
            const filePath = path.join(testBackupDir, `${walletAddress}_wallet_backup.json`);
            fs.writeFileSync(filePath, 'invalid-json-data');

            await expect(
                WalletProvider.ejectWalletFromFile(walletProvider, walletAddress, TEST_PASSWORD),
            ).rejects.toThrow();
        });

        it('should handle empty password', async () => {
            await expect(
                WalletProvider.ejectWalletFromFile(walletProvider, walletAddress, ''),
            ).rejects.toThrow();
        });
    });
});
