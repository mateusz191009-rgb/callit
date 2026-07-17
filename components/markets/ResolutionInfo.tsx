'use client';

import { ArrowRight, FileText, UserCheck, Users, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Market, ResolutionMethod } from '@/lib/types';

const METHODS: Record<
  ResolutionMethod,
  { icon: LucideIcon; name: string; blurb: string }
> = {
  oracle: {
    icon: Zap,
    name: 'Source oracle',
    blurb:
      'The outcome is read automatically from the market’s source when it settles there. No human input touches the result.',
  },
  community: {
    icon: Users,
    name: 'Community vote + team confirmation',
    blurb:
      'After the market ends, the community votes on the outcome. Our team reviews and confirms the majority, then winning shares pay $1.00. A $10 confirmation fee comes out of the market’s pot.',
  },
  // Pre-v8 rows only — no new market can be created with this value. They
  // are settled by the team like any other ended community market.
  manual: {
    icon: UserCheck,
    name: 'Team settled (legacy)',
    blurb:
      'An older market type. The outcome is reviewed and settled by our team after the end date.',
  },
};

export default function ResolutionInfo({ market }: { market: Market }) {
  const method = METHODS[market.resolution];
  const Icon = method.icon;

  return (
    <div className="rounded-2xl border border-line bg-surface-2 p-5">
      <h2 className="text-sm font-bold text-tx">How this market resolves</h2>

      <div className="mt-3 flex items-start gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-green/10"
          aria-hidden
        >
          <Icon className="h-[18px] w-[18px] text-green" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-tx">{method.name}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-tx-sec">
            {method.blurb}
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-line bg-surface-3/50 p-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-tx-mut">
          Planned fairness pipeline
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs font-semibold text-tx-sec">
          <span>Resolution bond</span>
          <ArrowRight className="h-3 w-3 shrink-0 text-tx-mut" aria-hidden />
          <span>24h dispute window</span>
          <ArrowRight className="h-3 w-3 shrink-0 text-tx-mut" aria-hidden />
          <span>Community jury</span>
        </div>
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-tx-mut">
        <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <a
          href="/docs/RESOLUTION.md"
          target="_blank"
          rel="noopener"
          className="font-semibold text-green hover:underline"
        >
          Read the resolution design
        </a>
      </p>
    </div>
  );
}
