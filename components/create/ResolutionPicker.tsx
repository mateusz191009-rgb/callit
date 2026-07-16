'use client';

import { Check, UserCheck, Users, type LucideIcon } from 'lucide-react';
import type { ResolutionMethod } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * Creatable resolution methods. 'oracle' still exists in
 * ResolutionMethod (Global/Polymarket markets resolve via oracle) but
 * is not offered for user-created markets — only this picker changed;
 * ResolutionInfo and the rest of the app keep handling all three.
 */
const OPTIONS: {
  value: ResolutionMethod;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Small amber caveat under the description (e.g. resolve fee). */
  note?: string;
}[] = [
  {
    value: 'community',
    label: 'Community vote',
    description: 'Token holders vote on the outcome',
    icon: Users,
  },
  {
    value: 'manual',
    label: 'Manual',
    description: 'You resolve the market yourself',
    icon: UserCheck,
    note: '$10 resolve fee',
  },
];

export default function ResolutionPicker({
  value,
  onChange,
}: {
  value: ResolutionMethod;
  onChange: (v: ResolutionMethod) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Resolution method"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
    >
      {OPTIONS.map((opt) => {
        const selected = value === opt.value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={cn(
              'relative rounded-xl border p-4 text-left transition-colors',
              'focus:outline-none focus-visible:border-green/60',
              selected
                ? 'border-green/60 bg-green/10'
                : 'border-line bg-surface-3 hover:border-line-strong'
            )}
          >
            {selected && (
              <span
                className="absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full bg-green text-green-ink"
                aria-hidden
              >
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
            )}
            <Icon
              className={cn('h-5 w-5', selected ? 'text-green' : 'text-tx-mut')}
              aria-hidden
            />
            <div className="mt-2.5 text-sm font-bold text-tx">{opt.label}</div>
            <div className="mt-1 text-xs leading-relaxed text-tx-mut">
              {opt.description}
            </div>
            {opt.note && (
              <div className="mt-1.5 text-[11px] font-bold text-amber">
                {opt.note}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
