import { cn } from '@/lib/utils';

export type BadgeVariant = 'green' | 'sky' | 'neutral' | 'amber' | 'danger';

const variants: Record<BadgeVariant, string> = {
  green: 'border-green/40 text-green bg-green/10',
  sky: 'border-sky/40 text-sky bg-sky/10',
  neutral: 'border-line text-tx-sec bg-surface-3/60',
  amber: 'border-amber/40 text-amber bg-amber/10',
  danger: 'border-danger/40 text-danger bg-danger/10',
};

export default function Badge({
  variant = 'neutral',
  className,
  children,
}: {
  variant?: BadgeVariant;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-bold leading-none',
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
