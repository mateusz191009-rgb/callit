'use client';

/**
 * Polymarket-style line-end labels (v25.30).
 *
 * Each series gets its current value — and on binary charts its side's name —
 * printed at the right edge of the plot, at the height its line ends. That is
 * what makes their charts readable at a glance: the eye lands on the line's
 * end and the answer is sitting right there, instead of in a legend somewhere
 * above the panel.
 *
 * Rendered through recharts' `<Customized>` hook, which is the one place that
 * hands us the live y-scale and plot offset — a label positioned any other
 * way drifts the moment the axis domain changes. Labels are drawn into the
 * axis gutter, so they carry an ink-coloured halo (`paintOrder: stroke`) to
 * stay legible when a tick lands at the same height, and labels that would
 * collide are dodged apart.
 */

export interface EndLabel {
  /** Current value on the 0–100 percent axis. */
  value: number;
  color: string;
  /** Optional name line above the percent — binary charts name the side
   *  ("Kolar" over "47%"); multi-series charts leave it out and let the
   *  legend carry the names. */
  name?: string;
}

/** "Zdenek Kolar" does not fit in the gutter; "Kolar" does. Last word for
 *  long person/team names, hard cap for one-word monsters. */
export function shortEndName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= 9) return trimmed;
  const last = trimmed.split(/\s+/).pop() ?? trimmed;
  return last.length <= 10 ? last : `${last.slice(0, 9)}…`;
}

/** The slice of recharts' Customized props we actually read. */
interface CustomizedChartProps {
  yAxisMap?: Record<string, { scale?: (v: number) => number }>;
  offset?: { top: number; left: number; width: number; height: number };
}

const HALO = '#0E1C28'; // ink — the page background the chart sits on

/**
 * Factory for `<Customized component={endLabels(...)} />`. A factory rather
 * than a component with props because Customized clones its `component` with
 * chart internals as props — our own data has to be closed over.
 */
export function endLabels(labels: EndLabel[]) {
  return function EndLabels(props: unknown) {
    const { yAxisMap, offset } = (props ?? {}) as CustomizedChartProps;
    const axis = yAxisMap ? Object.values(yAxisMap)[0] : undefined;
    const scale = axis?.scale;
    if (!scale || !offset || labels.length === 0) return null;

    const twoLine = labels.some((l) => l.name);
    const minGap = twoLine ? 30 : 15;

    // Position, then dodge: sorted by y, each label is pushed below the one
    // above when they would overlap, and the stack is clamped to the plot.
    const placed = labels
      .map((l) => ({ ...l, y: scale(l.value) }))
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < placed.length; i++) {
      if (placed[i].y - placed[i - 1].y < minGap) {
        placed[i].y = placed[i - 1].y + minGap;
      }
    }
    const bottom = offset.top + offset.height - (twoLine ? 10 : 4);
    for (let i = placed.length - 1; i >= 0; i--) {
      const cap = bottom - (placed.length - 1 - i) * minGap;
      if (placed[i].y > cap) placed[i].y = cap;
      if (i > 0 && placed[i].y - placed[i - 1].y < minGap) {
        placed[i - 1].y = placed[i].y - minGap;
      }
    }

    const x = offset.left + offset.width + 6;
    const halo: React.CSSProperties = {
      paintOrder: 'stroke',
      stroke: HALO,
      strokeWidth: 3,
      strokeLinejoin: 'round',
    };

    return (
      <g aria-hidden>
        {placed.map((l) => (
          <g key={`${l.color}-${l.name ?? ''}-${l.value}`}>
            {l.name && (
              <text
                x={x}
                y={l.y - 7}
                fill={l.color}
                fontSize={10}
                fontWeight={600}
                style={halo}
              >
                {shortEndName(l.name)}
              </text>
            )}
            <text
              x={x}
              y={l.y + (l.name ? 7 : 4)}
              fill={l.color}
              fontSize={12}
              fontWeight={700}
              style={halo}
            >
              {Math.round(l.value)}%
            </text>
          </g>
        ))}
      </g>
    );
  };
}
