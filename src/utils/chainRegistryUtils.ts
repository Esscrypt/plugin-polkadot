import { z } from 'zod';

export const CHAIN_RPC_MAPPING: Record<string, string> = {
    polkadot: 'wss://rpc.polkadot.io',
    paseo: 'wss://rpc.paseo.io',
    kusama: 'wss://kusama-rpc.polkadot.io',
    westend: 'wss://westend-rpc.polkadot.io',
    moonbeam: 'wss://wss.api.moonbeam.network',
    moonriver: 'wss://moonriver.public.blastapi.io',
    astar: 'wss://astar-rpc.dwellir.com',
    shiden: 'wss://shiden-rpc.dwellir.com',
    acala: 'wss://acala-rpc.dwellir.com',
    karura: 'wss://karura-rpc.dwellir.com',
    bifrost: 'wss://bifrost-rpc.dwellir.com',
    parallel: 'wss://parallel-rpc.dwellir.com',
    heiko: 'wss://heiko-rpc.dwellir.com',
    kilt: 'wss://spiritnet.kilt.io',
    phala: 'wss://phala-rpc.dwellir.com',
    khala: 'wss://khala-rpc.dwellir.com',
    crust: 'wss://crust-rpc.dwellir.com',
    unique: 'wss://unique-rpc.dwellir.com',
    quartz: 'wss://quartz-rpc.dwellir.com',
    litmus: 'wss://litmus-rpc.dwellir.com',
    robonomics: 'wss://robonomics-rpc.dwellir.com',
    subsocial: 'wss://subsocial-rpc.dwellir.com',
    zeitgeist: 'wss://zeitgeist-rpc.dwellir.com',
    basilisk: 'wss://basilisk-rpc.dwellir.com',
    hydradx: 'wss://hydradx-rpc.dwellir.com',
    altair: 'wss://altair-rpc.dwellir.com',
    kintsugi: 'wss://kintsugi-rpc.dwellir.com',
    interlay: 'wss://interlay-rpc.dwellir.com',
    centrifuge: 'wss://centrifuge-rpc.dwellir.com',
    calamari: 'wss://calamari-rpc.dwellir.com',
    manta: 'wss://manta-rpc.dwellir.com',
    turing: 'wss://turing-rpc.dwellir.com',
    integritee: 'wss://integritee-rpc.dwellir.com',
    nodle: 'wss://nodle-rpc.dwellir.com',
    efinity: 'wss://efinity-rpc.dwellir.com',
    darwinia: 'wss://darwinia-rpc.dwellir.com',
    crab: 'wss://crab-rpc.dwellir.com',
    pioneer: 'wss://pioneer-rpc.dwellir.com',
    bitcountry: 'wss://bitcountry-rpc.dwellir.com',
    subdao: 'wss://subdao-rpc.dwellir.com',
    subgame: 'wss://subgame-rpc.dwellir.com',
    subspace: 'wss://subspace-rpc.dwellir.com',
    ternoa: 'wss://ternoa-rpc.dwellir.com',
    zero: 'wss://zero-rpc.dwellir.com',
    encointer: 'wss://encointer-rpc.dwellir.com',
    kylin: 'wss://kylin-rpc.dwellir.com',
    polymesh: 'wss://polymesh-rpc.dwellir.com',
    equilibrium: 'wss://equilibrium-rpc.dwellir.com',
    chainx: 'wss://chainx-rpc.dwellir.com',
    edgeware: 'wss://edgeware-rpc.dwellir.com',
    kulupu: 'wss://kulupu-rpc.dwellir.com',
    joystream: 'wss://joystream-rpc.dwellir.com',
    dock: 'wss://dock-rpc.dwellir.com',
    stafi: 'wss://stafi-rpc.dwellir.com',
    sora: 'wss://sora-rpc.dwellir.com',
    substrate: 'wss://substrate-rpc.dwellir.com',
};

export const CHAIN_ID_MAPPING: Record<string, string> = {
    polkadot: '0',
    paseo: '0',
    kusama: '2',
    westend: '0',
    substrate: '0',
    acala: '2000',
    ajuna: '2051',
    astar: '2006',
    bitfrost: '2030',
    hydradx: '2034',
    moonbeam: '2004',
    phala: '2035',
    assetHubPolkadot: '1000',
    polkadotBridgeHub: '1002',
    polkadotCollectives: '1001',
    bajun: '2119',
    basilisk: '2090',
    bitfrostKusama: '2001',
    karura: '2000',
    khala: '2004',
    assetHubKusama: '1000',
    kusamaBridgeHub: '1002',
    moonriver: '2023',
    shiden: '2007',
    tinkernet: '2125',
    moonbase: '1000',
    rococoContracts: '1002',
    rococoAssetHub: '1000',
    rococoBridgeHub: '1013',
    rococoCoretime: '1013',
    tangleRococo: '4006',
    watr: '2058',
    tokyoShibuya: '1000',
    westendAssetHub: '1000',
    westendBridgeHub: '1002',
    westendCollectives: '1001',
    wococoBridgeHub: '1014',
    wococoWockmint: '1000',
};

// Zod Schemas for Registry Validation
export const AssetDetailsSchema = z.object({
    asset: z.string(),
    symbol: z.string(),
    decimals: z.number(),
});
export type AssetDetails = z.infer<typeof AssetDetailsSchema>;

export const SpecRegistrySchema = z.record(z.string(), AssetDetailsSchema);
export type SpecRegistry = z.infer<typeof SpecRegistrySchema>;

export const RegistryAssetInfoEntrySchema = z.object({
    tokens: z.array(z.string()),
    assetsInfo: z.record(z.string(), z.string()),
    foreignAssetsInfo: z.record(z.string(), z.union([z.string(), z.record(z.unknown())])),
    poolPairsInfo: z.record(z.string(), z.union([z.string(), z.record(z.unknown())])),
    specName: z.string(),
    nativeChainID: z.string().optional(),
    registry: z.record(z.string(), SpecRegistrySchema).optional(),
});
export type RegistryAssetInfoEntry = z.infer<typeof RegistryAssetInfoEntrySchema>;

export const RegistryChainEntriesSchema = z.record(z.string(), RegistryAssetInfoEntrySchema);
export type RegistryChainEntries = z.infer<typeof RegistryChainEntriesSchema>;

export const FullRegistryDataSchema = z.record(z.string(), RegistryChainEntriesSchema);
export type FullRegistryData = z.infer<typeof FullRegistryDataSchema>;

export interface ChainMetadata {
    decimals: number;
    tokenSymbol: string;
    chainId: string; // This is the genesis hash
    rpcUrl: string;
}
