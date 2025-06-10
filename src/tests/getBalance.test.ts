import type { IAgentRuntime } from '@elizaos/core';
import { describe, it, vi, beforeEach, expect } from 'vitest';
import { GetBalanceAction } from '../actions/getBalance';
import { PolkadotApiService } from '../services/api-service';
import { CacheManager, MemoryCacheAdapter } from '@elizaos/core';

const POLKADOT_RPC_URL = 'wss://rpc.polkadot.io';
const NATIVE_TOKEN_SYMBOL = 'DOT';

const ADDRESS_WITH_BALANCE = '13UVJyLnbVp9RBZYFwFGyDvVd1y27Tt8tkntv6Q7JVPhFsTB';
// TO DO: Generate new random address for zero balance
const ADDRESS_WITH_ZERO_BALANCE = '15fKVPoSLsoyPxUkH6ri6vdgY7PsPkQarYpzmW7grio3wgcp';

// Mock the core functions
vi.mock('@elizaos/core', async () => {
    const actual = await vi.importActual('@elizaos/core');
    return {
        ...actual,
        generateObject: vi.fn(),
        composeContext: vi.fn(),
    };
});

describe('GetBalanceAction', () => {
    let mockRuntime: IAgentRuntime;
    let getBalanceAction: GetBalanceAction;
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
        getBalanceAction = new GetBalanceAction(mockRuntime);
    });

    describe('API Integration', () => {
        it('should retrieve balance for a valid Polkadot address', async () => {
            const testAddress = ADDRESS_WITH_BALANCE;

            const result = await getBalanceAction.getBalance({
                address: testAddress,
            });

            expect(result.address).toBe(testAddress);
            expect(typeof result.freeBalance).toBe('string');
            expect(typeof result.reservedBalance).toBe('string');
            expect(typeof result.totalBalance).toBe('string');
            expect(typeof result.tokenSymbol).toBe('string');
            expect(typeof result.tokenDecimals).toBe('number');
            expect(typeof result.formattedFreeBalance).toBe('string');
            expect(typeof result.formattedReservedBalance).toBe('string');
            expect(typeof result.formattedTotalBalance).toBe('string');

            // Verify basic calculations work with real data
            const totalCalculated = BigInt(result.freeBalance) + BigInt(result.reservedBalance);
            expect(BigInt(result.totalBalance)).toBe(totalCalculated);

            // Verify formatting includes token symbol
            expect(result.formattedFreeBalance).toContain(result.tokenSymbol);
            expect(result.formattedTotalBalance).toContain(result.tokenSymbol);
        });

        it('should handle addresses with zero balance', async () => {
            // Use a freshly generated address that should have zero balance
            const zeroBalanceAddress = ADDRESS_WITH_ZERO_BALANCE;

            const result = await getBalanceAction.getBalance({
                address: zeroBalanceAddress,
            });

            expect(result.address).toBe(zeroBalanceAddress);
            expect(result.freeBalance).toBe('0');
            expect(result.reservedBalance).toBe('0');
            expect(result.totalBalance).toBe('0');
            expect(result.tokenSymbol).toBe(NATIVE_TOKEN_SYMBOL); // Assuming Polkadot mainnet
            expect(result.tokenDecimals).toBe(10); // Polkadot decimals
        });

        it('should format balances correctly with real token properties', async () => {
            const testAddress = ADDRESS_WITH_BALANCE;

            const result = await getBalanceAction.getBalance({
                address: testAddress,
            });

            expect(result.tokenSymbol).toBeTruthy();
            expect(result.tokenDecimals).toBeGreaterThan(0);

            // If there's any balance, formatted should differ from raw
            if (result.freeBalance !== '0') {
                expect(result.formattedFreeBalance).not.toBe(result.freeBalance);

                const parts = result.formattedFreeBalance.split(' ');
                expect(parts).toHaveLength(2);
                expect(Number(parts[0].replace(/,/g, ''))).not.toBeNaN();
                expect(parts[1]).toBe(result.tokenSymbol);
            }
        });
    });

    describe('Basic Error Handling', () => {
        it('should throw error for invalid address format', async () => {
            const invalidAddress = 'invalid-address';

            await expect(
                getBalanceAction.getBalance({ address: invalidAddress }),
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
                getBalanceAction.getBalance({ address: ADDRESS_WITH_BALANCE }),
            ).rejects.toThrow();
        });
    });
});
