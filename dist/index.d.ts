import { IAgentRuntime, Memory, State, HandlerCallback, ICacheManager, Plugin } from '@elizaos/core';
import BigNumber from 'bignumber.js';
import { Keyring } from '@polkadot/keyring';
import { KeyringOptions } from '@polkadot/keyring/types';

declare const _default$9: {
    name: string;
    similes: string[];
    description: string;
    handler: (runtime: IAgentRuntime, message: Memory, state: State, _options: Record<string, unknown>, callback?: HandlerCallback) => Promise<boolean>;
    validate: (_runtime: IAgentRuntime) => Promise<boolean>;
    examples: ({
        user: string;
        content: {
            text: string;
            action: string;
        };
    } | {
        user: string;
        content: {
            text: string;
            action?: undefined;
        };
    })[][];
};

declare const _default$8: {
    name: string;
    similes: string[];
    description: string;
    handler: (runtime: IAgentRuntime, message: Memory, state: State, _options: Record<string, unknown>, callback?: HandlerCallback) => Promise<boolean>;
    validate: (_runtime: IAgentRuntime) => Promise<boolean>;
    examples: ({
        user: string;
        content: {
            text: string;
            action: string;
        };
    } | {
        user: string;
        content: {
            text: string;
            action?: undefined;
        };
    })[][];
};

interface WalletData {
    source: WalletProviderSource;
    address: string;
    createdAt: number;
    decryptedKeyring?: {
        type: KeyringOptions['type'];
        mnemonic: string;
        options: KeyringOptions;
    };
}
declare enum WalletSourceType {
    FROM_MNEMONIC = "fromMnemonic",
    FROM_ENCRYPTED_JSON = "fromEncryptedJson"
}
interface WalletSourceFromMnemonic {
    type: WalletSourceType.FROM_MNEMONIC;
    mnemonic: string;
    keyringOptions?: KeyringOptions;
    password?: string;
    hardDerivation?: string;
    softDerivation?: string;
}
interface WalletSourceFromEncryptedJson {
    type: WalletSourceType.FROM_ENCRYPTED_JSON;
    encryptedJson: string;
    password: string;
}
type WalletProviderSource = WalletSourceFromMnemonic | WalletSourceFromEncryptedJson;
interface WalletProviderConstructionParams {
    cacheManager: ICacheManager;
    source: WalletProviderSource;
}
declare class WalletProvider {
    keyring: Keyring;
    cacheManager: ICacheManager;
    coinMarketCapApiKey: string;
    walletNumber: number | null;
    source: WalletProviderSource;
    constructor(params: WalletProviderConstructionParams);
    static storeWalletInCache(address: string, wallet: WalletProvider, walletNumber?: number): Promise<void>;
    private static getWalletNumberFromCache;
    private static getNextWalletNumberFromFilesystem;
    static clearWalletFromCache(wallet: WalletProvider, address: string): Promise<void>;
    static clearAllWalletsFromCache(wallet: WalletProvider): Promise<void>;
    static loadWalletByAddress(wallet: WalletProvider, address: string, password?: string): Promise<WalletProvider>;
    static loadWalletByNumber(wallet: WalletProvider, number: number, password?: string): Promise<WalletProvider>;
    private _initializeFromMnemonic;
    private _initializeFromEncryptedJson;
    fetchPrices(): Promise<{
        nativeToken: {
            usd: BigNumber;
        };
    }>;
    getAddress(): string;
    getWalletNumber(): Promise<number | null>;
    static getWalletData(wallet: WalletProvider, number: number): Promise<WalletData | null>;
    static getWalletByAddress(wallet: WalletProvider, address: string): Promise<WalletData | null>;
    static generateNew(wallet: WalletProvider, password: string, options?: {
        password?: string;
        hardDerivation?: string;
        softDerivation?: string;
        keyringOptions?: KeyringOptions;
    }): Promise<{
        walletProvider: WalletProvider;
        mnemonic: string;
        encryptedBackup: string;
        walletNumber: number;
    }>;
    static importWalletFromFile(runtime: IAgentRuntime, walletAddressForBackupName: string, password: string): Promise<WalletProvider>;
    static ejectWalletFromFile(wallet: WalletProvider, walletAddressForBackupName: string, password: string): Promise<{
        mnemonic: string;
        options: KeyringOptions;
    }>;
    static importWallet(encryptedMnemonicAndOptions: string, password: string, runtime: IAgentRuntime): Promise<WalletProvider>;
}

declare const _default$7: {
    name: string;
    similes: string[];
    description: string;
    handler: (runtime: IAgentRuntime, message: Memory, state: State, _options: Record<string, unknown>, callback?: HandlerCallback) => Promise<boolean>;
    validate: (_runtime: IAgentRuntime) => Promise<boolean>;
    examples: ({
        user: string;
        content: {
            text: string;
            action: string;
        };
    } | {
        user: string;
        content: {
            text: string;
            action?: undefined;
        };
    })[][];
};

declare const _default$6: {
    name: string;
    similes: string[];
    description: string;
    handler: (runtime: IAgentRuntime, message: Memory, state: State, _options: Record<string, unknown>, callback?: HandlerCallback) => Promise<boolean>;
    validate: (_runtime: IAgentRuntime) => Promise<boolean>;
    examples: ({
        user: string;
        content: {
            text: string;
            action: string;
        };
    } | {
        user: string;
        content: {
            text: string;
            action?: undefined;
        };
    })[][];
};

declare const _default$5: {
    name: string;
    similes: string[];
    description: string;
    handler: (runtime: IAgentRuntime, message: Memory, state: State, _options: Record<string, unknown>, callback?: HandlerCallback) => Promise<boolean>;
    validate: (_runtime: IAgentRuntime) => Promise<boolean>;
    examples: ({
        user: string;
        content: {
            text: string;
            action: string;
        };
    } | {
        user: string;
        content: {
            text: string;
            action?: undefined;
        };
    })[][];
};

declare const _default$4: {
    name: string;
    similes: string[];
    description: string;
    handler: (runtime: IAgentRuntime, message: Memory, state: State, _options: Record<string, unknown>, callback?: HandlerCallback) => Promise<boolean>;
    validate: (_runtime: IAgentRuntime) => Promise<boolean>;
    examples: ({
        user: string;
        content: {
            text: string;
            action: string;
        };
    } | {
        user: string;
        content: {
            text: string;
            action?: undefined;
        };
    })[][];
};

declare const _default$3: {
    name: string;
    similes: string[];
    description: string;
    handler: (runtime: IAgentRuntime, message: Memory, state: State, _options: Record<string, unknown>, callback?: HandlerCallback) => Promise<boolean>;
    validate: (_runtime: IAgentRuntime) => Promise<boolean>;
    examples: ({
        user: string;
        content: {
            text: string;
            action: string;
        };
    } | {
        user: string;
        content: {
            text: string;
            action?: undefined;
        };
    })[][];
};

declare const _default$2: {
    name: string;
    similes: string[];
    description: string;
    handler: (runtime: IAgentRuntime, message: Memory, state: State, _options: Record<string, unknown>, callback?: HandlerCallback) => Promise<boolean>;
    validate: (_runtime: IAgentRuntime) => Promise<boolean>;
    examples: ({
        user: string;
        content: {
            text: string;
            action: string;
        };
    } | {
        user: string;
        content: {
            text: string;
            action?: undefined;
        };
    })[][];
};

declare const _default$1: {
    name: string;
    similes: string[];
    description: string;
    handler: (runtime: IAgentRuntime, message: Memory, state: State, _options: Record<string, unknown>, callback?: HandlerCallback) => Promise<boolean>;
    validate: (_runtime: IAgentRuntime) => Promise<boolean>;
    examples: ({
        user: string;
        content: {
            text: string;
            action: string;
        };
    } | {
        user: string;
        content: {
            text: string;
            action?: undefined;
        };
    })[][];
};

declare const _default: {
    name: string;
    similes: string[];
    description: string;
    handler: (runtime: IAgentRuntime, message: Memory, state: State, _options: Record<string, unknown>, callback?: HandlerCallback) => Promise<boolean>;
    validate: (_runtime: IAgentRuntime) => Promise<boolean>;
    examples: ({
        user: string;
        content: {
            text: string;
            action: string;
        };
    } | {
        user: string;
        content: {
            text: string;
            action?: undefined;
        };
    })[][];
};

declare const polkadotPlugin: Plugin;

export { _default$9 as CreatePolkadotWallet, _default$8 as EjectPolkadotWallet, _default$4 as GetBalance, _default$2 as GetBlockEvents, _default$3 as GetBlockInfo, _default$1 as GetReferenda, _default as GetReferendumDetails, _default$6 as LoadPolkadotWallet, _default$7 as SignPolkadotMessage, _default$5 as ValidateSignature, WalletProvider, polkadotPlugin as default, polkadotPlugin };
