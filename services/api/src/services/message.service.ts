import type { Message, MessageContact, MessageThread } from "@fasalx/types";
import type { Prisma } from "@prisma/client";

import { HttpError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { requireFarmerProfile } from "./listing.service.js";

/**
 * Direct contact between a buyer and the farmers supplying one order.
 *
 * **Phone numbers are the sensitive part of this feature**, and the rule is
 * that they are only ever shown between people already trading with each
 * other. A buyer browsing `/supply` sees twelve farmers and none of their
 * numbers; a buyer who has an order with four of them sees exactly those four.
 * Without that gate the listings page becomes a way to harvest contact details
 * for everyone on the platform, which would hurt the farmers this is meant to
 * help — and they have no way to withdraw a number once it is out.
 *
 * The thread is the (orderId, farmerId) pair rather than a room per order.
 * An aggregated order has one thread per farmer, so no farmer learns who else
 * is filling the order or at what price.
 */

const messageInclude = {
  sender: { select: { id: true, name: true } },
} satisfies Prisma.MessageInclude;

type MessageRow = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

function toMessage(row: MessageRow, userId: string): Message {
  return {
    id: row.id,
    body: row.body,
    mine: row.senderUserId === userId,
    senderName: row.sender.name,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Loads the order and proves the caller is a party to it. */
async function loadOrderForParty(orderId: string, userId: string, role: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      buyer: { include: { user: { select: { id: true, name: true, phone: true } } } },
      allocations: {
        include: {
          farmer: { include: { user: { select: { id: true, name: true, phone: true } } } },
        },
      },
    },
  });
  if (!order) {
    throw HttpError.notFound("ORDER_NOT_FOUND", "That order no longer exists");
  }

  if (role === "BUYER") {
    if (order.buyer.userId !== userId) {
      throw HttpError.forbidden("You are not a party to this order");
    }
    return { order, farmerId: null as string | null };
  }

  if (role === "FARMER") {
    const farmer = await requireFarmerProfile(userId);
    const mine = order.allocations.some((a) => a.farmerId === farmer.id);
    if (!mine) {
      throw HttpError.forbidden("You are not a party to this order");
    }
    return { order, farmerId: farmer.id };
  }

  throw HttpError.forbidden("Messaging is for the buyer and farmers on an order");
}

/**
 * Threads on one order.
 *
 * A buyer gets one per farmer; a farmer gets only their own. Contact details
 * come back with each thread because the caller has already been proved a
 * party to the trade.
 */
export async function listThreads(
  orderId: string,
  userId: string,
  role: string,
): Promise<MessageThread[]> {
  const { order, farmerId } = await loadOrderForParty(orderId, userId, role);

  const allocations =
    farmerId === null
      ? order.allocations
      : order.allocations.filter((a) => a.farmerId === farmerId);

  const rows = await prisma.message.findMany({
    where: {
      orderId,
      farmerId: { in: allocations.map((a) => a.farmerId) },
    },
    include: messageInclude,
    orderBy: { createdAt: "asc" },
  });

  const buyerContact: MessageContact = {
    name: order.buyer.user.name,
    phone: order.buyer.user.phone,
    role: "BUYER",
    subtitle: order.buyer.companyName,
  };

  return allocations.map((allocation) => {
    const mine = rows.filter((row) => row.farmerId === allocation.farmerId);
    // A farmer talks to the buyer; the buyer talks to each farmer.
    const contact: MessageContact =
      role === "FARMER"
        ? buyerContact
        : {
            name: allocation.farmer.user.name,
            phone: allocation.farmer.user.phone,
            role: "FARMER",
            subtitle: allocation.farmer.village,
          };

    return {
      orderId,
      orderNo: order.orderNo,
      farmerId: allocation.farmerId,
      contact,
      messages: mine.map((row) => toMessage(row, userId)),
      unread: mine.filter((row) => row.senderUserId !== userId && row.readAt === null).length,
    };
  });
}

/** Posts a message into one thread and marks the other side's as read. */
export async function sendMessage(
  userId: string,
  role: string,
  input: { orderId: string; farmerId?: string; body: string },
): Promise<MessageThread[]> {
  const { order, farmerId: ownFarmerId } = await loadOrderForParty(input.orderId, userId, role);

  // A farmer may only write in their own thread, whatever they ask for.
  const farmerId = ownFarmerId ?? input.farmerId;
  if (!farmerId) {
    throw HttpError.badRequest("FARMER_REQUIRED", "Choose which farmer to message");
  }
  if (!order.allocations.some((a) => a.farmerId === farmerId)) {
    throw HttpError.badRequest("NOT_ON_ORDER", "That farmer is not supplying this order");
  }

  await prisma.$transaction([
    prisma.message.create({
      data: { orderId: input.orderId, farmerId, senderUserId: userId, body: input.body },
    }),
    // Writing a reply means you have read what came before it.
    prisma.message.updateMany({
      where: { orderId: input.orderId, farmerId, senderUserId: { not: userId }, readAt: null },
      data: { readAt: new Date() },
    }),
  ]);

  return listThreads(input.orderId, userId, role);
}

/** Marks the other side's messages in one thread as read. */
export async function markRead(
  orderId: string,
  farmerId: string,
  userId: string,
  role: string,
): Promise<{ ok: true }> {
  const { farmerId: ownFarmerId } = await loadOrderForParty(orderId, userId, role);
  const target = ownFarmerId ?? farmerId;

  await prisma.message.updateMany({
    where: { orderId, farmerId: target, senderUserId: { not: userId }, readAt: null },
    data: { readAt: new Date() },
  });
  return { ok: true };
}
