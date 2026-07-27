import { cn } from '@/lib/utils';

/**
 * The phone-shaped view of a table row.
 *
 * Portfolio (9 columns), trade history (8) and the leaderboard (5) are all
 * real tables, and on a 390px screen a 9-column table is ~900px wide inside
 * a 358px box. `overflow-x-auto` kept the page from breaking, but it left
 * the user with a nested horizontal scroller with no affordance and the
 * columns that matter — PnL, Result — permanently off-screen.
 *
 * So below `md` each row becomes a card: the identifying text on top, the
 * numbers underneath as label/value pairs that wrap. The table itself stays
 * for `md` and up, where it is the better tool.
 */

export function RecordCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <li className={cn('card-surface space-y-2.5 p-3.5', className)}>{children}</li>
  );
}

/** Label above, value below — the stacked equivalent of a table cell. */
export function RecordField({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="text-nano font-bold uppercase tracking-wide text-tx-mut">
        {label}
      </div>
      <div className="mt-0.5 truncate text-mini font-bold tabular-nums text-tx-sec">
        {value}
      </div>
    </div>
  );
}

/** The field grid inside a RecordCard. Three across fits 390px comfortably. */
export function RecordFields({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-3 gap-x-3 gap-y-2">{children}</div>;
}
