import type { IAgentRuntime } from '@elizaos/core';
import { describe, it, vi, beforeEach, expect, afterEach } from 'vitest';
import { WalletProvider, initWalletProvider } from '../providers/wallet';
import { stringToU8a, hexToU8a } from '@polkadot/util';
import { signatureVerify } from '@polkadot/util-crypto';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { PROVIDER_CONFIG } from '../providers/wallet';
import { SignMessageAction } from '../actions/signMessage';
import { CacheManager } from '../utils/cache';

const cacheManager = new CacheManager();

describe('SignMessage', () => {
    let mockRuntime: IAgentRuntime;
    let walletProvider: WalletProvider;
    let loadedWallet: WalletProvider;
    let walletAddress: string;
    let signAction: SignMessageAction;
    const TEST_PASSWORD = 'test-password';
    const TEST_MESSAGE = 'Hello, this is a test message!';
    let testBackupDir: string;

    beforeEach(async () => {
        // Reset all mocks
        vi.clearAllMocks();

        // Create a temporary test directory
        // Create a temporary test directory
        testBackupDir = path.join(process.cwd(), 'sign_message_test_wallet_backups');

        // Clean up any existing test directory
        if (fs.existsSync(testBackupDir)) {
            fs.rmSync(testBackupDir, { recursive: true, force: true });
        }

        // Create fresh test directory
        fs.mkdirSync(testBackupDir, { recursive: true });

        // Override the backup directory for testing
        PROVIDER_CONFIG.WALLET_BACKUP_DIRNAME = 'sign_message_test_wallet_backups';

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

        // Load the wallet for testing
        loadedWallet = await WalletProvider.loadWalletByAddress(
            walletProvider,
            walletAddress,
            TEST_PASSWORD,
        );
        signAction = new SignMessageAction(loadedWallet);
    });

    afterEach(() => {
        // Clean up test directory after each test
        if (fs.existsSync(testBackupDir)) {
            fs.rmSync(testBackupDir, { recursive: true, force: true });
        }
    });

    describe('Sign Message with Wallet Number', () => {
        it('should sign message with wallet loaded by number', async () => {
            const result = await signAction.signMessage(TEST_MESSAGE, 1, undefined, TEST_PASSWORD);

            expect(result.status).toBe('success');
            expect(result.signature).toBeDefined();
            expect(result.walletAddress).toBe(walletAddress);
            expect(result.walletNumber).toBe(1);

            // Verify the signature
            const messageU8a = stringToU8a(TEST_MESSAGE);
            const signatureU8a = hexToU8a(result.signature);
            const publicKey = loadedWallet.keyring.getPair(walletAddress).publicKey;
            const verification = signatureVerify(messageU8a, signatureU8a, publicKey);
            expect(verification.isValid).toBe(true);
        });

        it('should fail to sign with incorrect wallet number', async () => {
            await expect(
                signAction.signMessage(TEST_MESSAGE, 999, undefined, TEST_PASSWORD),
            ).rejects.toThrow();
        });
    });

    describe('Sign Message with Wallet Address', () => {
        it('should sign message with wallet loaded by address', async () => {
            const result = await signAction.signMessage(
                TEST_MESSAGE,
                undefined,
                walletAddress,
                TEST_PASSWORD,
            );

            expect(result.status).toBe('success');
            expect(result.signature).toBeDefined();
            expect(result.walletAddress).toBe(walletAddress);

            // Verify the signature
            const messageU8a = stringToU8a(TEST_MESSAGE);
            const signatureU8a = hexToU8a(result.signature);
            const publicKey = loadedWallet.keyring.getPair(walletAddress).publicKey;
            const verification = signatureVerify(messageU8a, signatureU8a, publicKey);
            expect(verification.isValid).toBe(true);
        });

        it('should fail to sign with non-existent wallet address', async () => {
            await expect(
                signAction.signMessage(
                    TEST_MESSAGE,
                    undefined,
                    'non-existent-address',
                    TEST_PASSWORD,
                ),
            ).rejects.toThrow();
        });
    });

    describe('Signature Verification', () => {
        it('should verify signature with correct message', async () => {
            const result = await signAction.signMessage(TEST_MESSAGE, 1, undefined, TEST_PASSWORD);

            // Verify with correct message
            const messageU8a = stringToU8a(TEST_MESSAGE);
            const signatureU8a = hexToU8a(result.signature);
            const publicKey = loadedWallet.keyring.getPair(walletAddress).publicKey;
            const verification = signatureVerify(messageU8a, signatureU8a, publicKey);
            expect(verification.isValid).toBe(true);
        });

        it('should fail verification with modified message', async () => {
            const result = await signAction.signMessage(TEST_MESSAGE, 1, undefined, TEST_PASSWORD);

            // Try to verify with modified message
            const modifiedMessage = `${TEST_MESSAGE} (modified)`;
            const modifiedMessageU8a = stringToU8a(modifiedMessage);
            const signatureU8a = hexToU8a(result.signature);
            const publicKey = loadedWallet.keyring.getPair(walletAddress).publicKey;
            const verification = signatureVerify(modifiedMessageU8a, signatureU8a, publicKey);
            expect(verification.isValid).toBe(false);
        });
    });

    describe('Error Handling', () => {
        it('should handle empty message', async () => {
            await expect(signAction.signMessage('', 1, undefined, TEST_PASSWORD)).rejects.toThrow(
                'Cannot sign an empty message',
            );
        });
    });
});
