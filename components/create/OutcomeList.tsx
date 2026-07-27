'use client';

import { GripVertical, Plus, X } from 'lucide-react';
import { EVENT_OUTCOMES_MAX, EVENT_OUTCOMES_MIN } from '@/lib/types';
import Button from '@/components/ui/button';
import Input from '@/components/ui/input';

/** Same ceiling create_event_rpc enforces on every name. */
export const OUTCOME_MAX_LEN = 60;

/**
 * The answer list of a multi-outcome event (v25.28).
 *
 * These are NAMES, not questions — "Alice", "Manchester City", "Above 4%" —
 * because each one becomes its own binary market underneath and the question
 * it is asked against is the event's. The rules the server will re-check are
 * spelled out here rather than discovered on submit: two to eight, non-empty,
 * and no two the same.
 */
export default function OutcomeList({
  values,
  onChange,
  error,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  /** Shown under the list once the field has been touched. */
  error?: string | null;
}) {
  const set = (i: number, v: string) =>
    onChange(values.map((old, idx) => (idx === i ? v : old)));

  const add = () => {
    if (values.length >= EVENT_OUTCOMES_MAX) return;
    onChange([...values, '']);
  };

  const remove = (i: number) => {
    if (values.length <= EVENT_OUTCOMES_MIN) {
      // Never below the minimum — empty it instead of leaving a one-sided
      // event that cannot be submitted and gives no way back.
      set(i, '');
      return;
    }
    onChange(values.filter((_, idx) => idx !== i));
  };

  const duplicate = (i: number): boolean => {
    const name = values[i].trim().toLowerCase();
    if (!name) return false;
    return values.some((v, idx) => idx < i && v.trim().toLowerCase() === name);
  };

  return (
    <div className="space-y-2">
      {values.map((value, i) => {
        const dupe = duplicate(i);
        return (
          <div key={i} className="flex items-center gap-2">
            <GripVertical className="h-4 w-4 shrink-0 text-tx-mut" aria-hidden />
            <Input
              value={value}
              maxLength={OUTCOME_MAX_LEN}
              onChange={(e) => set(i, e.target.value)}
              placeholder={i === 0 ? 'e.g. Alice' : i === 1 ? 'e.g. Bob' : 'Another outcome'}
              aria-label={`Outcome ${i + 1}`}
              error={dupe}
              aria-invalid={dupe || undefined}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={`Remove outcome ${i + 1}`}
              className="shrink-0 rounded-lg p-1.5 text-tx-mut transition-colors hover:bg-surface-3 hover:text-danger"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        );
      })}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={add}
          disabled={values.length >= EVENT_OUTCOMES_MAX}
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add outcome
        </Button>
        <span className="text-xs tabular-nums text-tx-mut">
          {values.length}/{EVENT_OUTCOMES_MAX}
        </span>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
