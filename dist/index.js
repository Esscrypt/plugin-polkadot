// src/actions/createWallet.ts
import { elizaLogger as elizaLogger4, ModelClass, generateObject, composeContext } from "@elizaos/core";

// src/providers/wallet.ts
import { elizaLogger as elizaLogger3 } from "@elizaos/core";
import { CacheManager, MemoryCacheAdapter } from "@elizaos/core";
import * as path from "node:path";

// src/enviroment.ts
import { z } from "zod";
var CONFIG_KEYS = {
  POLKADOT_PRIVATE_KEY: "POLKADOT_PRIVATE_KEY",
  POLKADOT_RPC_URL: "POLKADOT_RPC_URL",
  POLKADOT_RPC_API_KEY: "POLKADOT_RPC_API_KEY",
  POLKADOT_MANIFEST_URL: "POLKADOT_MANIFEST_URL",
  POLKADOT_BRIDGE_URL: "POLKADOT_BRIDGE_URL",
  USE_CACHE_MANAGER: "USE_CACHE_MANAGER"
};
var envSchema = z.object({
  POLKADOT_PRIVATE_KEY: z.string().min(1, "private key is required"),
  POLKADOT_RPC_URL: z.string(),
  POLKADOT_RPC_API_KEY: z.string(),
  POLKADOT_MANIFEST_URL: z.string(),
  POLKADOT_BRIDGE_URL: z.string()
});

// src/providers/wallet.ts
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady, mnemonicGenerate } from "@polkadot/util-crypto";
import fs from "node:fs";

// src/utils/wallet.ts
import { elizaLogger } from "@elizaos/core";
import BigNumber from "bignumber.js";
async function fetchPrices(cacheManager, coinMarketCapApiKey) {
  try {
    const cacheKey = "prices";
    const cachedValue = await cacheManager.get(cacheKey);
    if (cachedValue) {
      elizaLogger.log("Cache hit for fetchPrices");
      return cachedValue;
    }
    elizaLogger.log("Cache miss for fetchPrices");
    let lastError;
    for (let i = 0; i < PROVIDER_CONFIG.MAX_RETRIES; i++) {
      try {
        const response = await fetch(
          `${PROVIDER_CONFIG.COINMARKETCAP_API_URL}?symbol=${PROVIDER_CONFIG.NATIVE_TOKEN_SYMBOL}&convert=USD`,
          {
            headers: {
              "X-CMC_PRO_API_KEY": coinMarketCapApiKey,
              Accept: "application/json"
            }
          }
        );
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `HTTP error! status: ${response.status}, message: ${errorText}`
          );
        }
        const data = await response.json();
        const price = data?.data?.[PROVIDER_CONFIG.NATIVE_TOKEN_SYMBOL]?.quote?.USD;
        if (price) {
          const prices = {
            nativeToken: { usd: new BigNumber(price.price) }
          };
          cacheManager.set(cacheKey, prices);
          return prices;
        }
        throw new Error("Price data not found in CoinMarketCap response structure.");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        elizaLogger.error(`Attempt ${i + 1} failed:`, message);
        lastError = error instanceof Error ? error : new Error(message);
        if (i < PROVIDER_CONFIG.MAX_RETRIES - 1) {
          const delay = PROVIDER_CONFIG.RETRY_DELAY * 2 ** i;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    elizaLogger.error("All attempts failed. Throwing the last error:", lastError);
    throw lastError ?? new Error("All attempts to fetch prices failed without a specific error.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    elizaLogger.error("Error fetching prices:", message);
    throw new Error(`Failed to fetch prices: ${message}`);
  }
}
function formatPortfolio(runtime, portfolio, walletAddress) {
  let output = `${runtime.character.name}
`;
  output += `Wallet Address: ${walletAddress}
`;
  const totalUsdFormatted = new BigNumber(portfolio.totalUsd).toFixed(2);
  const totalNativeTokenFormatted = new BigNumber(portfolio.totalNativeToken).toFixed(4);
  output += `Total Value: $${totalUsdFormatted} (${totalNativeTokenFormatted} ${PROVIDER_CONFIG.NATIVE_TOKEN_SYMBOL.toUpperCase()})
`;
  return output;
}
async function fetchPortfolioValue(cacheManager, coinMarketCapApiKey, walletAddress) {
  try {
    const cacheKey = `portfolio-${walletAddress}`;
    const cachedValue = await cacheManager.get(cacheKey);
    if (cachedValue) {
      elizaLogger.log("Cache hit for fetchPortfolioValue", cachedValue);
      return cachedValue;
    }
    elizaLogger.log("Cache miss for fetchPortfolioValue");
    const prices = await fetchPrices(cacheManager, coinMarketCapApiKey);
    const nativeTokenBalance = BigInt(0);
    const amount = Number(nativeTokenBalance) / Number(PROVIDER_CONFIG.NATIVE_TOKEN_DECIMALS);
    const totalUsd = new BigNumber(amount.toString()).times(prices.nativeToken.usd);
    const portfolio = {
      totalUsd: totalUsd.toString(),
      totalNativeToken: amount.toFixed(4).toString()
    };
    cacheManager.set(cacheKey, portfolio);
    return portfolio;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    elizaLogger.error("Error fetching portfolio:", message);
    throw new Error(`Failed to fetch portfolio value: ${message}`);
  }
}
async function getFormattedPortfolio(runtime, cacheManager, coinMarketCapApiKey, walletAddress) {
  try {
    const portfolio = await fetchPortfolioValue(
      cacheManager,
      coinMarketCapApiKey,
      walletAddress
    );
    return formatPortfolio(runtime, portfolio, walletAddress);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    elizaLogger.error("Error generating portfolio report:", message);
    return "Unable to fetch wallet information. Please try again later.";
  }
}

// src/utils/encryption.ts
import { naclDecrypt, naclEncrypt, randomAsU8a, pbkdf2Encode } from "@polkadot/util-crypto";
import { stringToU8a, u8aToString, u8aToHex, hexToU8a } from "@polkadot/util";
import { elizaLogger as elizaLogger2 } from "@elizaos/core";
function encrypt(text, password) {
  try {
    if (!text || typeof text !== "string") {
      throw new Error("Invalid input text for encryption");
    }
    if (!password || typeof password !== "string") {
      throw new Error("Invalid password for encryption");
    }
    const messageU8a = stringToU8a(text);
    const kdfSalt = randomAsU8a(16);
    const { password: secretKey } = pbkdf2Encode(stringToU8a(password), kdfSalt);
    const { encrypted, nonce } = naclEncrypt(messageU8a, secretKey.subarray(0, 32));
    const kdfSaltHex = u8aToHex(kdfSalt);
    const nonceHex = u8aToHex(nonce);
    const encryptedHex = u8aToHex(encrypted);
    return `${kdfSaltHex}:${nonceHex}:${encryptedHex}`;
  } catch (error) {
    elizaLogger2.error("Encryption error:", error);
    throw new Error(`Failed to encrypt data: ${error.message}`);
  }
}
function decrypt(encryptedString, password) {
  try {
    if (!encryptedString || typeof encryptedString !== "string") {
      throw new Error("Invalid encrypted string input");
    }
    if (!password || typeof password !== "string") {
      throw new Error("Invalid password for decryption");
    }
    const parts = encryptedString.split(":");
    if (parts.length !== 3) {
      throw new Error(
        "Invalid encrypted data format (expected kdfSaltHex:nonceHex:encryptedHex)"
      );
    }
    const [kdfSaltHex, nonceHex, encryptedHex] = parts;
    const kdfSalt = hexToU8a(kdfSaltHex);
    const nonce = hexToU8a(nonceHex);
    const encryptedU8a = hexToU8a(encryptedHex);
    const { password: secretKey } = pbkdf2Encode(stringToU8a(password), kdfSalt);
    const decryptedU8a = naclDecrypt(encryptedU8a, nonce, secretKey.subarray(0, 32));
    if (!decryptedU8a) {
      throw new Error("Decryption failed. Invalid password or corrupted data.");
    }
    const decryptedText = u8aToString(decryptedU8a);
    return decryptedText;
  } catch (error) {
    elizaLogger2.error("Decryption error:", error.message);
    throw new Error(`Failed to decrypt data: ${error.message}`);
  }
}

// src/providers/wallet.ts
var PROVIDER_CONFIG = {
  NATIVE_TOKEN_SYMBOL: "DOT",
  COINMARKETCAP_API_URL: "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest",
  MAX_RETRIES: 3,
  RETRY_DELAY: 2e3,
  NATIVE_TOKEN_DECIMALS: BigInt(1e10),
  WALLET_BACKUP_DIRNAME: "polkadot_wallet_backups",
  DEFAULT_KEYRING_TYPE: "ed25519",
  DEFAULT_KEYRING_SS58_FORMAT: 42
  // substrate generic, 2 for kusama, 0 for polkadot
};
var WALLET_CACHE_KEY = "polkadot/wallets";
var WalletProvider = class _WalletProvider {
  keyring;
  cacheManager;
  coinMarketCapApiKey;
  walletNumber = null;
  source;
  constructor(params) {
    this.cacheManager = process.env[CONFIG_KEYS.USE_CACHE_MANAGER] !== "false" ? params.cacheManager : new CacheManager(new MemoryCacheAdapter());
    this.coinMarketCapApiKey = process.env.COINMARKETCAP_API_KEY || "";
    if (!this.coinMarketCapApiKey) {
      elizaLogger3.warn("COINMARKETCAP_API_KEY is not set. Price fetching will likely fail.");
    }
    const { source } = params;
    this.source = source;
    try {
      const dispatchMap = {
        ["fromMnemonic" /* FROM_MNEMONIC */]: () => this._initializeFromMnemonic(source),
        ["fromEncryptedJson" /* FROM_ENCRYPTED_JSON */]: () => this._initializeFromEncryptedJson(source)
      };
      dispatchMap[source.type]();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      elizaLogger3.error(`WalletProvider constructor failed: ${message}`);
      throw new Error(`Failed to initialize WalletProvider: ${message}`);
    }
    if (!this.keyring || this.keyring.getPairs().length === 0) {
      throw new Error(
        `Keypair not loaded into keyring after initialization from source: ${source.type}`
      );
    }
  }
  static async storeWalletInCache(address, wallet, walletNumber) {
    elizaLogger3.debug("Starting storeWalletInCache for address:", address);
    let cache;
    try {
      const cachedData = await wallet.cacheManager.get(WALLET_CACHE_KEY);
      if (cachedData) {
        elizaLogger3.debug("Retrieved existing cache");
        cache = cachedData;
      } else {
        elizaLogger3.debug("No existing cache found, creating new one");
        cache = {
          wallets: {},
          numberToAddress: {}
        };
      }
    } catch (error) {
      elizaLogger3.error("Error retrieving cache, creating new one:", {
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : error
      });
      cache = {
        wallets: {},
        numberToAddress: {}
      };
    }
    const finalWalletNumber = walletNumber ?? await _WalletProvider.getWalletNumberFromCache(address, cache);
    elizaLogger3.debug("Assigned wallet number:", finalWalletNumber);
    const walletData = {
      number: finalWalletNumber,
      createdAt: Date.now(),
      sourceType: wallet.source.type,
      ...wallet.source.type === "fromMnemonic" /* FROM_MNEMONIC */ && {
        mnemonicData: {
          mnemonic: wallet.source.mnemonic,
          options: wallet.source.keyringOptions || {
            type: PROVIDER_CONFIG.DEFAULT_KEYRING_TYPE,
            ss58Format: PROVIDER_CONFIG.DEFAULT_KEYRING_SS58_FORMAT
          }
        }
      },
      ...wallet.source.type === "fromEncryptedJson" /* FROM_ENCRYPTED_JSON */ && {
        encryptedData: wallet.source.encryptedJson
      }
    };
    cache.wallets[address] = walletData;
    cache.numberToAddress[finalWalletNumber] = address;
    try {
      await wallet.cacheManager.set(WALLET_CACHE_KEY, cache);
      elizaLogger3.debug("Successfully stored wallet in cache");
    } catch (error) {
      elizaLogger3.error("Failed to store wallet in cache:", {
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : error
      });
      throw new Error(
        `Failed to store wallet in cache: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  static async getWalletNumberFromCache(address, cache) {
    return cache.wallets[address]?.number || null;
  }
  static getNextWalletNumberFromFilesystem() {
    const backupDir = path.join(process.cwd(), PROVIDER_CONFIG.WALLET_BACKUP_DIRNAME);
    if (!fs.existsSync(backupDir)) {
      return 1;
    }
    try {
      const files = fs.readdirSync(backupDir);
      if (files.length === 0) {
        return 1;
      }
      return files.length;
    } catch (_error) {
      return 1;
    }
  }
  static async clearWalletFromCache(wallet, address) {
    const cache = await wallet.cacheManager.get(WALLET_CACHE_KEY);
    if (!cache) return;
    const walletNumber = cache.wallets[address]?.number;
    if (walletNumber) {
      delete cache.numberToAddress[walletNumber];
    }
    delete cache.wallets[address];
    await wallet.cacheManager.set(WALLET_CACHE_KEY, cache);
  }
  static async clearAllWalletsFromCache(wallet) {
    await wallet.cacheManager.set(WALLET_CACHE_KEY, {
      wallets: {},
      numberToAddress: {}
    });
  }
  static async loadWalletByAddress(wallet, address, password) {
    const cache = await wallet.cacheManager.get(WALLET_CACHE_KEY);
    if (cache?.wallets[address]) {
      const walletData = cache.wallets[address];
      if (walletData.mnemonicData) {
        return new _WalletProvider({
          cacheManager: wallet.cacheManager,
          source: {
            type: "fromMnemonic" /* FROM_MNEMONIC */,
            mnemonic: walletData.mnemonicData.mnemonic,
            keyringOptions: walletData.mnemonicData.options
          }
        });
      }
      if (walletData.encryptedData && password) {
        return new _WalletProvider({
          cacheManager: wallet.cacheManager,
          source: {
            type: "fromEncryptedJson" /* FROM_ENCRYPTED_JSON */,
            encryptedJson: walletData.encryptedData,
            password
          }
        });
      }
      if (walletData.encryptedData && !password) {
        throw new Error(
          `Wallet found in cache but no password provided for address ${address}`
        );
      }
    }
    const backupDir = path.join(process.cwd(), PROVIDER_CONFIG.WALLET_BACKUP_DIRNAME);
    const fileName = `${address}_wallet_backup.json`;
    const filePath = path.join(backupDir, fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error(`No stored data found for wallet address ${address}`);
    }
    if (!password) {
      throw new Error(
        `Wallet found in file system but no password provided for address ${address}`
      );
    }
    const encryptedFileContent = fs.readFileSync(filePath, {
      encoding: "utf-8"
    });
    const walletProvider = new _WalletProvider({
      cacheManager: wallet.cacheManager,
      source: {
        type: "fromEncryptedJson" /* FROM_ENCRYPTED_JSON */,
        encryptedJson: encryptedFileContent,
        password
      }
    });
    await _WalletProvider.storeWalletInCache(address, walletProvider);
    return walletProvider;
  }
  static async loadWalletByNumber(wallet, number, password) {
    const cache = await wallet.cacheManager.get(WALLET_CACHE_KEY);
    if (cache?.numberToAddress[number]) {
      const address = cache.numberToAddress[number];
      const walletData = cache.wallets[address];
      if (walletData.mnemonicData) {
        return new _WalletProvider({
          cacheManager: wallet.cacheManager,
          source: {
            type: "fromMnemonic" /* FROM_MNEMONIC */,
            mnemonic: walletData.mnemonicData.mnemonic,
            keyringOptions: walletData.mnemonicData.options
          }
        });
      }
      if (walletData.encryptedData && password) {
        return new _WalletProvider({
          cacheManager: wallet.cacheManager,
          source: {
            type: "fromEncryptedJson" /* FROM_ENCRYPTED_JSON */,
            encryptedJson: walletData.encryptedData,
            password
          }
        });
      }
      if (walletData.encryptedData && !password) {
        throw new Error(`Wallet #${number} found in cache but no password provided`);
      }
    }
    const backupDir = path.join(process.cwd(), PROVIDER_CONFIG.WALLET_BACKUP_DIRNAME);
    if (!fs.existsSync(backupDir)) {
      throw new Error(`No wallet found with number ${number}`);
    }
    const files = fs.readdirSync(backupDir);
    if (number <= 0 || number > files.length) {
      throw new Error(`No wallet found with number ${number}`);
    }
    if (!password) {
      throw new Error(`Wallet #${number} found in file system but no password provided`);
    }
    const targetFile = files[number - 1];
    const filePath = path.join(backupDir, targetFile);
    const encryptedFileContent = fs.readFileSync(filePath, {
      encoding: "utf-8"
    });
    const walletProvider = new _WalletProvider({
      cacheManager: wallet.cacheManager,
      source: {
        type: "fromEncryptedJson" /* FROM_ENCRYPTED_JSON */,
        encryptedJson: encryptedFileContent,
        password
      }
    });
    await _WalletProvider.storeWalletInCache(walletProvider.getAddress(), walletProvider);
    return walletProvider;
  }
  // Private handler methods for initialization logic
  _initializeFromMnemonic(source) {
    try {
      elizaLogger3.debug("Initializing wallet from mnemonic");
      const opts = source.keyringOptions || {
        type: PROVIDER_CONFIG.DEFAULT_KEYRING_TYPE,
        ss58Format: PROVIDER_CONFIG.DEFAULT_KEYRING_SS58_FORMAT
      };
      elizaLogger3.debug("Using keyring options:", opts);
      this.keyring = new Keyring(opts);
      let suri = source.mnemonic;
      if (source.password) {
        suri = `${suri}///${source.password}`;
      }
      if (source.hardDerivation) {
        suri = `${suri}//${source.hardDerivation}`;
      }
      if (source.softDerivation) {
        suri = `${suri}/${source.softDerivation}`;
      }
      elizaLogger3.debug("Generated SURI:", suri);
      this.keyring.addFromUri(suri, { name: "main pair" }, opts.type);
      elizaLogger3.debug("Wallet initialized successfully");
    } catch (error) {
      elizaLogger3.error("Error initializing from mnemonic:", {
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : error
      });
      throw new Error(`Failed to initialize wallet from mnemonic: ${error.message}`);
    }
  }
  _initializeFromEncryptedJson(source) {
    try {
      elizaLogger3.debug("Initializing wallet from encrypted JSON");
      elizaLogger3.debug("Encrypted data length:", source.encryptedJson.length);
      const decryptedJson = decrypt(source.encryptedJson, source.password);
      elizaLogger3.debug("Decrypted JSON length:", decryptedJson.length);
      elizaLogger3.debug("Decrypted JSON content:", decryptedJson);
      let MnemonicAndOptions;
      try {
        elizaLogger3.debug("Attempting to parse decrypted JSON");
        MnemonicAndOptions = JSON.parse(decryptedJson);
        elizaLogger3.debug("Successfully parsed wallet data:", MnemonicAndOptions);
      } catch (parseError) {
        elizaLogger3.error("JSON Parse Error:", {
          error: parseError instanceof Error ? {
            message: parseError.message,
            stack: parseError.stack,
            name: parseError.name
          } : parseError,
          json: decryptedJson
        });
        throw new Error(`Failed to parse decrypted wallet data: ${parseError.message}`);
      }
      if (!MnemonicAndOptions.mnemonic || !MnemonicAndOptions.options) {
        elizaLogger3.error("Missing required fields in parsed data:", MnemonicAndOptions);
        throw new Error("Decrypted data missing required fields (mnemonic or options)");
      }
      this.keyring = new Keyring(MnemonicAndOptions.options);
      this.keyring.addFromUri(
        MnemonicAndOptions.mnemonic,
        { name: "imported main pair" },
        MnemonicAndOptions.options.type
      );
      elizaLogger3.debug("Wallet initialized successfully");
    } catch (error) {
      elizaLogger3.error("Error initializing from encrypted JSON:", {
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : error
      });
      throw new Error(`Failed to initialize wallet from encrypted data: ${error.message}`);
    }
  }
  async fetchPrices() {
    return fetchPrices(this.cacheManager, this.coinMarketCapApiKey);
  }
  getAddress() {
    const pairs = this.keyring.getPairs();
    if (pairs.length === 0) {
      throw new Error("No keypairs available in the keyring to get an address.");
    }
    return pairs[0].address;
  }
  async getWalletNumber() {
    if (this.walletNumber !== null) {
      return this.walletNumber;
    }
    const address = this.getAddress();
    const cache = await this.cacheManager.get(WALLET_CACHE_KEY);
    const number = cache?.wallets[address]?.number;
    this.walletNumber = number !== void 0 ? Number(number) : null;
    return this.walletNumber;
  }
  static async getWalletData(wallet, number) {
    const cache = await wallet.cacheManager.get(WALLET_CACHE_KEY);
    if (!cache?.numberToAddress[number]) return null;
    const address = cache.numberToAddress[number];
    const walletData = cache.wallets[address];
    if (!walletData) return null;
    return {
      source: {
        type: walletData.sourceType,
        ...walletData.mnemonicData && {
          mnemonic: walletData.mnemonicData.mnemonic,
          keyringOptions: walletData.mnemonicData.options
        },
        ...walletData.encryptedData && {
          encryptedJson: walletData.encryptedData
        }
      },
      address,
      createdAt: walletData.createdAt
    };
  }
  static async getWalletByAddress(wallet, address) {
    const cache = await wallet.cacheManager.get(WALLET_CACHE_KEY);
    if (!cache?.wallets[address]) return null;
    const walletData = cache.wallets[address];
    return {
      source: {
        type: walletData.sourceType,
        ...walletData.mnemonicData && {
          mnemonic: walletData.mnemonicData.mnemonic,
          keyringOptions: walletData.mnemonicData.options
        },
        ...walletData.encryptedData && {
          encryptedJson: walletData.encryptedData
        }
      },
      address,
      createdAt: walletData.createdAt
    };
  }
  static async generateNew(wallet, password, options) {
    const mnemonic = mnemonicGenerate(24);
    const keyringOptions = options?.keyringOptions || {
      type: PROVIDER_CONFIG.DEFAULT_KEYRING_TYPE,
      ss58Format: PROVIDER_CONFIG.DEFAULT_KEYRING_SS58_FORMAT
    };
    const dataToEncrypt = {
      mnemonic,
      options: keyringOptions,
      ...options?.password && { password: options.password },
      ...options?.hardDerivation && {
        hardDerivation: options.hardDerivation
      },
      ...options?.softDerivation && {
        softDerivation: options.softDerivation
      }
    };
    const jsonString = JSON.stringify(dataToEncrypt);
    try {
      const encryptedMnemonicAndOptions = encrypt(jsonString, password);
      const walletProvider = new _WalletProvider({
        cacheManager: wallet.cacheManager,
        source: {
          type: "fromMnemonic" /* FROM_MNEMONIC */,
          mnemonic,
          keyringOptions,
          password: options?.password,
          hardDerivation: options?.hardDerivation,
          softDerivation: options?.softDerivation
        }
      });
      const backupDir = path.join(process.cwd(), PROVIDER_CONFIG.WALLET_BACKUP_DIRNAME);
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      const address = walletProvider.getAddress();
      const fileName = `${address}_wallet_backup.json`;
      const filePath = path.join(backupDir, fileName);
      if (!fs.existsSync(path.dirname(filePath))) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
      }
      fs.writeFileSync(filePath, encryptedMnemonicAndOptions, {
        encoding: "utf-8"
      });
      elizaLogger3.log(`Wallet backup saved to ${filePath}`);
      const walletNumber = _WalletProvider.getNextWalletNumberFromFilesystem();
      await _WalletProvider.storeWalletInCache(address, walletProvider, walletNumber);
      return {
        walletProvider,
        mnemonic,
        encryptedBackup: encryptedMnemonicAndOptions,
        walletNumber
      };
    } catch (error) {
      elizaLogger3.error("Error in wallet generation:", {
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : error
      });
      throw error;
    }
  }
  static async importWalletFromFile(runtime, walletAddressForBackupName, password) {
    const backupDir = path.join(process.cwd(), PROVIDER_CONFIG.WALLET_BACKUP_DIRNAME);
    const fileName = `${walletAddressForBackupName}_wallet_backup.json`;
    const filePath = path.join(backupDir, fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Wallet backup file does not exist at: ${filePath}`);
    }
    const encryptedFileContent = fs.readFileSync(filePath, {
      encoding: "utf-8"
    });
    const constructionParams = {
      cacheManager: runtime.cacheManager,
      source: {
        type: "fromEncryptedJson" /* FROM_ENCRYPTED_JSON */,
        encryptedJson: encryptedFileContent,
        password
      }
    };
    return new _WalletProvider(constructionParams);
  }
  static async ejectWalletFromFile(wallet, walletAddressForBackupName, password) {
    const backupDir = path.join(process.cwd(), PROVIDER_CONFIG.WALLET_BACKUP_DIRNAME);
    const fileName = `${walletAddressForBackupName}_wallet_backup.json`;
    const filePath = path.join(backupDir, fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Wallet backup file does not exist at: ${filePath}`);
    }
    const encryptedFileContent = fs.readFileSync(filePath, {
      encoding: "utf-8"
    });
    elizaLogger3.debug("Read encrypted file content, length:", encryptedFileContent.length);
    const decryptedFileJson = decrypt(encryptedFileContent, password);
    elizaLogger3.debug("Decrypted file content:", decryptedFileJson);
    try {
      const mnemonicAndOptions = JSON.parse(decryptedFileJson);
      elizaLogger3.debug("Successfully parsed wallet data:", mnemonicAndOptions);
      elizaLogger3.log(
        `Wallet ejected from file ${filePath}, revealing mnemonic and options.`
      );
      await _WalletProvider.clearWalletFromCache(wallet, walletAddressForBackupName);
      return mnemonicAndOptions;
    } catch (parseError) {
      elizaLogger3.error("JSON Parse Error in ejectWalletFromFile:", {
        error: parseError instanceof Error ? {
          message: parseError.message,
          stack: parseError.stack,
          name: parseError.name
        } : parseError,
        json: decryptedFileJson
      });
      throw new Error(`Failed to parse decrypted wallet data: ${parseError.message}`);
    }
  }
  static async importWallet(encryptedMnemonicAndOptions, password, runtime) {
    const constructionParams = {
      cacheManager: runtime.cacheManager,
      source: {
        type: "fromEncryptedJson" /* FROM_ENCRYPTED_JSON */,
        encryptedJson: encryptedMnemonicAndOptions,
        password
      }
    };
    const walletProvider = new _WalletProvider(constructionParams);
    elizaLogger3.log(
      `Wallet imported successfully via encrypted JSON, address: ${walletProvider.getAddress()}`
    );
    return walletProvider;
  }
};
var initWalletProvider = async (runtime) => {
  let mnemonic = runtime.getSetting(CONFIG_KEYS.POLKADOT_PRIVATE_KEY);
  if (!mnemonic) {
    elizaLogger3.error(`${CONFIG_KEYS.POLKADOT_PRIVATE_KEY} is missing`);
    mnemonic = mnemonicGenerate(24);
  }
  const mnemonicsArray = mnemonic.split(" ");
  if (mnemonicsArray.length < 12 || mnemonicsArray.length > 24) {
    throw new Error(
      `${CONFIG_KEYS.POLKADOT_PRIVATE_KEY} mnemonic seems invalid (length: ${mnemonicsArray.length})`
    );
  }
  const keyringOptions = {
    type: PROVIDER_CONFIG.DEFAULT_KEYRING_TYPE,
    ss58Format: PROVIDER_CONFIG.DEFAULT_KEYRING_SS58_FORMAT
  };
  await cryptoWaitReady();
  const walletProvider = new WalletProvider({
    cacheManager: runtime.cacheManager,
    source: {
      type: "fromMnemonic" /* FROM_MNEMONIC */,
      mnemonic,
      keyringOptions
    }
  });
  elizaLogger3.log(`Wallet initialized from settings, address: ${walletProvider.getAddress()}`);
  return walletProvider;
};
var nativeWalletProvider = {
  async get(runtime, _message, _state) {
    const walletProvider = await initWalletProvider(runtime);
    if (runtime.getSetting("COINMARKETCAP_API_KEY")) {
      try {
        const formattedPortfolio = await getFormattedPortfolio(
          runtime,
          walletProvider.cacheManager,
          walletProvider.coinMarketCapApiKey,
          walletProvider.getAddress()
        );
        elizaLogger3.log(formattedPortfolio);
        return formattedPortfolio;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        elizaLogger3.error(
          `Error in ${PROVIDER_CONFIG.NATIVE_TOKEN_SYMBOL.toUpperCase()} wallet provider:`,
          message
        );
        return null;
      }
    }
    return null;
  }
};

// src/actions/createWallet.ts
import { z as z2 } from "zod";
var passwordSchema = z2.object({
  encryptionPassword: z2.string().optional().nullable(),
  keypairPassword: z2.string().optional().nullable(),
  hardDerivation: z2.string().optional().nullable(),
  softDerivation: z2.string().optional().nullable()
});
var passwordTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.
  Example response:
  \`\`\`json
  {
    "encryptionPassword": "<your password here>",
    "keypairPassword": "<optional password for keypair>",
    "hardDerivation": "<optional hard derivation path>",
    "softDerivation": "<optional soft derivation path>"
  }
  \`\`\`
  
  {{recentMessages}}

  If an encryption password is not provided in the latest message, return null for the encryption password.

  Respond with a JSON markdown block containing only the extracted values.`;
async function buildCreateWalletDetails(runtime, message, state) {
  const currentState = state || await runtime.composeState(message);
  const context = composeContext({
    state: currentState,
    template: passwordTemplate
  });
  const result = await generateObject({
    runtime,
    context,
    schema: passwordSchema,
    modelClass: ModelClass.SMALL
  });
  let passwordData = result.object;
  let wasPasswordGenerated = false;
  if (!passwordData?.encryptionPassword) {
    const generatedPassword = Math.random().toString(36).slice(-12);
    elizaLogger4.log("Encryption password not provided by user, generating one.");
    const baseData = passwordData || { text: "" };
    passwordData = { ...baseData, encryptionPassword: generatedPassword };
    wasPasswordGenerated = true;
  }
  const createWalletContent = passwordData;
  return { content: createWalletContent, wasPasswordGenerated };
}
var CreateWalletAction = class {
  runtime;
  walletProvider;
  constructor(runtime) {
    this.runtime = runtime;
  }
  async initialize() {
    this.walletProvider = await initWalletProvider(this.runtime);
  }
  async createWallet(params) {
    const { walletProvider, mnemonic, walletNumber } = await WalletProvider.generateNew(
      this.walletProvider,
      params.encryptionPassword,
      {
        password: params.keypairPassword,
        hardDerivation: params.hardDerivation,
        softDerivation: params.softDerivation
      }
    );
    const walletAddress = walletProvider.getAddress();
    await WalletProvider.storeWalletInCache(walletAddress, walletProvider);
    return { walletAddress, mnemonic, walletNumber };
  }
};
var createWallet_default = {
  name: "CREATE_POLKADOT_WALLET",
  similes: ["NEW_POLKADOT_WALLET", "MAKE_NEW_POLKADOT_WALLET"],
  description: "Creates a new Polkadot wallet on demand. Returns the public address and mnemonic backup (store it securely). The wallet keypair is also encrypted to a file using the provided password. Optionally supports keypair password and derivation paths.",
  handler: async (runtime, message, state, _options, callback) => {
    elizaLogger4.log("Starting CREATE_POLKADOT_WALLET action...");
    const { content: createWalletContent, wasPasswordGenerated: isPasswordGenerated } = await buildCreateWalletDetails(runtime, message, state);
    elizaLogger4.debug("createWalletContent", createWalletContent);
    if (!createWalletContent || typeof createWalletContent.encryptionPassword !== "string") {
      elizaLogger4.error("Failed to obtain encryption password.");
      if (callback) {
        callback({
          text: "Unable to process create wallet request. Could not obtain an encryption password.",
          content: {
            error: "Invalid create wallet. Password could not be determined or generated."
          }
        });
      }
      return false;
    }
    try {
      const action = new CreateWalletAction(runtime);
      await action.initialize();
      const { walletAddress, mnemonic, walletNumber } = await action.createWallet({
        encryptionPassword: createWalletContent.encryptionPassword,
        keypairPassword: createWalletContent.keypairPassword,
        hardDerivation: createWalletContent.hardDerivation,
        softDerivation: createWalletContent.softDerivation
      });
      let userMessageText = `
New Polkadot wallet created! \u{1F389}

Wallet Number: ${walletNumber}
This wallet number can be used to load and interact with your wallet in future sessions.`;
      if (isPasswordGenerated) {
        userMessageText += `

Generated Encryption Password: ${createWalletContent.encryptionPassword}
\u26A0\uFE0F IMPORTANT: Please store this password securely. You'll need it to access your wallet backup.`;
      }
      userMessageText += `

Wallet Address: ${walletAddress}`;
      if (createWalletContent.keypairPassword) {
        userMessageText += `
Keypair Password: ${createWalletContent.keypairPassword}`;
      }
      if (createWalletContent.hardDerivation) {
        userMessageText += `
Hard Derivation: ${createWalletContent.hardDerivation}`;
      }
      if (createWalletContent.softDerivation) {
        userMessageText += `
Soft Derivation: ${createWalletContent.softDerivation}`;
      }
      userMessageText += `

\u26A0\uFE0F IMPORTANT: Please securely store your mnemonic phrase:
${mnemonic}`;
      const result = {
        status: "success",
        walletAddress,
        walletNumber,
        mnemonic,
        keypairPassword: createWalletContent.keypairPassword,
        hardDerivation: createWalletContent.hardDerivation,
        softDerivation: createWalletContent.softDerivation,
        message: "New Polkadot wallet created. Store the mnemonic securely for recovery."
      };
      if (callback) {
        callback({
          text: userMessageText,
          content: result
        });
      }
      return true;
    } catch (error) {
      elizaLogger4.error("Error creating wallet:", error);
      if (callback) {
        callback({
          text: `Error creating wallet: ${error.message}`,
          content: { error: error.message }
        });
      }
      return false;
    }
  },
  validate: async (_runtime) => true,
  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "Please create a new Polkadot wallet with keypair password 'secret' and hard derivation 'test'",
          action: "CREATE_POLKADOT_WALLET"
        }
      },
      {
        user: "{{user2}}",
        content: {
          text: "New Polkadot wallet created!\nYour password was used to encrypt the wallet keypair, but never stored.\nWallet Address: EQAXxxxxxxxxxxxxxxxxxxxxxx\nWallet Number: 1\nKeypair Password: secret\nHard Derivation: test\n\nPlease securely store your mnemonic:"
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "Please create a new wallet",
          action: "CREATE_POLKADOT_WALLET"
        }
      },
      {
        user: "{{user2}}",
        content: {
          text: "New Polkadot wallet created!\nWallet Number: 1\nWallet Address: EQAXxxxxxxxxxxxxxxxxxxxxxx\n\nPlease securely store your mnemonic:"
        }
      }
    ]
  ]
};

// src/actions/ejectWallet.ts
import { elizaLogger as elizaLogger5, ModelClass as ModelClass2, generateObject as generateObject2, composeContext as composeContext2 } from "@elizaos/core";
import { z as z3 } from "zod";
function isEjectWalletContent(content) {
  return (typeof content.password === "string" || content.password === void 0 || content.password === null) && (typeof content.walletAddress === "string" || content.walletAddress === void 0 || content.walletAddress === null) && (typeof content.walletNumber === "number" || content.walletNumber === void 0 || content.walletNumber === null);
}
var ejectWalletSchema = z3.object({
  password: z3.string().optional().nullable(),
  walletAddress: z3.string().optional().nullable(),
  walletNumber: z3.number().optional().nullable()
});
var ejectWalletTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.
Example response:
\`\`\`json
{
  "password": "my_password",
  "walletAddress": "EQAXxxxxxxxxxxxxxxxxxxxxxx",
  "walletNumber": 1
}
\`\`\`

{{recentMessages}}

Respond with a JSON markdown block containing only the extracted values`;
async function buildEjectWalletDetails(runtime, message, state) {
  const currentState = state || await runtime.composeState(message);
  const context = composeContext2({
    state: currentState,
    template: ejectWalletTemplate
  });
  const result = await generateObject2({
    runtime,
    context,
    schema: ejectWalletSchema,
    modelClass: ModelClass2.SMALL
  });
  return result.object;
}
var ejectWallet_default = {
  name: "EJECT_POLKADOT_WALLET",
  similes: ["EXPORT_POLKADOT_WALLET", "RECOVER_WALLET", "EJECT_WALLET"],
  description: "Ejects an existing Polkadot wallet either by wallet number or from an encrypted backup file. Returns the wallet's mnemonic.",
  handler: async (runtime, message, state, _options, callback) => {
    elizaLogger5.log("Starting EJECT_POLKADOT_WALLET action...");
    const ejectWalletContent = await buildEjectWalletDetails(runtime, message, state);
    if (!isEjectWalletContent(ejectWalletContent)) {
      if (callback) {
        callback({
          text: "Unable to process eject wallet request. Please provide either a wallet number or wallet address.",
          content: {
            error: "Invalid eject wallet request. Missing required parameters."
          }
        });
      }
      return false;
    }
    try {
      elizaLogger5.debug("ejectWalletContent", ejectWalletContent);
      const { password, walletAddress, walletNumber } = ejectWalletContent;
      const walletProvider = await initWalletProvider(runtime);
      let mnemonic;
      let address;
      if (walletNumber) {
        const targetWallet = await WalletProvider.loadWalletByNumber(
          walletProvider,
          walletNumber,
          password
        );
        if (!targetWallet) {
          throw new Error(
            `Failed to load wallet #${walletNumber}. Please check the wallet number and password.`
          );
        }
        address = targetWallet.getAddress();
        const walletData = await WalletProvider.getWalletData(targetWallet, walletNumber);
        if (walletData?.decryptedKeyring?.mnemonic) {
          mnemonic = walletData.decryptedKeyring.mnemonic;
        } else if (password) {
          elizaLogger5.log(
            `No decrypted data in cache for wallet #${walletNumber}, falling back to file system`
          );
          const result2 = await WalletProvider.ejectWalletFromFile(
            walletProvider,
            address,
            password
          );
          mnemonic = result2.mnemonic;
        } else {
          throw new Error(
            `No decrypted data found for wallet #${walletNumber} and no password provided for file system fallback`
          );
        }
      } else if (walletAddress && password) {
        const result2 = await WalletProvider.ejectWalletFromFile(
          walletProvider,
          walletAddress,
          password
        );
        mnemonic = result2.mnemonic;
        address = walletAddress;
      } else {
        throw new Error(
          "Please provide either a wallet number or both wallet address and password."
        );
      }
      const result = {
        status: "success",
        walletAddress: address,
        mnemonic,
        message: `
Wallet ejected successfully.
Your Decrypted mnemonic is:

 ${mnemonic}.
Please store it securely.`
      };
      if (callback) {
        callback({
          text: `Wallet ejected successfully.

Your Decrypted mnemonic is:

 ${mnemonic}.

Please store it securely.`,
          content: result
        });
      }
      return true;
    } catch (error) {
      elizaLogger5.error("Error ejecting wallet:", error);
      if (callback) {
        callback({
          text: `Error ejecting wallet: ${error.message}`,
          content: { error: error.message }
        });
      }
      return false;
    }
  },
  validate: async (_runtime) => true,
  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "Please eject my Polkadot wallet #1 with password my_password",
          action: "EJECT_POLKADOT_WALLET"
        }
      },
      {
        user: "{{user2}}",
        content: {
          text: "Wallet ejected successfully. Your Decrypted mnemonic is: mnemonic. Please store it securely."
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "Please eject my Polkadot wallet with address 1234567890 and password my_password",
          action: "EJECT_POLKADOT_WALLET"
        }
      },
      {
        user: "{{user2}}",
        content: {
          text: "Wallet ejected successfully. Your Decrypted mnemonic is: mnemonic. Please store it securely."
        }
      }
    ]
  ]
};

// src/actions/signMessage.ts
import { elizaLogger as elizaLogger6, ModelClass as ModelClass3, generateObject as generateObject3, composeContext as composeContext3 } from "@elizaos/core";
import { stringToU8a as stringToU8a2, u8aToHex as u8aToHex2 } from "@polkadot/util";
import { z as z4 } from "zod";
function isSignMessageContent(content) {
  return typeof content.messageToSign === "string";
}
var signMessageSchema = z4.object({
  messageToSign: z4.string().min(1, "Message to sign cannot be empty."),
  walletNumber: z4.number().optional().nullable(),
  walletAddress: z4.string().optional().nullable(),
  walletPassword: z4.string().optional().nullable()
});
var signMessageTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.
Example response:
\`\`\`json
{
  "messageToSign": "This is the message I want to sign.",
  "walletNumber": 1,
  "walletAddress": "5GrwvaEF5zXb26FfGZWvt2fBvXN1Jz2yXzL9Vvns8wQMXwXb",
  "walletPassword": "optional-password-if-specified"
}
\`\`\`

{{recentMessages}}

Respond with a JSON markdown block containing only the extracted values`;
async function buildSignMessageDetails(runtime, message, state) {
  const currentState = state || await runtime.composeState(message);
  const context = composeContext3({
    state: currentState,
    template: signMessageTemplate
  });
  const result = await generateObject3({
    runtime,
    context,
    schema: signMessageSchema,
    modelClass: ModelClass3.SMALL
  });
  return result.object;
}
var SignMessageAction = class {
  walletProvider;
  constructor(walletProvider) {
    this.walletProvider = walletProvider;
  }
  async signMessage(messageToSign, walletNumber, walletAddress, password) {
    const messageU8a = stringToU8a2(String(messageToSign));
    if (messageU8a.length === 0) {
      throw new Error("Cannot sign an empty message");
    }
    let targetWallet = this.walletProvider;
    let currentWalletNumber = null;
    if (walletNumber) {
      targetWallet = await WalletProvider.loadWalletByNumber(
        this.walletProvider,
        walletNumber,
        password
      );
      if (!targetWallet) {
        throw new Error(
          `Failed to load wallet #${walletNumber}. Please check the wallet number.`
        );
      }
      currentWalletNumber = walletNumber;
    } else if (walletAddress) {
      targetWallet = await WalletProvider.loadWalletByAddress(
        this.walletProvider,
        walletAddress,
        password
      );
      if (!targetWallet) {
        throw new Error(
          `Failed to load wallet with address ${walletAddress}. Please check the address.`
        );
      }
      const cache = await targetWallet.cacheManager.get(WALLET_CACHE_KEY);
      currentWalletNumber = cache?.wallets[walletAddress]?.number || null;
    }
    const pairs = targetWallet.keyring.getPairs();
    if (pairs.length === 0) {
      throw new Error("No key pairs found in the wallet.");
    }
    const keypair = pairs[0];
    const signature = keypair.sign(messageU8a);
    await WalletProvider.storeWalletInCache(keypair.address, targetWallet);
    return {
      status: "success",
      signature: u8aToHex2(signature),
      walletAddress: keypair.address,
      walletNumber: currentWalletNumber || 1,
      // Default to 1 if no number found
      message: `Message signed successfully. Signature: ${u8aToHex2(signature)}`
    };
  }
};
var signMessage_default = {
  name: "SIGN_POLKADOT_MESSAGE",
  similes: ["SIGN_MESSAGE", "SIGN_DATA", "SIGN_TRANSACTION"],
  description: "Signs a message using a Polkadot wallet. Returns the signature.",
  handler: async (runtime, message, state, _options, callback) => {
    elizaLogger6.log("Starting SIGN_POLKADOT_MESSAGE action...");
    const signMessageContent = await buildSignMessageDetails(runtime, message, state);
    if (!isSignMessageContent(signMessageContent)) {
      if (callback) {
        callback({
          text: "Unable to process sign message request. Please provide a message to sign and either a wallet number or wallet address.",
          content: {
            error: "Invalid sign message request. Missing required parameters."
          }
        });
      }
      return false;
    }
    try {
      elizaLogger6.debug("signMessageContent", signMessageContent);
      const { messageToSign, walletNumber, walletAddress } = signMessageContent;
      const walletProvider = await initWalletProvider(runtime);
      const signAction = new SignMessageAction(walletProvider);
      const result = await signAction.signMessage(
        String(messageToSign),
        walletNumber,
        walletAddress
      );
      if (callback) {
        callback({
          text: `Message signed successfully.

Signature: ${result.signature}`,
          content: result
        });
      }
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      elizaLogger6.error("Error signing message:", errorMessage);
      if (callback) {
        callback({
          text: `Error signing message: ${errorMessage}`,
          content: { error: errorMessage }
        });
      }
      return false;
    }
  },
  validate: async (_runtime) => true,
  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "Please sign the message 'hello world' with my Polkadot wallet.",
          action: "SIGN_POLKADOT_MESSAGE"
        }
      },
      {
        user: "{{user2}}",
        content: {
          text: "Message signed successfully!\nSigner: 5GrwvaEF5zXb26FfGZWvt2fBvXN1Jz2yXzL9Vvns8wQMXwXb\nSignature: 0xabcd1234..."
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "Can you sign this for me: 'test message 123'",
          action: "SIGN_POLKADOT_MESSAGE"
        }
      },
      {
        user: "{{user2}}",
        content: {
          text: "Message signed successfully!\nSigner: 5GrwvaEF5zXb26FfGZWvt2fBvXN1Jz2yXzL9Vvns8wQMXwXb\nSignature: 0xfedc9876..."
        }
      }
    ]
  ]
};

// src/actions/loadWallet.ts
import { elizaLogger as elizaLogger7, ModelClass as ModelClass4, generateObject as generateObject4, composeContext as composeContext4 } from "@elizaos/core";
import { z as z5 } from "zod";
function isLoadWalletContent(content) {
  return (typeof content.walletNumber === "number" || content.walletNumber === void 0 || content.walletNumber === null) && (typeof content.walletAddress === "string" || content.walletAddress === void 0 || content.walletAddress === null) && (typeof content.walletPassword === "string" || content.walletPassword === void 0 || content.walletPassword === null);
}
var loadWalletSchema = z5.object({
  walletNumber: z5.number().optional().nullable(),
  walletAddress: z5.string().optional().nullable(),
  walletPassword: z5.string().optional().nullable()
});
var loadWalletTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.
Example response:
\`\`\`json
{
  "walletNumber": 1,
  "walletAddress": "5GrwvaEF5zXb26FfGZWvt2fBvXN1Jz2yXzL9Vvns8wQMXwXb",
  "walletPassword": "password"
}
\`\`\`

{{recentMessages}}

Respond with a JSON markdown block containing only the extracted values`;
async function buildLoadWalletDetails(runtime, message, state) {
  const currentState = state || await runtime.composeState(message);
  const context = composeContext4({
    state: currentState,
    template: loadWalletTemplate
  });
  const result = await generateObject4({
    runtime,
    context,
    schema: loadWalletSchema,
    modelClass: ModelClass4.SMALL
  });
  return result.object;
}
var loadWallet_default = {
  name: "LOAD_POLKADOT_WALLET",
  similes: ["LOAD_WALLET", "OPEN_WALLET", "ACCESS_WALLET"],
  description: "Loads an existing Polkadot wallet either by wallet number or address. Returns the wallet's address.",
  handler: async (runtime, message, state, _options, callback) => {
    elizaLogger7.log("Starting LOAD_POLKADOT_WALLET action...");
    const loadWalletContent = await buildLoadWalletDetails(runtime, message, state);
    if (!isLoadWalletContent(loadWalletContent)) {
      if (callback) {
        callback({
          text: "Unable to process load wallet request. Please provide either a wallet number or wallet address.",
          content: {
            error: "Invalid load wallet request. Missing required parameters."
          }
        });
      }
      return false;
    }
    try {
      elizaLogger7.debug("loadWalletContent", loadWalletContent);
      const { walletNumber, walletAddress, walletPassword } = loadWalletContent;
      const walletProvider = await initWalletProvider(runtime);
      let targetWallet = null;
      if (walletNumber) {
        targetWallet = await WalletProvider.loadWalletByNumber(
          walletProvider,
          walletNumber,
          walletPassword
        );
        if (!targetWallet) {
          throw new Error(
            `Failed to load wallet #${walletNumber}. Please check the wallet number or password.`
          );
        }
      } else if (walletAddress) {
        targetWallet = await WalletProvider.loadWalletByAddress(
          walletProvider,
          walletAddress,
          walletPassword
        );
        if (!targetWallet) {
          throw new Error(
            `Failed to load wallet with address ${walletAddress}. Please check the address or password.`
          );
        }
      }
      const address = targetWallet.getAddress();
      const currentWalletNumber = await targetWallet.getWalletNumber();
      await WalletProvider.storeWalletInCache(address, targetWallet);
      const result = {
        status: "success",
        walletAddress: address,
        walletNumber: currentWalletNumber,
        message: `Wallet loaded successfully. Your wallet address is: ${address}${currentWalletNumber ? ` (Wallet #${currentWalletNumber})` : ""}`
      };
      if (callback) {
        callback({
          text: `Wallet loaded successfully.

Your wallet address is: ${address}${currentWalletNumber ? ` (Wallet #${currentWalletNumber})` : ""}`,
          content: result
        });
      }
      return true;
    } catch (error) {
      elizaLogger7.error("Error loading wallet:", error);
      if (callback) {
        callback({
          text: `Error loading wallet: ${error.message}`,
          content: { error: error.message }
        });
      }
      return false;
    }
  },
  validate: async (_runtime) => true,
  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "Please load my Polkadot wallet #1 with password my_password",
          action: "LOAD_POLKADOT_WALLET"
        }
      },
      {
        user: "{{user2}}",
        content: {
          text: "Wallet loaded successfully!\nWallet #1\nAddress: 5GrwvaEF5zXb26FfGZWvt2fBvXN1Jz2yXzL9Vvns8wQMXwXb\n\nThe wallet is now ready for use."
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "Please load my Polkadot wallet with address 5GrwvaEF5zXb26FfGZWvt2fBvXN1Jz2yXzL9Vvns8wQMXwXb and password my_password",
          action: "LOAD_POLKADOT_WALLET"
        }
      },
      {
        user: "{{user2}}",
        content: {
          text: "Wallet loaded successfully!\nWallet #1\nAddress: 5GrwvaEF5zXb26FfGZWvt2fBvXN1Jz2yXzL9Vvns8wQMXwXb\n\nThe wallet is now ready for use."
        }
      }
    ]
  ]
};

// src/actions/validateSignature.ts
import { elizaLogger as elizaLogger8, ModelClass as ModelClass5, generateObject as generateObject5, composeContext as composeContext5 } from "@elizaos/core";
import { stringToU8a as stringToU8a3, hexToU8a as hexToU8a2 } from "@polkadot/util";
import { z as z6 } from "zod";
var validateSignatureSchema = z6.object({
  message: z6.string().min(1, "Message cannot be empty."),
  signature: z6.string().min(1, "Signature cannot be empty."),
  walletNumber: z6.number().optional().nullable(),
  walletPassword: z6.string().optional().nullable(),
  walletAddress: z6.string().optional().nullable()
});
var validateSignatureTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.
Example response:
\`\`\`json
{
  "message": "This is the message to verify",
  "signature": "0x...",
  "walletNumber": 1,
  "walletPassword": "optional-password-if-specified",
  "walletAddress": "optional-address-if-specified"
}
\`\`\`

{{recentMessages}}

Respond with a JSON markdown block containing only the extracted values`;
var ValidateAction = class {
  walletProvider;
  constructor(walletProvider) {
    this.walletProvider = walletProvider;
  }
  async validateSignature(messageToVerify, signature, walletNumber, walletAddress, password) {
    if (!walletNumber && !walletAddress) {
      throw new Error(
        "Unable to validate signature. Please provide a wallet number or address."
      );
    }
    if (!messageToVerify) {
      throw new Error("Cannot validate signature for an empty message");
    }
    if (!signature) {
      throw new Error("Cannot validate an empty signature");
    }
    let targetWallet = this.walletProvider;
    let currentWalletNumber = null;
    if (walletNumber) {
      targetWallet = await WalletProvider.loadWalletByNumber(
        this.walletProvider,
        walletNumber,
        password
      );
      if (!targetWallet) {
        throw new Error(
          `Failed to load wallet #${walletNumber}. Please check the wallet number.`
        );
      }
      currentWalletNumber = walletNumber;
    } else if (walletAddress) {
      targetWallet = await WalletProvider.loadWalletByAddress(
        this.walletProvider,
        walletAddress,
        password
      );
      if (!targetWallet) {
        throw new Error(
          `Failed to load wallet with address ${walletAddress}. Please check the address.`
        );
      }
      const cache = await targetWallet.cacheManager.get(WALLET_CACHE_KEY);
      currentWalletNumber = cache?.wallets[walletAddress]?.number || null;
    }
    const pairs = targetWallet.keyring.getPairs();
    if (pairs.length === 0) {
      throw new Error("No key pairs found in the wallet.");
    }
    const keypair = pairs[0];
    const messageU8a = stringToU8a3(String(messageToVerify));
    const signatureU8a = hexToU8a2(signature);
    const isValid = keypair.verify(messageU8a, signatureU8a, keypair.publicKey);
    await WalletProvider.storeWalletInCache(keypair.address, targetWallet);
    return {
      status: "success",
      isValid,
      walletAddress: keypair.address,
      walletNumber: currentWalletNumber || 1,
      // Default to 1 if no number found
      message: `Signature validation ${isValid ? "succeeded" : "failed"}.`
    };
  }
};
async function buildValidateSignatureDetails(runtime, message, state) {
  const currentState = state || await runtime.composeState(message);
  const context = composeContext5({
    state: currentState,
    template: validateSignatureTemplate
  });
  const result = await generateObject5({
    runtime,
    context,
    schema: validateSignatureSchema,
    modelClass: ModelClass5.SMALL
  });
  return result.object;
}
var isValidateSignatureContent = (content) => {
  return typeof content === "object" && content !== null && "message" in content && "signature" in content && ("walletNumber" in content && typeof content.walletNumber === "number" || "walletAddress" in content && typeof content.walletAddress === "string");
};
var validateSignature_default = {
  name: "VALIDATE_POLKADOT_SIGNATURE",
  similes: ["VERIFY_SIGNATURE", "CHECK_SIGNATURE", "VALIDATE_SIGNATURE"],
  description: "Validates a signature for a message using a Polkadot wallet. Returns whether the signature is valid.",
  handler: async (runtime, message, state, _options, callback) => {
    elizaLogger8.log("Starting VALIDATE_POLKADOT_SIGNATURE action...");
    const validateSignatureContent = await buildValidateSignatureDetails(
      runtime,
      message,
      state
    );
    if (!isValidateSignatureContent(validateSignatureContent)) {
      if (callback) {
        callback({
          text: "Unable to process validate signature request. Please provide a message, signature, and either a wallet number or wallet address.",
          content: {
            error: "Invalid validate signature request. Missing required parameters."
          }
        });
      }
      return false;
    }
    try {
      elizaLogger8.debug("validateSignatureContent", validateSignatureContent);
      const {
        message: messageToVerify,
        signature,
        walletNumber,
        walletAddress
      } = validateSignatureContent;
      const walletProvider = await initWalletProvider(runtime);
      const validateAction = new ValidateAction(walletProvider);
      const result = await validateAction.validateSignature(
        messageToVerify,
        signature,
        walletNumber,
        walletAddress
      );
      if (callback) {
        callback({
          text: result.message,
          content: result
        });
      }
      return true;
    } catch (error) {
      elizaLogger8.error("Error validating signature:", error);
      if (callback) {
        callback({
          text: `Error validating signature: ${error.message}`,
          content: { error: error.message }
        });
      }
      return false;
    }
  },
  validate: async (_runtime) => true,
  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "Please verify this signature: 0x1234... for message 'hello world'",
          action: "VALIDATE_POLKADOT_SIGNATURE"
        }
      },
      {
        user: "{{user2}}",
        content: {
          text: "Signature is valid for address 5GrwvaEF5zXb26FfGZWvt2fBvXN1Jz2yXzL9Vvns8wQMXwXb"
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "Check if signature 0x5678... is valid for message 'test' using wallet #1",
          action: "VALIDATE_POLKADOT_SIGNATURE"
        }
      },
      {
        user: "{{user2}}",
        content: {
          text: "Signature is valid for address 5GrwvaEF5zXb26FfGZWvt2fBvXN1Jz2yXzL9Vvns8wQMXwXb"
        }
      }
    ]
  ]
};

// src/actions/getBalance.ts
import { elizaLogger as elizaLogger10, ModelClass as ModelClass6, generateObject as generateObject6, composeContext as composeContext6 } from "@elizaos/core";
import { z as z7 } from "zod";
import { formatBalance } from "@polkadot/util";

// src/services/api-service.ts
import { elizaLogger as elizaLogger9 } from "@elizaos/core";
import { ApiPromise, WsProvider } from "@polkadot/api";
import { Service } from "@elizaos/core";
var DEFAULT_NETWORK_CONFIG = {
  DEFAULT_ENDPOINT: "wss://rpc.polkadot.io",
  BACKUP_ENDPOINTS: [
    "wss://polkadot-rpc.dwellir.com",
    "wss://polkadot.api.onfinality.io/public-ws",
    "wss://rpc.ibp.network/polkadot",
    "wss://polkadot-rpc.publicnode.com"
  ],
  MAX_RETRIES: 3,
  RETRY_DELAY: 2e3
};
var PolkadotApiService = class _PolkadotApiService extends Service {
  constructor(runtime) {
    super();
    this.runtime = runtime;
  }
  static serviceType = "polkadot_api";
  capabilityDescription = "The agent is able to interact with the Polkadot API";
  static _instance = null;
  api = null;
  provider = null;
  connecting = false;
  connectionPromise = null;
  lastEndpointIndex = 0;
  networkConfig = { ...DEFAULT_NETWORK_CONFIG };
  static async start(runtime) {
    if (!_PolkadotApiService._instance) {
      _PolkadotApiService._instance = new _PolkadotApiService(runtime);
      await _PolkadotApiService._instance.initialize();
      await _PolkadotApiService._instance.connectWithRetry();
    }
    return _PolkadotApiService._instance;
  }
  async stop() {
    await this.disconnect();
    _PolkadotApiService._instance = null;
  }
  async initialize() {
    const customEndpoint = this.runtime.getSetting(CONFIG_KEYS.POLKADOT_RPC_URL) || process.env.POLKADOT_RPC_URL;
    if (customEndpoint) {
      this.networkConfig.DEFAULT_ENDPOINT = customEndpoint;
      elizaLogger9.debug(`Using custom Polkadot endpoint: ${customEndpoint}`);
    } else {
      elizaLogger9.debug(
        `No custom endpoint found, using default: ${this.networkConfig.DEFAULT_ENDPOINT}`
      );
    }
  }
  /**
   * Get a connection to the Polkadot API
   * If a connection is already established, it will be reused
   * If no connection exists, a new one will be created
   * If a connection is being established, the existing promise will be returned
   */
  async getConnection() {
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
  async connectWithRetry(retryCount = 0) {
    try {
      const endpoint = this.getNextEndpoint();
      elizaLogger9.debug(`Connecting to Polkadot at ${endpoint}`);
      this.provider = new WsProvider(endpoint);
      this.api = await ApiPromise.create({ provider: this.provider });
      elizaLogger9.debug(`Connected to Polkadot at ${endpoint}`);
      return this.api;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      elizaLogger9.error(`Polkadot connection error: ${message}`);
      if (retryCount < this.networkConfig.MAX_RETRIES) {
        const delay = this.networkConfig.RETRY_DELAY * 2 ** retryCount;
        elizaLogger9.debug(`Retrying connection in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.connectWithRetry(retryCount + 1);
      }
      throw new Error(
        `Failed to connect to Polkadot after ${this.networkConfig.MAX_RETRIES} attempts`
      );
    }
  }
  /**
   * Get the next endpoint to try from the configured endpoints
   * This implements a round-robin selection strategy
   */
  getNextEndpoint() {
    const allEndpoints = [
      this.networkConfig.DEFAULT_ENDPOINT,
      ...this.networkConfig.BACKUP_ENDPOINTS
    ];
    this.lastEndpointIndex = this.lastEndpointIndex % allEndpoints.length;
    elizaLogger9.debug(`Next endpoint: ${allEndpoints[this.lastEndpointIndex]}`);
    return allEndpoints[this.lastEndpointIndex];
  }
  /**
   * Disconnect from the Polkadot API
   * This should be called when the application is shutting down
   */
  async disconnect() {
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
  isConnected() {
    return !!this.api && this.api.isConnected;
  }
  /**
   * Get information about the current connection
   * Returns null if no connection is established
   */
  getConnectionInfo() {
    if (!this.provider) {
      return null;
    }
    return {
      endpoint: this.provider.endpoint,
      connected: this.isConnected()
    };
  }
  /**
   * Set custom endpoints for the API connection
   * This allows endpoints to be configured at runtime
   * @param endpoints Array of WebSocket endpoints
   */
  setCustomEndpoints(endpoints) {
    if (!endpoints || endpoints.length === 0) {
      return;
    }
    if (endpoints.some((e) => e.startsWith("wss://") || e.startsWith("ws://"))) {
      Object.defineProperty(this.networkConfig, "DEFAULT_ENDPOINT", {
        value: endpoints[0],
        writable: true
      });
      Object.defineProperty(this.networkConfig, "BACKUP_ENDPOINTS", {
        value: endpoints.slice(1),
        writable: true
      });
      this.lastEndpointIndex = 0;
      elizaLogger9.debug(`Updated Polkadot API endpoints: ${endpoints.join(", ")}`);
    }
  }
};

// src/actions/getBalance.ts
var addressSchema = z7.object({
  address: z7.string().min(1, "Address is required")
});
var addressTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.
  Example response:
  \`\`\`json
  {
    "address": "15JRT5GjLAZkuvmpwmjCUp1RRLr7Y6Gnusz37ia37h2Xn5Rz"
  }
  \`\`\`
  
  {{recentMessages}}

  Respond with a JSON markdown block containing only the extracted values.`;
async function buildGetBalanceDetails(runtime, message, state) {
  const currentState = state || await runtime.composeState(message);
  const context = composeContext6({
    state: currentState,
    template: addressTemplate
  });
  const result = await generateObject6({
    runtime,
    context,
    schema: addressSchema,
    modelClass: ModelClass6.MEDIUM
  });
  const addressData = result.object;
  if (!addressData || !addressData.address) {
    throw new Error("Failed to extract a valid Polkadot address from the message");
  }
  return { content: addressData };
}
var GetBalanceAction = class {
  runtime;
  constructor(runtime) {
    this.runtime = runtime;
  }
  async getBalance(params) {
    try {
      elizaLogger10.debug("Initializing getBalance for address:", params.address);
      const apiService = await PolkadotApiService.start(this.runtime);
      const api = await apiService.getConnection();
      elizaLogger10.debug("API connection established");
      const accountInfo = await api.query.system.account(params.address);
      elizaLogger10.debug("Account info retrieved:", accountInfo.toHuman());
      const balance = accountInfo.toJSON();
      const properties = await api.rpc.system.properties();
      elizaLogger10.debug("Chain properties retrieved:", properties.toHuman());
      const tokenSymbol = properties.tokenSymbol.unwrap()[0].toString();
      const tokenDecimals = properties.tokenDecimals.unwrap()[0].toNumber();
      elizaLogger10.debug("Token details:", { tokenSymbol, tokenDecimals });
      formatBalance.setDefaults({
        decimals: tokenDecimals,
        unit: tokenSymbol
      });
      const freeBalance = balance.data.free.toString();
      const reservedBalance = balance.data.reserved.toString();
      const totalBalance = (BigInt(balance.data.free) + BigInt(balance.data.reserved)).toString();
      elizaLogger10.debug("Balance calculations completed:", {
        freeBalance,
        reservedBalance,
        totalBalance
      });
      const formattedFreeBalance = formatBalance(balance.data.free);
      const formattedReservedBalance = formatBalance(balance.data.reserved);
      const formattedTotalBalance = formatBalance(
        BigInt(balance.data.free) + BigInt(balance.data.reserved)
      );
      elizaLogger10.debug("Formatted balances:", {
        formattedFreeBalance,
        formattedReservedBalance,
        formattedTotalBalance
      });
      return {
        address: params.address,
        freeBalance,
        reservedBalance,
        totalBalance,
        formattedFreeBalance,
        formattedReservedBalance,
        formattedTotalBalance,
        tokenSymbol,
        tokenDecimals
      };
    } catch (error) {
      elizaLogger10.error(`Error fetching balance for address ${params.address}:`, error);
      throw new Error(`Failed to retrieve balance: ${error.message}`);
    }
  }
};
var getBalance_default = {
  name: "GET_POLKADOT_BALANCE",
  similes: ["CHECK_POLKADOT_BALANCE", "VIEW_POLKADOT_BALANCE", "POLKADOT_BALANCE"],
  description: "Retrieves the balance information for a Polkadot address, including free, reserved, and total balances.",
  handler: async (runtime, message, state, _options, callback) => {
    elizaLogger10.log("Starting GET_POLKADOT_BALANCE action...");
    try {
      const { content: getBalanceContent } = await buildGetBalanceDetails(
        runtime,
        message,
        state
      );
      elizaLogger10.debug("getBalanceContent", getBalanceContent);
      if (!getBalanceContent || typeof getBalanceContent.address !== "string") {
        elizaLogger10.error("Failed to obtain a valid address.");
        if (callback) {
          callback({
            text: "I couldn't process your balance request. Please provide a valid Polkadot address.",
            content: { error: "Invalid address format or missing address." }
          });
        }
        return false;
      }
      const action = new GetBalanceAction(runtime);
      const balanceInfo = await action.getBalance({
        address: getBalanceContent.address
      });
      const userMessageText = `
Balance Information for: ${balanceInfo.address}

Free Balance: ${balanceInfo.formattedFreeBalance}
Reserved Balance: ${balanceInfo.formattedReservedBalance}
Total Balance: ${balanceInfo.formattedTotalBalance}

Note: Free balance is the amount available for transfers and transactions. Reserved balance is locked for various on-chain activities.`;
      const result = {
        status: "success",
        address: balanceInfo.address,
        freeBalance: balanceInfo.freeBalance,
        reservedBalance: balanceInfo.reservedBalance,
        totalBalance: balanceInfo.totalBalance,
        formattedFreeBalance: balanceInfo.formattedFreeBalance,
        formattedReservedBalance: balanceInfo.formattedReservedBalance,
        formattedTotalBalance: balanceInfo.formattedTotalBalance,
        tokenSymbol: balanceInfo.tokenSymbol,
        tokenDecimals: balanceInfo.tokenDecimals
      };
      if (callback) {
        callback({
          text: userMessageText,
          content: result
        });
      }
      return true;
    } catch (error) {
      elizaLogger10.error("Error retrieving balance:", error);
      if (callback) {
        callback({
          text: `Error retrieving balance: ${error.message}`,
          content: { error: error.message }
        });
      }
      return false;
    }
  },
  validate: async (_runtime) => true,
  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "What is the balance of 15JRT5GjLAZkuvmpwmjCUp1RRLr7Y6Gnusz37ia37h2Xn5Rz?",
          action: "GET_POLKADOT_BALANCE"
        }
      },
      {
        user: "{{user1}}",
        content: {
          text: "Balance Information for: 15JRT5GjLAZkuvmpwmjCUp1RRLr7Y6Gnusz37ia37h2Xn5Rz\n\nFree Balance: 10.5000 DOT\nReserved Balance: 0.0000 DOT\nTotal Balance: 10.5000 DOT\n\nNote: Free balance is the amount available for transfers and transactions. Reserved balance is locked for various on-chain activities."
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "Check the DOT balance in this address: 15JRT5GjLAZkuvmpwmjCUp1RRLr7Y6Gnusz37ia37h2Xn5Rz",
          action: "GET_POLKADOT_BALANCE"
        }
      },
      {
        user: "{{user1}}",
        content: {
          text: "Balance Information for: 15JRT5GjLAZkuvmpwmjCUp1RRLr7Y6Gnusz37ia37h2Xn5Rz\n\nFree Balance: 10.5000 DOT\nReserved Balance: 0.0000 DOT\nTotal Balance: 10.5000 DOT\n\nNote: Free balance is the amount available for transfers and transactions. Reserved balance is locked for various on-chain activities."
        }
      }
    ]
  ]
};

// src/actions/getBlockInfo.ts
import { elizaLogger as elizaLogger11, ModelClass as ModelClass7, generateObject as generateObject7, composeContext as composeContext7 } from "@elizaos/core";
import { z as z8 } from "zod";
var blockInfoSchema = z8.object({
  blockNumberOrHash: z8.string().min(1, "Block number or hash is required")
});
var blockInfoTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.
  Example response:
  \`\`\`json
  {
    "blockNumberOrHash": "12345678" 
  }
  \`\`\`
  or
  \`\`\`json
  {
    "blockNumberOrHash": "0x1a2b3c4d5e6f..."
  }
  \`\`\`
  
  {{recentMessages}}

  Respond with a JSON markdown block containing only the extracted values.`;
async function buildGetBlockInfoDetails(runtime, message, state) {
  const currentState = state || await runtime.composeState(message);
  const context = composeContext7({
    state: currentState,
    template: blockInfoTemplate
  });
  const result = await generateObject7({
    runtime,
    context,
    schema: blockInfoSchema,
    modelClass: ModelClass7.MEDIUM
  });
  const blockData = result.object;
  if (!blockData || !blockData.blockNumberOrHash) {
    throw new Error("Failed to extract a valid block number or hash from the message");
  }
  return { content: blockData };
}
function formatTimestamp(timestamp) {
  if (timestamp === "Unknown") {
    return "Unknown";
  }
  try {
    const date = new Date(timestamp);
    return `${date.toISOString().replace("T", " ").slice(0, 19)} UTC`;
  } catch {
    return timestamp;
  }
}
var GetBlockInfoAction = class {
  runtime;
  constructor(runtime) {
    this.runtime = runtime;
  }
  async getBlockInfo(params) {
    try {
      const apiService = await PolkadotApiService.start(this.runtime);
      const api = await apiService.getConnection();
      let blockHash;
      if (params.blockNumberOrHash.startsWith("0x")) {
        blockHash = params.blockNumberOrHash;
      } else {
        const hashResult = await api.rpc.chain.getBlockHash(
          parseInt(params.blockNumberOrHash)
        );
        blockHash = hashResult.toString();
      }
      const [blockResult, eventsResult, timestampResult] = await Promise.allSettled([
        api.rpc.chain.getBlock(blockHash),
        api.query.system.events.at(blockHash),
        api.query.timestamp?.now ? api.query.timestamp.now.at(blockHash) : Promise.resolve(null)
      ]);
      if (blockResult.status === "rejected") {
        throw blockResult.reason;
      }
      if (eventsResult.status === "rejected") {
        throw eventsResult.reason;
      }
      const signedBlock = blockResult.value;
      const eventsRaw = eventsResult.value;
      const timestamp = timestampResult.status === "fulfilled" ? timestampResult.value : null;
      const block = signedBlock.block;
      const blockNumber = block.header.number.toString();
      const events = eventsRaw.toJSON();
      const blockInfo = {
        number: blockNumber,
        hash: blockHash.toString(),
        parentHash: block.header.parentHash.toString(),
        stateRoot: block.header.stateRoot.toString(),
        extrinsicsRoot: block.header.extrinsicsRoot.toString(),
        timestamp: timestamp !== null && timestamp !== void 0 ? new Date(
          timestamp.toNumber()
        ).toISOString() : "Unknown",
        extrinsicsCount: block.extrinsics.toArray().length,
        // Convert to array first
        eventsCount: Array.isArray(events) ? events.length : 0
      };
      return blockInfo;
    } catch (error) {
      elizaLogger11.error(`Error fetching block info for ${params.blockNumberOrHash}:`, error);
      throw new Error(`Failed to retrieve block info: ${error.message}`);
    }
  }
};
var getBlockInfo_default = {
  name: "GET_BLOCK_INFO",
  similes: ["VIEW_BLOCK_INFO", "BLOCK_DETAILS", "POLKADOT_BLOCK_INFO"],
  description: "Retrieves detailed information about a Polkadot block by its number or hash.",
  handler: async (runtime, message, state, _options, callback) => {
    elizaLogger11.log("Starting GET_BLOCK_INFO action...");
    try {
      const { content: getBlockInfoContent } = await buildGetBlockInfoDetails(
        runtime,
        message,
        state
      );
      elizaLogger11.debug("getBlockInfoContent", getBlockInfoContent);
      if (!getBlockInfoContent || typeof getBlockInfoContent.blockNumberOrHash !== "string") {
        elizaLogger11.error("Failed to obtain a valid block number or hash.");
        if (callback) {
          callback({
            text: "I couldn't process your block info request. Please provide a valid block number or hash.",
            content: { error: "Invalid block number or hash format." }
          });
        }
        return false;
      }
      const action = new GetBlockInfoAction(runtime);
      const blockInfo = await action.getBlockInfo({
        blockNumberOrHash: getBlockInfoContent.blockNumberOrHash
      });
      const timeInfo = blockInfo.timestamp !== "Unknown" ? `
\u23F0 Time: ${formatTimestamp(blockInfo.timestamp)}` : "";
      const userMessageText = `
\u{1F4E6} Block ${blockInfo.number} Information

Basic Details:
\u2022 Number: ${blockInfo.number}
\u2022 Hash: ${blockInfo.hash}
\u2022 Parent: ${blockInfo.parentHash}${timeInfo}

Merkle Roots:
\u2022 State Root: ${blockInfo.stateRoot}
\u2022 Extrinsics Root: ${blockInfo.extrinsicsRoot}

Block Content:
\u2022 \u{1F4CB} Extrinsics: ${blockInfo.extrinsicsCount}
\u2022 \u{1F4DD} Events: ${blockInfo.eventsCount}

\u{1F4CA} This block processed ${blockInfo.extrinsicsCount} transaction${blockInfo.extrinsicsCount === 1 ? "" : "s"} and generated ${blockInfo.eventsCount} event${blockInfo.eventsCount === 1 ? "" : "s"}.`;
      const result = {
        status: "success",
        number: blockInfo.number,
        hash: blockInfo.hash,
        parentHash: blockInfo.parentHash,
        stateRoot: blockInfo.stateRoot,
        extrinsicsRoot: blockInfo.extrinsicsRoot,
        timestamp: blockInfo.timestamp,
        extrinsicsCount: blockInfo.extrinsicsCount,
        eventsCount: blockInfo.eventsCount
      };
      if (callback) {
        callback({
          text: userMessageText,
          content: result
        });
      }
      return true;
    } catch (error) {
      elizaLogger11.error("Error retrieving block info:", error);
      if (callback) {
        callback({
          text: `Error retrieving block info: ${error.message}`,
          content: { error: error.message }
        });
      }
      return false;
    }
  },
  validate: async (_runtime) => true,
  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "What's the information for block 12345678?",
          action: "GET_BLOCK_INFO"
        }
      },
      {
        user: "{{user1}}",
        content: {
          text: "\u{1F4E6} Block 12345678 Information\n\nBasic Details:\n\u2022 Number: 12345678\n\u2022 Hash: 0x8d7c0cce1768da5c...\n\u2022 Parent: 0x557be0d61c75e187...\n\u23F0 Time: 2023-06-15 12:34:56 UTC\n\nMerkle Roots:\n\u2022 State Root: 0x7b8f01096c356d77...\n\u2022 Extrinsics Root: 0x8a65db1f6cc5a7e5...\n\nBlock Content:\n\u2022 \u{1F4CB} Extrinsics: 3\n\u2022 \u{1F4DD} Events: 8\n\n\u{1F4CA} This block processed 3 transactions and generated 8 events."
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "Show me the details of block 0x8d7c0cce1768da5c1725def400ce1a337369cbba4c4844d6f9b8bab255c9bb07",
          action: "GET_BLOCK_INFO"
        }
      },
      {
        user: "{{user1}}",
        content: {
          text: "\u{1F4E6} Block 12345678 Information\n\nBasic Details:\n\u2022 Number: 12345678\n\u2022 Hash: 0x8d7c0cce1768da5c...\n\u2022 Parent: 0x557be0d61c75e187...\n\u23F0 Time: 2023-06-15 12:34:56 UTC\n\nMerkle Roots:\n\u2022 State Root: 0x7b8f01096c356d77...\n\u2022 Extrinsics Root: 0x8a65db1f6cc5a7e5...\n\nBlock Content:\n\u2022 \u{1F4CB} Extrinsics: 3\n\u2022 \u{1F4DD} Events: 8\n\n\u{1F4CA} This block processed 3 transactions and generated 8 events."
        }
      }
    ]
  ]
};

// src/actions/getBlockEvents.ts
import { elizaLogger as elizaLogger12, ModelClass as ModelClass8, generateObject as generateObject8, composeContext as composeContext8 } from "@elizaos/core";
import { z as z9 } from "zod";
var blockEventsSchema = z9.object({
  blockNumberOrHash: z9.string().min(1, "Block number or hash is required"),
  filterModule: z9.string().optional().nullable().transform((val) => val === "null" || val === null ? void 0 : val),
  limit: z9.union([z9.number(), z9.string()]).optional().nullable().transform((val) => {
    if (val === "null" || val === null || val === void 0) return void 0;
    const num = typeof val === "string" ? parseInt(val) : val;
    return Number.isNaN(num) ? void 0 : Math.min(Math.max(num, 1), 1e3);
  })
});
var blockEventsTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.
  
  Extract the block number or hash from the message. Optionally extract a module filter (like "balances", "system", "staking") and a limit for the number of events.
  
  IMPORTANT: 
  - For filterModule: use the actual module name if specified, or omit the field entirely if not mentioned
  - For limit: use the actual number if specified, or omit the field entirely if not mentioned
  - Do NOT use the string "null" - either include the field with a value or omit it entirely
  
  Example response:
  \`\`\`json
  {
    "blockNumberOrHash": "12345678",
    "filterModule": "balances",
    "limit": 50
  }
  \`\`\`
  or
  \`\`\`json
  {
    "blockNumberOrHash": "0x1a2b3c4d5e6f..."
  }
  \`\`\`
  or 
  \`\`\`json
  {
    "blockNumberOrHash": "12345678",
    "limit": 10
  }
  \`\`\`
  
  {{recentMessages}}

  Respond with a JSON markdown block containing only the extracted values.`;
async function buildGetBlockEventsDetails(runtime, message, state) {
  const currentState = state || await runtime.composeState(message);
  const context = composeContext8({
    state: currentState,
    template: blockEventsTemplate
  });
  const result = await generateObject8({
    runtime,
    context,
    schema: blockEventsSchema,
    modelClass: ModelClass8.MEDIUM
  });
  const blockEventsData = result.object;
  if (!blockEventsData || !blockEventsData.blockNumberOrHash) {
    throw new Error("Failed to extract a valid block number or hash from the message");
  }
  return { content: blockEventsData };
}
function createEventSummary(section, method, data) {
  const eventKey = `${section}.${method}`;
  switch (eventKey) {
    case "balances.Transfer":
      if (data.length >= 3) {
        return `${data[0]} \u2192 ${data[1]} (${data[2]} units)`;
      }
      break;
    case "balances.Deposit":
      if (data.length >= 2) {
        return `${data[0]} (+${data[1]} units)`;
      }
      break;
    case "system.ExtrinsicSuccess":
      return "Extrinsic executed successfully";
    case "system.ExtrinsicFailed":
      return "Extrinsic failed";
    case "staking.Reward":
      if (data.length >= 2) {
        return `${data[0]} rewarded ${data[1]} units`;
      }
      break;
    case "democracy.Proposed":
      return "New proposal created";
    case "democracy.Voted":
      return "Vote cast";
    case "treasury.Deposit":
      if (data.length >= 1) {
        return `Treasury deposit: ${data[0]} units`;
      }
      break;
    default:
      if (data.length === 0) {
        return "No data";
      }
      if (data.length === 1) {
        return "1 data item";
      }
      return `${data.length} data items`;
  }
  return data.length === 0 ? "No data" : `${data.length} data items`;
}
var GetBlockEventsAction = class {
  runtime;
  constructor(runtime) {
    this.runtime = runtime;
  }
  async getBlockEvents(params) {
    try {
      const apiService = await PolkadotApiService.start(this.runtime);
      const api = await apiService.getConnection();
      let blockHash;
      let blockNumber;
      if (params.blockNumberOrHash.startsWith("0x")) {
        blockHash = params.blockNumberOrHash;
        const header = await api.rpc.chain.getHeader(blockHash);
        blockNumber = header.number.toString();
      } else {
        blockNumber = params.blockNumberOrHash;
        blockHash = (await api.rpc.chain.getBlockHash(parseInt(blockNumber))).toString();
      }
      const eventsAtBlock = await api.query.system.events.at(blockHash);
      const eventsArray = Array.from(eventsAtBlock);
      let processedEvents = eventsArray.map(
        (eventRecord, index) => {
          const event = eventRecord.event;
          const phase = eventRecord.phase;
          const section = event.section.toString();
          const method = event.method.toString();
          const data = event.data.toJSON();
          let phaseDesc = "Unknown";
          try {
            if (phase.isApplyExtrinsic) {
              phaseDesc = `Extrinsic ${phase.asApplyExtrinsic?.toString() || "Unknown"}`;
            } else if (phase.isFinalization) {
              phaseDesc = "Finalization";
            } else if (phase.isInitialization) {
              phaseDesc = "Initialization";
            } else {
              phaseDesc = phase.type || "Unknown";
            }
          } catch {
            phaseDesc = "Unknown";
          }
          const summary = createEventSummary(section, method, data);
          return {
            index,
            section,
            method,
            dataCount: data.length,
            phase: phaseDesc,
            summary
          };
        }
      );
      const totalEvents = processedEvents.length;
      if (params.filterModule) {
        processedEvents = processedEvents.filter(
          (event) => event.section.toLowerCase() === params.filterModule?.toLowerCase()
        );
      }
      const filteredEvents = processedEvents.length;
      if (params.limit && params.limit < processedEvents.length) {
        processedEvents = processedEvents.slice(0, params.limit);
      }
      return {
        blockNumber,
        blockHash: blockHash.toString(),
        totalEvents,
        filteredEvents,
        events: processedEvents,
        filterApplied: params.filterModule,
        limitApplied: params.limit
      };
    } catch (error) {
      elizaLogger12.error(
        `Error fetching events for block ${params.blockNumberOrHash}:`,
        error
      );
      throw new Error(`Failed to retrieve block events: ${error.message}`);
    }
  }
};
var getBlockEvents_default = {
  name: "GET_BLOCK_EVENTS",
  similes: ["VIEW_BLOCK_EVENTS", "BLOCK_EVENTS", "POLKADOT_EVENTS", "GET_EVENTS"],
  description: "Retrieves all events that occurred in a specific Polkadot block, with optional filtering by module and limiting.",
  handler: async (runtime, message, state, _options, callback) => {
    elizaLogger12.log("Starting GET_BLOCK_EVENTS action...");
    try {
      const { content: getBlockEventsContent } = await buildGetBlockEventsDetails(
        runtime,
        message,
        state
      );
      elizaLogger12.debug("getBlockEventsContent", getBlockEventsContent);
      if (!getBlockEventsContent || typeof getBlockEventsContent.blockNumberOrHash !== "string") {
        elizaLogger12.error("Failed to obtain a valid block number or hash.");
        if (callback) {
          callback({
            text: "I couldn't process your block events request. Please provide a valid block number or hash.",
            content: { error: "Invalid block number or hash format." }
          });
        }
        return false;
      }
      const action = new GetBlockEventsAction(runtime);
      const eventsInfo = await action.getBlockEvents({
        blockNumberOrHash: getBlockEventsContent.blockNumberOrHash,
        filterModule: getBlockEventsContent.filterModule,
        limit: getBlockEventsContent.limit
      });
      const eventsDisplay = eventsInfo.events.map((event, idx) => {
        return `${idx + 1}. ${event.section}.${event.method} (${event.phase})
   \u2514\u2500 ${event.summary}`;
      }).join("\n");
      const showingText = eventsInfo.events.length < eventsInfo.filteredEvents ? ` (showing first ${eventsInfo.events.length})` : "";
      const filterText = eventsInfo.filterApplied ? `
Filter: ${eventsInfo.filterApplied} module events only` : "";
      const moreEventsText = eventsInfo.events.length < eventsInfo.filteredEvents ? `

\u{1F4CB} ${eventsInfo.filteredEvents - eventsInfo.events.length} more events available. Use a higher limit to see more.` : "";
      const userMessageText = `
\u{1F4E6} Block Events for Block ${eventsInfo.blockNumber}
Hash: ${eventsInfo.blockHash.slice(0, 20)}...

Summary:
\u2022 Total Events: ${eventsInfo.totalEvents}
\u2022 Filtered Events: ${eventsInfo.filteredEvents}${showingText}${filterText}

${eventsInfo.events.length > 0 ? `Events:
${eventsDisplay}${moreEventsText}` : "\u274C No events found with the applied filters."}`;
      const result = {
        status: "success",
        blockNumber: eventsInfo.blockNumber,
        blockHash: eventsInfo.blockHash,
        totalEvents: eventsInfo.totalEvents,
        filteredEvents: eventsInfo.filteredEvents,
        events: eventsInfo.events,
        filterApplied: eventsInfo.filterApplied,
        limitApplied: eventsInfo.limitApplied
      };
      if (callback) {
        callback({
          text: userMessageText,
          content: result
        });
      }
      return true;
    } catch (error) {
      elizaLogger12.error("Error retrieving block events:", error);
      if (callback) {
        callback({
          text: `Error retrieving block events: ${error.message}`,
          content: { error: error.message }
        });
      }
      return false;
    }
  },
  validate: async (_runtime) => true,
  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "What events happened in block 12345678?",
          action: "GET_BLOCK_EVENTS"
        }
      },
      {
        user: "{{user1}}",
        content: {
          text: "\u{1F4E6} Block Events for Block 12345678\nHash: 0x8d7c0cce1768da5c...\n\nSummary:\n\u2022 Total Events: 8\n\u2022 Filtered Events: 8 (showing first 5)\n\nEvents:\n1. system.ExtrinsicSuccess (Extrinsic 1)\n   \u2514\u2500 Extrinsic executed successfully\n\n2. balances.Transfer (Extrinsic 2)\n   \u2514\u2500 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY \u2192 5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty (10000000000 units)\n\n3. system.ExtrinsicSuccess (Extrinsic 2)\n   \u2514\u2500 Extrinsic executed successfully\n\n4. treasury.Deposit (Finalization)\n   \u2514\u2500 Treasury deposit: 1000000000 units\n\n5. balances.Deposit (Finalization)\n   \u2514\u2500 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY (+500000000 units)\n\n\u{1F4CB} 3 more events available. Use a higher limit to see more."
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "Show me only the balances events from block 0x8d7c0cce1768da5c1725def400ce1a337369cbba4c4844d6f9b8bab255c9bb07",
          action: "GET_BLOCK_EVENTS"
        }
      },
      {
        user: "{{user1}}",
        content: {
          text: "\u{1F4E6} Block Events for Block 12345678\nHash: 0x8d7c0cce1768da5c...\n\nSummary:\n\u2022 Total Events: 8\n\u2022 Filtered Events: 3\nFilter: balances module events only\n\nEvents:\n1. balances.Transfer (Extrinsic 2)\n   \u2514\u2500 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY \u2192 5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty (10000000000 units)\n\n2. balances.Deposit (Finalization)\n   \u2514\u2500 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY (+500000000 units)\n\n3. balances.Reserved (Finalization)\n   \u2514\u2500 2 data items"
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "Get the first 3 events from block 12345678",
          action: "GET_BLOCK_EVENTS"
        }
      },
      {
        user: "{{user1}}",
        content: {
          text: "\u{1F4E6} Block Events for Block 12345678\nHash: 0x8d7c0cce1768da5c...\n\nSummary:\n\u2022 Total Events: 8\n\u2022 Filtered Events: 8 (showing first 3)\n\nEvents:\n1. system.ExtrinsicSuccess (Extrinsic 1)\n   \u2514\u2500 Extrinsic executed successfully\n\n2. balances.Transfer (Extrinsic 2)\n   \u2514\u2500 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY \u2192 5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty (10000000000 units)\n\n3. system.ExtrinsicSuccess (Extrinsic 2)\n   \u2514\u2500 Extrinsic executed successfully\n\n\u{1F4CB} 5 more events available. Use a higher limit to see more."
        }
      }
    ]
  ]
};

// src/actions/getReferenda.ts
import { elizaLogger as elizaLogger13, ModelClass as ModelClass9, generateObject as generateObject9, composeContext as composeContext9 } from "@elizaos/core";
import { z as z10 } from "zod";
var referendaSchema = z10.object({
  limit: z10.union([z10.number(), z10.string()]).optional().nullable().transform((val) => {
    if (val === "null" || val === null || val === void 0) return void 0;
    const num = typeof val === "string" ? parseInt(val) : val;
    return Number.isNaN(num) ? void 0 : Math.min(Math.max(num, 1), 50);
  })
});
var referendaTemplate = `Respond with a JSON markdown block containing only the extracted values.
  
  Extract the number of referenda the user wants to see from their message.
  Look for numbers like "show me 5 referenda", "get 10 proposals", "last 3 governance items", etc.
  
  If no specific number is mentioned, omit the limit field to use the default.
  Maximum limit is 50.
  
  Example responses:
  \`\`\`json
  {
    "limit": 10
  }
  \`\`\`
  or
  \`\`\`json
  {}
  \`\`\`
  
  {{recentMessages}}

  Respond with a JSON markdown block containing only the extracted values.`;
async function buildGetReferendaDetails(runtime, message, state) {
  const currentState = state || await runtime.composeState(message);
  const context = composeContext9({
    state: currentState,
    template: referendaTemplate
  });
  const result = await generateObject9({
    runtime,
    context,
    schema: referendaSchema,
    modelClass: ModelClass9.MEDIUM
  });
  const referendaData = result.object;
  return { content: referendaData };
}
function getTrackName(trackId) {
  if (trackId === -1) {
    return "unknown";
  }
  const trackNames = {
    0: "root",
    1: "whitelisted_caller",
    10: "staking_admin",
    11: "treasurer",
    12: "lease_admin",
    13: "fellowship_admin",
    14: "general_admin",
    15: "auction_admin",
    20: "referendum_canceller",
    21: "referendum_killer",
    30: "small_tipper",
    31: "big_tipper",
    32: "small_spender",
    33: "medium_spender",
    34: "big_spender"
  };
  return trackNames[trackId] || `track_${trackId}`;
}
function formatReferendumStatus(referendumInfo) {
  if (referendumInfo.ongoing) {
    return "ongoing";
  }
  if (referendumInfo.approved) {
    return "approved";
  }
  if (referendumInfo.rejected) {
    return "rejected";
  }
  if (referendumInfo.cancelled) {
    return "cancelled";
  }
  if (referendumInfo.timedOut) {
    return "timedout";
  }
  if (referendumInfo.killed) {
    return "killed";
  }
  return "unknown";
}
function formatTokenAmount(amount, decimals = 10, symbol = "DOT") {
  const value = BigInt(amount);
  const divisor = BigInt(10 ** decimals);
  const quotient = value / divisor;
  const remainder = value % divisor;
  if (remainder === BigInt(0)) {
    return `${quotient} ${symbol}`;
  }
  const decimal = remainder.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${quotient}.${decimal} ${symbol}`;
}
var GetReferendaAction = class {
  runtime;
  constructor(runtime) {
    this.runtime = runtime;
  }
  async getReferenda(limit = 10) {
    try {
      const apiService = await PolkadotApiService.start(this.runtime);
      const api = await apiService.getConnection();
      const referendumCount = await api.query.referenda.referendumCount();
      const totalCount = parseInt(referendumCount.toString());
      const referenda = [];
      const maxLimit = Math.min(limit, 50);
      for (let i = totalCount - 1; i >= 0 && referenda.length < maxLimit; i--) {
        try {
          const referendumInfo = await api.query.referenda.referendumInfoFor(i);
          const apiResponse = referendumInfo;
          if (apiResponse.isSome) {
            const info = apiResponse.unwrap().toJSON();
            let trackId;
            if (info.ongoing && typeof info.ongoing === "object" && info.ongoing.track !== void 0) {
              trackId = info.ongoing.track;
            } else {
              trackId = -1;
            }
            const status = formatReferendumStatus(info);
            const referendum = {
              id: i,
              trackId,
              trackName: getTrackName(trackId),
              status
            };
            if (info.ongoing) {
              referendum.proposalHash = info.ongoing.proposal?.lookup?.hash || info.ongoing.proposal?.inline || "unknown";
              referendum.submitted = info.ongoing.submitted?.toString();
              if (info.ongoing.submissionDeposit) {
                referendum.submissionDeposit = {
                  who: info.ongoing.submissionDeposit.who,
                  amount: info.ongoing.submissionDeposit.amount?.toString() || "0"
                };
              }
              if (info.ongoing.decisionDeposit) {
                referendum.decisionDeposit = {
                  who: info.ongoing.decisionDeposit.who,
                  amount: info.ongoing.decisionDeposit.amount?.toString() || "0"
                };
              }
              if (info.ongoing.deciding) {
                referendum.deciding = {
                  since: info.ongoing.deciding.since?.toString(),
                  confirming: info.ongoing.deciding.confirming?.toString()
                };
              }
              if (info.ongoing.tally) {
                referendum.tally = {
                  ayes: info.ongoing.tally.ayes?.toString() || "0",
                  nays: info.ongoing.tally.nays?.toString() || "0",
                  support: info.ongoing.tally.support?.toString() || "0"
                };
              }
              if (info.ongoing.alarm) {
                referendum.alarm = info.ongoing.alarm.toString();
              }
            }
            referenda.push(referendum);
          }
        } catch (error) {
          elizaLogger13.debug(`Skipping referendum ${i}: ${error.message}`);
        }
      }
      return {
        totalCount,
        returnedCount: referenda.length,
        referenda
      };
    } catch (error) {
      elizaLogger13.error("Error fetching referenda:", error);
      throw new Error(`Failed to retrieve referenda: ${error.message}`);
    }
  }
};
var getReferenda_default = {
  name: "GET_REFERENDA",
  similes: [
    "VIEW_REFERENDA",
    "POLKADOT_REFERENDA",
    "GET_GOVERNANCE_REFERENDA",
    "GOVERNANCE_PROPOSALS",
    "VIEW_PROPOSALS",
    "SHOW_REFERENDA"
  ],
  description: "Retrieves recent governance referenda from Polkadot's OpenGov system. Shows referendum details including track, status, voting results, and deposits.",
  handler: async (runtime, message, state, _options, callback) => {
    elizaLogger13.log("Starting GET_REFERENDA action...");
    try {
      const { content: getReferendaContent } = await buildGetReferendaDetails(
        runtime,
        message,
        state
      );
      elizaLogger13.debug("getReferendaContent", getReferendaContent);
      const action = new GetReferendaAction(runtime);
      const referendaInfo = await action.getReferenda(getReferendaContent.limit || 10);
      const referendaDisplay = referendaInfo.referenda.map((ref, idx) => {
        let details = `${idx + 1}. Referendum ${ref.id} (${ref.trackName})
   Status: ${ref.status.toUpperCase()}`;
        if (ref.tally) {
          const ayes = formatTokenAmount(ref.tally.ayes, 3);
          const nays = formatTokenAmount(ref.tally.nays, 3);
          details += `
   Votes: ${ayes} AYE, ${nays} NAY`;
        }
        if (ref.deciding) {
          details += `
   Deciding since block: ${ref.deciding.since}`;
          if (ref.deciding.confirming) {
            details += ` (confirming since: ${ref.deciding.confirming})`;
          }
        }
        if (ref.submissionDeposit) {
          const deposit = formatTokenAmount(ref.submissionDeposit.amount, 3);
          details += `
   Deposit: ${deposit} by ${ref.submissionDeposit.who}`;
        }
        return details;
      }).join("\n\n");
      const userMessageText = `
\u{1F3DB}\uFE0F Polkadot Governance Referenda

Summary:
\u2022 Total Referenda: ${referendaInfo.totalCount}
\u2022 Showing: ${referendaInfo.returnedCount}

${referendaInfo.referenda.length > 0 ? `Recent Referenda:
${referendaDisplay}` : "\u274C No referenda found."}

\u{1F4A1} Note: Completed referenda show "unknown" track as this information is not preserved on-chain.`;
      const result = {
        status: "success",
        totalCount: referendaInfo.totalCount,
        returnedCount: referendaInfo.returnedCount,
        referenda: referendaInfo.referenda
      };
      if (callback) {
        callback({
          text: userMessageText,
          content: result
        });
      }
      return true;
    } catch (error) {
      elizaLogger13.error("Error retrieving referenda:", error);
      if (callback) {
        callback({
          text: `Error retrieving referenda: ${error.message}`,
          content: { error: error.message }
        });
      }
      return false;
    }
  },
  validate: async (_runtime) => true,
  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "What are the current governance referenda?",
          action: "GET_REFERENDA"
        }
      },
      {
        user: "{{user1}}",
        content: {
          text: "Here's a list of current ongoing referenda..."
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "Show me the last 5 governance proposals",
          action: "GET_REFERENDA"
        }
      },
      {
        user: "{{user1}}",
        content: {
          text: "Here's a list of the 5 latest referenda..."
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "Get me 20 referenda",
          action: "GET_REFERENDA"
        }
      },
      {
        user: "{{user1}}",
        content: {
          text: "Here's a list of the last 20 referenda..."
        }
      }
    ]
  ]
};

// src/actions/getReferendumDetails.ts
import { elizaLogger as elizaLogger14, ModelClass as ModelClass10, generateObject as generateObject10, composeContext as composeContext10 } from "@elizaos/core";
import { z as z11 } from "zod";
var referendumDetailsSchema = z11.object({
  referendumId: z11.union([z11.number(), z11.string()]).transform((val) => {
    const num = typeof val === "string" ? parseInt(val) : val;
    if (Number.isNaN(num) || num < 0) {
      throw new Error("Invalid referendum ID");
    }
    return num;
  })
});
var referendumDetailsTemplate = `Respond with a JSON markdown block containing only the extracted referendum ID.
  
  Extract the referendum ID number from the user's message. Look for patterns like:
  - "referendum 123"
  - "proposal 456"
  - "ref 789"
  - "referendum #42"
  - "show me referendum 100"
  - "details for 200"
  - just a plain number if the context is about referenda
  
  The referendum ID must be a valid positive number.
  
  Example responses:
  \`\`\`json
  {
    "referendumId": 123
  }
  \`\`\`
  
  {{recentMessages}}

  Respond with a JSON markdown block containing only the referendum ID.`;
async function buildGetReferendumDetailsRequest(runtime, message, state) {
  const currentState = state || await runtime.composeState(message);
  const context = composeContext10({
    state: currentState,
    template: referendumDetailsTemplate
  });
  const result = await generateObject10({
    runtime,
    context,
    schema: referendumDetailsSchema,
    modelClass: ModelClass10.MEDIUM
  });
  const detailsData = result.object;
  return { content: detailsData };
}
function getTrackName2(trackId) {
  if (trackId === -1) {
    return "unknown";
  }
  const trackNames = {
    0: "root",
    1: "whitelisted_caller",
    10: "staking_admin",
    11: "treasurer",
    12: "lease_admin",
    13: "fellowship_admin",
    14: "general_admin",
    15: "auction_admin",
    20: "referendum_canceller",
    21: "referendum_killer",
    30: "small_tipper",
    31: "big_tipper",
    32: "small_spender",
    33: "medium_spender",
    34: "big_spender"
  };
  return trackNames[trackId] || `track_${trackId}`;
}
function formatReferendumStatus2(referendumInfo) {
  if (referendumInfo.ongoing) {
    return "ongoing";
  }
  if (referendumInfo.approved) {
    return "approved";
  }
  if (referendumInfo.rejected) {
    return "rejected";
  }
  if (referendumInfo.cancelled) {
    return "cancelled";
  }
  if (referendumInfo.timedOut) {
    return "timedout";
  }
  if (referendumInfo.killed) {
    return "killed";
  }
  return "unknown";
}
function formatTokenAmount2(amount, decimals = 10, symbol = "DOT") {
  const value = BigInt(amount);
  const divisor = BigInt(10 ** decimals);
  const quotient = value / divisor;
  const remainder = value % divisor;
  if (remainder === BigInt(0)) {
    return `${quotient} ${symbol}`;
  }
  const decimal = remainder.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${quotient}.${decimal} ${symbol}`;
}
var GetReferendumDetailsAction = class {
  runtime;
  constructor(runtime) {
    this.runtime = runtime;
  }
  async getReferendumDetails(referendumId) {
    try {
      const apiService = await PolkadotApiService.start(this.runtime);
      const api = await apiService.getConnection();
      const referendumCount = await api.query.referenda.referendumCount();
      const totalCount = parseInt(referendumCount.toString());
      if (referendumId >= totalCount) {
        throw new Error(
          `Referendum ${referendumId} does not exist. Latest referendum is ${totalCount - 1}.`
        );
      }
      const referendumInfo = await api.query.referenda.referendumInfoFor(referendumId);
      const typedReferendumInfo = referendumInfo;
      if (!typedReferendumInfo.isSome) {
        throw new Error(`Referendum ${referendumId} not found or has no data.`);
      }
      const info = typedReferendumInfo.unwrap().toJSON();
      elizaLogger14.info(info);
      let trackId;
      if (info.ongoing && typeof info.ongoing === "object" && info.ongoing.track !== void 0) {
        trackId = info.ongoing.track;
      } else {
        trackId = -1;
      }
      const status = formatReferendumStatus2(info);
      const referendum = {
        id: referendumId,
        trackId,
        trackName: getTrackName2(trackId),
        status
      };
      if (info.ongoing) {
        referendum.proposalHash = info.ongoing.proposal?.lookup?.hash || info.ongoing.proposal?.inline || "unknown";
        referendum.proposalLength = info.ongoing.proposal?.lookup?.len;
        referendum.origin = info.ongoing.origin?.origins || "unknown";
        referendum.enactmentDelay = info.ongoing.enactment?.after;
        referendum.submitted = info.ongoing.submitted?.toString();
        if (info.ongoing.submissionDeposit) {
          referendum.submissionDeposit = {
            who: info.ongoing.submissionDeposit.who,
            amount: info.ongoing.submissionDeposit.amount?.toString() || "0",
            formattedAmount: formatTokenAmount2(
              info.ongoing.submissionDeposit.amount?.toString() || "0"
            )
          };
        }
        if (info.ongoing.decisionDeposit) {
          referendum.decisionDeposit = {
            who: info.ongoing.decisionDeposit.who,
            amount: info.ongoing.decisionDeposit.amount?.toString() || "0",
            formattedAmount: formatTokenAmount2(
              info.ongoing.decisionDeposit.amount?.toString() || "0"
            )
          };
        }
        if (info.ongoing.deciding) {
          referendum.deciding = {
            since: info.ongoing.deciding.since?.toString(),
            confirming: info.ongoing.deciding.confirming?.toString()
          };
        }
        if (info.ongoing.tally) {
          referendum.tally = {
            ayes: info.ongoing.tally.ayes?.toString() || "0",
            nays: info.ongoing.tally.nays?.toString() || "0",
            support: info.ongoing.tally.support?.toString() || "0",
            formattedAyes: formatTokenAmount2(
              info.ongoing.tally.ayes?.toString() || "0"
            ),
            formattedNays: formatTokenAmount2(
              info.ongoing.tally.nays?.toString() || "0"
            ),
            formattedSupport: formatTokenAmount2(
              info.ongoing.tally.support?.toString() || "0"
            )
          };
        }
        referendum.inQueue = info.ongoing.inQueue || false;
        if (info.ongoing.alarm) {
          referendum.alarm = Array.isArray(info.ongoing.alarm) ? info.ongoing.alarm.map((a) => a.toString()) : [info.ongoing.alarm.toString()];
        }
      } else {
        if (info.approved && Array.isArray(info.approved) && info.approved[0]) {
          referendum.completionBlock = info.approved[0].toString();
        } else if (info.rejected && Array.isArray(info.rejected) && info.rejected[0]) {
          referendum.completionBlock = info.rejected[0].toString();
        } else if (info.cancelled && Array.isArray(info.cancelled) && info.cancelled[0]) {
          referendum.completionBlock = info.cancelled[0].toString();
        } else if (info.timedOut && Array.isArray(info.timedOut) && info.timedOut[0]) {
          referendum.completionBlock = info.timedOut[0].toString();
        } else if (info.killed && Array.isArray(info.killed) && info.killed[0]) {
          referendum.completionBlock = info.killed[0].toString();
        }
      }
      return referendum;
    } catch (error) {
      elizaLogger14.error(`Error fetching referendum ${referendumId}:`, error);
      throw new Error(`Failed to retrieve referendum ${referendumId}: ${error.message}`);
    }
  }
};
var getReferendumDetails_default = {
  name: "GET_REFERENDUM_DETAILS",
  similes: [
    "VIEW_REFERENDUM_DETAILS",
    "REFERENDUM_INFO",
    "GET_REFERENDUM_INFO",
    "SHOW_REFERENDUM",
    "REFERENDUM_DETAILS",
    "PROPOSAL_DETAILS"
  ],
  description: "Retrieves detailed information about a specific governance referendum from Polkadot's OpenGov system by referendum ID.",
  handler: async (runtime, message, state, _options, callback) => {
    elizaLogger14.log("Starting GET_REFERENDUM_DETAILS action...");
    try {
      const { content: detailsContent } = await buildGetReferendumDetailsRequest(
        runtime,
        message,
        state
      );
      elizaLogger14.debug("detailsContent", detailsContent);
      const action = new GetReferendumDetailsAction(runtime);
      const referendum = await action.getReferendumDetails(detailsContent.referendumId);
      let userMessageText = `
\u{1F3DB}\uFE0F Referendum ${referendum.id} Details

Overview:
\u2022 Track: ${referendum.trackName} (${referendum.trackId === -1 ? "track info not preserved" : `ID: ${referendum.trackId}`})
\u2022 Status: ${referendum.status.toUpperCase()}`;
      if (referendum.origin) {
        userMessageText += `
\u2022 Origin: ${referendum.origin}`;
      }
      if (referendum.completionBlock) {
        userMessageText += `
\u2022 Completed at block: ${referendum.completionBlock}`;
      }
      if (referendum.proposalHash) {
        userMessageText += `

Proposal:
\u2022 Hash: ${referendum.proposalHash}`;
        if (referendum.proposalLength) {
          userMessageText += `
\u2022 Length: ${referendum.proposalLength} bytes`;
        }
        if (referendum.enactmentDelay) {
          userMessageText += `
\u2022 Enactment delay: ${referendum.enactmentDelay} blocks`;
        }
      }
      if (referendum.submitted) {
        userMessageText += `

Timeline:
\u2022 Submitted at block: ${referendum.submitted}`;
        if (referendum.deciding) {
          userMessageText += `
\u2022 Deciding since block: ${referendum.deciding.since}`;
          if (referendum.deciding.confirming) {
            userMessageText += `
\u2022 Confirming since block: ${referendum.deciding.confirming}`;
          }
        }
      }
      if (referendum.tally) {
        const ayesPercent = referendum.tally.ayes !== "0" && referendum.tally.nays !== "0" ? (BigInt(referendum.tally.ayes) * BigInt(100) / (BigInt(referendum.tally.ayes) + BigInt(referendum.tally.nays))).toString() : "N/A";
        userMessageText += `

\u{1F5F3}\uFE0F Voting Results:
\u2022 Ayes: ${referendum.tally.formattedAyes}`;
        if (ayesPercent !== "N/A") {
          userMessageText += ` (${ayesPercent}%)`;
        }
        userMessageText += `
\u2022 Nays: ${referendum.tally.formattedNays}
\u2022 Support: ${referendum.tally.formattedSupport}`;
      }
      if (referendum.submissionDeposit || referendum.decisionDeposit) {
        userMessageText += `

Deposits:`;
        if (referendum.submissionDeposit) {
          userMessageText += `
\u2022 Submission: ${referendum.submissionDeposit.formattedAmount} by ${referendum.submissionDeposit.who}`;
        }
        if (referendum.decisionDeposit) {
          userMessageText += `
\u2022 Decision: ${referendum.decisionDeposit.formattedAmount} by ${referendum.decisionDeposit.who}`;
        }
      }
      if (referendum.alarm) {
        userMessageText += `

\u23F0 Alarm: Set for block ${referendum.alarm[0]}`;
      }
      if (referendum.inQueue !== void 0) {
        userMessageText += `

Queue Status: ${referendum.inQueue ? "In queue" : "Not in queue"}`;
      }
      const result = {
        status: "success",
        referendum
      };
      if (callback) {
        callback({
          text: userMessageText,
          content: result
        });
      }
      return true;
    } catch (error) {
      elizaLogger14.error("Error retrieving referendum details:", error);
      if (callback) {
        callback({
          text: `Error retrieving referendum details: ${error.message}`,
          content: { error: error.message }
        });
      }
      return false;
    }
  },
  validate: async (_runtime) => true,
  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "Show me details for referendum 586",
          action: "GET_REFERENDUM_DETAILS"
        }
      },
      {
        user: "{{user1}}",
        content: {
          text: "\u{1F3DB}\uFE0F Referendum 586 Details\n\nOverview:\n\u2022 Track: medium_spender (ID: 33)\n\u2022 Status: ONGOING\n\u2022 Origin: MediumSpender\n\nProposal:\n\u2022 Hash: 0xad649d315fe4c18ce3f9b9c09c698c0c860508cb3bcccdbce5adede355a26850\n\u2022 Length: 60 bytes\n\u2022 Enactment delay: 100 blocks\n\nTimeline:\n\u2022 Submitted at block: 26316166\n\u2022 Deciding since block: 26318566\n\n\u{1F5F3}\uFE0F Voting Results:\n\u2022 Ayes: 105.0 DOT (100%)\n\u2022 Nays: 0 DOT\n\u2022 Support: 35.0 DOT\n\nDeposits:\n\u2022 Submission: 1.0 DOT by 136byv85...n5Rz\n\u2022 Decision: 200.0 DOT by 136byv85...n5Rz\n\n\u23F0 Alarm: Set for block 26721700\n\nQueue Status: Not in queue"
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "Get referendum 500 info",
          action: "GET_REFERENDUM_DETAILS"
        }
      },
      {
        user: "{{user1}}",
        content: {
          text: "\u{1F3DB}\uFE0F Referendum 500 Details\n\nOverview:\n\u2022 Track: unknown (track info not preserved)\n\u2022 Status: APPROVED\n\u2022 Completed at block: 24567890\n\n\u{1F4A1} Note: This referendum has been completed. Detailed voting information and track data are not preserved on-chain for completed referenda."
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "What's the status of proposal 123?",
          action: "GET_REFERENDUM_DETAILS"
        }
      },
      {
        user: "{{user1}}",
        content: {
          text: "\u{1F3DB}\uFE0F Referendum 123 Details\n\nOverview:\n\u2022 Track: treasurer (ID: 11)\n\u2022 Status: ONGOING\n\u2022 Origin: Treasurer\n\nProposal:\n\u2022 Hash: 0x1234567890abcdef1234567890abcdef12345678\n\u2022 Length: 45 bytes\n\u2022 Enactment delay: 50 blocks\n\nTimeline:\n\u2022 Submitted at block: 26200000\n\u2022 Deciding since block: 26202000\n\n\u{1F5F3}\uFE0F Voting Results:\n\u2022 Ayes: 5,432.1 DOT (92%)\n\u2022 Nays: 456.7 DOT\n\u2022 Support: 1,234.5 DOT\n\nDeposits:\n\u2022 Submission: 10.0 DOT by 5GrwvaEF...Xb26\n\u2022 Decision: 100.0 DOT by 5GrwvaEF...Xb26\n\nQueue Status: Not in queue"
        }
      }
    ]
  ]
};

// src/providers/networkData.ts
import { elizaLogger as elizaLogger15 } from "@elizaos/core";
var ChainDataService = class {
  apiService;
  async initialize(runtime) {
    this.apiService = await PolkadotApiService.start(runtime);
  }
  async getChainInfo() {
    const api = await this.apiService.getConnection();
    const [chain, nodeName, nodeVersion, properties, health, bestNumber, finalizedNumber] = await Promise.all([
      api.rpc.system.chain(),
      api.rpc.system.name(),
      api.rpc.system.version(),
      api.rpc.system.properties(),
      api.rpc.system.health(),
      api.derive.chain.bestNumber(),
      api.derive.chain.bestNumberFinalized()
    ]);
    const typedProperties = properties;
    const typedHealth = health;
    const chainInfo = {
      name: chain.toString(),
      nodeName: nodeName.toString(),
      nodeVersion: nodeVersion.toString(),
      properties: {
        tokenSymbol: typedProperties.tokenSymbol.unwrap()[0].toString(),
        tokenDecimals: typedProperties.tokenDecimals.unwrap()[0].toNumber()
      },
      health: {
        peers: typedHealth.peers.toNumber(),
        isSyncing: typedHealth.isSyncing.valueOf(),
        shouldHavePeers: typedHealth.shouldHavePeers.valueOf()
      },
      blocks: {
        best: bestNumber.toString(),
        finalized: finalizedNumber.toString()
      },
      timestamp: Date.now()
    };
    return chainInfo;
  }
  async getValidatorCount() {
    const api = await this.apiService.getConnection();
    let count = 0;
    try {
      const validators = await api.query.session.validators();
      const validatorsCodec = validators;
      const validatorsArray = validatorsCodec.toJSON();
      count = Array.isArray(validatorsArray) ? validatorsArray.length : 0;
    } catch (_error) {
      try {
        const validatorCount = await api.query.staking.validatorCount();
        count = parseInt(validatorCount.toString());
      } catch (innerError) {
        const message = innerError instanceof Error ? innerError.message : String(innerError);
        elizaLogger15.error(`Error fetching validator count: ${message}`);
      }
    }
    return count;
  }
  async getParachainCount() {
    const api = await this.apiService.getConnection();
    let count = 0;
    try {
      if (api.query.paras?.parachains) {
        const parachains = await api.query.paras.parachains();
        const parachainsCodec = parachains;
        const parachainsArray = parachainsCodec.toJSON();
        count = Array.isArray(parachainsArray) ? parachainsArray.length : 0;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      elizaLogger15.error(`Error fetching parachain count: ${message}`);
    }
    return count;
  }
  formatChainInfo(chainInfo) {
    const timeSinceUpdate = Math.floor((Date.now() - chainInfo.timestamp) / 1e3);
    return `Polkadot Network Status (updated ${timeSinceUpdate}s ago):
- Network: ${chainInfo.name}
- Connected: ${chainInfo.health.peers > 0 ? "Yes" : "No"} (${chainInfo.health.peers} peers)
- Synced: ${!chainInfo.health.isSyncing ? "Yes" : "No"}
- Latest Block: #${chainInfo.blocks.best} (finalized: #${chainInfo.blocks.finalized})
- Native Token: ${chainInfo.properties.tokenSymbol}`;
  }
};
var networkDataProvider = {
  async get(_runtime, _message, _state) {
    try {
      const chainDataService = new ChainDataService();
      await chainDataService.initialize(_runtime);
      const chainInfo = await chainDataService.getChainInfo();
      const [validatorCount, parachainCount] = await Promise.all([
        chainDataService.getValidatorCount(),
        chainDataService.getParachainCount()
      ]);
      let output = chainDataService.formatChainInfo(chainInfo);
      if (validatorCount > 0) {
        output += `
\u2022 Active Validators: ${validatorCount}`;
      }
      if (parachainCount > 0) {
        output += `
\u2022 Connected Parachains: ${parachainCount}`;
      }
      elizaLogger15.info("Network Data Provider output generated", output);
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      elizaLogger15.error(`Error in Network Data Provider: ${message}`);
      return "Network Data Provider: Unable to retrieve current network status.";
    }
  }
};
var networkData_default = networkDataProvider;

// src/index.ts
var polkadotPlugin = {
  name: "polkadot",
  description: "Polkadot Plugin for Eliza",
  actions: [
    createWallet_default,
    ejectWallet_default,
    signMessage_default,
    loadWallet_default,
    getBalance_default,
    getBlockInfo_default,
    getBlockEvents_default,
    getReferenda_default,
    getReferendumDetails_default,
    validateSignature_default
  ],
  evaluators: [],
  providers: [nativeWalletProvider, networkData_default]
};
var index_default = polkadotPlugin;
export {
  createWallet_default as CreatePolkadotWallet,
  ejectWallet_default as EjectPolkadotWallet,
  getBalance_default as GetBalance,
  getBlockEvents_default as GetBlockEvents,
  getBlockInfo_default as GetBlockInfo,
  getReferenda_default as GetReferenda,
  getReferendumDetails_default as GetReferendumDetails,
  loadWallet_default as LoadPolkadotWallet,
  signMessage_default as SignPolkadotMessage,
  validateSignature_default as ValidateSignature,
  WalletProvider,
  index_default as default,
  polkadotPlugin
};
//# sourceMappingURL=index.js.map