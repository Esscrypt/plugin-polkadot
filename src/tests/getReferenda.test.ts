import type { IAgentRuntime } from '@elizaos/core';
import { describe, it, vi, beforeEach, expect } from 'vitest';
import { GetReferendaAction } from '../actions/getReferenda';
import { PolkadotApiService } from '../services/api-service';
import { CacheManager } from '../utils/cache';

const cacheManager = new CacheManager();

const POLKADOT_RPC_URL = 'wss://rpc.polkadot.io';

// Mock the core functions
vi.mock('@elizaos/core', async () => {
    const actual = await vi.importActual('@elizaos/core');
    return {
        ...actual,
        generateObject: vi.fn(),
        composeContext: vi.fn(),
    };
});

describe('GetReferendaAction', () => {
    let mockRuntime: IAgentRuntime;
    let getReferendaAction: GetReferendaAction;
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
        getReferendaAction = new GetReferendaAction(mockRuntime);
    });

    describe('API Integration', () => {
        it('should retrieve referenda with default behavior', async () => {
            const result = await getReferendaAction.getReferenda();

            expect(typeof result.totalCount).toBe('number');
            expect(typeof result.returnedCount).toBe('number');
            expect(Array.isArray(result.referenda)).toBe(true);
            expect(result.totalCount).toBeGreaterThanOrEqual(0);
            expect(result.returnedCount).toBeGreaterThanOrEqual(0);
            expect(result.returnedCount).toBeLessThanOrEqual(result.totalCount);
            expect(result.referenda.length).toBe(result.returnedCount);

            if (result.referenda.length > 0) {
                const referendum = result.referenda[0];
                expect(typeof referendum.id).toBe('number');
                expect(typeof referendum.trackId).toBe('number');
                expect(typeof referendum.trackName).toBe('string');
                expect(typeof referendum.status).toBe('string');
                expect(typeof referendum.proposalHash).toBe('string');
                expect([
                    'ongoing',
                    'approved',
                    'rejected',
                    'cancelled',
                    'timedout',
                    'killed',
                    'unknown',
                ]).toContain(referendum.status);
            }
        });

        it('should respect custom limit parameter', async () => {
            const limit = 5;
            const result = await getReferendaAction.getReferenda(limit);

            expect(result.returnedCount).toBeLessThanOrEqual(limit);
            expect(result.referenda.length).toBeLessThanOrEqual(limit);

            // If there are enough referenda, should return exactly the limit
            if (result.totalCount >= limit) {
                expect(result.returnedCount).toBe(limit);
                expect(result.referenda.length).toBe(limit);
            }
        });

        it('should handle limit greater than max returnable referenda', async () => {
            const largeLimit = 1000;
            const result = await getReferendaAction.getReferenda(largeLimit);

            expect(result.returnedCount).toBeLessThanOrEqual(result.totalCount);
        });

        it('should validate referendum data structure', async () => {
            const result = await getReferendaAction.getReferenda(3);

            for (const referendum of result.referenda) {
                // Required fields
                expect(typeof referendum.id).toBe('number');
                expect(referendum.id).toBeGreaterThanOrEqual(0);
                expect(typeof referendum.trackId).toBe('number');
                expect(typeof referendum.trackName).toBe('string');
                expect(typeof referendum.status).toBe('string');
                expect(typeof referendum.proposalHash).toBe('string');

                if (referendum.submitted) {
                    expect(typeof referendum.submitted).toBe('string');
                }
                if (referendum.tally) {
                    expect(typeof referendum.tally.ayes).toBe('string');
                    expect(typeof referendum.tally.nays).toBe('string');
                    expect(typeof referendum.tally.support).toBe('string');
                }
                if (referendum.submissionDeposit) {
                    expect(typeof referendum.submissionDeposit.who).toBe('string');
                    expect(typeof referendum.submissionDeposit.amount).toBe('string');
                }
            }
        });
    });

    describe('Error Handling', () => {
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

            await expect(getReferendaAction.getReferenda()).rejects.toThrow();
        });

        it('should handle invalid limit values', async () => {
            const result1 = await getReferendaAction.getReferenda(0);
            expect(result1.returnedCount).toBeGreaterThanOrEqual(0);

            const result2 = await getReferendaAction.getReferenda(-5);
            expect(result2.returnedCount).toBeGreaterThanOrEqual(0);
        });
    });
});
