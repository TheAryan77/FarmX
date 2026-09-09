import type { MatchBreakdown, MatchComponentName } from "@fasalx/types";

/**
 * The match score, drawn as its own explanation.
 *
 * Each segment's width is that component's *weighted* contribution, so the bar
 * length is the score and the composition shows how it was earned. A buyer can
 * see at a glance that one farmer ranked on price while another ranked on
 * distance — which a bare number cannot convey, and which is the difference
 * between a ranking they trust and one they have to take on faith.
 */

const ORDER: MatchComponentName[] = ["price", "distance", "quantity", "quality", "reliability"];

const SEGMENT: Record<MatchComponentName, { label: string; className: string }> = {
  price: { label: "Price", className: "bg-chart-1" },
  distance: { label: "Distance", className: "bg-chart-2" },
  quantity: { label: "Quantity", className: "bg-chart-3" },
  quality: { label: "Quality", className: "bg-chart-4" },
  reliability: { label: "Reliability", className: "bg-chart-5" },
};

const UNIT: Record<MatchComponentName, (raw: number) => string> = {
  price: (raw) => `₹${Math.round(raw)}/Q`,
  distance: (raw) => `${raw.toFixed(1)} km`,
  quantity: (raw) => `${raw}Q`,
  quality: () => "grade match",
  reliability: (raw) => `${raw.toFixed(1)}★`,
};

export function ScoreBar({
  score,
  breakdown,
}: {
  score: number;
  breakdown: MatchBreakdown;
}) {
  return (
    <div className="min-w-40 space-y-1">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-bold tabular-nums">{score.toFixed(3)}</span>
        <span className="text-xs text-muted-foreground">/ 1.000</span>
      </div>
      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-secondary"
        role="img"
        aria-label={`Score ${score.toFixed(3)} from ${ORDER.map(
          (name) => `${SEGMENT[name].label} ${(breakdown[name].weighted * 100).toFixed(1)} points`,
        ).join(", ")}`}
      >
        {ORDER.map((name) => {
          const component = breakdown[name];
          return (
            <span
              key={name}
              className={SEGMENT[name].className}
              style={{ width: `${component.weighted * 100}%` }}
              title={`${SEGMENT[name].label}: ${UNIT[name](component.raw)} → ${(
                component.normalised * 100
              ).toFixed(0)}% of the pool's best, contributing ${(
                component.weighted * 100
              ).toFixed(1)} points`}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Legend for the stacked bars, with the weight each component carries. */
export function ScoreLegend({ weights }: { weights: Record<MatchComponentName, number> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Score =</span>
      {ORDER.map((name, index) => (
        <span key={name} className="flex items-center gap-1.5">
          {index > 0 ? <span aria-hidden>+</span> : null}
          <span className={`inline-block size-2.5 rounded-sm ${SEGMENT[name].className}`} />
          {Math.round((weights[name] ?? 0) * 100)}% {SEGMENT[name].label.toLowerCase()}
        </span>
      ))}
      <span>· each normalised against the candidates actually available</span>
    </div>
  );
}
