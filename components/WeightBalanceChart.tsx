"use client";
// The CG envelope, with today's load plotted on it.
//
// Two departures from the graph printed in the POH, both deliberate:
//
//   • The horizontal axis is CG in INCHES, not moment. The limits are quoted
//     in inches (35.0 to 45.5), so an inches axis can be checked against the
//     printed numbers by eye. The POH plots moment because it saves the reader
//     a division — which is not a saving a computer needs to make.
//
//   • Two points are plotted, not one, joined by the line the CG actually
//     walks as the fuel goes. The tanks sit at 48 in, aft of where a loaded
//     172's CG ends up, so every flight drifts FORWARD in the air. A takeoff
//     point on its own is half the check.
//
// The axes stretch to contain the load if it falls outside the envelope: a
// point clamped to the frame would quietly understate how far out of limits a
// bad load is, which is the one moment this chart has a job to do.
import {
  envelopePolygon,
  type WeightBalanceProfile,
  type WeightBalanceResult,
} from "@/lib/weightBalance";

const WIDTH = 420;
const HEIGHT = 320;
const PAD = { top: 14, right: 14, bottom: 36, left: 50 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

export default function WeightBalanceChart({
  profile,
  takeoff,
  landing,
}: {
  profile: WeightBalanceProfile;
  takeoff: WeightBalanceResult;
  /** The same airplane with the usable fuel burned off. */
  landing: WeightBalanceResult;
}) {
  const envelope = envelopePolygon(profile);
  const points = [takeoff, landing].filter((r) => r.cgIn !== null);

  // Domain wide enough for the envelope AND wherever the load actually landed.
  const cgs = points.map((p) => p.cgIn!);
  const weights = points.map((p) => p.totalWeightLbs);
  const xMin = Math.min(profile.forwardCgIn - 2.5, ...cgs.map((c) => c - 1));
  const xMax = Math.max(profile.aftCgIn + 2.5, ...cgs.map((c) => c + 1));
  const yMin = Math.min(profile.envelopeFloorLbs - 100, ...weights.map((w) => w - 60));
  const yMax = Math.max(profile.maxGrossLbs + 120, ...weights.map((w) => w + 60));

  const sx = (cg: number) => PAD.left + ((cg - xMin) / (xMax - xMin)) * PLOT_W;
  const sy = (w: number) => PAD.top + ((yMax - w) / (yMax - yMin)) * PLOT_H;

  const envelopePath =
    envelope.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.cgIn)},${sy(p.weightLbs)}`).join(" ") +
    " Z";

  const weightTicks = ticks(yMin, yMax, 100).filter((t) => t % 200 === 0);
  const cgTicks = ticks(xMin, xMax, 1).filter((t) => t % 2 === 0);

  return (
    <figure className="space-y-2">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={
          takeoff.cgIn === null
            ? "Centre of gravity envelope"
            : `Centre of gravity envelope. Loaded to ${takeoff.totalWeightLbs} pounds at ${takeoff.cgIn} inches, which is ${
                takeoff.withinLimits ? "inside" : "outside"
              } the envelope.`
        }
      >
        {/* Grid + axes. Drawn first so everything else sits on top. */}
        {weightTicks.map((w) => (
          <g key={`w${w}`}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={sy(w)}
              y2={sy(w)}
              className="stroke-gray-200 dark:stroke-gray-700"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 6}
              y={sy(w) + 3}
              textAnchor="end"
              fontSize={9}
              className="fill-gray-500 dark:fill-gray-400"
            >
              {w.toLocaleString("en-US")}
            </text>
          </g>
        ))}
        {cgTicks.map((c) => (
          <text
            key={`c${c}`}
            x={sx(c)}
            y={HEIGHT - PAD.bottom + 13}
            textAnchor="middle"
            fontSize={9}
            className="fill-gray-500 dark:fill-gray-400"
          >
            {c}
          </text>
        ))}

        {/* The envelope itself. */}
        <path
          d={envelopePath}
          className="fill-indigo-500/10 stroke-indigo-500 dark:fill-indigo-400/10 dark:stroke-indigo-400"
          strokeWidth={1.5}
        />

        {/* Gross weight, called out where it stops being a line and starts
            being the reason you're leaving a bag behind. */}
        <text
          x={sx(profile.aftCgIn) + 4}
          y={sy(profile.maxGrossLbs) - 4}
          fontSize={9}
          className="fill-indigo-600 dark:fill-indigo-300"
        >
          {profile.maxGrossLbs.toLocaleString("en-US")} lb
        </text>

        {/* Fuel burn: takeoff → landing, the direction the CG travels. */}
        {takeoff.cgIn !== null && landing.cgIn !== null && (
          <line
            x1={sx(takeoff.cgIn)}
            y1={sy(takeoff.totalWeightLbs)}
            x2={sx(landing.cgIn)}
            y2={sy(landing.totalWeightLbs)}
            className="stroke-gray-400 dark:stroke-gray-500"
            strokeWidth={1.5}
            strokeDasharray="3 3"
          />
        )}

        {landing.cgIn !== null && (
          <circle
            cx={sx(landing.cgIn)}
            cy={sy(landing.totalWeightLbs)}
            r={4.5}
            className={
              landing.withinLimits
                ? "fill-white stroke-gray-500 dark:fill-gray-800 dark:stroke-gray-400"
                : "fill-white stroke-red-600 dark:fill-gray-800 dark:stroke-red-400"
            }
            strokeWidth={2}
          />
        )}
        {takeoff.cgIn !== null && (
          <circle
            cx={sx(takeoff.cgIn)}
            cy={sy(takeoff.totalWeightLbs)}
            r={5}
            className={
              takeoff.withinLimits
                ? "fill-indigo-600 dark:fill-indigo-400"
                : "fill-red-600 dark:fill-red-400"
            }
          />
        )}

        {/* Axis titles. */}
        <text
          x={PAD.left + PLOT_W / 2}
          y={HEIGHT - 4}
          textAnchor="middle"
          fontSize={9}
          className="fill-gray-500 dark:fill-gray-400"
        >
          CG — inches aft of datum
        </text>
        <text
          x={-(PAD.top + PLOT_H / 2)}
          y={11}
          transform="rotate(-90)"
          textAnchor="middle"
          fontSize={9}
          className="fill-gray-500 dark:fill-gray-400"
        >
          Weight — lb
        </text>
      </svg>

      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-indigo-600 dark:bg-indigo-400" />
          Takeoff
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border-2 border-gray-500 dark:border-gray-400" />
          Landing (fuel burned off)
        </span>
        <span>
          Envelope {profile.forwardCgIn}–{profile.aftCgIn} in
        </span>
      </figcaption>
    </figure>
  );
}

/** Round tick values covering a domain, at the given step. */
function ticks(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v);
  return out;
}
