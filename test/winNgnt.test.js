const Web3 = require('web3');
const { GSNProvider } = require("@openzeppelin/gsn-provider");
const { fundRecipient, balance} = require('@openzeppelin/gsn-helpers');
const { expectRevert, expectEvent } = require('@openzeppelin/test-helpers');
const { waitForEvent } = require('./utils/utils');

const NGNT = require('../test/utils/ngnt/NGNT');
const ngntAbi = NGNT.abi;
const ngntByteCode = NGNT.bytecode;
const NGNT_DECIMAL = process.env.NGNT_DECIMAL;
const uniswapExchangeContract = process.env.UNISWAP_EXCHANGE_CONTRACT;
const relayHub = require('../script/relayHub').relayHub;

const WINNGNT = artifacts.require('WinNgnt');
const url = process.env.LOCAL_GANACHE;

contract("WinNGNT Test", function (accounts) {
    let web3;
    let ngnt;
    let winNgnt;
    const tokenName = 'Naira Token';
    const symbol = 'NGNT';
    const currency = 'Naira';
    const decimals = 2;
    const masterMinter = accounts[0];
    const pauser = accounts[1];
    const blacklister = accounts[1];
    const owner = accounts[0];
    const minterAllowedAmount = 130000000;
    let mintAmount = 130000000;
    const gsnFee = 5000;
    let winNgntContractAddress;
    let maximumPurchasableTickets = 20;

    describe('WinNgnt without GSN', () => {

        before(async function () {
            web3 = new Web3(new Web3.providers.WebsocketProvider(url));

            ngnt = new web3.eth.Contract(ngntAbi, null, {data: ngntByteCode});
            ngnt = await ngnt.deploy().send({from: owner, gas: 4712388, gasPrice: 100000000000});

            await ngnt.methods.initialize(tokenName, symbol, currency, decimals, masterMinter, pauser, blacklister, owner, gsnFee).send({
                from: owner, gas: 4712388, gasPrice: 100000000000
            });

            await fundRecipient(web3, { recipient: ngnt.options.address, from: masterMinter });

            await ngnt.methods.configureMinter(masterMinter, minterAllowedAmount).send({from: masterMinter, gas: 4712388, gasPrice: 100000000000});
            const mintTransaction = await ngnt.methods.mint(masterMinter, mintAmount).send({from: masterMinter, gas: 4712388, gasPrice: 100000000000});

            winNgnt = await WINNGNT.new(ngnt.options.address, uniswapExchangeContract, relayHub.address ,maximumPurchasableTickets);
            winNgntContractAddress = winNgnt.address;

            const tx = await web3.eth.sendTransaction({ from: accounts[3], to: winNgnt.address, value: 10 });

        });

        context('when buyTicket function before approval', function () {
            it('should fail if contract address is not approved by NGNT', async () => {
                expect(async function () {
                    await winNgnt.buyTicket(1, {
                        from: masterMinter,
                        useGSN: true
                    }).to.throw();
                });
            });

            it('should get the Approval event after approval of contract ', async () => {
                const contractAddress = winNgnt.address;
                const allowedAmount = 130000000;
                const approvalReceipt = await ngnt.methods.approve(contractAddress, allowedAmount).send({from: masterMinter, useGSN: true});
                expectEvent(approvalReceipt, 'Approval');
            })
        });

        context('when buyTicket function is called after approval', function () {
            it('should fail when buying zero tickets', async () => {
                const invalidNumberOfTickets = 0;
                await expectRevert(winNgnt.buyTicket(invalidNumberOfTickets, {from: masterMinter, useGSN: true}), "Cannot buy less than one ticket");
            });

            it('should fail when ticket limit is exceeded', async () => {
                const invalidNumberOfTickets = 2700;
                await expectRevert(winNgnt.buyTicket(invalidNumberOfTickets, {from: masterMinter, useGSN: true}), "Total ticket per game limit exceeded");
            });


            context('when buying ticket for the first time ', function () {
                const numberOfTickets = 10;
                let buyTicketReceipt;
                let expectedTicketPricePaid;

                it('should buy the specified number of tickets', async () => {
                    buyTicketReceipt = await winNgnt.buyTicket(numberOfTickets, {from: masterMinter, useGSN: true});

                    const ticketsBought = await winNgnt.addressTicketCountPerGame(1, masterMinter, {from: masterMinter, useGSN: true});
                    expect(parseInt(ticketsBought.toString())).to.equal(numberOfTickets);
                });

                it('should send the total ticket fee to NGNT minus the first transaction fee', async () => {
                    const contractAddress = winNgnt.address;
                    const ticketPrice = parseInt((await winNgnt.ticketPrice({from: masterMinter, useGSN: true})).toString())/NGNT_DECIMAL;
                    const gsnFee = parseInt(await ngnt.methods.gsnFee().call({from: masterMinter}))/NGNT_DECIMAL;

                    const totalTicketPrice = numberOfTickets * ticketPrice;
                    expectedTicketPricePaid = totalTicketPrice - gsnFee;

                    const contractBalance = parseInt((await ngnt.methods.balanceOf(contractAddress).call({from: contractAddress})).toString())/NGNT_DECIMAL;
                    expect(contractBalance).to.equal(expectedTicketPricePaid);
                });

                it('should emit the BoughtTicket event', async() => {
                    expectEvent(buyTicketReceipt, 'BoughtTicket', {
                        buyer: masterMinter,
                        numOfTickets: numberOfTickets.toString(),
                        totalTicketPrice: (expectedTicketPricePaid * NGNT_DECIMAL).toString() });
                });

                it('should emit the Tickets event', async() => {
                    let actualTickets = [];
                    for(let i = 0; i < numberOfTickets; i++){
                        actualTickets.push(masterMinter);
                    }

                    expectEvent(buyTicketReceipt, 'Tickets');
                    const expectedTickets = buyTicketReceipt.logs[1].args.tickets;
                    expect(expectedTickets).to.eql(actualTickets);
                });

                it('should get the number of tickets purchaaed', async ()=> {
                    const numberOfTicketsPurchased = parseInt((await winNgnt.numberOfTicketsPurchased({from: masterMinter})).toString());
                    expect(numberOfTicketsPurchased).to.equal(numberOfTickets);
                })
            });
        });

        context('when maximum number of ticket is bought', function () {
            let numberOfTicketsLeft;
            let buyTicketReceipt;
            const buyer = accounts[3];
            const mintableAmount = 1000000;


            before(async function () {
                await ngnt.methods.configureMinter(buyer, mintableAmount).send({from: masterMinter});
                await ngnt.methods.mint(buyer, mintableAmount).send({from: buyer});
                await ngnt.methods.approve(winNgntContractAddress, mintableAmount).send({from: buyer});

                numberOfTicketsLeft = parseInt((await winNgnt.numberOfTicketsLeft({from: masterMinter})).toString());
            });

            it('should call endGame function', async () => {
                buyTicketReceipt = await winNgnt.buyTicket(10, {from: buyer});

                expectEvent(buyTicketReceipt, 'GameEnded');
                numberOfTicketsLeft = parseInt((await winNgnt.numberOfTicketsLeft({from: masterMinter})).toString());
                expect(numberOfTicketsLeft).to.equal(0);
            });

            it('should call the generateRandomNumber function', async () => {
                expectEvent(buyTicketReceipt, 'LogNewProvableQuery', {
                    description: "Provable query was sent, standing by for the answer..."
                });
            });

            it('should get the number of tickets purchased', async ()=> {
                const numberOfTicketsPurchased = parseInt((await winNgnt.numberOfTicketsPurchased({from: masterMinter})).toString());
                expect(numberOfTicketsPurchased).to.equal(maximumPurchasableTickets);
            })

            // it('callback should have logged a new random number', async () => {
            //     const {
            //         returnValues: {
            //             randomNumber
            //         }
            //     } = await waitForEvent(winNgnt.contract.events.RandomNumberGenerated);
            //     console.log(randomNumber)
            // });

        });
    });

    const customWinNgnt = require('../test/utils/winngnt/WinNgnt');
    describe('WinNGNT with GSN', () => {
        before(async function () {
            maximumPurchasableTickets = 10;
            web3 = new Web3(new Web3.providers.WebsocketProvider(url));

            ngnt = new web3.eth.Contract(ngntAbi, null, {data: ngntByteCode});
            ngnt = await ngnt.deploy().send({from: owner, gas: 4712388, gasPrice: 100000000000});

            await ngnt.methods.initialize(tokenName, symbol, currency, decimals, masterMinter, pauser, blacklister, owner, gsnFee).send({
                from: owner, gas: 4712388, gasPrice: 100000000000
            });


            await ngnt.methods.configureMinter(masterMinter, minterAllowedAmount).send({from: masterMinter, gas: 4712388, gasPrice: 100000000000});
            await ngnt.methods.mint(masterMinter, mintAmount).send({from: masterMinter, gas: 4712388, gasPrice: 100000000000});

            winNgnt = new web3.eth.Contract(customWinNgnt.abi, null, {data: customWinNgnt.bytecode});
            winNgnt = await winNgnt.deploy({
                data: WINNGNT.bytecode,
                arguments: [ngnt.options.address, uniswapExchangeContract, relayHub.address ,maximumPurchasableTickets]
            }).send({from: masterMinter, gas: 5712388, gasPrice: 300000000000});

            winNgntContractAddress = winNgnt._address;

            await web3.eth.sendTransaction({ from: accounts[3], to: winNgnt._address, value: 10 });

            await ngnt.methods.approve(winNgntContractAddress, 100000000).send({from: masterMinter, useGSN: true});

            await fundRecipient(web3, { recipient: ngnt.options.address, from: masterMinter });
            await fundRecipient(web3, { recipient: winNgntContractAddress, from: masterMinter });

        });

        context('when buyTicket function is called', function () {
            let numberOfTicketsLeft;
            let balanceBeforeBuyingTicket;
            let balanceAfterBuyingTicket;

            before(async function() {
                const url = process.env.LOCAL_GANACHE;
                const gsnProvider = new GSNProvider(url);
                winNgnt.setProvider(gsnProvider);
            });

            it('should buy ticket via gsn', async () => {
                balanceBeforeBuyingTicket = Web3.utils.fromWei( await web3.eth.getBalance(masterMinter));
                await winNgnt.methods.buyTicket(10).send({from: masterMinter, useGSN: true});

                numberOfTicketsLeft = parseInt((await winNgnt.methods.numberOfTicketsLeft().call({from: masterMinter})).toString());
                expect(numberOfTicketsLeft).to.equal(0);
            });

            it('should not charge user from their balance', async () => {
                balanceAfterBuyingTicket = Web3.utils.fromWei( await web3.eth.getBalance(masterMinter));
                expect(balanceBeforeBuyingTicket).to.equal(balanceAfterBuyingTicket);
            });

            it('should make a new provable query when startNextGame function is called', async () => {
                winNgnt.setProvider(url);

                const startNextGameReceipt = await winNgnt.methods.startNextGame().send({from: masterMinter, gasLimit: 750000});
                expectEvent(startNextGameReceipt, 'LogNewProvableQuery');
            })
        });
    });
});
