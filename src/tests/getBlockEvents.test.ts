import type { IAgentRuntime } from '@elizaos/core';
import { describe, it, vi, beforeEach, expect } from 'vitest';
import { GetBlockEventsAction } from '../actions/getBlockEvents';
import { PolkadotApiService } from '../services/api-service';
import { CacheManager, MemoryCacheAdapter } from '@elizaos/core';

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

describe('GetBlockEventsAction', () => {
    let mockRuntime: IAgentRuntime;
    let getBlockEventsAction: GetBlockEventsAction;
    let apiService: PolkadotApiService;

    beforeEach(async () => {
        vi.clearAllMocks();

        mockRuntime = {
            character: { name: 'TestAgent' },
            cacheManager: new CacheManager(new MemoryCacheAdapter()),
            getSetting: vi.fn().mockImplementation((param) => {
                if (param === 'POLKADOT_RPC_URL') {
                    return POLKADOT_RPC_URL;
                }
                return null;
            }),
            composeState: vi.fn().mockResolvedValue({}),
        } as unknown as IAgentRuntime;

        apiService = await PolkadotApiService.start(mockRuntime);
        getBlockEventsAction = new GetBlockEventsAction(mockRuntime);
    });

    describe('API Integration', () => {
        it('should retrieve events for a valid block number', async () => {
            const result = await getBlockEventsAction.getBlockEvents({
                blockNumberOrHash: RECENT_BLOCK_NUMBER,
            });

            expect(typeof result.blockNumber).toBe('string');
            expect(typeof result.blockHash).toBe('string');
            expect(typeof result.totalEvents).toBe('number');
            expect(typeof result.filteredEvents).toBe('number');
            expect(Array.isArray(result.events)).toBe(true);
            expect(result.totalEvents).toBeGreaterThanOrEqual(0);
            expect(result.filteredEvents).toBe(result.totalEvents); // No filter applied
            expect(result.events.length).toBe(result.filteredEvents);

            if (result.events.length > 0) {
                const event = result.events[0];
                expect(typeof event.index).toBe('number');
                expect(typeof event.section).toBe('string');
                expect(typeof event.method).toBe('string');
                expect(typeof event.dataCount).toBe('number');
                expect(typeof event.phase).toBe('string');
                expect(typeof event.summary).toBe('string');
            }
        });

        it('should handle block with events and verify formatting', async () => {
            const result = await getBlockEventsAction.getBlockEvents({
                blockNumberOrHash: RECENT_BLOCK_NUMBER,
            });

            expect(result.totalEvents).toBeGreaterThan(0);
            expect(result.blockHash).toMatch(/^0x[0-9a-fA-F]{64}$/); // Valid hex hash
            expect(result.blockNumber).toBe(RECENT_BLOCK_NUMBER);

            for (const event of result.events) {
                expect(typeof event.index).toBe('number');
                expect(event.section).toBeTruthy();
                expect(event.method).toBeTruthy();
                expect(typeof event.dataCount).toBe('number');
                expect(event.phase).toBeTruthy();
                expect(event.summary).toBeTruthy();
            }
        });

        it('should filter events by module when requested', async () => {
            const result = await getBlockEventsAction.getBlockEvents({
                blockNumberOrHash: RECENT_BLOCK_NUMBER,
                filterModule: 'system',
            });

            expect(result.totalEvents).toBeGreaterThanOrEqual(result.filteredEvents);
            expect(result.filterApplied).toBe('system');

            for (const event of result.events) {
                expect(event.section.toLowerCase()).toBe('system');
            }
        });

        it('should limit events when requested', async () => {
            const limit = 5;
            const result = await getBlockEventsAction.getBlockEvents({
                blockNumberOrHash: RECENT_BLOCK_NUMBER,
                limit: limit,
            });

            expect(result.events.length).toBeLessThanOrEqual(limit);
            if (result.totalEvents > limit) {
                expect(result.limitApplied).toBe(limit);
                expect(result.events.length).toBe(limit);
            }
        });

        it('should handle combination of filter and limit', async () => {
            const result = await getBlockEventsAction.getBlockEvents({
                blockNumberOrHash: RECENT_BLOCK_NUMBER,
                filterModule: 'system',
                limit: 3,
            });

            expect(result.filterApplied).toBe('system');
            expect(result.events.length).toBeLessThanOrEqual(3);

            for (const event of result.events) {
                expect(event.section.toLowerCase()).toBe('system');
            }
        });
    });

    describe('Error Handling', () => {
        it('should throw error for invalid block number', async () => {
            const invalidBlockNumber = INVALID_BLOCK_NUMBER;

            await expect(
                getBlockEventsAction.getBlockEvents({
                    blockNumberOrHash: invalidBlockNumber,
                }),
            ).rejects.toThrow();
        });

        it('should handle invalid block hash', async () => {
            const invalidHash = '0xinvalidhash';

            await expect(
                getBlockEventsAction.getBlockEvents({
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
                getBlockEventsAction.getBlockEvents({
                    blockNumberOrHash: RECENT_BLOCK_NUMBER,
                }),
            ).rejects.toThrow();
        });
    });
});
