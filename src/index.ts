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
};

export const polkadotPlugin: Plugin = {
    name: 'polkadot',
    description: 'Polkadot Plugin for Eliza',
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
    ],
    evaluators: [],
    providers: [nativeWalletProvider, networkDataProvider],
};

export default polkadotPlugin;
