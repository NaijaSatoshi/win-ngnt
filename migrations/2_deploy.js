const WinNgnt = artifacts.require('WinNgnt');
const ngntContractAddress = process.env.NGNT_CONTRACT_ADDRESS;
const env = process.env.NODE_ENV;
const maximumPurchasableTicket = process.env.MAXIMUM_PURCHASABLE_TICKET;
const uniswapExchangeContract = process.env.UNISWAP_EXCHANGE_CONTRACT;
const relayHub = require('../script/relayHub').relayHub;

module.exports = async function (deployer) {
    if(env === 'production' || env === 'staging' || env === 'development'){
        await deployer.deploy(WinNgnt, ngntContractAddress, uniswapExchangeContract, relayHub.address ,maximumPurchasableTicket);
    }
};