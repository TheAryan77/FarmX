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

// ---------------------------------------------------------------- logistics

export type ShipmentStatus =
  | "PLANNED"
  | "PICKUP_SCHEDULED"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "CANCELLED";

export type StopStatus = "PENDING" | "ARRIVED" | "LOADED" | "SKIPPED";

export interface ShipmentStop {
  id: string;
  sequence: number;
  /** Which vehicle in the plan makes this stop. */
  vehicleNumber: number;
  farmer: { id: string; name: string; village: string; district: string };
  lat: number;
  lng: number;
  quantityQuintals: number;
  /** Estimated road distance travelled to reach this stop from the previous one. */
  legDistanceKm: number;
  status: StopStatus;
  arrivedAt: string | null;
  loadedAt: string | null;
}

/** One vehicle's leg of the plan, for drawing a route line per truck. */
export interface ShipmentVehicle {
  vehicleNumber: number;
  loadQuintals: number;
  roadKm: number;
  /** Stop sequence numbers this vehicle visits, in order. */
  stopSequences: number[];
}

export interface Shipment {
  id: string;
  orderId: string;
  status: ShipmentStatus;

  vehicleClass: string;
  vehicleLabel: string;
  vehicleCount: number;
  capacityQuintals: number;
  rupeesPerKm: number | null;

  /** Estimated road distance — great-circle × a circuity factor, not routed. */
  totalDistanceKm: number;
  straightLineKm: number | null;
  totalQuintals: number;

  optimisedCostRupees: number;
  /**
   * One round trip per farm — collection without aggregation. The headline
   * saving is measured against this because it is what FasalX replaces.
   */
  naiveCostRupees: number;
  naiveDistanceKm: number;
  /** Same fleet in listed order; often equal to optimised on a small order. */
  sequencingCostRupees: number | null;

  savingRupees: number;
  savingPercent: number;

  destinationLat: number;
  destinationLng: number;
  destinationLabel: string;

  stops: ShipmentStop[];
  vehicles: ShipmentVehicle[];

  /** Stated so a reader can argue with the cost model rather than trust it. */
  assumptions: { roadCircuityFactor: number; note: string; baseline: string } | null;

  createdAt: string;
}

// ---------------------------------------------------------------- quality + settlement

export type QcStatus = "PENDING" | "APPROVED" | "REJECTED";

export type SettlementStatus = "PENDING" | "RELEASED" | "PAID" | "FAILED";

export interface QualityCheck {
  id: string;
  orderId: string;
  /** Grade the buyer actually found on delivery. */
  gradeFound: Grade;
  /** Grade the order was agreed at, for comparison. */
  gradeAgreed: Grade;
  moisturePct: number | null;
  status: QcStatus;
  notes: string | null;
  /** API path to the delivery proof photo, if one was uploaded. */
  proofUrl: string | null;
  inspectorName: string | null;
  checkedAt: string | null;
  createdAt: string;
}

/**
 * What one farmer actually receives, and how it was arrived at.
 *
 * Every figure is derived from the order, the shipment and two named
 * constants — none of it is stored as a magic number. `assumptions` carries
 * those constants so the UI can label them rather than presenting the
 * comparison as fact.
 */
export interface Settlement {
  id: string;
  orderId: string;
  orderNo: string;
  farmer: { id: string; name: string; village: string };

  allocatedQuintals: number;
  pricePerQuintal: number;

  /** allocatedQuintals × pricePerQuintal */
  grossRupees: number;
  /** This farmer's share of the collection cost, by quantity. */
  logisticsShareRupees: number;
  platformFeeRupees: number;
  /** gross − logistics − platform fee */
  netRupees: number;

  /** Illustrative estimate of the same sale through the mandi channel. */
  traditionalEstimateRupees: number;
  /** net − traditional estimate */
  farmerGainRupees: number;
  /** Gain as a share of the traditional estimate, 0-1. */
  farmerGainPercent: number;

  status: SettlementStatus;
  releasedAt: string | null;
  txHash: string | null;
  createdAt: string;
}

/** The named constants behind every settlement figure. */
export interface SettlementAssumptions {
  platformFeeRate: number;
  traditionalRealisationRate: number;
  /** Plain-language account of what the traditional rate stands for. */
  traditionalNote: string;
  logisticsNote: string;
}

export interface SettlementView {
  settlements: Settlement[];
  assumptions: SettlementAssumptions;
}

/** Month-to-date figures for the farmer's own dashboard. */
export interface FarmerEarnings {
  monthLabel: string;
  totalSalesRupees: number;
  totalQuintals: number;
  /** Quantity-weighted average price realised, whole rupees per quintal. */
  averagePriceRealised: number;
  /** Sum of net − traditional estimate across settled deals. */
  additionalRealisationRupees: number;
  orders: number;
  successfulDeliveries: number;
  settlements: Settlement[];
  assumptions: SettlementAssumptions;
}

// ------------------------------------------------------------------- admin

/**
 * Platform-level figures for the operations dashboard.
 *
 * CLAUDE.md's north star is value reaching the farmer per transaction, so the
 * admin view leads with the same number the farmer sees — just summed across
 * every settled deal instead of one. Nothing here is stored: it is all derived
 * from orders, settlements and shipments at read time.
 */
export interface AdminImpact {
  settledOrders: number;
  quintalsTraded: number;
  grossValueRupees: number;
  paidToFarmersRupees: number;
  logisticsCostRupees: number;
  platformFeeRupees: number;
  /** Sum of net − mandi estimate across every settlement. */
  extraVsTraditionalRupees: number;
  /** Weighted, as a fraction: 0.12 is 12% more than the traditional channel. */
  averageGainPercent: number;
  /** Fraction of gross that reached farmers. The headline ratio. */
  farmerSharePercent: number;
  farmersPaid: number;
}

export interface AdminNetwork {
  farmers: number;
  buyers: number;
  fpos: number;
  activeListings: number;
  listedQuintals: number;
  openRequirements: number;
  requiredQuintals: number;
}

export interface AdminPipelineRow {
  status: OrderStatus;
  orders: number;
  quintals: number;
  valueRupees: number;
}

export interface AdminLogistics {
  shipments: number;
  vehiclesDispatched: number;
  optimisedCostRupees: number;
  /** What separate round trips would have cost — the headline baseline. */
  baselineCostRupees: number;
  savedRupees: number;
  savedPercent: number;
}

export interface AdminChainStatusRow {
  status: ContractStatus;
  count: number;
}

export interface AdminChain {
  configured: boolean;
  contracts: AdminChainStatusRow[];
  /** Transitions the chain refused or could not be reached for. */
  degradedEvents: number;
  escrowLockedRupees: number;
}

export type AdminAlertSeverity = "critical" | "warning";

/**
 * Something an operator needs to act on.
 *
 * These are derived by checking the data against itself rather than read from
 * a status column — an order that says SETTLED while no farmer was paid is
 * exactly the kind of silent failure a status column cannot report.
 */
export interface AdminAlert {
  severity: AdminAlertSeverity;
  code: string;
  title: string;
  detail: string;
  orderId?: string;
  orderNo?: string;
}

export interface AdminOrderRow {
  id: string;
  orderNo: string;
  status: OrderStatus;
  buyerName: string;
  quintals: number;
  pricePerQuintal: number;
  grossRupees: number;
  farmers: number;
  settlements: number;
  createdAt: string;
}

export interface AdminServiceHealth {
  name: string;
  target: string;
  ok: boolean;
  detail: string;
}

export interface AdminOverview {
  generatedAt: string;
  impact: AdminImpact;
  network: AdminNetwork;
  pipeline: AdminPipelineRow[];
  logistics: AdminLogistics;
  chain: AdminChain;
  alerts: AdminAlert[];
  recentOrders: AdminOrderRow[];
  services: AdminServiceHealth[];
  assumptions: SettlementAssumptions;
}

export type KycStatus = "NOT_STARTED" | "PENDING" | "VERIFIED" | "REJECTED";

/** One row of the admin farmer directory. Earnings are summed from settlements. */
export interface AdminFarmerRow {
  id: string;
  name: string;
  phone: string;
  village: string;
  district: string;
  farmSizeAcres: number;
  rating: number;
  completedOrders: number;
  kycStatus: KycStatus;
  activeListings: number;
  listedQuintals: number;
  soldQuintals: number;
  earnedRupees: number;
  gainRupees: number;
}

export interface AdminListingRow {
  id: string;
  farmerId: string;
  farmerName: string;
  village: string;
  crop: string;
  grade: Grade;
  quantityQuintals: number;
  reservedQuintals: number;
  expectedPricePerQuintal: number;
  status: ListingStatus;
  availableFrom: string;
  createdAt: string;
}

/** A farmer's share of one order, as operations needs to see it. */
export interface AdminAllocationRow {
  farmerId: string;
  farmerName: string;
  village: string;
  allocatedQuintals: number;
  pricePerQuintal: number;
  grossRupees: number;
  /** Null when no payout has been written for this allocation. */
  netRupees: number | null;
  gainRupees: number | null;
}

export interface AdminOrderDetail {
  order: AdminOrderRow;
  grade: Grade;
  deliveryBy: string;
  isAggregated: boolean;
  allocations: AdminAllocationRow[];
  contract: {
    contractNo: string;
    status: ContractStatus;
    escrowStatus: string | null;
    amountRupees: number;
    pdfSha256: string | null;
    onChainDealId: string | null;
  } | null;
  shipment: {
    status: string;
    vehicleClass: string;
    vehicleCount: number;
    totalDistanceKm: number;
    optimisedCostRupees: number;
    naiveCostRupees: number;
    stops: number;
  } | null;
  quality: {
    status: string;
    gradeAssessed: Grade | null;
    moisturePercent: number | null;
    notes: string | null;
    checkedAt: string | null;
  } | null;
  assumptions: SettlementAssumptions;
}

// -------------------------------------------------------------------- chat

export type ChatLanguage = "en" | "hi";

export interface ChatAnswer {
  answer: string;
  language: ChatLanguage;
  /**
   * True when the answer came from the offline summary rather than the model.
   * Surfaced so the UI can say so — passing a template off as the assistant's
   * own reasoning would be a small lie told repeatedly.
   */
  offline: boolean;
}
