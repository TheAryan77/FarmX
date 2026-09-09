import { ESCROW_STATUS, fasalXEscrowAbi } from "@fasalx/blockchain/abi";
import type { ContractStatus } from "@fasalx/types";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { env } from "../env.js";

/**
 * The only place in the codebase that talks to a chain.
 *
 * CLAUDE.md: blockchain calls happen from the API layer's contract service,
 * never from a client. Private keys stay here, server-side, and nothing about
 * them reaches a browser.
 *
 * Development runs against a local Hardhat node. Moving to Polygon Amoy is a
 * matter of pointing CHAIN_RPC_URL and the keys at Amoy and redeploying —
 * nothing in this file, the contract, or the UI changes.
 */

export const escrowAbi = fasalXEscrowAbi;

/**
 * Rupees are the contractual unit; the chain holds native token as a stand-in
 * for that settlement. This is a fixed demo constant, NOT an exchange rate,
 * and no claim is made that it is one. ₹1,210,000 becomes 1.21 native tokens.
 */
export const WEI_PER_RUPEE = 10n ** 12n;

export function rupeesToWei(rupees: number): bigint {
  return BigInt(Math.round(rupees)) * WEI_PER_RUPEE;
}

/** A deal id the contract can key on: keccak256 of the off-chain contract number. */
export function dealIdFor(contractNo: string): Hex {
  return keccak256(toHex(contractNo));
}

/** Maps the contract's Status index onto the Prisma ContractStatus enum. */
export function statusFromIndex(index: number): ContractStatus | null {
  const name = ESCROW_STATUS[index];
  return name === undefined || name === "NONE" ? null : (name as ContractStatus);
}

const chain = defineChain({
  id: env.CHAIN_ID,
  name: env.CHAIN_NAME,
  nativeCurrency: { name: "Native", symbol: "POL", decimals: 18 },
  rpcUrls: { default: { http: [env.CHAIN_RPC_URL] } },
  ...(env.CHAIN_EXPLORER_URL
    ? { blockExplorers: { default: { name: "Explorer", url: env.CHAIN_EXPLORER_URL } } }
    : {}),
});

/** Link to a transaction, when the chain has a block explorer. Local has none. */
export function explorerTxUrl(txHash: string): string | null {
  return env.CHAIN_EXPLORER_URL ? `${env.CHAIN_EXPLORER_URL}/tx/${txHash}` : null;
}

export interface ChainConfig {
  publicClient: PublicClient;
  /** Owns the escrow: creates deals and attests logistics events. */
  platform: WalletClient;
  /**
   * The demo buyer. Only the buyer may fund a deal or approve quality, by
   * design — so for the demo the API signs on their behalf. In production the
   * buyer signs from their own wallet and the API never holds this key.
   */
  buyer: WalletClient;
  escrowAddress: Address;
  settlementAddress: Address;
}

let cached: ChainConfig | null = null;

/**
 * Returns the configured clients, or null when the chain is not set up.
 *
 * Null rather than throwing: a missing contract address is a normal state
 * before `pnpm chain:deploy`, and the rest of the marketplace must keep
 * working without it.
 */
export function getChain(): ChainConfig | null {
  if (cached) return cached;

  if (!env.ESCROW_CONTRACT_ADDRESS || !env.PLATFORM_PRIVATE_KEY || !env.BUYER_PRIVATE_KEY) {
    return null;
  }

  const transport = http(env.CHAIN_RPC_URL);
  const platformAccount = privateKeyToAccount(env.PLATFORM_PRIVATE_KEY as Hex);
  const buyerAccount = privateKeyToAccount(env.BUYER_PRIVATE_KEY as Hex);

  cached = {
    publicClient: createPublicClient({ chain, transport }) as PublicClient,
    platform: createWalletClient({ account: platformAccount, chain, transport }),
    buyer: createWalletClient({ account: buyerAccount, chain, transport }),
    escrowAddress: env.ESCROW_CONTRACT_ADDRESS as Address,
    settlementAddress: (env.SETTLEMENT_ADDRESS || buyerAccount.address) as Address,
  };
  return cached;
}

/** Human-readable reason the chain is unavailable, for the degraded state. */
export function chainUnavailableReason(): string {
  if (!env.ESCROW_CONTRACT_ADDRESS) {
    return "No escrow contract deployed. Run `pnpm chain` then `pnpm chain:deploy`.";
  }
  if (!env.PLATFORM_PRIVATE_KEY || !env.BUYER_PRIVATE_KEY) {
    return "Chain signing keys are not configured — see .env.example.";
  }
  return "The chain is not reachable.";
}

/** Chain details the UI needs, with no key material. */
export function chainInfo(): {
  name: string;
  chainId: number;
  explorerUrl: string | null;
  escrowAddress: string | null;
} {
  return {
    name: env.CHAIN_NAME,
    chainId: env.CHAIN_ID,
    explorerUrl: env.CHAIN_EXPLORER_URL || null,
    escrowAddress: env.ESCROW_CONTRACT_ADDRESS || null,
  };
}
