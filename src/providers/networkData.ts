import type { IAgentRuntime, Memory, Provider, State } from '@elizaos/core';
import { elizaLogger } from '@elizaos/core';
import { PolkadotApiService } from '../services/api-service';

interface ChainInfo {
    name: string;
    nodeName: string;
    nodeVersion: string;
    properties: {
        tokenSymbol: string;
        tokenDecimals: number;
    };
    health: {
        peers: number;
        isSyncing: boolean;
        shouldHavePeers: boolean;
    };
    blocks: {
        best: string;
        finalized: string;
    };
    timestamp: number;
}

// Define types for API responses to avoid using any
interface PolkadotChainProperties {
    tokenSymbol: {
        unwrap: () => Array<{ toString: () => string }>;
    };
    tokenDecimals: {
        unwrap: () => Array<{ toNumber: () => number }>;
    };
}

interface PolkadotHealth {
    peers: { toNumber: () => number };
    isSyncing: { valueOf: () => boolean };
    shouldHavePeers: { valueOf: () => boolean };
}

interface PolkadotCodec {
    toString: () => string;
    toJSON: () => unknown[];
    toNumber?: () => number;
}

class ChainDataService {
    private apiService: PolkadotApiService;

    public async initialize(runtime: IAgentRuntime): Promise<void> {
        this.apiService = await PolkadotApiService.start(runtime);
    }

    public async getChainInfo(): Promise<ChainInfo> {
        const api = await this.apiService.getConnection();

        const [chain, nodeName, nodeVersion, properties, health, bestNumber, finalizedNumber] =
            await Promise.all([
                api.rpc.system.chain(),
                api.rpc.system.name(),
                api.rpc.system.version(),
                api.rpc.system.properties(),
                api.rpc.system.health(),
                api.derive.chain.bestNumber(),
                api.derive.chain.bestNumberFinalized(),
            ]);

        // Type the properties response properly
        const typedProperties = properties as unknown as PolkadotChainProperties;
        const typedHealth = health as unknown as PolkadotHealth;

        const chainInfo: ChainInfo = {
            name: chain.toString(),
            nodeName: nodeName.toString(),
            nodeVersion: nodeVersion.toString(),
            properties: {
                tokenSymbol: typedProperties.tokenSymbol.unwrap()[0].toString(),
                tokenDecimals: typedProperties.tokenDecimals.unwrap()[0].toNumber(),
            },
            health: {
                peers: typedHealth.peers.toNumber(),
                isSyncing: typedHealth.isSyncing.valueOf(),
                shouldHavePeers: typedHealth.shouldHavePeers.valueOf(),
            },
            blocks: {
                best: bestNumber.toString(),
                finalized: finalizedNumber.toString(),
            },
            timestamp: Date.now(),
        };

        return chainInfo;
    }

    public async getValidatorCount(): Promise<number> {
        const api = await this.apiService.getConnection();
        let count = 0;

        try {
            // Convert validators to array first
            const validators = await api.query.session.validators();
            const validatorsCodec = validators as unknown as PolkadotCodec;
            const validatorsArray = validatorsCodec.toJSON() as unknown[];
            count = Array.isArray(validatorsArray) ? validatorsArray.length : 0;
        } catch (_error) {
            try {
                // Convert validator count to number
                const validatorCount = await api.query.staking.validatorCount();
                // Use toString and parseInt to avoid toNumber type errors
                count = parseInt(validatorCount.toString());
            } catch (innerError) {
                const message =
                    innerError instanceof Error ? innerError.message : String(innerError);
                elizaLogger.error(`Error fetching validator count: ${message}`);
            }
        }

        return count;
    }

    public async getParachainCount(): Promise<number> {
        const api = await this.apiService.getConnection();
        let count = 0;

        try {
            if (api.query.paras?.parachains) {
                const parachains = await api.query.paras.parachains();
                // Convert to array first with proper typing
                const parachainsCodec = parachains as unknown as PolkadotCodec;
                const parachainsArray = parachainsCodec.toJSON() as unknown[];
                count = Array.isArray(parachainsArray) ? parachainsArray.length : 0;
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            elizaLogger.error(`Error fetching parachain count: ${message}`);
        }

        return count;
    }

    public formatChainInfo(chainInfo: ChainInfo): string {
        const timeSinceUpdate = Math.floor((Date.now() - chainInfo.timestamp) / 1000);

        return `Polkadot Network Status (updated ${timeSinceUpdate}s ago):
- Network: ${chainInfo.name}
- Connected: ${chainInfo.health.peers > 0 ? 'Yes' : 'No'} (${chainInfo.health.peers} peers)
- Synced: ${!chainInfo.health.isSyncing ? 'Yes' : 'No'}
- Latest Block: #${chainInfo.blocks.best} (finalized: #${chainInfo.blocks.finalized})
- Native Token: ${chainInfo.properties.tokenSymbol}`;
    }
}

export const networkDataProvider: Provider = {
    async get(_runtime: IAgentRuntime, _message: Memory, _state?: State): Promise<string | null> {
        try {
            const chainDataService = new ChainDataService();
            await chainDataService.initialize(_runtime);

            const chainInfo = await chainDataService.getChainInfo();

            const [validatorCount, parachainCount] = await Promise.all([
                chainDataService.getValidatorCount(),
                chainDataService.getParachainCount(),
            ]);

            let output = chainDataService.formatChainInfo(chainInfo);

            if (validatorCount > 0) {
                output += `\n- Active Validators: ${validatorCount}`;
            }

            if (parachainCount > 0) {
                output += `\n- Connected Parachains: ${parachainCount}`;
            }

            elizaLogger.info('Network Data Provider output generated', output);
            return output;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            elizaLogger.error(`Error in Network Data Provider: ${message}`);

            return 'Network Data Provider: Unable to retrieve current network status.';
        }
    },
};

export default networkDataProvider;
