'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { formatMoney } from '@/lib/format';

export interface AmountInputProps {
  value: number | '';
  onChange: (v: number | '') => void;
  /** Cap used by the Max chip (the user's available balance). */
  max: number;
  /** Show the "Balance: …" line (hide for signed-out users). Default true. */
  showBalance?: boolean;
  /** Balance shown on the "Balance: …" line; falls back to `max` (buy
   *  panels cap at the balance, so they can omit it). */
  balance?: number;
}

/** Quick chips ADD to the current amount; Max SETS it to the cap. */
const ADD_AMOUNTS = [1, 5, 10, 100] as const;

const CHIP_CLASSES =
  'rounded-full border border-line bg-surface-3 px-3 py-1 text-xs font-bold tabular-nums ' +
  'text-tx-sec transition-colors hover:border-green/50 hover:text-tx';

/**
 * Polymarket-style USD amount: "Amount" label left, a huge editable
 * "$<n>" display right (real input — keyboard friendly), add-chips
 * (+$1 / +$5 / +$10 / +$100) plus Max, and an optional balance line.
 */
export default function AmountInput({
  value,
  onChange,
  max,
  showBalance = true,
  balance,
}: AmountInputProps) {
  // Local text mirror so in-progress typing like "2." isn't clobbered by
  // the numeric round-trip; external changes (chips, Max, reset) sync in.
  const [text, setText] = useState(value === '' ? '' : String(value));

  useEffect(() => {
    const parsed = text === '' ? Number.NaN : Number(text);
    const current = Number.isNaN(parsed) ? '' : parsed;
    if (value !== current) setText(value === '' ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const maxAmount = Math.floor(max * 100) / 100;
  const isZero = text === '' || Number(text) === 0;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Strip the $ prefix and anything non-numeric; single dot, 2 decimals.
    let s = e.target.value.replace(/[^0-9.]/g, '');
    const dot = s.indexOf('.');
    if (dot !== -1) {
      s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
      s = s.slice(0, dot + 3);
    }
    s = s.slice(0, 12);
    setText(s);
    const n = Number(s);
    if (s === '' || Number.isNaN(n)) {
      onChange('');
      return;
    }
    onChange(n);
  };

  const addAmount = (amt: number) =>
    onChange(Math.round((numeric + amt) * 100) / 100);

  return (
    <div className="space-y-3">
      {/* Big centered amount row: label left, huge $ display right */}
      <div className="flex items-center justify-between gap-4">
        <label htmlFor="trade-amount" className="shrink-0 text-sm font-bold text-tx-sec">
          Amount
        </label>
        <input
          id="trade-amount"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="$0"
          value={text === '' ? '' : `$${text}`}
          onChange={handleChange}
          aria-label="Trade amount in USD"
          className={cn(
            'min-w-0 flex-1 bg-transparent text-right text-4xl font-black tabular-nums',
            'tracking-tight outline-none placeholder:text-tx-mut',
            isZero ? 'text-tx-mut' : 'text-tx'
          )}
        />
      </div>

      {/* Quick chips — add to the amount; Max sets it to the cap */}
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {ADD_AMOUNTS.map((amt) => (
          <button
            key={amt}
            type="button"
            onClick={() => addAmount(amt)}
            className={CHIP_CLASSES}
          >
            +${amt}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange(maxAmount)}
          className={cn(
            CHIP_CLASSES,
            value === maxAmount && maxAmount > 0 && 'border-green/50 bg-green/10 text-green'
          )}
        >
          Max
        </button>
      </div>

      {showBalance && (
        <p className="text-right text-xs text-tx-mut tabular-nums">
          Balance: {formatMoney(balance ?? max)}
        </p>
      )}
    </div>
  );
}
