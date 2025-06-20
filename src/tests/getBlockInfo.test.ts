import type { IAgentRuntime } from '@elizaos/core';
import { describe, it, vi, beforeEach, expect } from 'vitest';
import { GetBlockInfoAction } from '../actions/getBlockInfo';
import { PolkadotApiService } from '../services/api-service';
import { CacheManager } from '../utils/cache';

const cacheManager = new CacheManager();

const POLKADOT_RPC_URL = 'wss://rpc.polkadot.io';

const RECENT_BLOCK_NUMBER = '22000000';
const INVALID_BLOCK_NUMBER = '9999999999999999';

// Mock the core functions
vi.mock('@elizaos/core', async () => {
    const actual = await vi.importActual('@elizaos/core');
    return {
        ...actual,
        generateObject: vi.fn(),
        composeContext: vi.fn(),
    };
});

describe('GetBlockInfoAction', () => {
    let mockRuntime: IAgentRuntime;
    let getBlockInfoAction: GetBlockInfoAction;
    let apiService: PolkadotApiService;

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
            getSetting: vi.fn().mockImplementation((param) => {
                if (param === 'POLKADOT_RPC_URL') {
                    return POLKADOT_RPC_URL;
                }
                return null;
            }),
            composeState: vi.fn().mockResolvedValue({}),
        } as unknown as IAgentRuntime;

        apiService = await PolkadotApiService.start(mockRuntime);
        getBlockInfoAction = new GetBlockInfoAction(mockRuntime);
    });

    describe('API Integration', () => {
        it('should retrieve block info for a valid block number', async () => {
            const result = await getBlockInfoAction.getBlockInfo({
                blockNumberOrHash: RECENT_BLOCK_NUMBER,
            });

            expect(typeof result.number).toBe('string');
            expect(typeof result.hash).toBe('string');
            expect(typeof result.parentHash).toBe('string');
            expect(typeof result.stateRoot).toBe('string');
            expect(typeof result.extrinsicsRoot).toBe('string');
            expect(typeof result.timestamp).toBe('string');
            expect(typeof result.extrinsicsCount).toBe('number');
            expect(typeof result.eventsCount).toBe('number');

            expect(result.number).toBe(RECENT_BLOCK_NUMBER);

            // Verify hash format
            expect(result.hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
            expect(result.parentHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
            expect(result.stateRoot).toMatch(/^0x[0-9a-fA-F]{64}$/);
            expect(result.extrinsicsRoot).toMatch(/^0x[0-9a-fA-F]{64}$/);

            expect(result.extrinsicsCount).toBeGreaterThanOrEqual(0);
            expect(result.eventsCount).toBeGreaterThanOrEqual(0);
        });

        it('should handle block with real data and verify formatting', async () => {
            const result = await getBlockInfoAction.getBlockInfo({
                blockNumberOrHash: RECENT_BLOCK_NUMBER,
            });

            expect(result.extrinsicsCount).toBeGreaterThan(0);
            expect(result.eventsCount).toBeGreaterThan(0);

            if (result.timestamp !== 'Unknown') {
                expect(() => new Date(result.timestamp)).not.toThrow();
                expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
            }
        });

        it('should identify block number vs hash correctly', async () => {
            const numberResult = await getBlockInfoAction.getBlockInfo({
                blockNumberOrHash: RECENT_BLOCK_NUMBER,
            });

            // Test with the hash from the previous result
            const hashResult = await getBlockInfoAction.getBlockInfo({
                blockNumberOrHash: numberResult.hash,
            });

            expect(numberResult.number).toBe(hashResult.number);
            expect(numberResult.hash).toBe(hashResult.hash);
            expect(numberResult.parentHash).toBe(hashResult.parentHash);
        });
    });

    describe('Error Handling', () => {
        it('should throw error for invalid block number', async () => {
            const invalidBlockNumber = INVALID_BLOCK_NUMBER;

            await expect(
                getBlockInfoAction.getBlockInfo({
                    blockNumberOrHash: invalidBlockNumber,
                }),
            ).rejects.toThrow();
        });

        it('should throw error for invalid block hash format', async () => {
            const invalidHash = '0xinvalidhash';

            await expect(
                getBlockInfoAction.getBlockInfo({
                    blockNumberOrHash: invalidHash,
                }),
            ).rejects.toThrow();
        });

        it('should handle connection failures gracefully', async () => {
            // Create a new instance with invalid RPC URL
            const badRuntime = {
                ...mockRuntime,
                getSetting: vi.fn().mockImplementation((param) => {
                    if (param === 'POLKADOT_RPC_URL') {
                        return 'wss://invalid-url.com';
                    }
                    return null;
                }),
            } as unknown as IAgentRuntime;

            apiService.stop();
            PolkadotApiService.start(badRuntime);

            await expect(
                getBlockInfoAction.getBlockInfo({
                    blockNumberOrHash: RECENT_BLOCK_NUMBER,
                }),
            ).rejects.toThrow();
        });
    });
});
