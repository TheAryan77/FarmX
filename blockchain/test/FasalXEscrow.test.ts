import { expect } from "chai";
import hre from "hardhat";
import { keccak256, parseEther, toHex, getAddress } from "viem";

/**
 * FasalXEscrow tests.
 *
 * This contract decides when money moves, so the invalid transitions matter
 * more than the happy path: the guarantee being sold to a farmer is that the
 * buyer *cannot* take the produce and keep the money, and that only holds if
 * every out-of-order call reverts.
 */

const DEAL_ID = keccak256(toHex("FSL1024"));
const OTHER_DEAL_ID = keccak256(toHex("FSL1025"));
const CONTRACT_HASH = keccak256(toHex("a pretend contract PDF"));
const AMOUNT_RUPEES = 1_210_000n;
const ESCROW_WEI = parseEther("1.21");

/** Status enum indices, matching the contract and prisma/schema.prisma. */
const Status = {
  NONE: 0,
  CREATED: 1,
  ACCEPTED: 2,
  FUNDED: 3,
  PICKED_UP: 4,
  DELIVERED: 5,
  QC_APPROVED: 6,
  RELEASED: 7,
  DISPUTED: 8,
  REFUNDED: 9,
} as const;

async function deploy() {
  const [platform, buyer, settlement, stranger] = await hre.viem.getWalletClients();
  if (!platform || !buyer || !settlement || !stranger) {
    throw new Error("expected at least four funded accounts");
  }

  const escrow = await hre.viem.deployContract("FasalXEscrow", [platform.account.address]);
  const publicClient = await hre.viem.getPublicClient();

  return { escrow, publicClient, platform, buyer, settlement, stranger };
}

/** Deploy plus a CREATED deal, the starting point for most cases. */
async function withDeal() {
  const ctx = await deploy();
  await ctx.escrow.write.createDeal([
    DEAL_ID,
    ctx.buyer.account.address,
    ctx.settlement.account.address,
    AMOUNT_RUPEES,
    CONTRACT_HASH,
  ]);
  return ctx;
}

/** Walks a deal to FUNDED, which is where the money is actually at risk. */
async function fundedDeal() {
  const ctx = await withDeal();
  await ctx.escrow.write.acceptDeal([DEAL_ID]);
  await ctx.escrow.write.fundDeal([DEAL_ID], {
    account: ctx.buyer.account,
    value: ESCROW_WEI,
  });
  return ctx;
}

describe("FasalXEscrow", () => {
  describe("deployment", () => {
    it("assigns ownership to the platform and starts with no deals", async () => {
      const { escrow, platform } = await deploy();
      expect(getAddress(await escrow.read.owner())).to.equal(
        getAddress(platform.account.address),
      );
      expect(await escrow.read.dealCount()).to.equal(0n);
    });

    it("reports NONE for a deal that was never created", async () => {
      const { escrow } = await deploy();
      expect(await escrow.read.statusOf([DEAL_ID])).to.equal(Status.NONE);
    });
  });

  describe("the happy path", () => {
    it("carries a deal from created to released and pays the seller", async () => {
      const { escrow, publicClient, buyer, settlement } = await deploy();

      await escrow.write.createDeal([
        DEAL_ID,
        buyer.account.address,
        settlement.account.address,
        AMOUNT_RUPEES,
        CONTRACT_HASH,
      ]);
      expect(await escrow.read.statusOf([DEAL_ID])).to.equal(Status.CREATED);

      await escrow.write.acceptDeal([DEAL_ID]);
      expect(await escrow.read.statusOf([DEAL_ID])).to.equal(Status.ACCEPTED);

      await escrow.write.fundDeal([DEAL_ID], { account: buyer.account, value: ESCROW_WEI });
      expect(await escrow.read.statusOf([DEAL_ID])).to.equal(Status.FUNDED);

      // The money is genuinely held by the contract, not merely marked as held.
      expect(
        await publicClient.getBalance({ address: escrow.address }),
      ).to.equal(ESCROW_WEI);

      await escrow.write.confirmPickup([DEAL_ID]);
      expect(await escrow.read.statusOf([DEAL_ID])).to.equal(Status.PICKED_UP);

      await escrow.write.confirmDelivery([DEAL_ID]);
      expect(await escrow.read.statusOf([DEAL_ID])).to.equal(Status.DELIVERED);

      await escrow.write.approveQuality([DEAL_ID], { account: buyer.account });
      expect(await escrow.read.statusOf([DEAL_ID])).to.equal(Status.QC_APPROVED);

      const sellerBefore = await publicClient.getBalance({
        address: settlement.account.address,
      });
      await escrow.write.releaseFunds([DEAL_ID]);
      const sellerAfter = await publicClient.getBalance({
        address: settlement.account.address,
      });

      expect(await escrow.read.statusOf([DEAL_ID])).to.equal(Status.RELEASED);
      expect(sellerAfter - sellerBefore).to.equal(ESCROW_WEI);
      // Nothing left behind, and the deal no longer claims to hold anything.
      expect(await publicClient.getBalance({ address: escrow.address })).to.equal(0n);

      const deal = await escrow.read.getDeal([DEAL_ID]);
      expect(deal.escrowedWei).to.equal(0n);
      expect(deal.amountRupees).to.equal(AMOUNT_RUPEES);
      expect(deal.contractHash).to.equal(CONTRACT_HASH);
      expect(Number(deal.fundedAt)).to.be.greaterThan(0);
      expect(Number(deal.settledAt)).to.be.greaterThan(0);
      // Settlement cannot predate funding.
      expect(Number(deal.settledAt)).to.be.at.least(Number(deal.fundedAt));
    });

    it("records the contract hash and rupee amount without any personal data", async () => {
      const { escrow, buyer, settlement } = await withDeal();
      const deal = await escrow.read.getDeal([DEAL_ID]);

      expect(deal.dealId).to.equal(DEAL_ID);
      expect(getAddress(deal.buyer)).to.equal(getAddress(buyer.account.address));
      expect(getAddress(deal.seller)).to.equal(getAddress(settlement.account.address));
      // Only these fields exist — the struct has no room for a name or a phone.
      expect(Object.keys(deal).sort()).to.deep.equal(
        [
          "amountRupees",
          "buyer",
          "contractHash",
          "createdAt",
          "dealId",
          "escrowedWei",
          "fundedAt",
          "seller",
          "settledAt",
          "status",
        ].sort(),
      );
    });
  });

  describe("invalid transitions", () => {
    it("refuses to fund a deal that has not been accepted", async () => {
      const { escrow, buyer } = await withDeal();
      await expect(
        escrow.write.fundDeal([DEAL_ID], { account: buyer.account, value: ESCROW_WEI }),
      ).to.be.rejectedWith("InvalidTransition");
    });

    it("refuses to release funds before quality is approved", async () => {
      const { escrow } = await fundedDeal();
      await expect(escrow.write.releaseFunds([DEAL_ID])).to.be.rejectedWith(
        "InvalidTransition",
      );
    });

    it("refuses to confirm delivery before pickup", async () => {
      const { escrow } = await fundedDeal();
      await expect(escrow.write.confirmDelivery([DEAL_ID])).to.be.rejectedWith(
        "InvalidTransition",
      );
    });

    it("refuses to approve quality before anything was delivered", async () => {
      const { escrow, buyer } = await fundedDeal();
      await expect(
        escrow.write.approveQuality([DEAL_ID], { account: buyer.account }),
      ).to.be.rejectedWith("InvalidTransition");
    });

    it("refuses to accept the same deal twice", async () => {
      const { escrow } = await withDeal();
      await escrow.write.acceptDeal([DEAL_ID]);
      await expect(escrow.write.acceptDeal([DEAL_ID])).to.be.rejectedWith(
        "InvalidTransition",
      );
    });

    it("refuses to release the same deal twice", async () => {
      const { escrow, buyer } = await fundedDeal();
      await escrow.write.confirmPickup([DEAL_ID]);
      await escrow.write.confirmDelivery([DEAL_ID]);
      await escrow.write.approveQuality([DEAL_ID], { account: buyer.account });
      await escrow.write.releaseFunds([DEAL_ID]);

      await expect(escrow.write.releaseFunds([DEAL_ID])).to.be.rejectedWith(
        "InvalidTransition",
      );
    });

    it("refuses to dispute a deal after quality was approved", async () => {
      const { escrow, buyer } = await fundedDeal();
      await escrow.write.confirmPickup([DEAL_ID]);
      await escrow.write.confirmDelivery([DEAL_ID]);
      await escrow.write.approveQuality([DEAL_ID], { account: buyer.account });

      // The buyer has accepted the goods; reversing that would make approval
      // meaningless, so the escrow will not go back.
      await expect(
        escrow.write.raiseDispute([DEAL_ID, "changed my mind"]),
      ).to.be.rejectedWith("InvalidTransition");
    });

    it("refuses to dispute before the deal is funded", async () => {
      const { escrow } = await withDeal();
      await expect(escrow.write.raiseDispute([DEAL_ID, "too early"])).to.be.rejectedWith(
        "InvalidTransition",
      );
    });

    it("refuses to act on a deal that does not exist", async () => {
      const { escrow } = await deploy();
      await expect(escrow.write.acceptDeal([OTHER_DEAL_ID])).to.be.rejectedWith(
        "UnknownDeal",
      );
      await expect(escrow.read.getDeal([OTHER_DEAL_ID])).to.be.rejectedWith("UnknownDeal");
    });

    it("refuses to create the same deal id twice", async () => {
      const { escrow, buyer, settlement } = await withDeal();
      await expect(
        escrow.write.createDeal([
          DEAL_ID,
          buyer.account.address,
          settlement.account.address,
          AMOUNT_RUPEES,
          CONTRACT_HASH,
        ]),
      ).to.be.rejectedWith("DealAlreadyExists");
    });

    it("refuses to refund a deal that is not disputed", async () => {
      const { escrow } = await fundedDeal();
      await expect(escrow.write.refundBuyer([DEAL_ID])).to.be.rejectedWith(
        "InvalidTransition",
      );
    });
  });

  describe("access control", () => {
    it("lets only the platform create deals", async () => {
      const { escrow, buyer, settlement, stranger } = await deploy();
      await expect(
        escrow.write.createDeal(
          [
            DEAL_ID,
            buyer.account.address,
            settlement.account.address,
            AMOUNT_RUPEES,
            CONTRACT_HASH,
          ],
          { account: stranger.account },
        ),
      ).to.be.rejectedWith("OwnableUnauthorizedAccount");
    });

    it("lets only the buyer fund their own deal", async () => {
      const { escrow, stranger } = await withDeal();
      await escrow.write.acceptDeal([DEAL_ID]);
      await expect(
        escrow.write.fundDeal([DEAL_ID], { account: stranger.account, value: ESCROW_WEI }),
      ).to.be.rejectedWith("NotBuyer");
    });

    it("lets only the buyer approve quality — not the platform", async () => {
      const { escrow, platform, settlement } = await fundedDeal();
      await escrow.write.confirmPickup([DEAL_ID]);
      await escrow.write.confirmDelivery([DEAL_ID]);

      // The party paying decides whether what arrived is what they bought.
      await expect(
        escrow.write.approveQuality([DEAL_ID], { account: platform.account }),
      ).to.be.rejectedWith("NotBuyer");
      await expect(
        escrow.write.approveQuality([DEAL_ID], { account: settlement.account }),
      ).to.be.rejectedWith("NotBuyer");
    });

    it("keeps strangers out of a deal entirely", async () => {
      const { escrow, stranger } = await fundedDeal();
      await expect(
        escrow.write.confirmPickup([DEAL_ID], { account: stranger.account }),
      ).to.be.rejectedWith("NotAuthorised");
      await expect(
        escrow.write.raiseDispute([DEAL_ID, "not mine"], { account: stranger.account }),
      ).to.be.rejectedWith("NotAuthorised");
    });

    it("lets only the platform refund a disputed deal", async () => {
      const { escrow, buyer } = await fundedDeal();
      await escrow.write.raiseDispute([DEAL_ID, "short weight"], { account: buyer.account });
      await expect(
        escrow.write.refundBuyer([DEAL_ID], { account: buyer.account }),
      ).to.be.rejectedWith("OwnableUnauthorizedAccount");
    });
  });

  describe("validation", () => {
    it("rejects a zero address for either party", async () => {
      const { escrow, buyer } = await deploy();
      const zero = "0x0000000000000000000000000000000000000000";
      await expect(
        escrow.write.createDeal([DEAL_ID, zero, buyer.account.address, AMOUNT_RUPEES, CONTRACT_HASH]),
      ).to.be.rejectedWith("ZeroAddress");
      await expect(
        escrow.write.createDeal([DEAL_ID, buyer.account.address, zero, AMOUNT_RUPEES, CONTRACT_HASH]),
      ).to.be.rejectedWith("ZeroAddress");
    });

    it("rejects a zero rupee amount and a zero-value funding", async () => {
      const { escrow, buyer, settlement } = await deploy();
      await expect(
        escrow.write.createDeal([
          DEAL_ID,
          buyer.account.address,
          settlement.account.address,
          0n,
          CONTRACT_HASH,
        ]),
      ).to.be.rejectedWith("ZeroAmount");

      await escrow.write.createDeal([
        DEAL_ID,
        buyer.account.address,
        settlement.account.address,
        AMOUNT_RUPEES,
        CONTRACT_HASH,
      ]);
      await escrow.write.acceptDeal([DEAL_ID]);
      await expect(
        escrow.write.fundDeal([DEAL_ID], { account: buyer.account, value: 0n }),
      ).to.be.rejectedWith("ZeroAmount");
    });

    it("has no way to send it money outside a deal", async () => {
      const { escrow, publicClient, stranger } = await deploy();
      // No receive() or fallback(), so an unattributed transfer must fail and
      // the contract can never hold a balance nobody is owed.
      await expect(
        stranger.sendTransaction({ to: escrow.address, value: parseEther("1") }),
      ).to.be.rejected;
      expect(await publicClient.getBalance({ address: escrow.address })).to.equal(0n);
    });
  });

  describe("the dispute path", () => {
    it("refunds the buyer when a funded deal is disputed", async () => {
      const { escrow, publicClient, buyer } = await fundedDeal();
      await escrow.write.confirmPickup([DEAL_ID]);
      await escrow.write.confirmDelivery([DEAL_ID]);

      await escrow.write.raiseDispute([DEAL_ID, "moisture above Grade A"], {
        account: buyer.account,
      });
      expect(await escrow.read.statusOf([DEAL_ID])).to.equal(Status.DISPUTED);

      const before = await publicClient.getBalance({ address: buyer.account.address });
      await escrow.write.refundBuyer([DEAL_ID]);
      const after = await publicClient.getBalance({ address: buyer.account.address });

      expect(await escrow.read.statusOf([DEAL_ID])).to.equal(Status.REFUNDED);
      expect(after - before).to.equal(ESCROW_WEI);
      expect(await publicClient.getBalance({ address: escrow.address })).to.equal(0n);
    });

    it("will not release funds on a disputed deal", async () => {
      const { escrow, buyer } = await fundedDeal();
      await escrow.write.raiseDispute([DEAL_ID, "short weight"], { account: buyer.account });
      await expect(escrow.write.releaseFunds([DEAL_ID])).to.be.rejectedWith(
        "InvalidTransition",
      );
    });
  });

  describe("isolation between deals", () => {
    it("keeps two deals' escrows separate", async () => {
      const { escrow, publicClient, buyer, settlement, stranger } = await deploy();

      for (const [id, party] of [
        [DEAL_ID, buyer],
        [OTHER_DEAL_ID, stranger],
      ] as const) {
        await escrow.write.createDeal([
          id,
          party.account.address,
          settlement.account.address,
          AMOUNT_RUPEES,
          CONTRACT_HASH,
        ]);
        await escrow.write.acceptDeal([id]);
      }

      await escrow.write.fundDeal([DEAL_ID], { account: buyer.account, value: ESCROW_WEI });
      expect(await publicClient.getBalance({ address: escrow.address })).to.equal(ESCROW_WEI);

      // Releasing one must not touch the other's money.
      await escrow.write.confirmPickup([DEAL_ID]);
      await escrow.write.confirmDelivery([DEAL_ID]);
      await escrow.write.approveQuality([DEAL_ID], { account: buyer.account });
      await escrow.write.releaseFunds([DEAL_ID]);

      expect(await escrow.read.statusOf([OTHER_DEAL_ID])).to.equal(Status.ACCEPTED);
      expect((await escrow.read.getDeal([OTHER_DEAL_ID])).escrowedWei).to.equal(0n);
      expect(await escrow.read.dealCount()).to.equal(2n);
    });
  });
});
