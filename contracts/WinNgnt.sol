pragma solidity ^0.5.0;

import "./provableAPI.sol";
import "./SafeStringCast.sol";
import "./interfaces/IERC20.sol";
import "./interfaces/IUniswapExchange.sol";
import { SafeIntCast } from "./SafeIntCast.sol";
import "@0x/contracts-utils/contracts/src/LibBytes.sol";
import '@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol';
import "@openzeppelin/contracts-ethereum-package/contracts/GSN/GSNRecipient.sol";


contract WinNgnt is GSNRecipient, usingProvable {
    using SafeMath for uint256;
    using SafeStringCast for string;

    IERC20 private _ngnt;
    IUniswapExchange private _uniswap;
    IRelayHub private _relayHub;
    uint public TOTAL_NGNT = 0;

    struct Game {
        uint gameNumber;
        address[] tickets;
        address gameWinner;
    }

    enum GSNErrorCodes {
        INSUFFICIENT_BALANCE, NOT_ALLOWED
    }

    uint public commission;
    uint public gameNumber = 1;
    uint public deadline = 1742680400;
    uint public ticketPrice = 50000;
    uint public minimumEther = 1 wei;
    uint public maximumPurchasableTickets = 250;
    uint public maximumTicketsPerAddress = 10;
    uint public oneEther = 1000000000000000000;
    uint public targetAmount = 1000000000000000000;

    bool public exchangeContractApproval;

    mapping(uint => Game) public games;
    mapping(address => uint) public addressTicketCount;
    mapping(uint => mapping(address => uint)) public addressTicketCountPerGame;
    mapping(address => bool) public addressHasPaidGsnFee;
    mapping(bytes32 => bool) public pendingQueries;

    //TODO: Remove event after thorough testing
    event Tickets(address[] tickets);

    event GameEnded(uint gameNumber);
    event BoughtTicket(address buyer, uint numOfTickets, uint totalTicketPrice);
    event LogNewProvableQuery(string description);
    event RandomNumberGenerated(uint16 randomNumber);
    event WinnerSelected(address winner, uint amount, uint gameNumber);



    modifier atLeastOneTicket(uint numberOfTickets){
        require(numberOfTickets >= 1, "Cannot buy less than one ticket");
        _;
    }

    modifier ticketLimitNotExceed(uint numberOfTickets){
        require((games[gameNumber].tickets.length + numberOfTickets) <= maximumPurchasableTickets, "Total ticket per game limit exceeded");
        _;
    }

    modifier maxTicketPerAddressLimitNotExceed(address _address, uint numberOfTickets){
        require((addressTicketCountPerGame[gameNumber][_address] + numberOfTickets) <= maximumTicketsPerAddress, "Maximum ticket limit per address exceeded");
        _;
    }

    modifier isCalledByAProvableCallbackAddress(address caller){
        require(caller == provable_cbAddress(), "Callback can only be called by a provable callback address");
        _;
    }

    modifier queryIdHasNotBeenProcessed(bytes32 queryId){
        require (pendingQueries[queryId] == true);
        _;
    }

    constructor(IERC20 ngnt, IUniswapExchange uniswap, IRelayHub relayHub,uint _maximumPurchasableTickets) public {
        GSNRecipient.initialize();
        _ngnt = ngnt;
        _uniswap = uniswap;
        _relayHub = relayHub;
        maximumPurchasableTickets = _maximumPurchasableTickets;
    }

    function buyTicket(uint numberOfTickets) atLeastOneTicket(numberOfTickets) ticketLimitNotExceed(numberOfTickets)
    maxTicketPerAddressLimitNotExceed(_msgSender(), numberOfTickets)
    external
    {
        uint totalTicketPrice = ticketPrice.mul(numberOfTickets);
        uint totalAddressTicketCount = addressTicketCount[_msgSender()];
        uint totalAddressTicketCountPerGame = addressTicketCountPerGame[gameNumber][_msgSender()];

        if (!addressHasPaidGsnFee[_msgSender()]) {
            uint gsnFee = _ngnt.gsnFee();
            if (gsnFee <= 0) {
                gsnFee = 5000;
            }

            totalTicketPrice = totalTicketPrice.sub(gsnFee);
            addressHasPaidGsnFee[_msgSender()] = true;
        }

        TOTAL_NGNT += totalTicketPrice;
        _ngnt.transferFrom(_msgSender(), address(this), totalTicketPrice);

        totalAddressTicketCount += numberOfTickets;
        totalAddressTicketCountPerGame += numberOfTickets;
        
        addressTicketCount[_msgSender()] = totalAddressTicketCount;
        addressTicketCountPerGame[gameNumber][_msgSender()] = totalAddressTicketCountPerGame;

        Game storage game = games[gameNumber];
        game.gameNumber = gameNumber;
        for(uint i = 0; i < numberOfTickets; i++){
            game.tickets.push(_msgSender());
        }

        address[] memory tickets = game.tickets;
        emit BoughtTicket(_msgSender(), numberOfTickets, totalTicketPrice);
        emit Tickets(tickets);

        if(games[gameNumber].tickets.length == maximumPurchasableTickets){
            if(gameNumber.mod(5) == 0){
                swapNgntForEth();
                fundRecipient();
            }
            endGame();
        }
    }

    function numberOfTicketsLeft() external view returns (uint){
        Game storage game = games[gameNumber];
        uint ticketsBought = game.tickets.length;
        return maximumPurchasableTickets.sub(ticketsBought);
    }

    function numberOfTicketsPurchased() external view returns(uint){
        Game storage game = games[gameNumber];
        uint ticketsBought = game.tickets.length;
        return ticketsBought;
    }

    function getNgntAddress() external view returns(address){
        return address(_ngnt);
    }

    function __callback(bytes32 queryId, string memory _result) isCalledByAProvableCallbackAddress(_msgSender())
    queryIdHasNotBeenProcessed(queryId) public
    {
        if(games[gameNumber].tickets.length == maximumPurchasableTickets){
            uint16 randomIndex = _result.toUint();
            emit RandomNumberGenerated(randomIndex);
            delete pendingQueries[queryId];

            sendNgntToWinner(randomIndex);
            resetGame();
        }
    }

    function generateRandomNumber() private {
        if (provable_getPrice("WolframAlpha") > address(this).balance) {
            emit LogNewProvableQuery("Provable query was NOT sent, please add some ETH to cover for the query fee");
        }
        else {
            uint lastIndex = 0;
            Game storage game = games[gameNumber];
            lastIndex = game.tickets.length - 1;

            bytes memory query;
            query = abi.encodePacked(SafeIntCast.toString(lastIndex));
            query = abi.encodePacked("random number between 0 and ", query);
            string memory provableQuery = string(query);

            emit LogNewProvableQuery("Provable query was sent, standing by for the answer...");
            bytes32 queryId = provable_query("WolframAlpha", provableQuery);
            pendingQueries[queryId] = true;
        }
    }

    function startNextGame() public {
        generateRandomNumber();
    }

    function sendNgntToWinner(uint randomIndex) private {
        Game storage game = games[gameNumber];
        address winner = game.tickets[randomIndex];
        game.gameWinner = winner;

        uint amountWon = TOTAL_NGNT.mul(90).div(100);
        commission += TOTAL_NGNT.sub(amountWon);
        _ngnt.transfer(winner, amountWon);

        emit WinnerSelected(winner, amountWon, gameNumber);
    }

    function swapNgntForEth() private {
        if(address(this).balance < oneEther){
            if(!exchangeContractApproval){
                _ngnt.approve(address(_uniswap), 100000000000);
                exchangeContractApproval = true;
            }

            uint tokenSold = commission;
            _uniswap.tokenToEthSwapInput(tokenSold, minimumEther, deadline);
            commission = 0;
        }
    }

    function fundRecipient() private {
        uint relayBalance = _relayHub.balanceOf(address(this));
        if(relayBalance < targetAmount){
            uint amountDifference = targetAmount.sub(relayBalance);
            if(address(this).balance > amountDifference){
                _relayHub.depositFor.value(amountDifference)(address(this));
            }else{
                _relayHub.depositFor.value(address(this).balance)(address(this));
            }
        }
    }

    function resetGame() private {
        gameNumber++;
        TOTAL_NGNT = 0;
    }

    function endGame() private {
        emit GameEnded(gameNumber);
        generateRandomNumber();
    }

    function acceptRelayedCall(
        address relay,
        address from,
        bytes calldata encodedFunction,
        uint256 transactionFee,
        uint256 gasPrice,
        uint256 gasLimit,
        uint256 nonce,
        bytes calldata approvalData,
        uint256 maxPossibleCharge
    ) external view returns (uint256, bytes memory) {
        bytes4 calldataSelector = LibBytes.readBytes4(encodedFunction, 0);
        if (calldataSelector == this.buyTicket.selector) {
            return _approveRelayedCall();
        } else {
            return _rejectRelayedCall(uint256(GSNErrorCodes.NOT_ALLOWED));
        }
    }

    function _preRelayedCall(bytes memory context) internal returns (bytes32) {
    }

    function _postRelayedCall(bytes memory context, bool, uint256 actualCharge, bytes32) internal {
    }

    function  () external payable {
    }
}
