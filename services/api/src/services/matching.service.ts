import type {
  AggregationProposal,
  Listing,
  MatchBreakdown,
  MatchCandidate,
  MatchComponentName,
  MatchResult,
} from "@fasalx/types";

import { env } from "../env.js";
import { HttpError } from "../lib/errors.js";
import { getRequirementCandidates } from "./requirement.service.js";

/**
 * CLAUDE.md: Node never runs the scoring. It gathers the candidate pool from
 * Postgres, posts it to the Python service, and maps the result back onto the
 * wire types. The weights and the greedy fill live in exactly one place.
 */

const MATCH_TIMEOUT_MS = 5000;

/** Shape of the Python service's POST /match response. */
interface AiMatchResponse {
  weights: Record<MatchComponentName, number>;
  ranked: {
    listingId: string;
    farmerId: string | null;
    rank: number;
    score: number;
    breakdown: MatchBreakdown;
  }[];
  aggregation: {
    selected: {
      listingId: string;
      allocatedQuintals: number;
      availableQuintals: number;
      isPartial: boolean;
      pricePerQuintal: number;
      score: number;
      rank: number;
    }[];
    runningTotals: number[];
    totalQuintals: number;
    targetQuintals: number;
    shortfallQuintals: number;
    satisfiable: boolean;
    weightedAveragePriceRupees: number;
    sumOfAsksRupees: number;
    farmerCount: number;
  };
}

async function callMatcher(
  requirement: { quantityQuintals: number; grade: string; targetPricePerQuintal: number; maxDistanceKm: number },
  candidates: Listing[],
): Promise<AiMatchResponse> {
  const body = {
    requirement: {
      quantityQuintals: requirement.quantityQuintals,
      grade: requirement.grade,
      targetPricePerQuintal: requirement.targetPricePerQuintal,
      maxDistanceKm: requirement.maxDistanceKm,
    },
    candidates: candidates.map((listing) => ({
      listingId: listing.id,
      farmerId: listing.farmer.id,
      farmerName: listing.farmer.name,
      pricePerQuintal: listing.expectedPricePerQuintal,
      availableQuintals: listing.availableQuintals,
      distanceKm: listing.distanceKm,
      grade: listing.grade,
      rating: listing.farmer.rating,
      completedOrders: listing.farmer.completedOrders,
    })),
  };

  let response: Response;
  try {
    response = await fetch(`${env.AI_SERVICE_URL}/match`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(MATCH_TIMEOUT_MS),
    });
  } catch {
    // Unlike the price card, matching has no honest degraded form: a ranking
    // Node invented would not be the ranking the engine produces, and the
    // buyer would be committing money against it.
    throw new HttpError(
      503,
      "MATCHING_UNAVAILABLE",
      "The matching service is not reachable. Start it with `pnpm ai:dev` and try again.",
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new HttpError(
      502,
      "MATCHING_FAILED",
      `The matching service rejected the request (${response.status}). ${detail.slice(0, 160)}`,
    );
  }

  return (await response.json()) as AiMatchResponse;
}

/** Ranked candidates for a requirement, with the reasoning per row. */
export async function runMatching(requirementId: string): Promise<MatchResult> {
  const { requirement, candidates, excluded } = await getRequirementCandidates(requirementId);

  if (candidates.length === 0) {
    return { requirement, weights: DEFAULT_WEIGHTS, candidates: [], excluded };
  }

  const ai = await callMatcher(requirement, candidates);
  const byId = new Map(candidates.map((listing) => [listing.id, listing]));

  const ranked: MatchCandidate[] = ai.ranked.flatMap((row) => {
    const listing = byId.get(row.listingId);
    if (!listing) return [];
    return [{ listing, rank: row.rank, score: row.score, breakdown: row.breakdown }];
  });

  return { requirement, weights: ai.weights, candidates: ranked, excluded };
}

/**
 * Weights used when there is nothing to score. Kept in sync with the Python
 * service, which is authoritative — this only labels an empty table.
 */
const DEFAULT_WEIGHTS: Record<MatchComponentName, number> = {
  price: 0.3,
  distance: 0.25,
  quantity: 0.2,
  quality: 0.15,
  reliability: 0.1,
};

/** The proposed aggregation for a requirement, before anything is committed. */
export async function proposeAggregation(requirementId: string): Promise<AggregationProposal> {
  const { requirement, candidates } = await getRequirementCandidates(requirementId);

  if (requirement.remainingQuintals <= 0) {
    throw new HttpError(
      409,
      "REQUIREMENT_ALREADY_FILLED",
      "This requirement is already fully sourced",
    );
  }

  if (candidates.length === 0) {
    return {
      requirement,
      allocations: [],
      targetQuintals: requirement.remainingQuintals,
      totalQuintals: 0,
      shortfallQuintals: requirement.remainingQuintals,
      satisfiable: false,
      weightedAveragePriceRupees: 0,
      sumOfAsksRupees: 0,
      farmerCount: 0,
    };
  }

  // Aggregate against what is still OUTSTANDING, not the original quantity —
  // a requirement that is part-filled should only source the remainder.
  const ai = await callMatcher(
    { ...requirement, quantityQuintals: requirement.remainingQuintals },
    candidates,
  );

  const byId = new Map(candidates.map((listing) => [listing.id, listing]));
  const allocations = ai.aggregation.selected.flatMap((item, index) => {
    const listing = byId.get(item.listingId);
    if (!listing) return [];
    return [
      {
        listing,
        rank: item.rank,
        score: item.score,
        allocatedQuintals: item.allocatedQuintals,
        isPartial: item.isPartial,
        pricePerQuintal: item.pricePerQuintal,
        cumulativeQuintals: ai.aggregation.runningTotals[index] ?? item.allocatedQuintals,
      },
    ];
  });

  return {
    requirement,
    allocations,
    targetQuintals: ai.aggregation.targetQuintals,
    totalQuintals: ai.aggregation.totalQuintals,
    shortfallQuintals: ai.aggregation.shortfallQuintals,
    satisfiable: ai.aggregation.satisfiable,
    weightedAveragePriceRupees: ai.aggregation.weightedAveragePriceRupees,
    sumOfAsksRupees: ai.aggregation.sumOfAsksRupees,
    farmerCount: ai.aggregation.farmerCount,
  };
}
