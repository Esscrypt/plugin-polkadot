import type { Plugin } from '@elizaos/core';
import createWalletAction from './actions/createWallet.ts';
import ejectWalletAction from './actions/ejectWallet.ts';
import signMessageAction from './actions/signMessage.ts';
import loadWalletAction from './actions/loadWallet.ts';
import validateSignatureAction from './actions/validateSignature.ts';
import getBalanceAction from './actions/getBalance.ts';
import getBlockInfoAction from './actions/getBlockInfo.ts';
import getBlockEventsAction from './actions/getBlockEvents.ts';
import getReferendaAction from './actions/getReferenda.ts';
import getReferendumDetailsAction from './actions/getReferendumDetails.ts';
import { WalletProvider, nativeWalletProvider } from './providers/wallet.ts';
import networkDataProvider from './providers/networkData.ts';
import transferFundsAction from './actions/transferFunds.ts';
import crossChainTransferAction from './actions/crossChainTransfer.ts';
import { logger } from '@elizaos/core/v2';

export {
    WalletProvider,
    createWalletAction as CreatePolkadotWallet,
    ejectWalletAction as EjectPolkadotWallet,
    signMessageAction as SignPolkadotMessage,
    loadWalletAction as LoadPolkadotWallet,
    getBalanceAction as GetBalance,
    getBlockInfoAction as GetBlockInfo,
    getBlockEventsAction as GetBlockEvents,
    getReferendaAction as GetReferenda,
    getReferendumDetailsAction as GetReferendumDetails,
    validateSignatureAction as ValidateSignature,
    transferFundsAction as TransferPolkadotFunds,
    crossChainTransferAction as CrossChainTransfer,
};

export const polkadotPlugin: Plugin = {
    name: 'polkadot',
    description: 'Polkadot Plugin for Eliza',
    init: async (_config, runtime) => {
        logger.log('Polkadot Plugin initialized');
        const rpcUrl = runtime.getSetting('POLKADOT_RPC_URL');
        if (!rpcUrl) {
            logger.warn('POLKADOT_RPC_URL not provided');
        }
        const privateKey = runtime.getSetting('POLKADOT_PRIVATE_KEY');
        if (!privateKey) {
            logger.warn('POLKADOT_PRIVATE_KEY not provided');
        }
        const coinmarketcapApiKey = runtime.getSetting('COINMARKETCAP_API_KEY');
        if (!coinmarketcapApiKey) {
            logger.warn('COINMARKETCAP_API_KEY not provided');
        }
    },
    actions: [
        createWalletAction,
        ejectWalletAction,
        signMessageAction,
        loadWalletAction,
        getBalanceAction,
        getBlockInfoAction,
        getBlockEventsAction,
        getReferendaAction,
        getReferendumDetailsAction,
        validateSignatureAction,
        transferFundsAction,
        crossChainTransferAction,
    ],
    evaluators: [],
    providers: [nativeWalletProvider, networkDataProvider],
};

export default polkadotPlugin;
