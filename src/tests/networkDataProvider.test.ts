import type { IAgentRuntime, Memory, State } from '@elizaos/core';
import { describe, it, vi, beforeEach, expect, afterEach } from 'vitest';
import networkDataProvider from '../providers/networkData';
import { PolkadotApiService } from '../services/api-service';
import { CacheManager } from '../utils/cache';

const POLKADOT_RPC_URL = 'wss://rpc.polkadot.io';

describe('Network Data Provider', () => {
    let mockRuntime: IAgentRuntime;
    let apiService: PolkadotApiService;
    let mockMessage: Memory;
    let mockState: State;
    const cacheManager = new CacheManager();
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

        mockMessage = {
            userId: 'test-user',
            content: { text: 'test message' },
        } as unknown as Memory;

        mockState = {} as State;

        apiService = await PolkadotApiService.start(mockRuntime);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('API Integration', () => {
        it('should fetch and return network status information', async () => {
            const result = await networkDataProvider.get(mockRuntime, mockMessage, mockState);

            expect(typeof result.text).toBe('string');
            expect(result.text.length).toBeGreaterThan(0);

            expect(result.text).toMatch(/Network Status.*:/);
            expect(result.text).toContain('Network:');
            expect(result.text).toContain('Connected:');
            expect(result.text).toContain('Synced:');
            expect(result.text).toContain('Latest Block:');
            expect(result.text).toContain('Native Token:');
        });

        it('should include real network details', async () => {
            const result = await networkDataProvider.get(mockRuntime, mockMessage, mockState);

            // Should contain realistic network values
            expect(result.text).toMatch(/Network: \w+/); // Network name
            expect(result.text).toMatch(/Connected: (Yes|No) \(\d+ peers\)/); // Peer count
            expect(result.text).toMatch(/Synced: (Yes|No)/); // Sync status
            expect(result.text).toMatch(/Latest Block: #\d+/); // Block number
            expect(result.text).toMatch(/Native Token: [A-Z]+/); // Token symbol
        });

        it('should include timestamp information', async () => {
            const result = await networkDataProvider.get(mockRuntime, mockMessage, mockState);

            expect(result.text).toMatch(/updated \d+s ago/);
        });

        it('should handle optional network components', async () => {
            const result = await networkDataProvider.get(mockRuntime, mockMessage, mockState);

            if (result.text.includes('Active Validators:')) {
                expect(result.text).toMatch(/Active Validators: \d+/);
            }
            if (result.text.includes('Connected Parachains:')) {
                expect(result.text).toMatch(/Connected Parachains: \d+/);
            }
        });

        it('should format output consistently', async () => {
            const result = await networkDataProvider.get(mockRuntime, mockMessage, mockState);

            const lines = result.text.split('\n');
            expect(lines.length).toBeGreaterThan(1);

            expect(lines[0]).toMatch(/Network Status.*:/);

            for (let i = 1; i < lines.length; i++) {
                if (lines[i].trim()) {
                    expect(lines[i]).toMatch(/^- /);
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

            const result = await networkDataProvider.get(badRuntime, mockMessage, mockState);

            // Should return an error message rather than throwing
            expect(typeof result.text).toBe('string');
            expect(result.text).toContain('Unable to retrieve current network status');
        });
    });
});
