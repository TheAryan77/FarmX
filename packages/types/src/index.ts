/**
 * Shared FasalX wire types.
 *
 * CLAUDE.md: shared types live here and are imported by apps — never
 * duplicated. These describe what crosses the network, which is deliberately
 * not the same as the Prisma model: apps never import `@prisma/client`, so the
 * database layer cannot leak into a client bundle. The API maps Prisma rows to
 * these shapes, and guards the enums against drift with a compile-time check.
 *
 * Units, everywhere and without exception:
 *   - money    → whole rupees, as `number` (integer)
 *   - quantity → quintals, as `number` with at most 2 decimals. Never kg.
 */

export type Role = "FARMER" | "BUYER" | "FPO" | "ADMIN";

export type Grade = "A" | "B" | "C";

export type RequirementStatus =
  | "OPEN"
  | "MATCHING"
  | "PARTIALLY_FULFILLED"
  | "FULFILLED"
  | "CANCELLED"
  | "EXPIRED";

export type OfferStatus = "PENDING" | "COUNTERED" | "ACCEPTED" | "REJECTED" | "EXPIRED";

export type OfferParty = "BUYER" | "FARMER";

/** The on-chain escrow state machine, mirrored in FasalXEscrow.sol. */
export type ContractStatus =
  | "CREATED"
  | "ACCEPTED"
  | "FUNDED"
  | "PICKED_UP"
  | "DELIVERED"
  | "QC_APPROVED"
  | "RELEASED"
  | "DISPUTED"
  | "REFUNDED";

export type EscrowStatus = "PENDING" | "LOCKED" | "RELEASED" | "REFUNDED";

export type OrderStatus =
  | "CREATED"
  | "CONTRACTED"
  | "FUNDED"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "QC_PASSED"
  | "SETTLED"
  | "DISPUTED"
  | "CANCELLED";

export type ListingStatus =
  | "DRAFT"
  | "ACTIVE"
  | "RESERVED"
  | "PARTIALLY_ALLOCATED"
  | "SOLD"
  | "EXPIRED"
  | "CANCELLED";

/** Every API route returns one of these two shapes. */
export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export type ApiResponse<T> = { data: T } | { error: ApiError };

// ---------------------------------------------------------------- auth

export interface AuthUser {
  id: string;
  phone: string;
  name: string;
  role: Role;
  language: string;
  /** FarmerProfile / BuyerProfile / FpoProfile id, whichever matches the role. */
  profileId: string | null;
  district: string | null;
}

export interface RequestOtpResult {
  phone: string;
  expiresInSeconds: number;
  /**
   * Present only outside production. Mock OTP has no SMS provider, so the code
   * is surfaced here as well as logged, which keeps demo-day logins out of the
   * terminal. Never populated when NODE_ENV is production.
   */
  devOtp?: string;
}

export interface VerifyOtpResult {
  token: string;
  user: AuthUser;
}

/** Claims carried by the signed token. No PII beyond the user id. */
export interface JwtClaims {
  sub: string;
  role: Role;
}

// ---------------------------------------------------------------- listings

/** The seller, as shown on a public listing. No phone number. */
export interface ListingFarmer {
  id: string;
  name: string;
  village: string;
  district: string;
  rating: number;
  completedOrders: number;
}

export interface Listing {
  id: string;
  crop: string;
  grade: Grade;

  /** Total listed, in quintals. */
  quantityQuintals: number;
  /** Committed to an accepted offer or allocation, in quintals. */
  reservedQuintals: number;
  /** quantityQuintals − reservedQuintals. Derived server-side. */
  availableQuintals: number;

  /** Whole rupees per quintal. */
  expectedPricePerQuintal: number;
  /** availableQuintals × expectedPricePerQuintal, whole rupees. Derived. */
  totalValueRupees: number;

  /** ISO date, no time component (YYYY-MM-DD). */
  availableFrom: string;

  village: string;
  district: string;
  state: string;
  lat: number;
  lng: number;

  status: ListingStatus;
  notes: string | null;

  farmer: ListingFarmer;

  /**
   * Road-less great-circle distance from the requesting buyer's location, in
   * km. Present only when the caller is an authenticated buyer or an origin
   * was supplied; null otherwise. Haversine, no PostGIS — CLAUDE.md.
   */
  distanceKm: number | null;

  createdAt: string;
  updatedAt: string;
}

export interface ListingPage {
  listings: Listing[];
  total: number;
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------- market data

/**
 * Latest mandi price straight from PriceHistory. This is the pre-AI reading
 * the farmer home screen shows; session 7 replaces it with a prediction.
 */
export interface PriceSnapshot {
  crop: string;
  district: string;
  /** ISO date of the reading. */
  date: string;
  modalPricePerQuintal: number;
  minPricePerQuintal: number | null;
  maxPricePerQuintal: number | null;
  /** Change against the reading 7 days earlier, in whole rupees. */
  changeVs7dRupees: number | null;
  source: string;
}

// ---------------------------------------------------------------- requirements

/** The buyer, as shown on their own requirement. */
export interface RequirementBuyer {
  id: string;
  companyName: string;
  district: string;
  state: string;
  lat: number;
  lng: number;
}

export interface Requirement {
  id: string;
  crop: string;
  grade: Grade;

  /** What the buyer needs, in quintals. */
  quantityQuintals: number;
  /** Whole rupees per quintal the buyer is aiming at — a target, not a cap. */
  targetPricePerQuintal: number;
  maxDistanceKm: number;
  /** Smallest lot the buyer will coordinate a pickup for, in quintals. */
  minLotQuintals: number | null;

  /** ISO date, no time component. */
  deliveryBy: string;
  status: RequirementStatus;
  notes: string | null;

  buyer: RequirementBuyer;

  /** Committed through order allocations so far, in quintals. */
  allocatedQuintals: number;
  /** quantityQuintals − allocatedQuintals, floored at zero. */
  remainingQuintals: number;
  /** 0-100, rounded. Drives the dashboard fulfilment bar. */
  fulfilmentPercent: number;

  /** Whole rupees: quantityQuintals × targetPricePerQuintal. */
  estimatedValueRupees: number;

  createdAt: string;
  updatedAt: string;
}

/**
 * Supply that satisfies a requirement's own constraints — crop, grade, radius
 * and minimum lot. Unranked: session 8 adds the scoring and aggregation.
 */
export interface RequirementCandidates {
  requirement: Requirement;
  candidates: Listing[];
  /** Sum of availableQuintals across the candidates. */
  totalAvailableQuintals: number;
  /** Whether the candidate pool alone could fill the requirement. */
  satisfiable: boolean;
  /** How many listings were excluded, and why — shown as a rejection summary. */
  excluded: {
    wrongGrade: number;
    tooFar: number;
    belowMinLot: number;
  };
}

// ---------------------------------------------------------------- offers

/** One message in a negotiation. A counter is a new offer, not an edit. */
export interface Offer {
  id: string;
  listingId: string;
  requirementId: string | null;
  parentOfferId: string | null;

  /** Which side put this price on the table. */
  initiatedBy: OfferParty;
  /** Whole rupees per quintal. */
  pricePerQuintal: number;
  quantityQuintals: number;
  /** pricePerQuintal × quantityQuintals, whole rupees. Derived. */
  totalRupees: number;

  status: OfferStatus;
  expiresAt: string | null;
  createdAt: string;
}

/**
 * A whole negotiation, from the point of view of whoever asked.
 *
 * The API decides what the caller may do rather than making each client
 * re-derive the state machine — the farmer app and the buyer portal would
 * otherwise both have to know that you cannot accept your own price.
 */
export interface OfferThread {
  /** Id of the first offer in the chain. */
  rootId: string;
  /** The offer currently on the table — the only one that can be acted on. */
  latest: Offer;
  /** Oldest first, including `latest`. */
  history: Offer[];

  listing: {
    id: string;
    crop: string;
    grade: Grade;
    availableQuintals: number;
    expectedPricePerQuintal: number;
    village: string;
    district: string;
  };
  farmer: { id: string; name: string; village: string; district: string; rating: number };
  buyer: { id: string; companyName: string; district: string };

  /** True when the caller is the side that must respond. */
  awaitingYou: boolean;
  canAccept: boolean;
  canCounter: boolean;
  canReject: boolean;

  /** Set once the thread has been accepted. */
  orderId: string | null;
  orderNo: string | null;
}

// ---------------------------------------------------------------- orders

export interface OrderAllocation {
  id: string;
  listingId: string;
  farmer: { id: string; name: string; village: string; district: string };
  allocatedQuintals: number;
  pricePerQuintal: number;
  grossAmountRupees: number;
  /** Populated by the matching engine in session 8. */
  matchScore: number | null;
  matchRank: number | null;
  distanceKm: number | null;
}

export interface Order {
  id: string;
  /** Human-readable reference, e.g. FSL1024. */
  orderNo: string;
  crop: string;
  grade: Grade;

  totalQuintals: number;
  settledPricePerQuintal: number;
  grossAmountRupees: number;

  deliveryBy: string;
  status: OrderStatus;
  /** True when filled by aggregating several farmers (session 8). */
  isAggregated: boolean;

  buyer: { id: string; companyName: string; district: string };
  requirementId: string | null;
  sourceOfferId: string | null;

  allocations: OrderAllocation[];

  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------- AI price

export type PriceRecommendation = "SELL_NOW" | "HOLD" | "SELL_PARTIAL";

export type DemandLevel = "LOW" | "MODERATE" | "HIGH";

/**
 * How much unmet buyer demand exists on the platform right now.
 *
 * A real number from the marketplace, not a model output: the sum of what open
 * requirements still need. The level is a pilot-scale bucketing of that
 * quantity, and the underlying figure is always shown alongside so nobody has
 * to take the label on trust.
 */
export interface DemandSignal {
  level: DemandLevel;
  /** Quintals of open requirement still to be sourced in this district. */
  unfilledQuintals: number;
  openRequirements: number;
  /** Quintals currently listed and still uncommitted in this district. */
  availableSupplyQuintals: number;
}

/** What backs any accuracy claim about the model. */
export interface PriceModelInfo {
  trainedAt: string | null;
  dataSource: string | null;
  /** Mean absolute error on the held-out period, whole rupees per quintal. */
  maeRupees: number | null;
  /** Mean absolute percentage error, 0-1. */
  mape: number | null;
  /** Error of a "price will not change" baseline, for comparison. */
  naiveMaeRupees: number | null;
  /** Fractional reduction in error versus that baseline. */
  skillVsNaive: number | null;
  trainRows: number | null;
  testRows: number | null;
  /** Band within which `confidence` was measured, 0-1. */
  tolerancePct: number | null;
}

export interface PricePrediction {
  crop: string;
  district: string;
  /** Date of the latest reading the forecast was made from. */
  asOf: string;
  horizonDays: number;

  /** All whole rupees per quintal. */
  current: number;
  predicted: number;
  low: number;
  high: number;

  /** Fractional change from current to predicted. */
  deltaPct: number;
  /** Share of held-out predictions inside the tolerance band, 0-1. */
  confidence: number;
  recommendation: PriceRecommendation;

  demand: DemandSignal;
  model: PriceModelInfo | null;

  /**
   * "model" when the prediction came from the trained model, "fallback" when
   * the AI service was unreachable and this is the latest mandi reading with
   * no forecast attached. The UI must say which.
   */
  source: "model" | "fallback";
}

// ---------------------------------------------------------------- matching

/** One scored dimension, kept explainable end to end. */
export interface MatchComponent {
  /** The underlying value — ₹/quintal, km, quintals, or a star rating. */
  raw: number;
  /** That value scaled 0-1 against the candidate pool's own range. */
  normalised: number;
  /** normalised × this component's weight — the points it contributed. */
  weighted: number;
}

export type MatchComponentName =
  | "price"
  | "distance"
  | "quantity"
  | "quality"
  | "reliability";

export type MatchBreakdown = Record<MatchComponentName, MatchComponent>;

/** A candidate listing with its score and the reasoning behind it. */
export interface MatchCandidate {
  listing: Listing;
  rank: number;
  /** 0-1, the weighted sum of the breakdown. */
  score: number;
  breakdown: MatchBreakdown;
}

/** What the greedy fill proposes, before the buyer commits to it. */
export interface AggregationAllocation {
  listing: Listing;
  rank: number;
  score: number;
  allocatedQuintals: number;
  /** True when only part of this farmer's lot is taken. */
  isPartial: boolean;
  pricePerQuintal: number;
  /** Running total after this farmer is added — what the UI animates. */
  cumulativeQuintals: number;
}

export interface AggregationProposal {
  requirement: Requirement;
  allocations: AggregationAllocation[];

  targetQuintals: number;
  totalQuintals: number;
  shortfallQuintals: number;
  satisfiable: boolean;

  /** Quantity-weighted average of the selected farmers' asking prices. */
  weightedAveragePriceRupees: number;
  /** What the selection costs if every farmer is paid their own ask. */
  sumOfAsksRupees: number;
  farmerCount: number;
}

export interface MatchResult {
  requirement: Requirement;
  weights: Record<MatchComponentName, number>;
  candidates: MatchCandidate[];
  /** Counts of supply the constraints rejected, and why. */
  excluded: { wrongGrade: number; tooFar: number; belowMinLot: number };
}

// ---------------------------------------------------------------- contracts

/** One recorded transition, with the transaction that carried it. */
export interface ContractEvent {
  id: string;
  fromStatus: ContractStatus | null;
  toStatus: ContractStatus;
  txHash: string | null;
  /** Explorer link, when the chain has one. Local chains do not. */
  explorerUrl: string | null;
  blockNumber: number | null;
  /**
   * True when the transition was recorded off-chain because the chain was
   * unreachable. The UI must label these — they are an intent, not a fact.
   */
  degraded: boolean;
  note: string | null;
  createdAt: string;
}

export interface EscrowView {
  status: EscrowStatus;
  /** Whole rupees held. The farmer only ever sees this, never a token amount. */
  amountRupees: number;
  fundedTxHash: string | null;
  fundedExplorerUrl: string | null;
  releasedTxHash: string | null;
  releasedExplorerUrl: string | null;
  fundedAt: string | null;
  releasedAt: string | null;
}

/** What the chain itself currently says, read live rather than from our copy. */
export interface OnChainDeal {
  dealId: string;
  status: ContractStatus | null;
  amountRupees: number;
  /** Native token held, as a string to survive JSON. Never shown to a farmer. */
  escrowedWei: string;
  contractHash: string;
  buyerAddress: string;
  sellerAddress: string;
}

export interface ChainInfo {
  name: string;
  chainId: number;
  explorerUrl: string | null;
  escrowAddress: string | null;
}

export interface ContractRecord {
  id: string;
  contractNo: string;
  orderId: string;
  order: Order;

  /** Our record of where the deal has got to. */
  status: ContractStatus;
  amountRupees: number;

  /** SHA-256 of the contract PDF — the value written on-chain. */
  pdfSha256: string | null;
  /** API path to download the PDF. Not a filesystem path. */
  pdfUrl: string | null;

  onChainDealId: string | null;
  buyerAddress: string | null;
  sellerAddress: string | null;
  chainId: number | null;

  escrow: EscrowView | null;
  events: ContractEvent[];

  /**
   * Live chain state, or null when the chain could not be read. When this
   * disagrees with `status`, the chain is the authority on escrow and the UI
   * says so.
   */
  onChain: OnChainDeal | null;
  chain: ChainInfo;
  /** Set when the chain is unreachable, so the UI can explain rather than fail. */
  degradedReason: string | null;
}

/** Actions that drive the escrow forward, as the API exposes them. */
export type ContractAction =
  | "accept"
  | "fund"
  | "pickup"
  | "deliver"
  | "approve-quality"
  | "release"
  | "dispute"
  | "refund";
