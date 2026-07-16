import { cn } from '@/lib/utils';

/**
 * Lightweight CSS tooltip (no positioning lib). Shows on hover/focus of
 * the wrapped element. `side` supports 'top' and 'right'.
 */
export default function Tooltip({
  label,
  side = 'top',
  className,
  children,
}: {
  label: string;
  side?: 'top' | 'right';
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={cn('group/tip relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute z-50 whitespace-nowrap rounded-lg border border-line bg-surface-3 px-2 py-1',
          'text-xs font-semibold text-tx-sec opacity-0 shadow-lg transition-opacity duration-150',
          'group-hover/tip:opacity-100 group-focus-within/tip:opacity-100',
          side === 'top' && 'bottom-full left-1/2 mb-1.5 -translate-x-1/2',
          side === 'right' && 'left-full top-1/2 ml-2 -translate-y-1/2'
        )}
      >
        {label}
      </span>
    </span>
  );
}
