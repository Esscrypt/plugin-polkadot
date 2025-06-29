import { elizaLogger } from '@elizaos/core';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { Service, IAgentRuntime } from '@elizaos/core';

const DEFAULT_NETWORK_CONFIG = {
    DEFAULT_ENDPOINT: 'wss://rpc.polkadot.io',
    BACKUP_ENDPOINTS: [
        'wss://polkadot-rpc.dwellir.com',
        'wss://polkadot.api.onfinality.io/public-ws',
        'wss://rpc.ibp.network/polkadot',
        'wss://polkadot-rpc.publicnode.com',
    ],
    MAX_RETRIES: 3,
    RETRY_DELAY: 2000,
};

/**
 * Singleton service that manages connection to the Polkadot API
 * Includes connection pooling, retry logic, and endpoint fallback
 */
export class PolkadotApiService extends Service {
    static serviceType = 'polkadot_api' as const;
    capabilityDescription = 'The agent is able to interact with the Polkadot API';

    private static _instance: PolkadotApiService | null = null;
    private api: ApiPromise | null = null;
    private provider: WsProvider | null = null;
    private connecting = false;
    private connectionPromise: Promise<ApiPromise> | null = null;
    private lastEndpointIndex = 0;
    private networkConfig = { ...DEFAULT_NETWORK_CONFIG };

    constructor(protected runtime: IAgentRuntime) {
        super();
    }

    static async start(runtime: IAgentRuntime): Promise<PolkadotApiService> {
        if (!PolkadotApiService._instance) {
            PolkadotApiService._instance = new PolkadotApiService(runtime);
            await PolkadotApiService._instance.initialize();
            await PolkadotApiService._instance.connectWithRetry();
        }
        return PolkadotApiService._instance;
    }

    async stop(): Promise<void> {
        await this.disconnect();
        PolkadotApiService._instance = null;
    }

    async initialize(): Promise<void> {
        const customEndpoint = this.runtime.getSetting('POLKADOT_RPC_URL');

        if (customEndpoint) {
            this.networkConfig.DEFAULT_ENDPOINT = customEndpoint;
            elizaLogger.debug(`Using custom Polkadot endpoint: ${customEndpoint}`);
        } else {
            elizaLogger.debug(
                `No custom endpoint found, using default: ${this.networkConfig.DEFAULT_ENDPOINT}`,
            );
        }
    }

    /**
     * Get a connection to the Polkadot API
     * If a connection is already established, it will be reused
     * If no connection exists, a new one will be created
     * If a connection is being established, the existing promise will be returned
     */
    public async getConnection(): Promise<ApiPromise> {
        if (this.api?.isConnected) {
            return this.api;
        }

        if (this.connecting && this.connectionPromise) {
            return this.connectionPromise;
        }

        this.connecting = true;
        this.connectionPromise = this.connectWithRetry();

        try {
            this.api = await this.connectionPromise;
            return this.api;
        } finally {
            this.connecting = false;
            this.connectionPromise = null;
        }
    }

    /**
     * Connect to the Polkadot API with retry logic
     * @param retryCount Current retry attempt number
     */
    private async connectWithRetry(retryCount = 0): Promise<ApiPromise> {
        try {
            const endpoint = this.getNextEndpoint();
            elizaLogger.debug(`Connecting to Polkadot at ${endpoint}`);

            this.provider = new WsProvider(endpoint);
            this.api = await ApiPromise.create({ provider: this.provider });

            elizaLogger.debug(`Connected to Polkadot at ${endpoint}`);
            return this.api;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            elizaLogger.error(`Polkadot connection error: ${message}`);

            if (retryCount < this.networkConfig.MAX_RETRIES) {
                const delay = this.networkConfig.RETRY_DELAY * 2 ** retryCount;
                elizaLogger.debug(`Retrying connection in ${delay}ms...`);

                await new Promise((resolve) => setTimeout(resolve, delay));
                return this.connectWithRetry(retryCount + 1);
            }

            throw new Error(
                `Failed to connect to Polkadot after ${this.networkConfig.MAX_RETRIES} attempts`,
            );
        }
    }

    /**
     * Get the next endpoint to try from the configured endpoints
     * This implements a round-robin selection strategy
     */
    private getNextEndpoint(): string {
        const allEndpoints = [
            this.networkConfig.DEFAULT_ENDPOINT,
            ...this.networkConfig.BACKUP_ENDPOINTS,
        ];
        this.lastEndpointIndex = this.lastEndpointIndex % allEndpoints.length;
        elizaLogger.debug(`Next endpoint: ${allEndpoints[this.lastEndpointIndex]}`);
        return allEndpoints[this.lastEndpointIndex];
    }

    /**
     * Disconnect from the Polkadot API
     * This should be called when the application is shutting down
     */
    public async disconnect(): Promise<void> {
        if (this.api) {
            await this.api.disconnect();
            this.api = null;
        }

        if (this.provider) {
            this.provider.disconnect();
            this.provider = null;
        }
    }

    /**
     * Check if a connection is currently established
     */
    public isConnected(): boolean {
        return !!this.api && this.api.isConnected;
    }

    /**
     * Get information about the current connection
     * Returns null if no connection is established
     */
    public getConnectionInfo(): { endpoint: string; connected: boolean } | null {
        if (!this.provider) {
            return null;
        }

        return {
            endpoint: this.provider.endpoint,
            connected: this.isConnected(),
        };
    }

    /**
     * Set custom endpoints for the API connection
     * This allows endpoints to be configured at runtime
     * @param endpoints Array of WebSocket endpoints
     */
    public setCustomEndpoints(endpoints: string[]): void {
        if (!endpoints || endpoints.length === 0) {
            return;
        }

        // Only update if there's at least one valid endpoint
        if (endpoints.some((e) => e.startsWith('wss://') || e.startsWith('ws://'))) {
            // Replace the existing configuration
            Object.defineProperty(this.networkConfig, 'DEFAULT_ENDPOINT', {
                value: endpoints[0],
                writable: true,
            });

            Object.defineProperty(this.networkConfig, 'BACKUP_ENDPOINTS', {
                value: endpoints.slice(1),
                writable: true,
            });

            // Reset the endpoint index
            this.lastEndpointIndex = 0;
            elizaLogger.debug(`Updated Polkadot API endpoints: ${endpoints.join(', ')}`);
        }
    }
}

export default PolkadotApiService;
