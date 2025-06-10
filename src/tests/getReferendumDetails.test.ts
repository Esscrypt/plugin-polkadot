import type { IAgentRuntime } from '@elizaos/core';
import { describe, it, vi, beforeEach, expect } from 'vitest';
import { GetReferendumDetailsAction } from '../actions/getReferendumDetails';
import { PolkadotApiService } from '../services/api-service';
import { CacheManager, MemoryCacheAdapter } from '@elizaos/core';

const POLKADOT_RPC_URL = 'wss://rpc.polkadot.io';

const EXISTING_REFERENDUM_ID = 100;
const INVALID_REFERENDUM_ID = 9999999999;

// Mock the core functions
vi.mock('@elizaos/core', async () => {
    const actual = await vi.importActual('@elizaos/core');
    return {
        ...actual,
        generateObject: vi.fn(),
        composeContext: vi.fn(),
    };
});

describe('GetReferendumDetailsAction', () => {
    let mockRuntime: IAgentRuntime;
    let getReferendumDetailsAction: GetReferendumDetailsAction;
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
        getReferendumDetailsAction = new GetReferendumDetailsAction(mockRuntime);
    });

    describe('API Integration', () => {
        it('should retrieve referendum details for an existing referendum', async () => {
            const result =
                await getReferendumDetailsAction.getReferendumDetails(EXISTING_REFERENDUM_ID);

            expect(typeof result.id).toBe('number');
            expect(result.id).toBe(EXISTING_REFERENDUM_ID);
            expect(typeof result.trackId).toBe('number');
            expect(typeof result.trackName).toBe('string');
            expect(typeof result.status).toBe('string');

            if (result.status === 'ongoing') {
                expect(typeof result.proposalHash).toBe('string');
            }

            expect([
                'ongoing',
                'approved',
                'rejected',
                'cancelled',
                'timedout',
                'killed',
                'unknown',
            ]).toContain(result.status);

            if (result.submitted) {
                expect(typeof result.submitted).toBe('string');
            }
            if (result.proposalLength) {
                expect(typeof result.proposalLength).toBe('number');
            }
            if (result.submissionDeposit) {
                expect(typeof result.submissionDeposit.who).toBe('string');
                expect(typeof result.submissionDeposit.amount).toBe('string');
                expect(typeof result.submissionDeposit.formattedAmount).toBe('string');
            }
            if (result.tally) {
                expect(typeof result.tally.ayes).toBe('string');
                expect(typeof result.tally.nays).toBe('string');
                expect(typeof result.tally.support).toBe('string');
                expect(typeof result.tally.formattedAyes).toBe('string');
                expect(typeof result.tally.formattedNays).toBe('string');
                expect(typeof result.tally.formattedSupport).toBe('string');
            }
        });

        it('should validate track name mapping', async () => {
            const result =
                await getReferendumDetailsAction.getReferendumDetails(EXISTING_REFERENDUM_ID);

            expect(result.trackName).toBeTruthy();
            expect(typeof result.trackName).toBe('string');

            expect(result.trackId).toBeGreaterThanOrEqual(-1); // -1 for unknown/completed
        });

        it('should format token amounts correctly', async () => {
            const result =
                await getReferendumDetailsAction.getReferendumDetails(EXISTING_REFERENDUM_ID);

            if (result.submissionDeposit?.formattedAmount) {
                expect(result.submissionDeposit.formattedAmount).toMatch(/\d+\.?\d* DOT/);
            }
            if (result.decisionDeposit?.formattedAmount) {
                expect(result.decisionDeposit.formattedAmount).toMatch(/\d+\.?\d* DOT/);
            }
            if (result.tally?.formattedAyes) {
                expect(result.tally.formattedAyes).toMatch(/\d+\.?\d* DOT/);
                expect(result.tally.formattedNays).toMatch(/\d+\.?\d* DOT/);
                expect(result.tally.formattedSupport).toMatch(/\d+\.?\d* DOT/);
            }
        });
    });

    describe('Error Handling', () => {
        it('should throw error for non-existent referendum ID', async () => {
            const nonExistentId = INVALID_REFERENDUM_ID; // Very high ID that shouldn't exist

            await expect(
                getReferendumDetailsAction.getReferendumDetails(nonExistentId),
            ).rejects.toThrow();
        });

        it('should handle negative referendum ID', async () => {
            await expect(getReferendumDetailsAction.getReferendumDetails(-1)).rejects.toThrow();
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
                getReferendumDetailsAction.getReferendumDetails(EXISTING_REFERENDUM_ID),
            ).rejects.toThrow();
        });
    });
});
