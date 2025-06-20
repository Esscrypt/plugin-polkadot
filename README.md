# @elizaos/plugin-polkadot

A plugin for handling Polkadot blockchain operations, providing wallet management and price fetching capabilities.

## Overview

This plugin provides functionality to:

- Manage Polkadot wallets, including generation, encryption, and import.
- Utilize Polkadot keyring for key management.
- Fetch token prices using CoinMarketCap API.
- Query wallet portfolio information (currently with placeholder balances).
- Interface with Polkadot blockchain via RPC endpoints.
- Cache prices and portfolio data.
- Sign messages and validate signatures using Polkadot keypairs.
- Load existing wallets by wallet number or address.
- Retrieve real-time on-chain data including account balances.
- Query detailed block information by number or hash.
- Get block events with module filtering and limiting options.
- Monitor Polkadot's OpenGov governance referenda.
- Get detailed information about specific governance proposals.
- Access live network status including validator and parachain counts.

### Screenshot

### Quick Start

```bash
# Ensure you have Node.js and pnpm installed
# nvm use 23 && npm install -g pnpm

# Set required environment variables (see Configuration section)
export POLKADOT_RPC_URL="wss://rpc.polkadot.io"
export COINMARKETCAP_API_KEY="your_coinmarketcap_api_key"
# Optional: POLKADOT_PRIVATE_KEY="your_mnemonic_phrase_for_default_wallet_initialization"

# Run the debug script (if available)
# bash ./packages/plugin-polkadot/scripts/debug.sh
```

## Getting Started

### New to ElizaOS

To test this plugin with ElizaOS from scratch, follow these steps:

1. Clone the ElizaOS monorepo: https://github.com/elizaOS/eliza
2. Inside packages, clone the polkadot-plugin repo: https://github.com/Esscrypt/plugin-polkadot
3. Inside the characters folder, link the plugin. example character file: https://gist.github.com/mikirov/74ec0c51255050562b2bdd63ccfc36fb
4. Inside agent folder, add `"@elizaos/plugin-polkadot": "workspace:*"` to the dependencies section in package.json
5. Follow install and build instructions: `pnpm install --no-frozen-lockfile && pnpm build`
6. Start WEB UI: `pnpm start:client`
7. Start Agent: `pnpm start --characters="characters/dobby.character.json"`
8. (Optional) set .env with **POLKADOT_PRIVATE_KEY** and **POLKADOT_RPC_URL**

> Note: When starting the Agent, if **POLKADOT_PRIVATE_KEY** is not set, an error will pop up, but the agent will still run and expect a wallet to get created by the user

9. Go to [http://localhost:5173/](http://localhost:5173/) and interact with the agent.

### Existing ElizaOS Users

```bash
npm install @elizaos/plugin-polkadot
# or
pnpm add @elizaos/plugin-polkadot
```

## Configuration

The plugin requires the following environment variables:

```env
POLKADOT_RPC_URL=your_polkadot_rpc_endpoint  # Optional - defaults to wss://rpc.polkadot.io
COINMARKETCAP_API_KEY=your_cmc_api_key     # Optional - for fetching token prices
POLKADOT_PRIVATE_KEY=your_mnemonic_phrase  # Optional - for default wallet initialization via initWalletProvider
```

## Usage

Import and register the plugin in your Eliza configuration:

```typescript
import { polkadotPlugin } from "@elizaos/plugin-polkadot"; // Assuming polkadotPlugin is the main export

export default {
  plugins: [polkadotPlugin],
  // ... other configuration
};
```

## Features

### WalletProvider

The `WalletProvider` manages Polkadot wallet operations, key management, and portfolio tracking:

```typescript
import { WalletProvider, initWalletProvider, WalletSourceType, type WalletProviderConstructionParams } from "@elizaos/plugin-polkadot/src/providers/wallet";
import type { IAgentRuntime } from "@elizaos/core";

// Initialize the provider (e.g., from environment settings if POLKADOT_PRIVATE_KEY is set)
// const walletProvider = await initWalletProvider(runtime);

// Or create/import a wallet:
// 1. Generate a new wallet and save its encrypted backup
// const { walletProvider, mnemonic, encryptedBackup } = await WalletProvider.generateNew(
//   "wss://rpc.polkadot.io",
//   "your-strong-password",
//   runtime.cacheManager
// );
// console.log("New Mnemonic (SAVE THIS SECURELY!):", mnemonic);

// 2. Import from mnemonic
// const paramsMnemonic: WalletProviderConstructionParams = {
//   rpcUrl: "wss://rpc.polkadot.io",
//   cacheManager: runtime.cacheManager,
//   source: {
//     type: WalletSourceType.FROM_MNEMONIC,
//     mnemonic: "your twelve or twenty-four word mnemonic phrase",
//   }
// };
// const walletFromMnemonic = new WalletProvider(paramsMnemonic);

// Get wallet address
// const address = walletProvider.getAddress();

// Get formatted portfolio (currently uses placeholder balance)
// const portfolio = await walletProvider.getFormattedPortfolio(runtime);
// console.log(portfolio);

// Fetch prices
// const prices = await walletProvider.fetchPrices();
// console.log("Current DOT price:", prices.nativeToken.usd.toString());
```

### Create Polkadot Wallet Action

The `CreateWalletAction` handles on-demand Polkadot wallet creation with encrypted key storage using a user-supplied password. The mnemonic is returned for secure backup, and the encrypted wallet details are saved to a file.

```typescript
// This action is typically invoked by the agent based on user intent.
// Example of how the handler in `createWallet.ts` works:

import { CreateWalletAction } from "@elizaos/plugin-polkadot/src/actions/createWallet";
import type { IAgentRuntime } from "@elizaos/core";

// Assuming 'runtime' is an IAgentRuntime instance
// const rpcUrl = runtime.getSetting("POLKADOT_RPC_URL") || "wss://rpc.polkadot.io";
// const action = new CreateWalletAction(runtime);

// const { walletAddress, mnemonic } = await action.createWallet({
//   rpcUrl,
//   encryptionPassword: "user-provided-strong-password",
// });

// console.log("Wallet Address:", walletAddress);
// console.log("Mnemonic (store securely!):", mnemonic);
// A file backup is also created in 'polkadot_wallet_backups' directory.
```

## Development

### Building

```bash
pnpm run build
```

### Testing

```bash
pnpm run test
```

## Dependencies

- `@polkadot/keyring`: For managing Polkadot keypairs.
- `@polkadot/util-crypto`: Cryptographic utilities including mnemonic generation and NaCl encryption.
- `@polkadot/util`: Utility functions for string/byte array conversions.
- `@polkadot/api`: For connecting to Polkadot blockchain and querying on-chain data.
- `bignumber.js`: Precise number handling.
- `node-cache`: In-memory caching functionality.
- `zod`: Schema validation for action inputs.
- `fs` (Node.js built-in): For file system operations (wallet backups).
- `path` (Node.js built-in): For path manipulations.
- Other standard dependencies listed in `package.json`.

## API Reference

### Providers

- `WalletProvider`: Manages Polkadot wallet lifecycle (creation, import, encryption), address retrieval, price fetching, and basic portfolio information.
- `nativeWalletProvider`: A higher-level provider that uses `WalletProvider` to expose wallet information (e.g., formatted portfolio) to the agent.
- `networkDataProvider`: Provides real-time network status including block numbers, validator counts, and parachain information.

### Key Interfaces & Enums (from `providers/wallet.ts`)

```typescript
export enum WalletSourceType {
    NEW = 'new',
    FROM_MNEMONIC = 'fromMnemonic',
    FROM_ENCRYPTED_JSON = 'fromEncryptedJson',
    FROM_ENCRYPTED_FILE = 'fromEncryptedFile',
}

export interface WalletProviderConstructionParams {
    rpcUrl: string;
    cacheManager: ICacheManager; // from @elizaos/core
    source: WalletProviderSource; // Union of specific source types
}

interface WalletPortfolio {
    totalUsd: string;
    totalNativeToken: string;
}

interface Prices {
    nativeToken: { usd: BigNumber }; // BigNumber from bignumber.js
}
```

### Configuration Constants (from `providers/wallet.ts`)

```typescript
const PROVIDER_CONFIG = {
    MAINNET_RPC: "https://rpc.polkadot.io", // Default Polkadot RPC
    RPC_API_KEY: "", // Placeholder, not currently used for Polkadot RPC
    NATIVE_TOKEN_SYMBOL: "DOT", // Native token symbol for price fetching
    COINMARKETCAP_API_URL: "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest",
    MAX_RETRIES: 3, // For API calls
    RETRY_DELAY: 2000, // Initial retry delay in ms
    NATIVE_TOKEN_DECIMALS: BigInt(10000000000), // Polkadot native token (DOT) has 10 decimals
    WALLET_BACKUP_DIRNAME: "polkadot_wallet_backups", // Directory for encrypted wallet backups
    DEFAULT_KEYRING_TYPE: 'sr25519' as const, // Default crypto type for new keypairs
    DEFAULT_KEYRING_SS58_FORMAT: 2, // Default SS58 address format (Polkadot Relay Chain)
};
```

## Common Issues/Troubleshooting

### Issue: Price Fetching Failure

- **Cause**: Missing or invalid `COINMARKETCAP_API_KEY`, network connectivity issues, or CoinMarketCap API service problems.
- **Solution**: Ensure `COINMARKETCAP_API_KEY` is correctly set in environment variables and is valid. Check network connection.

### Issue: Wallet Creation/Import Fails

- **Cause**: Incorrect password for decryption, corrupted backup file, file not found, or issues with mnemonic phrase.
- **Solution**: Verify the password. Ensure the backup file path is correct and the file is intact. Double-check the mnemonic phrase for typos or incorrect word count.

### Issue: `Error: No keypairs available in the keyring to get an address.`
- **Cause**: Attempting to get an address from a `WalletProvider` instance that was initialized with `WalletSourceType.NEW` but no keys have been added yet, or all keys were removed.
- **Solution**: Ensure a keypair is added to the keyring (e.g., after `WalletSourceType.FROM_MNEMONIC` or by explicitly adding one) before calling `getAddress()`.

### Issue: Block/Event Queries Fail

- **Cause**: Invalid block number/hash, RPC endpoint issues, or network connectivity problems.
- **Solution**: Verify block numbers/hashes exist. Check RPC endpoint status and try alternative endpoints.

## Security Best Practices

- **Store Mnemonics Securely**: The mnemonic phrase is the master key to the wallet. It should be stored offline, in a secure location, and never shared.
- **Use Strong Passwords**: For encrypting wallet backups, use strong, unique passwords.
- **Backup Encrypted Files**: Keep backups of the encrypted wallet files in a secure, separate location.
- **Validate Addresses**: When interacting with wallets (though not yet implemented for sending), always double-check addresses.
- **Keep Dependencies Updated**: Regularly update dependencies to include the latest security patches, especially for cryptographic libraries.

## Future Enhancements

1.  **Transaction Capabilities**:
    *   Implement sending DOT.
    *   Support for interacting with parachain assets.
    *   Smart contract interaction capabilities.
2.  **Staking and Governance Participation**:
    *   Allow users to stake DOT.
    *   View staking information and rewards.
    *   Participate in Polkadot governance.
3.  **Multi-Account Management**: Allow managing multiple addresses/keypairs within a single `WalletProvider` instance.
4.  **Hardware Wallet Integration**: Support for popular hardware wallets like Ledger.
5.  **Enhanced Portfolio**: More detailed portfolio breakdown, including different tokens and their values.
6.  **Cross-Chain Functionality**: Explore interactions with other chains via Polkadot's XCM.
7.  **NFT Support**: Viewing and managing NFTs on Polkadot and its parachains.

We welcome community feedback and contributions to help prioritize these enhancements.

## Contributing

Contributions are welcome! Please see the main Eliza project's `CONTRIBUTING.md` file for more information.

## Credits

This plugin integrates with and builds upon several key technologies:

- [Polkadot Network](https://polkadot.network/): The sharded protocol that enables scalable, interoperable, and secure blockchain networks.
- [@polkadot/keyring](https://www.npmjs.com/package/@polkadot/keyring): Polkadot's official keyring library.
- [@polkadot/util-crypto](https://www.npmjs.com/package/@polkadot/util-crypto) & [@polkadot/util](https://www.npmjs.com/package/@polkadot/util): Polkadot's utility and crypto libraries.
- [@polkadot/api](https://www.npmjs.com/package/@polkadot/api): Official Polkadot JavaScript API for blockchain interaction.
- [CoinMarketCap API](https://coinmarketcap.com/api/): Used for fetching token price data.
- [bignumber.js](https://github.com/MikeMcl/bignumber.js/): Precise number handling.
- [node-cache](https://github.com/node-cache/node-cache): Caching functionality.

Special thanks to:

- Parity Technologies and Web3 Foundation for their work on Polkadot and Substrate.
- The Polkadot/Substrate developer community.
- The Eliza community for their contributions and feedback.

For more information about Polkadot:

- [Polkadot Wiki](https://wiki.polkadot.network/)
- [Polkadot Documentation](https://polkadot.network/docs/en/)
- [Substrate Developer Hub](https://substrate.dev/)

## License

This plugin is part of the Eliza project. See the main project repository for license information.
