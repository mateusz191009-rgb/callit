'use client';

import { useEffect } from 'react';
import { ShieldCheck, Users } from 'lucide-react';
import type { ResolutionMethod } from '@/lib/types';

/**
 * v8 — no picker any more: 'community' is the ONLY resolution a user can
 * create ('manual' is gone; create_market_rpc rejects it server-side, and
 * 'oracle' stays feed-only). What used to be a choice is now an explainer
 * of the one pipeline every community market goes through:
 *
 *   users vote after the market ends
 *     -> an admin reviews and CONFIRMS the majority
 *       -> winners are paid; a $10 confirmation fee comes out of the
 *          market's own pot (never anyone's balance).
 *
 * The prop signature is kept so CreateMarketForm's wiring stays intact —
 * `onChange` is invoked once with 'community' to normalize any stale
 * draft state (e.g. a form remount that still carried 'manual').
 */
export default function ResolutionPicker({
  value,
  onChange,
}: {
  value: ResolutionMethod;
  onChange: (v: ResolutionMethod) => void;
}) {
  // Normalize a stale non-community draft (an effect, not a render-time
  // setState); never loops — guarded by value.
  useEffect(() => {
    if (value !== 'community') onChange('community');
  }, [value, onChange]);

  return (
    <div className="rounded-xl border border-green/40 bg-green/10 p-4">
      <div className="flex items-start gap-3">
        <Users className="mt-0.5 h-5 w-5 shrink-0 text-green" aria-hidden />
        <div className="min-w-0">
          <div className="text-sm font-bold text-tx">Community resolution</div>
          <p className="mt-1 text-xs leading-relaxed text-tx-mut">
            After your market ends, the community votes on the outcome and our
            team reviews and confirms the majority before winners are paid.
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-tx-sec">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-green" aria-hidden />
            A $10 confirmation fee is taken from the market&apos;s pot at
            settlement — never from your balance.
          </p>
        </div>
      </div>
    </div>
  );
}
