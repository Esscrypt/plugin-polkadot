import type { IAgentRuntime } from '@elizaos/core';
import { describe, it, vi, beforeEach, expect, afterEach } from 'vitest';
import { ImportWalletAction, type ImportWalletContent } from '../actions/importWallet';
import { WalletProvider, PROVIDER_CONFIG, WalletSourceType } from '../providers/wallet';
import { CONFIG_KEYS } from '../enviroment';
import { CacheManager } from '../utils/cache';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { mnemonicGenerate } from '@polkadot/util-crypto';

const cacheManager = new CacheManager();

describe('ImportWalletAction', () => {
    let importWalletAction: ImportWalletAction;
    let testBackupDir: string;
    let mockRuntime: IAgentRuntime;
    const testMnemonic = mnemonicGenerate(12);

    beforeEach(async () => {
        vi.clearAllMocks();
        process.env[CONFIG_KEYS.USE_CACHE_MANAGER] = 'true';

        testBackupDir = path.join(process.cwd(), 'import_wallet_test_wallet_backups');
        if (fs.existsSync(testBackupDir)) {
            fs.rmSync(testBackupDir, { recursive: true, force: true });
        }
        fs.mkdirSync(testBackupDir, { recursive: true });
        PROVIDER_CONFIG.WALLET_BACKUP_DIRNAME = 'import_wallet_test_wallet_backups';

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

        importWalletAction = new ImportWalletAction(mockRuntime);
        await importWalletAction.initialize();
    });

    afterEach(() => {
        if (fs.existsSync(testBackupDir)) {
            fs.rmSync(testBackupDir, { recursive: true, force: true });
        }
        delete process.env[CONFIG_KEYS.USE_CACHE_MANAGER];
        vi.restoreAllMocks();
    });

    describe('importWallet method', () => {
        it('should import a new wallet with mnemonic and encryption password', async () => {
            const params: ImportWalletContent = {
                mnemonic: testMnemonic,
                encryptionPassword: 'test-encrypt-password',
                text: 'import wallet',
            };
            const result = await importWalletAction.importWallet(params);
            expect(result).toBeDefined();
            expect(result.walletAddress).toBeDefined();
            expect(result.walletNumber).toBeDefined();
            expect(result.encryptedBackup).toBeDefined();

            const backupFilePath = path.join(
                testBackupDir,
                `${result.walletAddress}_wallet_backup.json`,
            );
            expect(fs.existsSync(backupFilePath)).toBe(true);
            const fileContent = fs.readFileSync(backupFilePath, 'utf-8');
            expect(fileContent).toMatch(/^0x[0-9a-f]+:0x[0-9a-f]+:0x[0-9a-f]+$/);
        });

        it('should import a wallet with all optional parameters and verify correct re-derivation', async () => {
            const keypairPass = 'keypair-pass';
            const hardDerive = '//hdPath';
            const softDerive = '//sfPath';
            const encryptionPass = 'test-encrypt-password-full';
            const params: ImportWalletContent = {
                mnemonic: testMnemonic,
                encryptionPassword: encryptionPass,
                keypairPassword: keypairPass,
                hardDerivation: hardDerive,
                softDerivation: softDerive,
                keyringType: 'sr25519',
                ss58Format: 2,
                text: 'import full wallet',
            };
            const initialImportResult = await importWalletAction.importWallet(params);
            expect(initialImportResult.walletAddress).toBeDefined();
            const walletProviderForEject = new WalletProvider({
                runtime: mockRuntime,
                source: {
                    type: WalletSourceType.FROM_MNEMONIC,
                    mnemonic: testMnemonic,
                },
            });
            const ejectedData = await WalletProvider.ejectWalletFromFile(
                walletProviderForEject,
                initialImportResult.walletAddress,
                encryptionPass,
            );
            expect(ejectedData.mnemonic).toBe(testMnemonic);
            expect(ejectedData.password).toBe(keypairPass);
            expect(ejectedData.hardDerivation).toBe(hardDerive);
            expect(ejectedData.softDerivation).toBe(softDerive);
            expect(ejectedData.options.type).toBe('sr25519');
            expect(ejectedData.options.ss58Format).toBe(2);
            const reImportedProvider = new WalletProvider({
                runtime: mockRuntime,
                source: {
                    type: WalletSourceType.FROM_ENCRYPTED_JSON,
                    encryptedJson: initialImportResult.encryptedBackup,
                    password: encryptionPass,
                },
            });
            expect(reImportedProvider.getAddress()).toBe(initialImportResult.walletAddress);
        });

        it('should create unique wallet addresses for same mnemonic with different derivation paths', async () => {
            const params1: ImportWalletContent = {
                mnemonic: testMnemonic,
                encryptionPassword: 'test-encrypt-password',
                hardDerivation: '//path1',
                text: 'import wallet1',
            };
            const result1 = await importWalletAction.importWallet(params1);

            const params2: ImportWalletContent = {
                mnemonic: testMnemonic,
                encryptionPassword: 'test-encrypt-password',
                hardDerivation: '//path2',
                text: 'import wallet2',
            };
            const result2 = await importWalletAction.importWallet(params2);

            expect(result1.walletAddress).not.toBe(result2.walletAddress);
            expect(
                fs.existsSync(
                    path.join(testBackupDir, `${result1.walletAddress}_wallet_backup.json`),
                ),
            ).toBe(true);
            expect(
                fs.existsSync(
                    path.join(testBackupDir, `${result2.walletAddress}_wallet_backup.json`),
                ),
            ).toBe(true);
        });

        it('should throw if encryptionPassword is empty or missing', async () => {
            const params: ImportWalletContent = {
                mnemonic: testMnemonic,
                encryptionPassword: '',
                text: 'import wallet bad pass',
            };
            await expect(importWalletAction.importWallet(params)).rejects.toThrow();
        });

        it('should throw if mnemonic is empty or missing', async () => {
            const params: ImportWalletContent = {
                mnemonic: '',
                encryptionPassword: 'test-password',
                text: 'import wallet bad mnemonic',
            };
            await expect(importWalletAction.importWallet(params)).rejects.toThrow();
        });
    });
});
