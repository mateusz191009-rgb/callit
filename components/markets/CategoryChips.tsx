'use client';

import { useMemo } from 'react';
import type { Category } from '@/lib/types';
import { useCategories } from '@/lib/useMarkets';
import { cn } from '@/lib/utils';

export default function CategoryChips({
  value,
  onChange,
}: {
  value: Category | 'all';
  onChange: (c: Category | 'all') => void;
}) {
  // Full list (built-ins + admin-created custom categories).
  const categories = useCategories();
  const chips = useMemo<{ value: Category | 'all'; label: string }[]>(
    () => [{ value: 'all', label: 'All' }, ...categories],
    [categories]
  );

  return (
    <div
      className="flex items-center gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label="Filter by category"
    >
      {chips.map((chip) => {
        const active = value === chip.value;
        return (
          <button
            key={chip.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(chip.value)}
            className={cn(
              'h-8 shrink-0 whitespace-nowrap rounded-xl border px-3 text-xs font-bold transition-colors',
              active
                ? 'border-green/40 bg-green/15 text-green'
                : 'border-line bg-surface-3 text-tx-sec hover:border-line-strong hover:text-tx'
            )}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}
