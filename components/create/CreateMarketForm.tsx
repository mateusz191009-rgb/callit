'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ListTree, Rocket, ToggleLeft, Wallet } from 'lucide-react';
import type { Category, ResolutionMethod } from '@/lib/types';
import { EVENT_OUTCOMES_MIN } from '@/lib/types';
import { formatMoney } from '@/lib/format';
import { play } from '@/lib/sound';
import { startNavProgressTo } from '@/lib/navProgress';
import { useCallitStore } from '@/lib/store';
import { supabaseEnabled } from '@/lib/supabase';
import { uploadIcon, type PreparedIcon } from '@/lib/upload';
import { useCategories } from '@/lib/useMarkets';
import { cn } from '@/lib/utils';
import Button from '@/components/ui/button';
import Input from '@/components/ui/input';
import Textarea from '@/components/ui/textarea';
import Select from '@/components/ui/select';
import IconUpload from './IconUpload';
import OutcomeList from './OutcomeList';
import ResolutionPicker from './ResolutionPicker';
import MarketPreview from './MarketPreview';

const QUESTION_MIN = 10;
const QUESTION_MAX = 140;

/** Seed bounds — `create_market_rpc` enforces the same range server-side,
 *  and `create_event_rpc` enforces it PER OUTCOME. */
const SEED_MIN = 10;
const SEED_MAX = 10000;
const SEED_DEFAULT = 50;
const SEED_CHIPS = [10, 50, 100, 250] as const;

/** v25.28 — a binary question, or an event with one market per outcome. */
type MarketKind = 'binary' | 'event';

const CHIP_CLASSES =
  'rounded-full border border-line bg-surface-3 px-3 py-1 text-xs font-bold tabular-nums ' +
  'text-tx-sec transition-colors hover:border-green/50 hover:text-tx';

function questionError(value: string): string | null {
  const len = value.trim().length;
  if (len === 0) return 'A question is required.';
  if (len < QUESTION_MIN) return `Questions need at least ${QUESTION_MIN} characters.`;
  if (len > QUESTION_MAX) return `Keep it to ${QUESTION_MAX} characters or fewer.`;
  return null;
}

/**
 * Validate the seed.
 *
 * `enforceBalance` is on only when the seed is REALLY debited — i.e. cloud
 * mode with a signed-in user, where `create_market_rpc` takes it from the
 * creator's balance. Local demo mode keeps the old free-seed behavior (no
 * pool, no debit), and local accounts start at $0, so enforcing the funding
 * rule there would make creating a market impossible offline.
 *
 * v25.28 — `multiplier` is the number of outcomes an EVENT will fund: the
 * seed is charged per outcome, so the balance rule has to look at the total.
 */
function seedError(
  value: number | '',
  balance: number,
  enforceBalance: boolean,
  multiplier = 1
): string | null {
  if (value === '' || !Number.isFinite(value)) return 'Seed liquidity is required.';
  if (value < SEED_MIN) return `Fund your market with at least $${SEED_MIN}.`;
  if (value > SEED_MAX) {
    return `Seed liquidity cannot exceed $${SEED_MAX.toLocaleString('en-US')}.`;
  }
  if (enforceBalance && value * multiplier > balance) {
    return multiplier > 1
      ? `Not enough balance — ${multiplier} outcomes cost ${formatMoney(value * multiplier)}`
      : 'Not enough balance to fund this market';
  }
  return null;
}

/** 2-8 names, all filled, none repeated. Mirrors create_event_rpc. */
function outcomesError(values: string[]): string | null {
  const names = values.map((v) => v.trim()).filter(Boolean);
  if (names.length < EVENT_OUTCOMES_MIN) return 'Name at least two outcomes.';
  const seen = new Set<string>();
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) return 'Two outcomes cannot have the same name.';
    seen.add(key);
  }
  return null;
}

function endDateError(value: string): string | null {
  if (!value) return 'An end date is required.';
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return 'Enter a valid date and time.';
  if (t <= Date.now()) return 'The end date must be in the future.';
  return null;
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function Section({
  n,
  title,
  aside,
  children,
}: {
  n: number;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="card-surface p-5">
      <div className="mb-3.5 flex items-center gap-2.5">
        <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md bg-green/10 text-xs font-black tabular-nums text-green">
          {n}
        </span>
        <h2 className="text-sm font-extrabold text-tx">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export default function CreateMarketForm() {
  const router = useRouter();
  const createMarket = useCallitStore((s) => s.createMarket);
  const createEvent = useCallitStore((s) => s.createEvent);
  const user = useCallitStore((s) => s.user);
  const balance = useCallitStore((s) => s.balance);
  const openAuthModal = useCallitStore((s) => s.openAuthModal);
  const hydrated = useCallitStore((s) => s._hasHydrated);
  // Full list: built-ins + admin-created custom categories.
  const categories = useCategories();

  // The seed is real money only in cloud mode — see seedError().
  const enforceBalance = supabaseEnabled && Boolean(user);

  const [kind, setKind] = useState<MarketKind>('binary');
  const [question, setQuestion] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<Category>('custom');
  const [endDate, setEndDate] = useState('');
  // Default matches the picker's first option — 'oracle' is no longer
  // offered for user-created markets (Global markets still use it).
  const [resolution, setResolution] = useState<ResolutionMethod>('community');
  const [seed, setSeed] = useState<number | ''>(SEED_DEFAULT);
  const [icon, setIcon] = useState<PreparedIcon | null>(null);
  const [outcomes, setOutcomes] = useState<string[]>(['', '']);
  const [touched, setTouched] = useState<{
    question: boolean;
    endDate: boolean;
    seed: boolean;
    outcomes: boolean;
  }>({
    question: false,
    endDate: false,
    seed: false,
    outcomes: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [minDate, setMinDate] = useState<string>();

  const questionRef = useRef<HTMLInputElement>(null);
  const endDateRef = useRef<HTMLInputElement>(null);
  const seedRef = useRef<HTMLInputElement>(null);

  // Set the datetime-local floor after mount to avoid SSR/client mismatch.
  useEffect(() => {
    setMinDate(toLocalInputValue(new Date()));
  }, []);

  const isEvent = kind === 'event';
  const namedOutcomes = outcomes.map((o) => o.trim()).filter(Boolean);
  const outcomeCount = Math.max(namedOutcomes.length, 1);

  const qErr = questionError(question);
  const dErr = endDateError(endDate);
  const sErr = seedError(seed, balance, enforceBalance, isEvent ? outcomeCount : 1);
  const oErr = isEvent ? outcomesError(outcomes) : null;
  const showQErr = touched.question && qErr !== null;
  const showDErr = touched.endDate && dErr !== null;
  const showSErr = touched.seed && sErr !== null;
  const showOErr = touched.outcomes && oErr !== null;

  const seedAmount = seed === '' ? SEED_DEFAULT : seed;
  const totalSeed = isEvent ? seedAmount * outcomeCount : seedAmount;

  const len = question.length;
  const counterClass =
    len > QUESTION_MAX || (len > 0 && len < QUESTION_MIN)
      ? 'text-danger'
      : len > 125
        ? 'text-amber'
        : 'text-tx-mut';

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    setTouched({ question: true, endDate: true, seed: true, outcomes: true });
    if (qErr || dErr || sErr || oErr) {
      if (qErr) questionRef.current?.focus();
      else if (dErr) endDateRef.current?.focus();
      else if (!oErr) seedRef.current?.focus();
      return;
    }
    setSubmitting(true);
    window.setTimeout(() => {
      void (async () => {
        // The image goes to storage first: an upload that fails must not
        // leave a funded market behind, and `uploadIcon` degrades to the
        // data URL rather than throwing, so this cannot block the launch.
        const iconUrl = icon ? await uploadIcon(icon) : undefined;

        if (isEvent) {
          // Cloud: create_event_rpc — every outcome, every pool and one
          // debit in a single transaction. Local: the same rows, free.
          const eventId = await createEvent({
            title: question.trim(),
            description: description.trim() || undefined,
            category,
            endDate: new Date(endDate).toISOString(),
            outcomes: namedOutcomes,
            icon: iconUrl,
            seedEach: seedAmount,
          });
          if (!eventId) {
            setSubmitting(false);
            toast.error(
              useCallitStore.getState().lastActionError ??
                'Your account is restricted from creating markets.'
            );
            return;
          }
          play('success');
          toast.success('Event is live');
          startNavProgressTo('/event/' + eventId);
          router.push('/event/' + eventId);
          return;
        }

        // Cloud: create_market_rpc — the server fixes the economics, debits
        // the seed as the market's real collateral and the market is live
        // for everyone. Local: appended to userMarkets, seed not charged.
        const market = await createMarket({
          question: question.trim(),
          description: description.trim() || undefined,
          category,
          endDate: new Date(endDate).toISOString(),
          resolution,
          seed: seedAmount,
          icon: iconUrl,
        });
        if (!market) {
          setSubmitting(false);
          toast.error(
            useCallitStore.getState().lastActionError ??
              'Your account is restricted from creating markets.'
          );
          return;
        }
        play('success');
        toast.success('Market is live');
        startNavProgressTo('/market/' + market.id);
        router.push('/market/' + market.id);
      })();
    }, 400);
  };

  return (
    <div className="lg:grid lg:grid-cols-[1fr_400px] lg:items-start lg:gap-8">
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {/* v25.28 — the shape of the thing comes first: it changes what the
            question means (a claim vs. a question with answers), whether the
            outcome list exists, and what the seed is charged on. */}
        <Section n={1} title="What are you launching?">
          <div className="grid gap-2 sm:grid-cols-2">
            <KindOption
              active={kind === 'binary'}
              icon={ToggleLeft}
              title="Yes / No"
              blurb="One claim, two sides. Traders buy Yes or No."
              onClick={() => setKind('binary')}
            />
            <KindOption
              active={kind === 'event'}
              icon={ListTree}
              title="Multiple outcomes"
              blurb="One question, up to 8 answers — each its own market."
              onClick={() => setKind('event')}
            />
          </div>
        </Section>

        <Section
          n={2}
          title={isEvent ? 'Event question' : 'Question'}
          aside={
            <span className={cn('ml-auto text-xs tabular-nums', counterClass)}>
              {len}/{QUESTION_MAX}
            </span>
          }
        >
          <Input
            ref={questionRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, question: true }))}
            placeholder={
              isEvent
                ? 'Who will win the 2027 championship?'
                : 'Will Bitcoin close above $150,000 on Dec 31, 2026?'
            }
            error={showQErr}
            aria-invalid={showQErr || undefined}
          />
          {showQErr && <p className="mt-1.5 text-xs text-danger">{qErr}</p>}
        </Section>

        {isEvent && (
          <Section
            n={3}
            title="Outcomes"
            aside={
              <span className="ml-auto text-xs text-tx-mut">
                Each becomes its own market
              </span>
            }
          >
            <div onBlur={() => setTouched((t) => ({ ...t, outcomes: true }))}>
              <OutcomeList
                values={outcomes}
                onChange={setOutcomes}
                error={showOErr ? oErr : null}
              />
            </div>
          </Section>
        )}

        <Section
          n={isEvent ? 4 : 3}
          title="Image"
          aside={<span className="ml-auto text-xs text-tx-mut">Optional</span>}
        >
          <IconUpload value={icon} onChange={setIcon} />
        </Section>

        <Section
          n={isEvent ? 5 : 4}
          title="Description"
          aside={<span className="ml-auto text-xs text-tx-mut">Optional</span>}
        >
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="How does this market resolve? Name the data source, the exact criteria and any edge cases so traders know precisely what counts."
          />
        </Section>

        <Section n={isEvent ? 6 : 5} title="Category">
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
            aria-label="Category"
          >
            {categories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Section>

        <Section n={isEvent ? 7 : 6} title="End date & time">
          <Input
            ref={endDateRef}
            type="datetime-local"
            className="tabular-nums [color-scheme:dark]"
            min={minDate}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, endDate: true }))}
            error={showDErr}
            aria-invalid={showDErr || undefined}
          />
          {showDErr && <p className="mt-1.5 text-xs text-danger">{dErr}</p>}
        </Section>

        <Section n={isEvent ? 8 : 7} title="Resolution method">
          <ResolutionPicker value={resolution} onChange={setResolution} />
        </Section>

        <Section
          n={isEvent ? 9 : 8}
          title={isEvent ? 'Seed liquidity per outcome' : 'Seed liquidity'}
        >
          <div className="space-y-3">
            <Input
              ref={seedRef}
              type="number"
              inputMode="decimal"
              min={SEED_MIN}
              max={SEED_MAX}
              step={1}
              className="tabular-nums"
              value={seed === '' ? '' : String(seed)}
              onChange={(e) => {
                const v = e.target.value;
                setSeed(v === '' ? '' : Number(v));
              }}
              onBlur={() => setTouched((t) => ({ ...t, seed: true }))}
              aria-label="Seed liquidity in USD"
              error={showSErr}
              aria-invalid={showSErr || undefined}
            />

            <div className="flex flex-wrap items-center gap-1.5">
              {SEED_CHIPS.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => {
                    setSeed(amt);
                    setTouched((t) => ({ ...t, seed: true }));
                  }}
                  className={cn(
                    CHIP_CLASSES,
                    seed === amt && 'border-green/50 bg-green/10 text-green'
                  )}
                >
                  ${amt}
                </button>
              ))}
              {/* Guests never see the demo balance (v2.1) — and they
                  cannot fund a market anyway. */}
              {hydrated && user && (
                <span className="ml-auto text-xs tabular-nums text-tx-mut">
                  Balance: {formatMoney(balance)}
                </span>
              )}
            </div>

            {showSErr && <p className="text-xs text-danger">{sErr}</p>}

            {/* An event funds one pool per outcome, so the number the form
                asks for is NOT the number that leaves the balance. */}
            {isEvent && (
              <p className="text-xs font-bold text-tx-sec tabular-nums">
                {namedOutcomes.length >= EVENT_OUTCOMES_MIN
                  ? `${namedOutcomes.length} outcomes × ${formatMoney(seedAmount)} = ${formatMoney(totalSeed)} total`
                  : `Charged per outcome — name at least ${EVENT_OUTCOMES_MIN}.`}
              </p>
            )}

            <p className="text-xs leading-relaxed text-tx-mut">
              You fund your market&apos;s liquidity. It backs every payout, and
              whatever is left plus the trading fees comes back to you when the
              market resolves.
            </p>
          </div>
        </Section>

        <div className="space-y-3 pt-1">
          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={submitting}
            className="w-full glow-green"
          >
            {!submitting && <Rocket className="h-5 w-5" aria-hidden />}
            {isEvent ? 'Launch event' : 'Launch market'}
          </Button>
          {hydrated && !user && (
            <p className="flex items-center justify-center gap-1.5 text-xs text-tx-mut">
              <Wallet className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Creating as guest —{' '}
              <button
                type="button"
                onClick={() => openAuthModal('signin')}
                className="font-bold text-green underline-offset-2 hover:underline"
              >
                sign in
              </button>{' '}
              to own your market.
            </p>
          )}
        </div>
      </form>

      <div className="mt-8 self-start lg:sticky lg:top-20 lg:mt-0">
        <MarketPreview
          input={{
            question,
            description: description || undefined,
            category,
            endDate,
            resolution,
            seed: seedAmount,
            icon: icon?.dataUrl,
            outcomes: isEvent ? outcomes : undefined,
          }}
        />
      </div>
    </div>
  );
}

function KindOption({
  active,
  icon: Icon,
  title,
  blurb,
  onClick,
}: {
  active: boolean;
  icon: typeof ToggleLeft;
  title: string;
  blurb: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors',
        active
          ? 'border-green/50 bg-green/[0.07]'
          : 'border-line bg-surface-3 hover:border-line-strong'
      )}
    >
      <Icon
        className={cn('mt-0.5 h-4 w-4 shrink-0', active ? 'text-green' : 'text-tx-mut')}
        aria-hidden
      />
      <span className="min-w-0">
        <span className="block text-sm font-bold text-tx">{title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-tx-mut">{blurb}</span>
      </span>
    </button>
  );
}
