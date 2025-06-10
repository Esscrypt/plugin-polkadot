import type { IAgentRuntime } from '@elizaos/core';
import { z } from 'zod';

export const CONFIG_KEYS = {
    POLKADOT_PRIVATE_KEY: 'POLKADOT_PRIVATE_KEY',
    POLKADOT_RPC_URL: 'POLKADOT_RPC_URL',
    POLKADOT_RPC_API_KEY: 'POLKADOT_RPC_API_KEY',
    POLKADOT_MANIFEST_URL: 'POLKADOT_MANIFEST_URL',
    POLKADOT_BRIDGE_URL: 'POLKADOT_BRIDGE_URL',
    USE_CACHE_MANAGER: 'USE_CACHE_MANAGER',
} as const;

export const envSchema = z.object({
    POLKADOT_PRIVATE_KEY: z.string().min(1, 'private key is required'),
    POLKADOT_RPC_URL: z.string(),
    POLKADOT_RPC_API_KEY: z.string(),
    POLKADOT_MANIFEST_URL: z.string(),
    POLKADOT_BRIDGE_URL: z.string(),
});

export type EnvConfig = z.infer<typeof envSchema>;

export async function validateEnvConfig(runtime: IAgentRuntime): Promise<EnvConfig> {
    try {
        const config = {
            POLKADOT_PRIVATE_KEY:
                runtime.getSetting(CONFIG_KEYS.POLKADOT_PRIVATE_KEY) ||
                process.env.POLKADOT_PRIVATE_KEY,
            POLKADOT_RPC_URL:
                runtime.getSetting(CONFIG_KEYS.POLKADOT_RPC_URL) || process.env.POLKADOT_RPC_URL,
            POLKADOT_RPC_API_KEY:
                runtime.getSetting(CONFIG_KEYS.POLKADOT_RPC_API_KEY) ||
                process.env.POLKADOT_RPC_API_KEY,
            POLKADOT_MANIFEST_URL:
                runtime.getSetting(CONFIG_KEYS.POLKADOT_MANIFEST_URL) ||
                process.env.POLKADOT_MANIFEST_URL,
            POLKADOT_BRIDGE_URL:
                runtime.getSetting(CONFIG_KEYS.POLKADOT_BRIDGE_URL) ||
                process.env.POLKADOT_BRIDGE_URL,
        };

        return envSchema.parse(config);
    } catch (error) {
        if (error instanceof z.ZodError) {
            const errorMessages = error.errors
                .map((err) => `${err.path.join('.')}: ${err.message}`)
                .join('\n');
            throw new Error(`Ton configuration validation failed:\n${errorMessages}`);
        }
        throw error;
    }
}
