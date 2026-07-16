import { cn } from '@/lib/utils';

export default function StatChip({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-line bg-surface-3/40 px-3 py-2',
        className
      )}
    >
      <div className="text-[11px] font-bold uppercase tracking-wide text-tx-mut">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-bold text-tx tabular-nums">{value}</div>
    </div>
  );
}
