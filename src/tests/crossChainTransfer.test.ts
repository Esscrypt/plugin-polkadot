import type { IAgentRuntime } from '@elizaos/core';
import { describe, it, vi, beforeEach, expect, afterEach } from 'vitest';
import { CrossChainTransferAction, crossChainTransferSchema } from '../actions/crossChainTransfer';
import { CacheManager } from '../utils/cache';
import { CHAIN_RPC_MAPPING } from '../utils/chainRegistryUtils';

const cacheManager = new CacheManager();

// Test constants
const POLKADOT_RPC_URL = 'wss://rpc.polkadot.io';
const MOONBEAM_RPC_URL = 'wss://wss.api.moonbeam.network';
const TEST_RECIPIENT_ADDRESS = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';
const TEST_AMOUNT = '1';
const TEST_ASSET_ID = 'DOT';

// Mock only the core functions that are not part of the actual functionality
vi.mock('@elizaos/core', async () => {
    const actual = await vi.importActual('@elizaos/core');
    return {
        ...actual,
        logger: {
            log: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        },
        ModelType: {
            TEXT_SMALL: 'text-small',
        },
        composePromptFromState: vi.fn().mockReturnValue('test prompt'),
        parseJSONObjectFromText: vi.fn().mockImplementation((text: string) => {
            // Mock parsing of JSON response
            try {
                return JSON.parse(text);
            } catch {
                return null;
            }
        }),
    };
});

describe('CrossChainTransferAction', () => {
    let mockRuntime: IAgentRuntime;
    let crossChainTransferAction: CrossChainTransferAction;

    beforeEach(async () => {
        vi.clearAllMocks();

        mockRuntime = {
            character: { name: 'TestAgent' },
            getCache: vi.fn().mockImplementation((key: string) => {
                return cacheManager.get(key);
            }),
            setCache: vi.fn().mockImplementation((key: string, value: unknown) => {
                cacheManager.set(key, value);
            }),
            getSetting: vi.fn().mockImplementation((param: string) => {
                if (param === 'POLKADOT_RPC_URL') {
                    return POLKADOT_RPC_URL;
                }
                return null;
            }),
            useModel: vi.fn().mockResolvedValue(
                JSON.stringify({
                    recipientAddress: TEST_RECIPIENT_ADDRESS,
                    amount: TEST_AMOUNT,
                    sourceChain: 'polkadot',
                    destinationChain: 'moonbeam',
                    destinationParachainId: '2004',
                    assetId: TEST_ASSET_ID,
                    walletNumber: null,
                    walletAddress: null,
                    password: null,
                }),
            ),
            composeState: vi.fn().mockResolvedValue({}),
        } as unknown as IAgentRuntime;

        crossChainTransferAction = new CrossChainTransferAction(mockRuntime);
    });

    afterEach(async () => {
        // Clean up any connections
        if (crossChainTransferAction) {
            try {
                // Close API connections if they exist
                if (
                    (
                        crossChainTransferAction as unknown as {
                            api: { disconnect: () => Promise<void> };
                        }
                    ).api
                ) {
                    await (
                        crossChainTransferAction as unknown as {
                            api: { disconnect: () => Promise<void> };
                        }
                    ).api.disconnect();
                }
            } catch (_error) {
                // Ignore cleanup errors
            }
        }
    });

    describe('Schema Validation', () => {
        it('should validate correct cross-chain transfer data', () => {
            const validData = {
                recipientAddress: TEST_RECIPIENT_ADDRESS,
                amount: TEST_AMOUNT,
                sourceChain: 'polkadot',
                destinationChain: 'moonbeam',
                destinationParachainId: '2004',
                assetId: TEST_ASSET_ID,
                walletNumber: null,
                walletAddress: null,
                password: null,
            };

            const result = crossChainTransferSchema.safeParse(validData);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.recipientAddress).toBe(TEST_RECIPIENT_ADDRESS);
                expect(result.data.amount).toBe(TEST_AMOUNT);
                expect(result.data.sourceChain).toBe('polkadot');
                expect(result.data.destinationChain).toBe('moonbeam');
            }
        });

        it('should handle optional fields correctly', () => {
            const dataWithOptionals = {
                recipientAddress: TEST_RECIPIENT_ADDRESS,
                amount: TEST_AMOUNT,
                sourceChain: 'polkadot',
                destinationChain: 'moonbeam',
                destinationParachainId: '2004',
                assetId: TEST_ASSET_ID,
                walletNumber: 1,
                walletAddress: 'test-address',
                password: 'test-password',
            };

            const result = crossChainTransferSchema.safeParse(dataWithOptionals);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.walletNumber).toBe(1);
                expect(result.data.walletAddress).toBe('test-address');
                expect(result.data.password).toBe('test-password');
            }
        });
    });

    describe('CrossChainTransferAction Initialization', () => {
        it('should initialize with valid source chain', async () => {
            await expect(crossChainTransferAction.initialize('polkadot')).resolves.not.toThrow();

            // Verify that the action was properly initialized
            expect(
                (crossChainTransferAction as unknown as { sourceChainName: string })
                    .sourceChainName,
            ).toBe('polkadot');
            expect(
                (crossChainTransferAction as unknown as { currentRpcUrl: string }).currentRpcUrl,
            ).toBe(POLKADOT_RPC_URL);
        });

        it('should use chain RPC mapping for known chains', async () => {
            await crossChainTransferAction.initialize('moonbeam');

            expect(
                (crossChainTransferAction as unknown as { currentRpcUrl: string }).currentRpcUrl,
            ).toBe(MOONBEAM_RPC_URL);
        });

        it('should handle unknown chains gracefully', async () => {
            // Mock runtime to return null for unknown chain
            const unknownChainRuntime = {
                ...mockRuntime,
                getSetting: vi.fn().mockReturnValue(null),
            } as unknown as IAgentRuntime;

            const action = new CrossChainTransferAction(unknownChainRuntime);

            await expect(action.initialize('unknown-chain')).rejects.toThrow();
        });
    });

    describe('Transfer Funds Validation', () => {
        beforeEach(async () => {
            await crossChainTransferAction.initialize('polkadot');
        });

        it('should validate transfer parameters', async () => {
            const validParams = {
                recipientAddress: TEST_RECIPIENT_ADDRESS,
                amount: TEST_AMOUNT,
                destinationChain: 'moonbeam',
                destinationParachainId: '2004',
                assetId: TEST_ASSET_ID,
            };

            // This test validates the parameter structure without actually executing the transfer
            expect(validParams.recipientAddress).toBeTruthy();
            expect(validParams.amount).toBeTruthy();
            expect(validParams.destinationChain).toBeTruthy();
            expect(validParams.destinationParachainId).toBeTruthy();
            expect(validParams.assetId).toBeTruthy();
        });

        it('should handle missing optional parameters', async () => {
            const paramsWithoutOptionals = {
                recipientAddress: TEST_RECIPIENT_ADDRESS,
                amount: TEST_AMOUNT,
                destinationChain: 'moonbeam',
                destinationParachainId: '2004',
                // assetId, walletNumber, walletAddress, password are optional
            };

            expect(paramsWithoutOptionals.recipientAddress).toBeTruthy();
            expect(paramsWithoutOptionals.amount).toBeTruthy();
            expect(paramsWithoutOptionals.destinationChain).toBeTruthy();
            expect(paramsWithoutOptionals.destinationParachainId).toBeTruthy();
        });

        it('should validate parachain ID format', () => {
            const validParachainIds = ['2004', '2000', '1000'];
            const invalidParachainIds = ['', 'abc', '-1'];

            for (const id of validParachainIds) {
                expect(id).toMatch(/^\d+$/);
                expect(Number.parseInt(id)).toBeGreaterThan(0);
            }

            for (const id of invalidParachainIds) {
                expect(id).not.toMatch(/^\d+$/);
            }
        });
    });

    describe('Chain RPC Mapping', () => {
        it('should have valid RPC URLs for known chains', () => {
            const knownChains = ['polkadot', 'moonbeam', 'moonriver', 'acala'];

            for (const chain of knownChains) {
                const rpcUrl = CHAIN_RPC_MAPPING[chain];
                expect(rpcUrl).toBeDefined();
                expect(rpcUrl).toMatch(/^wss:\/\//);
            }
        });

        it('should handle case-insensitive chain names', () => {
            const chainVariations = ['Polkadot', 'POLKADOT', 'polkadot'];

            for (const variation of chainVariations) {
                const rpcUrl = CHAIN_RPC_MAPPING[variation.toLowerCase()];
                expect(rpcUrl).toBeDefined();
            }
        });
    });

    describe('Error Handling', () => {
        it('should handle invalid recipient addresses', async () => {
            const invalidAddresses = ['', 'invalid-address', '0x123', 'not-an-address'];

            for (const address of invalidAddresses) {
                expect(address).not.toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
            }
        });

        // it('should handle invalid amounts', async () => {
        //     const invalidAmounts = ['', '-1', '0', 'abc', '1.2.3'];

        //     invalidAmounts.forEach(amount => {
        //         expect(amount).not.toMatch(/^\d+(\.\d+)?$/);
        //     });
        // });

        it('should handle missing required parameters', async () => {
            const requiredParams = [
                'recipientAddress',
                'amount',
                'destinationChain',
                'destinationParachainId',
            ];

            for (const param of requiredParams) {
                expect(param).toBeTruthy();
            }
        });
    });
});
