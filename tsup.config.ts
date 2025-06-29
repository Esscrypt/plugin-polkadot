import { defineConfig } from "tsup";

export default defineConfig({
    entry: ["src/index.ts"],
    outDir: "dist",
    sourcemap: true,
    clean: true,
    format: ["esm"],
    external: [
        "@elizaos/core",
        "@substrate/asset-transfer-api",
        "@substrate/asset-transfer-api-registry",
        "@polkadot/api",
        "@polkadot/keyring",
        "@polkadot/util-crypto",
        "@polkadot/util",
        "dotenv",
        "fs",
        "path",
        "@reflink/reflink",
        "@node-llama-cpp",
        "agentkeepalive",
        "bignumber.js",
        "zod",
        "node-cache"
    ],
});
