// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title FasalXEscrow
 * @notice Holds a buyer's payment until delivered produce passes quality check.
 *
 * CLAUDE.md, and this contract is deliberately narrow because of it:
 * PostgreSQL is the source of truth, and this holds *trust state only* — who
 * the parties are, how much is escrowed, where the deal has got to, and the
 * hash of the contract both sides agreed. Nothing else belongs here.
 *
 * NEVER ON-CHAIN: names, phone numbers, villages, bank or UPI references, or
 * anything else identifying a farmer. Only addresses, amounts and a hash.
 *
 * On `seller`: farmers do not hold wallets in this system, and an aggregated
 * order has several of them. `seller` is therefore the platform's settlement
 * address, which distributes to each farmer off-chain against the allocations
 * recorded in Postgres. The chain's job is to guarantee the money cannot move
 * until quality is approved — not to be the payment rail to twelve smallholders.
 *
 * The rupee figure is recorded for the audit trail; the value actually held is
 * whatever native token was deposited. The two are related by a demo constant
 * in the API, not by an exchange rate, and nothing here assumes otherwise.
 */
contract FasalXEscrow is Ownable, ReentrancyGuard {
    /**
     * @dev Mirrors the ContractStatus enum in prisma/schema.prisma exactly.
     *      NONE is index 0 so an unknown deal is distinguishable from a created
     *      one — without it, every id would look like a valid CREATED deal.
     */
    enum Status {
        NONE,
        CREATED,
        ACCEPTED,
        FUNDED,
        PICKED_UP,
        DELIVERED,
        QC_APPROVED,
        RELEASED,
        DISPUTED,
        REFUNDED
    }

    struct Deal {
        bytes32 dealId;
        address buyer;
        address seller;
        /// @notice Contract value in whole rupees. Audit record only.
        uint256 amountRupees;
        /// @notice Native token actually held by this contract for the deal.
        uint256 escrowedWei;
        Status status;
        /// @notice SHA-256 of the agreed contract PDF. The PDF stays off-chain.
        bytes32 contractHash;
        uint64 createdAt;
        uint64 fundedAt;
        uint64 settledAt;
    }

    mapping(bytes32 => Deal) private _deals;
    bytes32[] private _dealIds;

    // ---------------------------------------------------------------- events

    event DealCreated(
        bytes32 indexed dealId,
        address indexed buyer,
        address indexed seller,
        uint256 amountRupees,
        bytes32 contractHash
    );
    event DealAccepted(bytes32 indexed dealId, address indexed by);
    event DealFunded(bytes32 indexed dealId, address indexed buyer, uint256 amountWei);
    event PickupConfirmed(bytes32 indexed dealId, address indexed by);
    event DeliveryConfirmed(bytes32 indexed dealId, address indexed by);
    event QualityApproved(bytes32 indexed dealId, address indexed by);
    event DisputeRaised(bytes32 indexed dealId, address indexed by, string reason);
    event FundsReleased(bytes32 indexed dealId, address indexed seller, uint256 amountWei);
    event BuyerRefunded(bytes32 indexed dealId, address indexed buyer, uint256 amountWei);

    // ---------------------------------------------------------------- errors

    error DealAlreadyExists(bytes32 dealId);
    error UnknownDeal(bytes32 dealId);
    error InvalidTransition(bytes32 dealId, Status current, Status attempted);
    error NotBuyer(bytes32 dealId, address caller);
    error NotAuthorised(bytes32 dealId, address caller);
    error ZeroAddress();
    error ZeroAmount();
    error NothingEscrowed(bytes32 dealId);
    error TransferFailed(address to, uint256 amountWei);

    constructor(address initialOwner) Ownable(initialOwner) {}

    // ---------------------------------------------------------------- guards

    modifier dealExists(bytes32 dealId) {
        if (_deals[dealId].status == Status.NONE) revert UnknownDeal(dealId);
        _;
    }

    /// @dev Rejects any move the state machine does not allow, naming both states.
    modifier onlyFrom(bytes32 dealId, Status expected) {
        Status current = _deals[dealId].status;
        if (current != expected) revert InvalidTransition(dealId, current, expected);
        _;
    }

    modifier onlyBuyerOf(bytes32 dealId) {
        if (msg.sender != _deals[dealId].buyer) revert NotBuyer(dealId, msg.sender);
        _;
    }

    /// @dev The platform, or the party the action belongs to.
    modifier onlyPartyOrOwner(bytes32 dealId) {
        Deal storage deal = _deals[dealId];
        if (msg.sender != owner() && msg.sender != deal.buyer && msg.sender != deal.seller) {
            revert NotAuthorised(dealId, msg.sender);
        }
        _;
    }

    // ---------------------------------------------------------------- lifecycle

    /**
     * @notice Records a deal agreed off-chain. CREATED.
     * @dev Only the platform creates deals: the agreement itself happened in
     *      the marketplace, and this is the on-chain attestation of it.
     */
    function createDeal(
        bytes32 dealId,
        address buyer,
        address seller,
        uint256 amountRupees,
        bytes32 contractHash
    ) external onlyOwner {
        if (_deals[dealId].status != Status.NONE) revert DealAlreadyExists(dealId);
        if (buyer == address(0) || seller == address(0)) revert ZeroAddress();
        if (amountRupees == 0) revert ZeroAmount();

        _deals[dealId] = Deal({
            dealId: dealId,
            buyer: buyer,
            seller: seller,
            amountRupees: amountRupees,
            escrowedWei: 0,
            status: Status.CREATED,
            contractHash: contractHash,
            createdAt: uint64(block.timestamp),
            fundedAt: 0,
            settledAt: 0
        });
        _dealIds.push(dealId);

        emit DealCreated(dealId, buyer, seller, amountRupees, contractHash);
    }

    /// @notice Both sides have signed. CREATED → ACCEPTED.
    function acceptDeal(bytes32 dealId)
        external
        dealExists(dealId)
        onlyFrom(dealId, Status.CREATED)
        onlyPartyOrOwner(dealId)
    {
        _deals[dealId].status = Status.ACCEPTED;
        emit DealAccepted(dealId, msg.sender);
    }

    /**
     * @notice Buyer locks the payment. ACCEPTED → FUNDED.
     * @dev Only the buyer can fund, and only their own deal — otherwise a third
     *      party could deposit and muddle who is owed a refund.
     */
    function fundDeal(bytes32 dealId)
        external
        payable
        dealExists(dealId)
        onlyFrom(dealId, Status.ACCEPTED)
        onlyBuyerOf(dealId)
    {
        if (msg.value == 0) revert ZeroAmount();

        Deal storage deal = _deals[dealId];
        deal.escrowedWei = msg.value;
        deal.status = Status.FUNDED;
        deal.fundedAt = uint64(block.timestamp);

        emit DealFunded(dealId, msg.sender, msg.value);
    }

    /// @notice Produce collected from the farms. FUNDED → PICKED_UP.
    function confirmPickup(bytes32 dealId)
        external
        dealExists(dealId)
        onlyFrom(dealId, Status.FUNDED)
        onlyPartyOrOwner(dealId)
    {
        _deals[dealId].status = Status.PICKED_UP;
        emit PickupConfirmed(dealId, msg.sender);
    }

    /// @notice Arrived at the buyer. PICKED_UP → DELIVERED.
    function confirmDelivery(bytes32 dealId)
        external
        dealExists(dealId)
        onlyFrom(dealId, Status.PICKED_UP)
        onlyPartyOrOwner(dealId)
    {
        _deals[dealId].status = Status.DELIVERED;
        emit DeliveryConfirmed(dealId, msg.sender);
    }

    /**
     * @notice Quality check passed. DELIVERED → QC_APPROVED.
     * @dev Buyer only. The whole point of the escrow is that the party paying
     *      decides whether what arrived is what they bought — letting the
     *      platform approve on their behalf would hollow that out.
     */
    function approveQuality(bytes32 dealId)
        external
        dealExists(dealId)
        onlyFrom(dealId, Status.DELIVERED)
        onlyBuyerOf(dealId)
    {
        _deals[dealId].status = Status.QC_APPROVED;
        emit QualityApproved(dealId, msg.sender);
    }

    /**
     * @notice Something is wrong. FUNDED / PICKED_UP / DELIVERED → DISPUTED.
     * @dev Deliberately not allowed once QC is approved: the buyer has already
     *      accepted the goods, and reversing that would make approval
     *      meaningless. Nor before funding, when there is nothing at stake.
     */
    function raiseDispute(bytes32 dealId, string calldata reason)
        external
        dealExists(dealId)
        onlyPartyOrOwner(dealId)
    {
        Status current = _deals[dealId].status;
        if (
            current != Status.FUNDED &&
            current != Status.PICKED_UP &&
            current != Status.DELIVERED
        ) {
            revert InvalidTransition(dealId, current, Status.DISPUTED);
        }

        _deals[dealId].status = Status.DISPUTED;
        emit DisputeRaised(dealId, msg.sender, reason);
    }

    /**
     * @notice Pays the seller. QC_APPROVED → RELEASED.
     * @dev State is written before the transfer (checks-effects-interactions)
     *      and the function is nonReentrant, so a malicious recipient cannot
     *      re-enter and be paid twice.
     */
    function releaseFunds(bytes32 dealId)
        external
        nonReentrant
        dealExists(dealId)
        onlyFrom(dealId, Status.QC_APPROVED)
        onlyPartyOrOwner(dealId)
    {
        Deal storage deal = _deals[dealId];
        uint256 amount = deal.escrowedWei;
        if (amount == 0) revert NothingEscrowed(dealId);

        deal.escrowedWei = 0;
        deal.status = Status.RELEASED;
        deal.settledAt = uint64(block.timestamp);

        address seller = deal.seller;
        (bool ok, ) = seller.call{value: amount}("");
        if (!ok) revert TransferFailed(seller, amount);

        emit FundsReleased(dealId, seller, amount);
    }

    /// @notice Returns the escrow to the buyer. DISPUTED → REFUNDED.
    function refundBuyer(bytes32 dealId)
        external
        nonReentrant
        onlyOwner
        dealExists(dealId)
        onlyFrom(dealId, Status.DISPUTED)
    {
        Deal storage deal = _deals[dealId];
        uint256 amount = deal.escrowedWei;
        if (amount == 0) revert NothingEscrowed(dealId);

        deal.escrowedWei = 0;
        deal.status = Status.REFUNDED;
        deal.settledAt = uint64(block.timestamp);

        address buyer = deal.buyer;
        (bool ok, ) = buyer.call{value: amount}("");
        if (!ok) revert TransferFailed(buyer, amount);

        emit BuyerRefunded(dealId, buyer, amount);
    }

    // ---------------------------------------------------------------- views

    function getDeal(bytes32 dealId) external view returns (Deal memory) {
        Deal memory deal = _deals[dealId];
        if (deal.status == Status.NONE) revert UnknownDeal(dealId);
        return deal;
    }

    /// @notice Status without reverting — NONE means the deal is not on-chain.
    function statusOf(bytes32 dealId) external view returns (Status) {
        return _deals[dealId].status;
    }

    function dealCount() external view returns (uint256) {
        return _dealIds.length;
    }

    function dealIdAt(uint256 index) external view returns (bytes32) {
        return _dealIds[index];
    }

    /**
     * @dev No receive() or fallback() on purpose. Every rupee that enters this
     *      contract must be attached to a specific deal through fundDeal, so
     *      there can be no unattributed balance sitting here.
     */
}
