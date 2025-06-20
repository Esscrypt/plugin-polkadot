import type { IAgentRuntime } from '@elizaos/core';
import { describe, it, vi, beforeEach, expect, afterEach } from 'vitest';
import { WalletProvider, initWalletProvider } from '../providers/wallet';
import { stringToU8a, u8aToHex } from '@polkadot/util';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { PROVIDER_CONFIG, WALLET_CACHE_KEY } from '../providers/wallet';
import { ValidateAction } from '../actions/validateSignature';
import { CacheManager } from '../utils/cache';

const cacheManager = new CacheManager();

describe('ValidateAction', () => {
    let mockRuntime: IAgentRuntime;
    let walletProvider: WalletProvider;
    let walletAddress: string;
    let validateAction: ValidateAction;
    const TEST_PASSWORD = 'test-password';
    const TEST_MESSAGE = 'Hello, this is a test message!';
    let testBackupDir: string;

    beforeEach(async () => {
        // Reset all mocks
        vi.clearAllMocks();

        // Create a temporary test directory
        testBackupDir = path.join(process.cwd(), 'validate_signature_test_wallet_backups');

        // Clean up any existing test directory
        if (fs.existsSync(testBackupDir)) {
            fs.rmSync(testBackupDir, { recursive: true, force: true });
        }

        // Create fresh test directory
        fs.mkdirSync(testBackupDir, { recursive: true });

        // Override the backup directory for testing
        PROVIDER_CONFIG.WALLET_BACKUP_DIRNAME = 'validate_signature_test_wallet_backups';

        // Create mock runtime with real cache manager
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

        // Initialize ValidateAction
        validateAction = new ValidateAction(walletProvider);
    });

    afterEach(async () => {
        // Clear all wallets from cache
        await WalletProvider.clearAllWalletsFromCache(walletProvider);

        // Ensure cache is empty
        const cache = await cacheManager.get(WALLET_CACHE_KEY);
        expect(cache).toEqual({
            wallets: {},
            numberToAddress: {},
        });

        // Remove test directory and all its contents
        if (fs.existsSync(testBackupDir)) {
            fs.rmSync(testBackupDir, { recursive: true, force: true });
        }
    });

    describe('Validate Signature with Wallet Number', () => {
        it('should validate signature with wallet loaded by number', async () => {
            // Load the wallet and get keypair
            const loadedWallet = await WalletProvider.loadWalletByNumber(
                walletProvider,
                1,
                TEST_PASSWORD,
            );
            const pairs = loadedWallet.keyring.getPairs();
            const keypair = pairs[0];

            // Sign the message
            const messageU8a = stringToU8a(TEST_MESSAGE);
            const signature = keypair.sign(messageU8a);
            const signatureHex = u8aToHex(signature);

            // Validate the signature
            const result = await validateAction.validateSignature(
                TEST_MESSAGE,
                signatureHex,
                1,
                undefined,
                TEST_PASSWORD,
            );

            expect(result.status).toBe('success');
            expect(result.isValid).toBe(true);
            expect(result.walletAddress).toBe(walletAddress);
            expect(result.walletNumber).toBe(1);
        });

        it('should fail validation with incorrect wallet number', async () => {
            // Load the wallet and get keypair
            const loadedWallet = await WalletProvider.loadWalletByNumber(
                walletProvider,
                1,
                TEST_PASSWORD,
            );
            const pairs = loadedWallet.keyring.getPairs();
            const keypair = pairs[0];

            // Sign the message
            const messageU8a = stringToU8a(TEST_MESSAGE);
            const signature = keypair.sign(messageU8a);
            const signatureHex = u8aToHex(signature);

            // Attempt to validate with incorrect wallet number
            await expect(
                validateAction.validateSignature(
                    TEST_MESSAGE,
                    signatureHex,
                    999,
                    undefined,
                    TEST_PASSWORD,
                ),
            ).rejects.toThrow();
        });
    });

    describe('Validate Signature with Wallet Address', () => {
        it('should validate signature with wallet loaded by address', async () => {
            // Load the wallet and get keypair
            const loadedWallet = await WalletProvider.loadWalletByAddress(
                walletProvider,
                walletAddress,
                TEST_PASSWORD,
            );
            const pairs = loadedWallet.keyring.getPairs();
            const keypair = pairs[0];

            // Sign the message
            const messageU8a = stringToU8a(TEST_MESSAGE);
            const signature = keypair.sign(messageU8a);
            const signatureHex = u8aToHex(signature);

            // Validate the signature
            const result = await validateAction.validateSignature(
                TEST_MESSAGE,
                signatureHex,
                undefined,
                walletAddress,
                TEST_PASSWORD,
            );

            expect(result.status).toBe('success');
            expect(result.isValid).toBe(true);
            expect(result.walletAddress).toBe(walletAddress);
            expect(result.walletNumber).toBe(1);
        });

        it('should fail validation with non-existent wallet address', async () => {
            // Load the wallet and get keypair
            const loadedWallet = await WalletProvider.loadWalletByNumber(
                walletProvider,
                1,
                TEST_PASSWORD,
            );
            const pairs = loadedWallet.keyring.getPairs();
            const keypair = pairs[0];

            // Sign the message
            const messageU8a = stringToU8a(TEST_MESSAGE);
            const signature = keypair.sign(messageU8a);
            const signatureHex = u8aToHex(signature);

            // Attempt to validate with non-existent address
            await expect(
                validateAction.validateSignature(
                    TEST_MESSAGE,
                    signatureHex,
                    undefined,
                    'non-existent-address',
                    TEST_PASSWORD,
                ),
            ).rejects.toThrow();
        });
    });

    describe('Signature Verification', () => {
        it('should fail validation with modified message', async () => {
            // Load the wallet and get keypair
            const loadedWallet = await WalletProvider.loadWalletByNumber(
                walletProvider,
                1,
                TEST_PASSWORD,
            );
            const pairs = loadedWallet.keyring.getPairs();
            const keypair = pairs[0];

            // Sign the original message
            const messageU8a = stringToU8a(TEST_MESSAGE);
            const signature = keypair.sign(messageU8a);
            const signatureHex = u8aToHex(signature);

            // Try to validate with modified message
            const modifiedMessage = `${TEST_MESSAGE} (modified)`;
            const result = await validateAction.validateSignature(
                modifiedMessage,
                signatureHex,
                1,
                undefined,
                TEST_PASSWORD,
            );

            expect(result.status).toBe('success');
            expect(result.isValid).toBe(false);
        });

        it('should fail validation with invalid signature', async () => {
            // Create an invalid signature
            const invalidSignature = `0x${'1'.repeat(128)}`;

            // Attempt to validate with invalid signature
            const result = await validateAction.validateSignature(
                TEST_MESSAGE,
                invalidSignature,
                1,
                undefined,
                TEST_PASSWORD,
            );

            expect(result.status).toBe('success');
            expect(result.isValid).toBe(false);
        });
    });

    describe('Error Handling', () => {
        it('should handle empty message', async () => {
            // Load the wallet and get keypair
            const loadedWallet = await WalletProvider.loadWalletByNumber(
                walletProvider,
                1,
                TEST_PASSWORD,
            );
            const pairs = loadedWallet.keyring.getPairs();
            const keypair = pairs[0];

            // Sign the message
            const messageU8a = stringToU8a(TEST_MESSAGE);
            const signature = keypair.sign(messageU8a);
            const signatureHex = u8aToHex(signature);

            // Attempt to validate with empty message
            await expect(
                validateAction.validateSignature('', signatureHex, 1, undefined, TEST_PASSWORD),
            ).rejects.toThrow('Cannot validate signature for an empty message');
        });

        it('should handle empty signature', async () => {
            // Attempt to validate with empty signature
            await expect(
                validateAction.validateSignature(TEST_MESSAGE, '', 1, undefined, TEST_PASSWORD),
            ).rejects.toThrow('Cannot validate an empty signature');
        });

        it('should handle missing wallet number and address', async () => {
            // Load the wallet and get keypair
            const loadedWallet = await WalletProvider.loadWalletByNumber(
                walletProvider,
                1,
                TEST_PASSWORD,
            );
            const pairs = loadedWallet.keyring.getPairs();
            const keypair = pairs[0];

            // Sign the message
            const messageU8a = stringToU8a(TEST_MESSAGE);
            const signature = keypair.sign(messageU8a);
            const signatureHex = u8aToHex(signature);

            // Attempt to validate without wallet number or address
            await expect(
                validateAction.validateSignature(
                    TEST_MESSAGE,
                    signatureHex,
                    undefined,
                    undefined,
                    TEST_PASSWORD,
                ),
            ).rejects.toThrow(
                'Unable to validate signature. Please provide a wallet number or address.',
            );
        });
    });
});
