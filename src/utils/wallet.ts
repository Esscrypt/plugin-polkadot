import type { IAgentRuntime } from '@elizaos/core';
import { logger } from '@elizaos/core';
import BigNumber from 'bignumber.js';
import { PROVIDER_CONFIG } from '../providers/wallet';

export class MemoryCacheAdapter {
    data: Map<string, string>;

    constructor(initalData?: Map<string, string>) {
        this.data = initalData ?? new Map<string, string>();
    }

    async get(key: string): Promise<string | undefined> {
        return this.data.get(key);
    }

    async set(key: string, value: string): Promise<void> {
        this.data.set(key, value);
    }

    async delete(key: string): Promise<void> {
        this.data.delete(key);
    }
}

export interface WalletPortfolio {
    totalUsd: string;
    totalNativeToken: string;
}

export async function fetchPrices(
    runtime: IAgentRuntime,
    coinMarketCapApiKey: string,
): Promise<{ nativeToken: { usd: BigNumber } }> {
    try {
        const cacheKey = 'prices';
        const cachedValue = await runtime.getCache<{ nativeToken: { usd: BigNumber } }>(cacheKey);

        if (cachedValue) {
            logger.log('Cache hit for fetchPrices');
            return cachedValue;
        }
        logger.log('Cache miss for fetchPrices');

        let lastError: Error | undefined;
        for (let i = 0; i < PROVIDER_CONFIG.MAX_RETRIES; i++) {
            try {
                const response = await fetch(
                    `${PROVIDER_CONFIG.COINMARKETCAP_API_URL}?symbol=${PROVIDER_CONFIG.NATIVE_TOKEN_SYMBOL}&convert=USD`,
                    {
                        headers: {
                            'X-CMC_PRO_API_KEY': coinMarketCapApiKey,
                            Accept: 'application/json',
                        },
                    },
                );

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(
                        `HTTP error! status: ${response.status}, message: ${errorText}`,
                    );
                }

                const data = await response.json();
                const price = data?.data?.[PROVIDER_CONFIG.NATIVE_TOKEN_SYMBOL]?.quote?.USD;
                if (price) {
                    const prices = {
                        nativeToken: { usd: new BigNumber(price.price) },
                    };
                    runtime.setCache(cacheKey, prices);
                    return prices;
                }
                throw new Error('Price data not found in CoinMarketCap response structure.');
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.error(`Attempt ${i + 1} failed:`, message);
                lastError = error instanceof Error ? error : new Error(message);
                if (i < PROVIDER_CONFIG.MAX_RETRIES - 1) {
                    const delay = PROVIDER_CONFIG.RETRY_DELAY * 2 ** i;
                    await new Promise((resolve) => setTimeout(resolve, delay));
                }
            }
        }

        logger.error('All attempts failed. Throwing the last error:', lastError);
        throw (
            lastError ?? new Error('All attempts to fetch prices failed without a specific error.')
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Error fetching prices:', message);
        throw new Error(`Failed to fetch prices: ${message}`);
    }
}

export function formatPortfolio(
    runtime: IAgentRuntime,
    portfolio: WalletPortfolio,
    walletAddress: string,
): string {
    let output = `${runtime.character.name}\n`;
    output += `Wallet Address: ${walletAddress}\n`;

    const totalUsdFormatted = new BigNumber(portfolio.totalUsd).toFixed(2);
    const totalNativeTokenFormatted = new BigNumber(portfolio.totalNativeToken).toFixed(4);

    output += `Total Value: $${totalUsdFormatted} (${totalNativeTokenFormatted} ${PROVIDER_CONFIG.NATIVE_TOKEN_SYMBOL.toUpperCase()})\n`;

    return output;
}

export async function fetchPortfolioValue(
    runtime: IAgentRuntime,
    coinMarketCapApiKey: string,
    walletAddress: string,
): Promise<WalletPortfolio> {
    try {
        const cacheKey = `portfolio-${walletAddress}`;
        const cachedValue = await runtime.getCache<WalletPortfolio>(cacheKey);

        if (cachedValue) {
            logger.log('Cache hit for fetchPortfolioValue', cachedValue);
            return cachedValue;
        }
        logger.log('Cache miss for fetchPortfolioValue');

        const prices = await fetchPrices(runtime, coinMarketCapApiKey);
        const nativeTokenBalance = BigInt(0);
        const amount = Number(nativeTokenBalance) / Number(PROVIDER_CONFIG.NATIVE_TOKEN_DECIMALS);
        const totalUsd = new BigNumber(amount.toString()).times(prices.nativeToken.usd);

        const portfolio = {
            totalUsd: totalUsd.toString(),
            totalNativeToken: amount.toFixed(4).toString(),
        };

        runtime.setCache(cacheKey, portfolio);
        return portfolio;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Error fetching portfolio:', message);
        throw new Error(`Failed to fetch portfolio value: ${message}`);
    }
}

export async function getFormattedPortfolio(
    runtime: IAgentRuntime,
    coinMarketCapApiKey: string,
    walletAddress: string,
): Promise<string> {
    try {
        const portfolio = await fetchPortfolioValue(runtime, coinMarketCapApiKey, walletAddress);
        return formatPortfolio(runtime, portfolio, walletAddress);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Error generating portfolio report:', message);
        return 'Unable to fetch wallet information. Please try again later.';
    }
}
