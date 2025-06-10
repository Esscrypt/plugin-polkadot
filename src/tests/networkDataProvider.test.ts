import type { IAgentRuntime, Memory, State } from '@elizaos/core';
import { describe, it, vi, beforeEach, expect, afterEach } from 'vitest';
import networkDataProvider from '../providers/networkData';
import { PolkadotApiService } from '../services/api-service';
import { CacheManager, MemoryCacheAdapter } from '@elizaos/core';

const POLKADOT_RPC_URL = 'wss://rpc.polkadot.io';

describe('Network Data Provider', () => {
    let mockRuntime: IAgentRuntime;
    let apiService: PolkadotApiService;
    let mockMessage: Memory;
    let mockState: State;

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

            expect(typeof result).toBe('string');
            expect(result.length).toBeGreaterThan(0);

            expect(result).toMatch(/Network Status.*:/);
            expect(result).toContain('Network:');
            expect(result).toContain('Connected:');
            expect(result).toContain('Synced:');
            expect(result).toContain('Latest Block:');
            expect(result).toContain('Native Token:');
        });

        it('should include real network details', async () => {
            const result = await networkDataProvider.get(mockRuntime, mockMessage, mockState);

            // Should contain realistic network values
            expect(result).toMatch(/Network: \w+/); // Network name
            expect(result).toMatch(/Connected: (Yes|No) \(\d+ peers\)/); // Peer count
            expect(result).toMatch(/Synced: (Yes|No)/); // Sync status
            expect(result).toMatch(/Latest Block: #\d+/); // Block number
            expect(result).toMatch(/Native Token: [A-Z]+/); // Token symbol
        });

        it('should include timestamp information', async () => {
            const result = await networkDataProvider.get(mockRuntime, mockMessage, mockState);

            expect(result).toMatch(/updated \d+s ago/);
        });

        it('should handle optional network components', async () => {
            const result = await networkDataProvider.get(mockRuntime, mockMessage, mockState);

            if (result.includes('Active Validators:')) {
                expect(result).toMatch(/Active Validators: \d+/);
            }
            if (result.includes('Connected Parachains:')) {
                expect(result).toMatch(/Connected Parachains: \d+/);
            }
        });

        it('should format output consistently', async () => {
            const result = await networkDataProvider.get(mockRuntime, mockMessage, mockState);

            const lines = result.split('\n');
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
            expect(typeof result).toBe('string');
            expect(result).toContain('Unable to retrieve current network status');
        });
    });
});
