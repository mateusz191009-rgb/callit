'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, Send } from 'lucide-react';
import { useCallitStore } from '@/lib/store';
import { cn, hashString, mulberry32 } from '@/lib/utils';
import {
  avatarClass,
  fakeTradesFor,
  minutesAgoLabel,
  randomTrader,
  timeAgo,
} from '@/lib/useActivity';
import Tabs, { type TabItem } from '@/components/ui/tabs';
import Input from '@/components/ui/input';
import Button from '@/components/ui/button';
import Badge from '@/components/ui/badge';

type ChatTab = 'comments' | 'activity';

const TAB_ITEMS: TabItem<ChatTab>[] = [
  { value: 'comments', label: 'Comments' },
  { value: 'activity', label: 'Activity' },
];

/** v24.3 — 12 -> 40 texts so the bigger per-market seed count (5–8) and the
 *  hero's scrolling teaser never repeat within one thread. Fake on purpose:
 *  Gamma HAS a comments endpoint, but reading it would cost one request per
 *  event on the feed cycle (and new events start at `commentCount: 0`
 *  anyway) — this pool costs nothing at runtime. */
const COMMENT_POOL = [
  'Yes is underpriced here. The market is sleeping on this one.',
  'Volume picking up fast — someone knows something.',
  'Been holding No since it traded in the 40s. Feeling good.',
  'This resolves earlier than people think.',
  'Chart looks like a slow grind up to me.',
  'Called it weeks ago. Just adding on dips.',
  'What is the exact resolution source on this?',
  'Liquidity is thin, careful with size.',
  'Both sides feel expensive right now.',
  'Just doubled my position.',
  'Odds moved five points overnight. Wild.',
  'Fading the hype here — No looks solid.',
  'This is free money at these odds.',
  'Anyone else watching the order book on this?',
  'Sold half my stack, letting the rest ride.',
  'The news cycle will flip this by the weekend.',
  'Entry at 30 was the play. Still decent here though.',
  'Resolution criteria seem pretty clear to me.',
  'Whales are loading up, check the trades tab.',
  'This one is pure coin flip, sitting it out.',
  'Averaged down twice already. Conviction play.',
  'The base rate says No, the vibes say Yes.',
  'Someone dumped 5k into Yes an hour ago.',
  'Market is way behind the news on this.',
  'Best risk/reward on the whole site right now.',
  'I keep flip-flopping on this one, honestly.',
  'Set a limit order and forgot about it. Filled today.',
  'The deadline is closer than people realize.',
  'Priced for perfection — one headline ruins it.',
  'Been wrong on these before, sizing small.',
  'Comments here aged terribly last time lol.',
  'Feels like everyone is on the same side. Suspicious.',
  'The smart money moved early on this.',
  'Just here for the volatility, honestly.',
  'Longshot but the payout justifies a small bet.',
  'This should be trading ten points higher.',
  'Zero chance this resolves Yes. Free odds.',
  'Watching this chart is my new hobby.',
  'Took profits today, great market.',
  'The spread finally tightened, good entry now.',
] as const;

export interface SeedComment {
  id: string;
  author: string;
  text: string;
  minutesAgo: number;
}

/** 5–8 deterministic mock comments per market (never written to the store).
 *  Exported for the home hero's comment preview (v24.2) — deterministic by
 *  market id, so the hero and the market page show the SAME thread.
 *  v24.3: 2–3 -> 5–8 so the hero's scrolling ticker has a real thread to
 *  roll through. Stride 7 over the 40-text pool (gcd 1) walks all of it —
 *  the old stride 5 over 12 texts also never collided, but over 40 it
 *  would cycle just 8 of them. */
export function mockCommentsFor(marketId: string): SeedComment[] {
  const h = hashString(marketId);
  const rand = mulberry32(h ^ 0x2545f491);
  const count = 5 + (h % 4);
  const start = Math.floor(rand() * COMMENT_POOL.length);
  let minutes = 240 + Math.floor(rand() * 900); // oldest 4–19h ago
  const out: SeedComment[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      id: `seed-${marketId}-${i}`,
      author: randomTrader(Math.floor(rand() * 0xffffffff)),
      text: COMMENT_POOL[(start + i * 7) % COMMENT_POOL.length],
      minutesAgo: minutes,
    });
    minutes = Math.max(4, minutes - (25 + Math.floor(rand() * 115)));
  }
  return out;
}

function Avatar({ name }: { name: string }) {
  const guest = name === 'guest';
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-6 w-6 shrink-0 select-none items-center justify-center rounded-full text-[11px] font-black uppercase leading-none',
        guest ? 'border border-line bg-surface-3 text-tx-sec' : avatarClass(name)
      )}
    >
      {name.charAt(0)}
    </span>
  );
}

function CommentRow({ author, text, time }: { author: string; text: string; time: string }) {
  return (
    <div className="flex gap-2.5 border-b border-line/60 py-2.5 last:border-b-0">
      <Avatar name={author} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[13px] font-bold text-tx">{author}</span>
          <span className="shrink-0 text-[11px] text-tx-mut">{time}</span>
        </div>
        <p className="mt-0.5 break-words text-[13px] leading-snug text-tx-sec">{text}</p>
      </div>
    </div>
  );
}

/**
 * Market discussion card — Comments (store-backed, guests welcome) and a
 * deterministic mock Activity feed. Mock comments seed the thread visually
 * but are never persisted; real posts go through `store.addChatMessage`.
 */
export default function MarketChat({ marketId }: { marketId: string }) {
  const [tab, setTab] = useState<ChatTab>('comments');
  const [draft, setDraft] = useState('');
  const [, setTick] = useState(0);
  const messages = useCallitStore((s) => s.chat[marketId]);
  const addChatMessage = useCallitStore((s) => s.addChatMessage);
  const username = useCallitStore((s) => s.user?.username);
  const listRef = useRef<HTMLDivElement>(null);

  const seeded = useMemo(() => mockCommentsFor(marketId), [marketId]);
  const trades = useMemo(() => fakeTradesFor(marketId, 8), [marketId]);
  const posted = messages ?? [];

  // Keep relative timestamps fresh without re-rendering per message.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Follow the newest comment when the thread grows.
  useEffect(() => {
    const el = listRef.current;
    if (el && posted.length > 0) el.scrollTop = el.scrollHeight;
  }, [posted.length]);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    addChatMessage(marketId, text);
    setDraft('');
  };

  return (
    <section className="rounded-2xl border border-line bg-surface-2">
      <div className="flex items-center justify-between px-4 pt-4">
        <h2 className="flex items-center gap-2 text-sm font-extrabold text-tx">
          <MessageSquare className="h-4 w-4 text-green" aria-hidden />
          Discussion
        </h2>
        <span className="text-[11px] tabular-nums text-tx-mut">
          {seeded.length + posted.length} comments
        </span>
      </div>

      <Tabs items={TAB_ITEMS} value={tab} onChange={setTab} className="mx-4 mt-2" />

      {tab === 'comments' ? (
        <>
          <div ref={listRef} className="max-h-80 overflow-y-auto px-4 py-1">
            {seeded.map((c) => (
              <CommentRow
                key={c.id}
                author={c.author}
                text={c.text}
                time={minutesAgoLabel(c.minutesAgo)}
              />
            ))}
            {posted.map((m) => (
              <CommentRow key={m.id} author={m.author} text={m.text} time={timeAgo(m.createdAt)} />
            ))}
          </div>
          <form onSubmit={submit} className="flex items-center gap-2 border-t border-line px-4 py-3">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={username ? `Comment as ${username}…` : 'Comment as guest…'}
              maxLength={280}
              className="h-9 text-[13px]"
              aria-label="Add a comment"
            />
            <Button type="submit" size="sm" disabled={!draft.trim()} aria-label="Send comment">
              <Send className="h-3.5 w-3.5" aria-hidden />
              Send
            </Button>
          </form>
        </>
      ) : (
        <div className="px-4 py-1 pb-2">
          {trades.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2.5 border-b border-line/60 py-2.5 last:border-b-0"
            >
              <Avatar name={t.name} />
              <span className="truncate text-[13px] font-bold text-tx">{t.name}</span>
              <Badge variant={t.side === 'yes' ? 'green' : 'sky'}>
                {t.side === 'yes' ? 'Yes' : 'No'}
              </Badge>
              <span className="text-[13px] font-bold tabular-nums text-tx-sec">${t.amount}</span>
              <span className="ml-auto shrink-0 text-[11px] text-tx-mut">
                {minutesAgoLabel(t.minutesAgo)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
