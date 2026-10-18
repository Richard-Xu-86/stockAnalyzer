import type { TrendPoint } from "@/domain/metrics";
import { pct, shortDay } from "./format";

/**
 * Cumulative return since tracking began, you vs the market. Server-rendered SVG: no chart library,
 * no client JavaScript. Lines are told apart by weight and dash (not colour) and labelled directly
 * at their ends; the same numbers are available as a table below for screen readers.
 */
const WIDE = { W: 640, H: 240, PAD: { top: 12, right: 104, bottom: 28, left: 52 } };
// Phones: a smaller drawing space so the 12px labels stay about 12px on a 320–400px screen.
const NARROW = { W: 340, H: 230, PAD: { top: 12, right: 96, bottom: 28, left: 44 } };

export function TrendChart({ points, benchmarkLabel }: { points: TrendPoint[]; benchmarkLabel: string }) {
  if (points.length < 2) return null;
  const summary = `Since ${shortDay(points[0]!.date)}: you ${pct(points.at(-1)!.you)}, ${benchmarkLabel} ${pct(points.at(-1)!.market)}.`;
  return (
    <figure style={{ margin: 0 }}>
      <Plot points={points} benchmarkLabel={benchmarkLabel} size={WIDE} cls="wide" summary={summary} />
      <Plot points={points} benchmarkLabel={benchmarkLabel} size={NARROW} cls="narrow" summary={summary} />
      <figcaption className="visually-hidden">{summary}</figcaption>
    </figure>
  );
}

function Plot({ points, benchmarkLabel, size, cls, summary }: { points: TrendPoint[]; benchmarkLabel: string; size: typeof WIDE; cls: string; summary: string }) {
  const { W, H, PAD } = size;
  const you = points.map((p) => Number(p.you));
  const mkt = points.map((p) => Number(p.market));
  const all = [0, ...you, ...mkt];
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  const span = Math.max(hi - lo, 0.004);
  lo -= span * 0.08;
  hi += span * 0.08;

  const x = (i: number) => PAD.left + (i / (points.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);
  const path = (vs: number[]) => vs.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");

  const step = niceStep((hi - lo) / 4);
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(Number(t.toFixed(10)));

  const last = points.at(-1)!;
  let yYou = y(you.at(-1)!);
  let yMkt = y(mkt.at(-1)!);
  if (Math.abs(yYou - yMkt) < 16) {
    // keep the two end labels from overlapping
    const mid = (yYou + yMkt) / 2;
    const up = yYou <= yMkt ? -8 : 8;
    yYou = mid + up;
    yMkt = mid - up;
  }

  return (
      <svg className={`chart ${cls}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Cumulative return chart. ${summary}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? "zero" : "grid-line"} x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end">
              {fmtTick(t, step)}
            </text>
          </g>
        ))}
        <path className="market" d={path(mkt)} />
        <path className="you" d={path(you)} />
        <text className="label-you" x={W - PAD.right + 8} y={yYou + 4}>
          You {pct(last.you, 1)}
        </text>
        <text x={W - PAD.right + 8} y={yMkt + 4}>
          {benchmarkLabel} {pct(last.market, 1)}
        </text>
        <text x={PAD.left} y={H - 6}>
          {shortDay(points[0]!.date)}
        </text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end">
          {shortDay(last.date)}
        </text>
      </svg>
  );
}

function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

function fmtTick(t: number, step: number): string {
  const dp = step * 100 >= 1 ? 0 : step * 100 >= 0.1 ? 1 : 2;
  const v = (t * 100).toFixed(dp);
  return Number(v) === 0 ? "0%" : `${t > 0 ? "+" : "−"}${v.replace("-", "")}%`;
}
