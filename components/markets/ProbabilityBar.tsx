'use client';

import { motion } from 'framer-motion';
import { formatCents } from '@/lib/format';
import { cn } from '@/lib/utils';

export default function ProbabilityBar({
  yesPrice,
  showLabels = true,
  yesLabel,
  noLabel,
  className,
}: {
  yesPrice: number;
  showLabels?: boolean;
  /** Side display names (`Market.yesLabel`/`noLabel`, or a shortened form).
   *  Optional — absent means the literal Yes/No, so existing call sites keep
   *  working unchanged. First side stays green, second stays sky. */
  yesLabel?: string;
  noLabel?: string;
  className?: string;
}) {
  const yesCents = formatCents(yesPrice);
  const noCents = formatCents(1 - yesPrice);

  return (
    <div className={cn('w-full', className)}>
      {showLabels && (
        <div className="mb-1.5 flex items-center justify-between gap-3 text-sm font-bold">
          <span className="min-w-0 truncate text-green tabular-nums">
            {yesLabel ?? 'Yes'}{' '}
            <motion.span
              key={yesCents}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="inline-block"
            >
              {yesCents}
            </motion.span>
          </span>
          <span className="min-w-0 truncate text-sky tabular-nums">
            {noLabel ?? 'No'} {noCents}
          </span>
        </div>
      )}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-sky/70">
        <div
          className="h-full rounded-full bg-green transition-[width] duration-500"
          style={{ width: `${Math.round(yesPrice * 1000) / 10}%` }}
        />
      </div>
    </div>
  );
}
