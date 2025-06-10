import type { IAgentRuntime } from '@elizaos/core';
import { describe, it, vi, beforeEach, expect, afterEach } from 'vitest';
import { CreateWalletAction } from '../actions/createWallet';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { PROVIDER_CONFIG } from '../providers/wallet';
import { CONFIG_KEYS } from '../enviroment';
import { CacheManager, MemoryCacheAdapter } from '@elizaos/core';

const cacheManager = new CacheManager(new MemoryCacheAdapter());

describe('CreateWalletAction', () => {
    let mockRuntime: IAgentRuntime;
    let createWalletAction: CreateWalletAction;
    let testBackupDir: string;

    beforeEach(() => {
        // Reset all mocks
        vi.clearAllMocks();

        // Set environment variable to use mock cache manager
        process.env[CONFIG_KEYS.USE_CACHE_MANAGER] = 'true';

        // Create a temporary test directory
        testBackupDir = path.join(process.cwd(), 'create_wallet_test_wallet_backups');

        // Clean up any existing test directory
        if (fs.existsSync(testBackupDir)) {
            fs.rmSync(testBackupDir, { recursive: true, force: true });
        }

        // Create fresh test directory
        fs.mkdirSync(testBackupDir, { recursive: true });

        // Override the backup directory for testing
        PROVIDER_CONFIG.WALLET_BACKUP_DIRNAME = 'create_wallet_test_wallet_backups';

        // Create mock runtime
        mockRuntime = {
            character: { name: 'TestAgent' },
            cacheManager,
            getSetting: vi.fn().mockImplementation((key: string) => {
                if (key === 'COINMARKETCAP_API_KEY') return 'test_cmc_key';
                return null;
            }),
        } as unknown as IAgentRuntime;

        createWalletAction = new CreateWalletAction(mockRuntime);
    });

    afterEach(() => {
        // Clean up test directory after each test
        if (fs.existsSync(testBackupDir)) {
            fs.rmSync(testBackupDir, { recursive: true, force: true });
        }
        // Reset environment variable
        delete process.env[CONFIG_KEYS.USE_CACHE_MANAGER];
    });

    describe('initialize', () => {
        it('should initialize the wallet provider', async () => {
            await createWalletAction.initialize();
            expect(createWalletAction).toBeDefined();
        });
    });

    describe('createWallet', () => {
        beforeEach(async () => {
            await createWalletAction.initialize();
        });

        it('should create a new wallet with basic parameters', async () => {
            const result = await createWalletAction.createWallet({
                encryptionPassword: 'test-password',
            });

            expect(result).toBeDefined();
            expect(result.walletAddress).toBeDefined();
            expect(result.mnemonic).toBeDefined();
            expect(result.walletNumber).toBeDefined();

            // Verify the wallet was stored in cache
            // expect(cacheManager.set).toHaveBeenCalledWith(
            //     "polkadot/wallets",
            //     expect.objectContaining({
            //         wallets: expect.any(Object),
            //         numberToAddress: expect.any(Object)
            //     })
            // );

            // Verify backup file was created
            const backupFilePath = path.join(
                testBackupDir,
                `${result.walletAddress}_wallet_backup.json`,
            );
            expect(fs.existsSync(backupFilePath)).toBe(true);

            // Verify file contains encrypted content
            const fileContent = fs.readFileSync(backupFilePath, 'utf-8');
            expect(fileContent).toMatch(/^0x[0-9a-f]+:0x[0-9a-f]+:0x[0-9a-f]+$/); // Format: 0xkdfSaltHex:0xnonceHex:0xencryptedHex
        });

        it('should create a wallet with all optional parameters', async () => {
            const result = await createWalletAction.createWallet({
                encryptionPassword: 'test-password',
                keypairPassword: 'keypair-password',
                hardDerivation: '//hard',
                softDerivation: '//soft',
            });

            expect(result).toBeDefined();
            expect(result.walletAddress).toBeDefined();
            expect(result.mnemonic).toBeDefined();
            expect(result.walletNumber).toBeDefined();

            // Verify the wallet was stored in cache
            // expect(cacheManager.set).toHaveBeenCalledWith(
            //     "polkadot/wallets",
            //     expect.objectContaining({
            //         wallets: expect.any(Object),
            //         numberToAddress: expect.any(Object)
            //     })
            // );

            // Verify backup file was created
            const backupFilePath = path.join(
                testBackupDir,
                `${result.walletAddress}_wallet_backup.json`,
            );
            expect(fs.existsSync(backupFilePath)).toBe(true);

            // Verify file contains encrypted content
            const fileContent = fs.readFileSync(backupFilePath, 'utf-8');
            expect(fileContent).toMatch(/^0x[0-9a-f]+:0x[0-9a-f]+:0x[0-9a-f]+$/); // Format: 0xkdfSaltHex:0xnonceHex:0xencryptedHex
        });

        it('should create unique wallets with different parameters', async () => {
            const result1 = await createWalletAction.createWallet({
                encryptionPassword: 'test-password-1',
            });

            const result2 = await createWalletAction.createWallet({
                encryptionPassword: 'test-password-2',
            });

            expect(result1.walletAddress).not.toBe(result2.walletAddress);
            expect(result1.mnemonic).not.toBe(result2.mnemonic);

            // Verify both backup files were created
            const backupFile1 = path.join(
                testBackupDir,
                `${result1.walletAddress}_wallet_backup.json`,
            );
            const backupFile2 = path.join(
                testBackupDir,
                `${result2.walletAddress}_wallet_backup.json`,
            );
            expect(fs.existsSync(backupFile1)).toBe(true);
            expect(fs.existsSync(backupFile2)).toBe(true);

            // Verify both files contain encrypted content
            const content1 = fs.readFileSync(backupFile1, 'utf-8');
            const content2 = fs.readFileSync(backupFile2, 'utf-8');
            expect(content1).toMatch(/^0x[0-9a-f]+:0x[0-9a-f]+:0x[0-9a-f]+$/);
            expect(content2).toMatch(/^0x[0-9a-f]+:0x[0-9a-f]+:0x[0-9a-f]+$/);
            expect(content1).not.toBe(content2); // Different encryption results
        });

        it('should create wallets with different derivation paths', async () => {
            const result1 = await createWalletAction.createWallet({
                encryptionPassword: 'test-password',
                hardDerivation: '//hard1',
            });

            const result2 = await createWalletAction.createWallet({
                encryptionPassword: 'test-password',
                hardDerivation: '//hard2',
            });

            expect(result1.walletAddress).not.toBe(result2.walletAddress);

            // Verify both backup files were created
            const backupFile1 = path.join(
                testBackupDir,
                `${result1.walletAddress}_wallet_backup.json`,
            );
            const backupFile2 = path.join(
                testBackupDir,
                `${result2.walletAddress}_wallet_backup.json`,
            );
            expect(fs.existsSync(backupFile1)).toBe(true);
            expect(fs.existsSync(backupFile2)).toBe(true);

            // Verify both files contain encrypted content
            const content1 = fs.readFileSync(backupFile1, 'utf-8');
            const content2 = fs.readFileSync(backupFile2, 'utf-8');
            expect(content1).toMatch(/^0x[0-9a-f]+:0x[0-9a-f]+:0x[0-9a-f]+$/);
            expect(content2).toMatch(/^0x[0-9a-f]+:0x[0-9a-f]+:0x[0-9a-f]+$/);
            expect(content1).not.toBe(content2); // Different encryption results
        });

        it('should handle invalid passwords', async () => {
            await expect(
                createWalletAction.createWallet({
                    encryptionPassword: '', // Empty password
                }),
            ).rejects.toThrow();
        });

        it('should fail with null encryption password', async () => {
            await expect(
                createWalletAction.createWallet({
                    encryptionPassword: null,
                }),
            ).rejects.toThrow();
        });

        it('should fail with undefined encryption password', async () => {
            await expect(
                createWalletAction.createWallet({
                    encryptionPassword: undefined,
                }),
            ).rejects.toThrow();
        });
    });
});
