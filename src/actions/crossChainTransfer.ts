import type { IAgentRuntime, Memory, State, HandlerCallback, Content } from '@elizaos/core';
import {
    elizaLogger,
    ModelType,
    composePromptFromState,
    parseJSONObjectFromText,
} from '@elizaos/core';
import { WalletProvider, initWalletProvider } from '../providers/wallet';
import type { ApiPromise } from '@polkadot/api';
import { AssetTransferApi, constructApiPromise } from '@substrate/asset-transfer-api';
import type { TxResult } from '@substrate/asset-transfer-api';
import { CHAIN_RPC_MAPPING } from '../utils/chainRegistryUtils';

import { z } from 'zod';

export interface CrossChainTransferContent extends Content {
    recipientAddress: string;
    amount: string;
    sourceChain: string;
    destinationChain: string;
    destinationParachainId: string;
    assetId?: string;
    walletNumber?: number;
    walletAddress?: string;
    password?: string;
}

// Define a schema for input JSON
export const crossChainTransferSchema = z.object({
    recipientAddress: z.string(),
    amount: z.string(),
    sourceChain: z.string(),
    destinationChain: z.string(),
    destinationParachainId: z.string(),
    assetId: z.string(),
    walletNumber: z.number().optional().nullable(),
    walletAddress: z.string().optional().nullable(),
    password: z.string().optional().nullable(),
});

// Define a template to guide object building
export const crossChainTransferTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.
    Example response:
    \`\`\`json
    {
      "recipientAddress": "<recipient address>",
      "amount": "<numeric amount only, without asset symbol>",
      "sourceChain": "<source chain name>",
      "destinationChain": "<destination chain name>",
      "destinationParachainId": "<destination parachain id>",
      "assetId": "<asset symbol>",
      "walletNumber": <optional wallet number>,
      "walletAddress": "<optional wallet address>",
      "password": "<optional password>"
    }
    \`\`\`
    
    {{recentMessages}}
  
    If a wallet number or address is not provided in the latest message, return null for those values.
    If a password is not provided in the latest message, return null for the password.
    If source chain is not provided, it will default to "polkadot".
  
    IMPORTANT: For the "amount" field, extract ONLY the numeric value without any asset symbols or currency names. 
    For example, if the user says "transfer 1000 PAS", the amount should be "1000", not "1000 PAS".
  
    Respond with a JSON markdown block containing only the extracted values.`;

/**
 * Builds and validates a cross-chain transfer object using the provided runtime, message, and state.
 */
export async function buildCrossChainTransferDetails(
    runtime: IAgentRuntime,
    _message: Memory,
    state: State,
): Promise<CrossChainTransferContent> {
    const prompt = composePromptFromState({
        state,
        template: crossChainTransferTemplate,
    });

    const parsedResponse: CrossChainTransferContent | null = null;
    for (let i = 0; i < 5; i++) {
        const response = await runtime.useModel(ModelType.TEXT_SMALL, {
            prompt,
        });
        const parsedResponse = parseJSONObjectFromText(
            response,
        ) as CrossChainTransferContent | null;
        if (parsedResponse) {
            break;
        }
    }

    return parsedResponse;
}

export class CrossChainTransferAction {
    private runtime: IAgentRuntime;
    private walletProvider: WalletProvider;
    private api: ApiPromise;
    private assetApi: AssetTransferApi; // Using any temporarily to avoid type conflicts
    private currentRpcUrl: string;
    private sourceChainName: string;

    constructor(runtime: IAgentRuntime) {
        this.runtime = runtime;
    }

    async initialize(sourceChain: string): Promise<void> {
        this.sourceChainName = sourceChain;
        this.walletProvider = await initWalletProvider(this.runtime);

        // Get the RPC URL from the mapping or use default
        const chainName = sourceChain.toLowerCase();
        this.currentRpcUrl = CHAIN_RPC_MAPPING[chainName];

        if (!this.currentRpcUrl) {
            throw new Error(`RPC URL not found for chain: ${sourceChain}`);
        }

        const { api, specName, safeXcmVersion } = await constructApiPromise(this.currentRpcUrl);
        this.api = api;

        // Initialize the Asset Transfer API
        this.assetApi = new AssetTransferApi(api, specName, safeXcmVersion);
    }

    async transferFunds(
        params: {
            recipientAddress: string;
            amount: string;
            destinationChain: string;
            destinationParachainId: string;
            assetId?: string;
            walletNumber?: number;
            walletAddress?: string;
            password?: string;
        },
        dryRun = false,
    ): Promise<{
        status: string;
        message: string;
        decodedTx?: string;
        txHash?: string;
    }> {
        let targetWallet: WalletProvider;
        if (params.walletNumber) {
            targetWallet = await WalletProvider.loadWalletByNumber(
                this.walletProvider,
                params.walletNumber,
                params.password,
            );
        } else if (params.walletAddress) {
            targetWallet = await WalletProvider.loadWalletByAddress(
                this.walletProvider,
                params.walletAddress,
                params.password,
            );
        } else {
            targetWallet = this.walletProvider;
        }

        const keypair = targetWallet.keyring.getPairs()[0];
        if (!keypair) {
            throw new Error('No keypair found in the wallet');
        }

        const callInfo: TxResult<'call'> = await this.assetApi.createTransferTransaction(
            params.destinationParachainId,
            params.recipientAddress,
            params.assetId ? [params.assetId] : [],
            [params.amount],
            {
                format: 'call',
                xcmVersion: this.assetApi.safeXcmVersion,
            },
        );

        elizaLogger.debug('Transfer transaction created:', {
            callInfoTx: callInfo.tx,
        });

        elizaLogger.log('Attempting to dry run the transaction...');
        const dryRunResult = await this.assetApi.dryRunCall(
            keypair.address,
            callInfo.tx,
            'call',
            this.assetApi.safeXcmVersion,
        );

        if (dryRunResult === null) {
            elizaLogger.warn('Dry run did not return a result. Proceeding with caution.');
        } else if (dryRunResult.isErr) {
            elizaLogger.error('Transaction dry run failed:', dryRunResult.asErr.toHuman());
            throw new Error(`Transaction dry run failed: ${dryRunResult.asErr.toString()}`);
        } else {
            elizaLogger.log('Transaction dry run successful:', dryRunResult.asOk.toHuman());
        }

        let decodedTxString: string | undefined = undefined;
        try {
            decodedTxString = this.assetApi.decodeExtrinsic(callInfo.tx, 'call');
            elizaLogger.debug('Decoded transaction:', JSON.parse(decodedTxString));
        } catch (decodeError) {
            elizaLogger.warn('Failed to decode transaction:', decodeError);
        }

        if (dryRun) {
            return {
                status: 'success',
                message: `Dry run of cross-chain transfer of ${params.amount} ${params.assetId} from ${this.sourceChainName} to ${params.recipientAddress} on ${params.destinationChain} initiated.`,
            };
        }

        const submitableTransaction: TxResult<'submittable'> =
            await this.assetApi.createTransferTransaction(
                params.destinationParachainId,
                params.recipientAddress,
                params.assetId ? [params.assetId] : [],
                [params.amount],
                {
                    format: 'submittable',
                    xcmVersion: this.assetApi.safeXcmVersion,
                },
            );

        elizaLogger.log('Signing and sending the transaction...');
        let hash: string | undefined = undefined;
        const unsub = await submitableTransaction.tx.signAndSend(keypair, (result) => {
            console.log(`Current status is ${result.status}`);

            if (result.status.isInBlock) {
                console.log(`Transaction included at blockHash ${result.status.asInBlock}`);
            } else if (result.status.isFinalized) {
                console.log(`Transaction included at blockHash ${result.status.asFinalized}`);
                hash = result.txHash.toHex();

                unsub();
            }
        });

        return {
            status: 'success',
            txHash: hash,
            message: `Cross-chain transfer of ${params.amount} ${params.assetId} from ${this.sourceChainName} to ${params.recipientAddress} on ${params.destinationChain} initiated.`,
            decodedTx: decodedTxString,
        };
    }
}

export default {
    name: 'CROSS_CHAIN_TRANSFER',
    similes: ['CROSS_CHAIN_SEND', 'XCM_TRANSFER'],
    description:
        'Transfers tokens across different chains in the Polkadot ecosystem using XCM. Supports transfers between relay chains and parachains.',
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: Record<string, unknown>,
        callback?: HandlerCallback,
    ) => {
        elizaLogger.log('Starting CROSS_CHAIN_TRANSFER action...');

        // Build transfer details using the object building approach
        const transferContent = await buildCrossChainTransferDetails(runtime, message, state);

        elizaLogger.debug('crossChainTransferContent', transferContent);

        if (
            !transferContent ||
            !transferContent.recipientAddress ||
            !transferContent.amount ||
            !transferContent.destinationChain
        ) {
            elizaLogger.error('Failed to obtain required transfer details.');
            if (callback) {
                callback({
                    text: 'Unable to process cross-chain transfer request. Could not obtain required details.',
                    content: {
                        error: 'Invalid transfer request. Required details could not be determined.',
                    },
                });
            }
            return false;
        }

        try {
            // Initialize the transfer action
            const action = new CrossChainTransferAction(runtime);
            await action.initialize(transferContent.sourceChain);

            // Execute the transfer
            const result = await action.transferFunds({
                recipientAddress: transferContent.recipientAddress,
                amount: transferContent.amount,
                destinationChain: transferContent.destinationChain,
                destinationParachainId: transferContent.destinationParachainId,
                assetId: transferContent.assetId,
                walletNumber: transferContent.walletNumber,
                walletAddress: transferContent.walletAddress,
                password: transferContent.password,
            });

            if (callback) {
                callback({
                    text: result.message,
                    content: {
                        status: result.status,
                        message: result.message,
                        decodedTx: result.decodedTx,
                    },
                });
            }

            return true;
        } catch (error) {
            elizaLogger.error('Error in cross-chain transfer:', error);
            if (callback) {
                callback({
                    text: `Error in cross-chain transfer: ${error.message}`,
                    content: { error: error.message },
                });
            }
            return false;
        }
    },
    validate: async (_runtime: IAgentRuntime) => true,
    examples: [
        [
            {
                name: '{{user1}}',
                content: {
                    text: 'Please transfer 1 DOT from Polkadot to Moonbeam address 5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
                    action: 'CROSS_CHAIN_TRANSFER',
                },
            },
            {
                name: '{{user2}}',
                content: {
                    text: 'Cross-chain transfer of 1 DOT from Polkadot to 5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty on Moonbeam initiated. Transaction hash: 0x...',
                },
            },
        ],
        [
            {
                name: '{{user1}}',
                content: {
                    text: 'Send 0.5 GLMR from Moonbeam to 0xF977814e90dA44bFA03b6295A0616a897441aceC on Moonriver from wallet #2',
                    action: 'CROSS_CHAIN_TRANSFER',
                },
            },
            {
                name: '{{user2}}',
                content: {
                    text: 'Cross-chain transfer of 0.5 GLMR from Moonbeam to 0xF977814e90dA44bFA03b6295A0616a897441aceC on Moonriver from wallet #2 initiated. Transaction hash: 0x...',
                },
            },
        ],
    ],
};
