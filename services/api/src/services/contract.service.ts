import type { ContractAction, ContractRecord, OnChainDeal } from "@fasalx/types";
import {
  ContractStatus as PrismaContractStatus,
  EscrowStatus as PrismaEscrowStatus,
  OrderStatus as PrismaOrderStatus,
  Prisma,
} from "@prisma/client";
import type { Address, Hex, WalletClient } from "viem";

import { env } from "../env.js";
import {
  chainInfo,
  chainUnavailableReason,
  dealIdFor,
  escrowAbi,
  explorerTxUrl,
  getChain,
  rupeesToWei,
  statusFromIndex,
} from "../lib/chain.js";
import { HttpError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { generateContractPdf } from "../lib/pdf.js";
import { toQuintals } from "../lib/serialize.js";
import { getOrder, orderInclude, toOrder } from "./order.service.js";
import { requireBuyerProfile } from "./requirement.service.js";

/**
 * The contract service: the only thing in FasalX that writes to a chain.
 *
 * CLAUDE.md's division of labour is the whole design here. Postgres is the
 * source of truth for the order, the parties and the money in rupees. The
 * chain holds trust state only — who, how much, where the deal has got to, and
 * the hash of the agreed PDF. Everything identifying a farmer stays in
 * Postgres.
 *
 * Nothing in here ever fails a request because a chain was unreachable. The
 * intended transition is recorded locally, marked degraded, and surfaced as
 * such. A farmer must not lose sight of their deal because an RPC blipped.
 */

/** Payment terms printed into the PDF. Stated once, so the PDF cannot drift. */
const PAYMENT_TERMS = [
  "1. The buyer deposits the full contract value into escrow before pickup.",
  "2. Funds are held by the FasalX escrow contract and cannot be withdrawn by",
  "   either party while the deal is in progress.",
  "3. On delivery the buyer inspects the produce against the agreed grade.",
  "4. Payment is released to the seller only once that quality check passes.",
  "5. If the check fails, either party may raise a dispute and the escrow is",
  "   returned to the buyer.",
].join("\n");

/**
 * Escrow functions taking only a deal id. `raiseDispute` also takes a reason,
 * so it is handled separately — viem narrows `args` against the ABI, and a
 * loose `string[]` would defeat that checking entirely.
 */
type SingleArgFn =
  | "acceptDeal"
  | "fundDeal"
  | "confirmPickup"
  | "confirmDelivery"
  | "approveQuality"
  | "releaseFunds"
  | "refundBuyer";

/** Which chain transitions each action performs, and who signs. */
const ACTIONS: Record<
  ContractAction,
  {
    fn: SingleArgFn | "raiseDispute";
    from: PrismaContractStatus[];
    to: PrismaContractStatus;
    /** The buyer signs what only the buyer is allowed to do. */
    signer: "platform" | "buyer";
    payable?: boolean;
    reasonArg?: boolean;
  }
> = {
  accept: {
    fn: "acceptDeal",
    from: [PrismaContractStatus.CREATED],
    to: PrismaContractStatus.ACCEPTED,
    signer: "platform",
  },
  fund: {
    fn: "fundDeal",
    from: [PrismaContractStatus.ACCEPTED],
    to: PrismaContractStatus.FUNDED,
    signer: "buyer",
    payable: true,
  },
  pickup: {
    fn: "confirmPickup",
    from: [PrismaContractStatus.FUNDED],
    to: PrismaContractStatus.PICKED_UP,
    signer: "platform",
  },
  deliver: {
    fn: "confirmDelivery",
    from: [PrismaContractStatus.PICKED_UP],
    to: PrismaContractStatus.DELIVERED,
    signer: "platform",
  },
  "approve-quality": {
    fn: "approveQuality",
    from: [PrismaContractStatus.DELIVERED],
    to: PrismaContractStatus.QC_APPROVED,
    signer: "buyer",
  },
  release: {
    fn: "releaseFunds",
    from: [PrismaContractStatus.QC_APPROVED],
    to: PrismaContractStatus.RELEASED,
    signer: "platform",
  },
  dispute: {
    fn: "raiseDispute",
    from: [
      PrismaContractStatus.FUNDED,
      PrismaContractStatus.PICKED_UP,
      PrismaContractStatus.DELIVERED,
    ],
    to: PrismaContractStatus.DISPUTED,
    signer: "buyer",
    reasonArg: true,
  },
  refund: {
    fn: "refundBuyer",
    from: [PrismaContractStatus.DISPUTED],
    to: PrismaContractStatus.REFUNDED,
    signer: "platform",
  },
};

/** Order status kept in step with the escrow, so both apps read one story. */
const ORDER_STATUS_FOR: Partial<Record<PrismaContractStatus, PrismaOrderStatus>> = {
  ACCEPTED: PrismaOrderStatus.CONTRACTED,
  FUNDED: PrismaOrderStatus.FUNDED,
  PICKED_UP: PrismaOrderStatus.IN_TRANSIT,
  DELIVERED: PrismaOrderStatus.DELIVERED,
  QC_APPROVED: PrismaOrderStatus.QC_PASSED,
  RELEASED: PrismaOrderStatus.SETTLED,
  DISPUTED: PrismaOrderStatus.DISPUTED,
  REFUNDED: PrismaOrderStatus.CANCELLED,
};

const contractInclude = {
  order: { include: orderInclude },
  escrow: true,
  events: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.ContractInclude;

type ContractRow = Prisma.ContractGetPayload<{ include: typeof contractInclude }>;

// ---------------------------------------------------------------- chain calls

interface ChainWrite {
  txHash: string;
  blockNumber: number | null;
}

/**
 * Sends one escrow transaction and waits for it to be mined.
 *
 * Waiting matters: without the receipt we would report a transition that the
 * chain might still reject, and the demo would show a green tick for a
 * transaction that reverted.
 */
async function writeToChain(
  action: ContractAction,
  dealId: Hex,
  options: { valueWei?: bigint; reason?: string } = {},
): Promise<ChainWrite> {
  const chain = getChain();
  if (!chain) throw new Error(chainUnavailableReason());

  const spec = ACTIONS[action];
  const wallet: WalletClient = spec.signer === "buyer" ? chain.buyer : chain.platform;
  const account = wallet.account;
  if (!account) throw new Error("Chain wallet has no account configured");

  // Three shapes, because viem checks each against the ABI: the dispute call
  // carries a reason, funding carries value (and is the only payable
  // function), and the rest take just the deal id.
  const common = {
    address: chain.escrowAddress,
    abi: escrowAbi,
    account,
    chain: null,
  } as const;

  let txHash: Hex;
  if (spec.fn === "raiseDispute") {
    txHash = await wallet.writeContract({
      ...common,
      functionName: "raiseDispute",
      args: [dealId, options.reason ?? "Dispute raised"],
    });
  } else if (spec.fn === "fundDeal") {
    txHash = await wallet.writeContract({
      ...common,
      functionName: "fundDeal",
      args: [dealId],
      value: options.valueWei ?? 0n,
    });
  } else {
    txHash = await wallet.writeContract({
      ...common,
      functionName: spec.fn,
      args: [dealId],
    });
  }

  const receipt = await chain.publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`Transaction ${txHash} reverted on chain`);
  }

  return { txHash, blockNumber: Number(receipt.blockNumber) };
}

/** Reads live chain state, or null when it cannot be read. */
async function readOnChain(dealId: Hex): Promise<OnChainDeal | null> {
  const chain = getChain();
  if (!chain) return null;

  try {
    const deal = (await chain.publicClient.readContract({
      address: chain.escrowAddress,
      abi: escrowAbi,
      functionName: "getDeal",
      args: [dealId],
    })) as {
      dealId: Hex;
      buyer: Address;
      seller: Address;
      amountRupees: bigint;
      escrowedWei: bigint;
      status: number;
      contractHash: Hex;
    };

    return {
      dealId: deal.dealId,
      status: statusFromIndex(Number(deal.status)),
      amountRupees: Number(deal.amountRupees),
      escrowedWei: deal.escrowedWei.toString(),
      contractHash: deal.contractHash,
      buyerAddress: deal.buyer,
      sellerAddress: deal.seller,
    };
  } catch {
    // Includes UnknownDeal, which is the normal answer for a contract whose
    // creation was recorded in degraded mode and never reached the chain.
    return null;
  }
}

// ---------------------------------------------------------------- mapping

function toContractRecord(row: ContractRow, onChain: OnChainDeal | null): ContractRecord {
  // Three distinct situations, and the UI needs to tell them apart:
  //   - no chain configured at all
  //   - configured, but the live read failed although a deal id exists
  //   - fine
  let degradedReason: string | null = null;
  if (getChain() === null) {
    degradedReason = chainUnavailableReason();
  } else if (row.onChainDealId !== null && onChain === null) {
    degradedReason =
      "Cannot read the chain right now, so the escrow state below is our last known record.";
  }

  return {
    id: row.id,
    contractNo: row.contractNo,
    orderId: row.orderId,
    order: toOrder(row.order),

    status: row.status,
    amountRupees: row.amountRupees,

    pdfSha256: row.pdfSha256,
    pdfUrl: row.pdfPath === null ? null : `/contracts/${row.id}/pdf`,

    onChainDealId: row.onChainDealId,
    buyerAddress: row.buyerAddress,
    sellerAddress: row.sellerAddress,
    chainId: row.chainId,

    escrow:
      row.escrow === null
        ? null
        : {
            status: row.escrow.status,
            amountRupees: row.escrow.amountRupees,
            fundedTxHash: row.escrow.fundedTxHash,
            fundedExplorerUrl:
              row.escrow.fundedTxHash === null ? null : explorerTxUrl(row.escrow.fundedTxHash),
            releasedTxHash: row.escrow.releasedTxHash,
            releasedExplorerUrl:
              row.escrow.releasedTxHash === null
                ? null
                : explorerTxUrl(row.escrow.releasedTxHash),
            fundedAt: row.escrow.fundedAt?.toISOString() ?? null,
            releasedAt: row.escrow.releasedAt?.toISOString() ?? null,
          },

    events: row.events.map((event) => ({
      id: event.id,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      txHash: event.txHash,
      explorerUrl: event.txHash === null ? null : explorerTxUrl(event.txHash),
      blockNumber: event.blockNumber,
      degraded: event.degraded,
      note: event.note,
      createdAt: event.createdAt.toISOString(),
    })),

    onChain,
    chain: chainInfo(),
    degradedReason,
  };
}

/**
 * A short, readable reason a chain write failed.
 *
 * viem's messages are multi-line and include the RPC URL and the full request
 * body. That is useful in a log and wrong in a note the UI will render, so the
 * first line is kept and the rest dropped.
 */
function chainErrorNote(err: unknown): string {
  if (!(err instanceof Error)) return "The chain rejected the transaction";

  const shortMessage = (err as Error & { shortMessage?: string }).shortMessage;
  const first = (shortMessage ?? err.message).split("\n")[0]?.trim() ?? "";

  if (/HTTP request failed|fetch failed|ECONNREFUSED|socket/i.test(first)) {
    return "The chain was unreachable, so this step is recorded but not yet confirmed on-chain.";
  }
  return first.slice(0, 160) || "The chain rejected the transaction";
}

/** Records a transition, whether or not the chain accepted it. */
async function recordEvent(
  contractId: string,
  from: PrismaContractStatus | null,
  to: PrismaContractStatus,
  result: { txHash?: string; blockNumber?: number | null; degraded: boolean; note?: string },
): Promise<void> {
  await prisma.contractEvent.create({
    data: {
      contractId,
      fromStatus: from,
      toStatus: to,
      ...(result.txHash === undefined ? {} : { txHash: result.txHash }),
      ...(result.blockNumber === undefined || result.blockNumber === null
        ? {}
        : { blockNumber: result.blockNumber }),
      degraded: result.degraded,
      ...(result.note === undefined ? {} : { note: result.note }),
    },
  });
}

// ---------------------------------------------------------------- reads

async function loadForParty(
  contractId: string,
  userId: string,
  role: string,
): Promise<ContractRow> {
  const row = await prisma.contract.findUnique({
    where: { id: contractId },
    include: contractInclude,
  });
  if (!row) {
    throw HttpError.notFound("CONTRACT_NOT_FOUND", "That contract no longer exists");
  }

  // Reuses the order's own party check rather than duplicating it.
  await getOrder(row.orderId, userId, role);
  return row;
}

export async function getContract(
  contractId: string,
  userId: string,
  role: string,
): Promise<ContractRecord> {
  const row = await loadForParty(contractId, userId, role);
  const onChain =
    row.onChainDealId === null ? null : await readOnChain(row.onChainDealId as Hex);
  return toContractRecord(row, onChain);
}

export async function getContractForOrder(
  orderId: string,
  userId: string,
  role: string,
): Promise<ContractRecord | null> {
  const row = await prisma.contract.findUnique({
    where: { orderId },
    include: contractInclude,
  });
  if (!row) return null;
  return getContract(row.id, userId, role);
}

/** The stored PDF, for download. */
export async function getContractPdfPath(
  contractId: string,
  userId: string,
  role: string,
): Promise<{ path: string; filename: string }> {
  const row = await loadForParty(contractId, userId, role);
  if (row.pdfPath === null) {
    throw HttpError.notFound("PDF_NOT_FOUND", "No contract document has been generated yet");
  }
  return { path: row.pdfPath, filename: `${row.contractNo}.pdf` };
}

// ---------------------------------------------------------------- writes

/**
 * Generates the contract document, hashes it, and registers the deal on-chain.
 *
 * The PDF is produced and hashed before anything is written to the chain,
 * because the hash is one of the arguments — the document has to exist first
 * for "this exact agreement" to mean anything.
 */
export async function createContract(userId: string, orderId: string): Promise<ContractRecord> {
  const buyer = await requireBuyerProfile(userId);

  const orderRow = await prisma.order.findUnique({
    where: { id: orderId },
    include: orderInclude,
  });
  if (!orderRow) {
    throw HttpError.notFound("ORDER_NOT_FOUND", "That order no longer exists");
  }
  if (orderRow.buyerId !== buyer.id) {
    throw HttpError.forbidden("That order is not yours");
  }

  const existing = await prisma.contract.findUnique({ where: { orderId } });
  if (existing) {
    throw new HttpError(
      409,
      "CONTRACT_EXISTS",
      `Order ${orderRow.orderNo} already has contract ${existing.contractNo}`,
    );
  }

  const order = toOrder(orderRow);
  const contractNo = `FSLC-${order.orderNo.replace(/^FSL/, "")}`;
  const pdf = await generateContractPdf(order, contractNo, PAYMENT_TERMS);
  const dealId = dealIdFor(contractNo);

  const chain = getChain();
  const buyerAddress = chain?.buyer.account?.address ?? null;
  const sellerAddress = chain?.settlementAddress ?? null;

  const contract = await prisma.contract.create({
    data: {
      orderId: order.id,
      contractNo,
      status: PrismaContractStatus.CREATED,
      amountRupees: order.grossAmountRupees,
      pdfPath: pdf.filePath,
      pdfSha256: pdf.sha256,
      onChainDealId: dealId,
      ...(buyerAddress === null ? {} : { buyerAddress }),
      ...(sellerAddress === null ? {} : { sellerAddress }),
      chainId: env.CHAIN_ID,
      escrow: {
        create: {
          status: PrismaEscrowStatus.PENDING,
          amountRupees: order.grossAmountRupees,
        },
      },
    },
  });

  if (!chain) {
    await recordEvent(contract.id, null, PrismaContractStatus.CREATED, {
      degraded: true,
      note: chainUnavailableReason(),
    });
  } else {
    try {
      // A SHA-256 hex string is already 32 bytes, so prefixing it gives the
      // bytes32 the contract expects.
      const created = await chain.platform.writeContract({
        address: chain.escrowAddress,
        abi: escrowAbi,
        functionName: "createDeal",
        args: [
          dealId,
          chain.buyer.account!.address,
          chain.settlementAddress,
          BigInt(order.grossAmountRupees),
          `0x${pdf.sha256}` as Hex,
        ],
        account: chain.platform.account!,
        chain: null,
      });
      const receipt = await chain.publicClient.waitForTransactionReceipt({ hash: created });

      await recordEvent(contract.id, null, PrismaContractStatus.CREATED, {
        txHash: created,
        blockNumber: Number(receipt.blockNumber),
        degraded: false,
        note: `Contract hash ${pdf.sha256.slice(0, 16)}… written on-chain`,
      });
    } catch (err) {
      console.warn(`[chain] createDeal failed for ${contractNo}:`, err);
      await recordEvent(contract.id, null, PrismaContractStatus.CREATED, {
        degraded: true,
        note: chainErrorNote(err),
      });
    }
  }

  await prisma.order.update({
    where: { id: order.id },
    data: { status: PrismaOrderStatus.CONTRACTED },
  });

  return getContract(contract.id, userId, "BUYER");
}

/**
 * Drives one escrow transition.
 *
 * The off-chain status is only advanced once the chain has accepted the move,
 * so our record never claims a state the chain would deny. When the chain is
 * unreachable the intent is recorded as a degraded event and the status stays
 * put — a pending intention, not a fact.
 */
export async function transitionContract(
  contractId: string,
  userId: string,
  role: string,
  action: ContractAction,
  reason?: string,
): Promise<ContractRecord> {
  const row = await loadForParty(contractId, userId, role);
  const spec = ACTIONS[action];

  // Authorisation before state: "only the buyer can fund this" is the more
  // useful answer than "wrong state", and it is true regardless of state.
  if (action === "fund" && role !== "BUYER") {
    throw HttpError.forbidden("Only the buyer can fund the escrow");
  }
  if (action === "approve-quality" && role !== "BUYER") {
    throw HttpError.forbidden("Only the buyer can approve quality");
  }

  if (!spec.from.includes(row.status)) {
    throw new HttpError(
      409,
      "INVALID_TRANSITION",
      `Cannot ${action} a contract that is ${row.status.toLowerCase().replace(/_/g, " ")}`,
    );
  }

  const dealId = row.onChainDealId as Hex | null;
  if (dealId === null) {
    throw new HttpError(
      409,
      "NOT_ON_CHAIN",
      "This contract has no on-chain deal, so its escrow cannot be moved",
    );
  }

  try {
    const write = await writeToChain(action, dealId, {
      ...(spec.payable ? { valueWei: rupeesToWei(row.amountRupees) } : {}),
      ...(reason === undefined ? {} : { reason }),
    });

    await prisma.$transaction(async (tx) => {
      await tx.contract.update({ where: { id: row.id }, data: { status: spec.to } });

      const orderStatus = ORDER_STATUS_FOR[spec.to];
      if (orderStatus) {
        await tx.order.update({ where: { id: row.orderId }, data: { status: orderStatus } });
      }

      if (action === "fund") {
        await tx.escrow.update({
          where: { contractId: row.id },
          data: {
            status: PrismaEscrowStatus.LOCKED,
            fundedTxHash: write.txHash,
            fundedAt: new Date(),
          },
        });
      }
      if (action === "release") {
        await tx.escrow.update({
          where: { contractId: row.id },
          data: {
            status: PrismaEscrowStatus.RELEASED,
            releasedTxHash: write.txHash,
            releasedAt: new Date(),
          },
        });
      }
      if (action === "refund") {
        await tx.escrow.update({
          where: { contractId: row.id },
          data: {
            status: PrismaEscrowStatus.REFUNDED,
            refundedTxHash: write.txHash,
          },
        });
      }
    });

    await recordEvent(row.id, row.status, spec.to, {
      txHash: write.txHash,
      blockNumber: write.blockNumber,
      degraded: false,
      ...(reason === undefined ? {} : { note: reason }),
    });
  } catch (err) {
    // Never fail the request for a chain problem — record the intent instead.
    console.warn(`[chain] ${action} failed for ${row.contractNo}:`, err);
    await recordEvent(row.id, row.status, spec.to, {
      degraded: true,
      note: chainErrorNote(err),
    });
  }

  return getContract(row.id, userId, role);
}

/** Quantity total, used by the settlement screen in session 11. */
export function totalAllocatedQuintals(row: ContractRow): number {
  return row.order.allocations.reduce((sum, a) => sum + toQuintals(a.allocatedQuintals), 0);
}
