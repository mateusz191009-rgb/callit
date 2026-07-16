import { cn } from '@/lib/utils';

export default function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('skeleton-shimmer rounded-lg bg-surface-3/70', className)}
      aria-hidden="true"
    />
  );
}
