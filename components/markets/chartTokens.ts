/**
 * Chart paint, mirrored from the Tailwind tokens in `tailwind.config.ts`.
 *
 * Recharts wants concrete colors — it cannot read a Tailwind class — so
 * these hexes have to exist somewhere. They used to be re-declared inside
 * `PriceChart` and `MultiOutcomeChart` separately, which meant a token edit
 * silently skipped both charts: when `tx.mut` was raised to clear WCAG AA,
 * the axis labels would have stayed on the old failing #6F8CA4.
 *
 * Keeping them here also means `CHART_COLORS` can be imported WITHOUT
 * pulling in a chart component — and with it recharts, which is ~90-110 KB
 * gzipped. `FeaturedHero` needs the palette for its legend dots on first
 * paint but loads the chart itself lazily; that only works because this
 * module has no recharts dependency of its own.
 *
 * If you change a value here, change it in `tailwind.config.ts` too.
 */

/** `line.DEFAULT` — grid lines and axis rules. */
export const CHART_LINE = '#2C4356';

/** `tx.mut` — axis ticks and tooltip labels. */
export const CHART_TX_MUT = '#8FA8BC';

/** `green.DEFAULT` — the Yes/primary series. */
export const CHART_GREEN = '#00E17E';

/** Shared outcome palette — green first (frontrunner), then sky/amber/rose. */
export const CHART_COLORS = [CHART_GREEN, '#3B9DF8', '#FFB547', '#FF5C7A'];
