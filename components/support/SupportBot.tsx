'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { MessageCircle, Send, X } from 'lucide-react';
import Input from '@/components/ui/input';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Scripted knowledge base                                             */
/* ------------------------------------------------------------------ */

const GREETING =
  "Hi, I'm the Callitnow support bot. Ask me about deposits, withdrawals, market resolution or fees — or pick a topic below.";

const ANSWER_DEPOSIT =
  'Head to Wallet -> Deposit, pick a currency and send funds to the address shown (QR included). Then submit a deposit request with the amount — every deposit is reviewed manually and credited to your balance once approved.';

const ANSWER_WITHDRAW =
  'Wallet -> Withdraw: choose a currency, enter the amount and your payout address. The amount is reserved from your balance immediately and the request goes into manual review. If it is rejected, the funds are refunded in full.';

const ANSWER_RESOLVE =
  'Markets resolve one of three ways: Chainlink oracle (automatic), community vote (signed-in users vote after the market ends and the majority wins), or manually by the creator — manual resolution costs a flat $10 fee. Winning shares pay out $1 each.';

const ANSWER_FEES =
  'Trading on Callitnow is fee-free. The only charge is a flat $10 fee when a creator manually resolves their own market. Oracle and community resolutions are free.';

const ANSWER_BAN =
  'Accounts and markets that break the rules can be banned by moderators. When a market is banned, open positions on it are refunded at cost. If you think a ban is a mistake, email support@call-it-now.com.';

const ANSWER_LIVE =
  'Sports markets stay tradeable while the game is on — up to 4 hours past the listed end time. Look for the pulsing LIVE indicator; odds keep updating with every fill.';

const ANSWER_HUMAN = 'Our team replies via email within 24h: support@call-it-now.com';

const FALLBACK =
  'I am not sure about that one. I can help with deposits, withdrawals, market resolution, fees, bans and live trading — or ask to talk to a human and I will point you to our team.';

const QUICK_REPLIES: { label: string; answer: string }[] = [
  { label: 'How do deposits work?', answer: ANSWER_DEPOSIT },
  { label: 'Withdrawals', answer: ANSWER_WITHDRAW },
  { label: 'How do markets resolve?', answer: ANSWER_RESOLVE },
  { label: 'Fees', answer: ANSWER_FEES },
  { label: 'Talk to a human', answer: ANSWER_HUMAN },
];

const KEYWORD_ANSWERS: { pattern: RegExp; answer: string }[] = [
  { pattern: /deposit/i, answer: ANSWER_DEPOSIT },
  { pattern: /withdraw/i, answer: ANSWER_WITHDRAW },
  { pattern: /resolv|resolution|outcome|oracle|vote/i, answer: ANSWER_RESOLVE },
  { pattern: /fee|cost|charge|commission/i, answer: ANSWER_FEES },
  { pattern: /ban/i, answer: ANSWER_BAN },
  { pattern: /live|in[\s-]?play/i, answer: ANSWER_LIVE },
  { pattern: /human|agent|person|someone|team|email|support/i, answer: ANSWER_HUMAN },
];

function matchAnswer(text: string): string {
  const hit = KEYWORD_ANSWERS.find((k) => k.pattern.test(text));
  return hit ? hit.answer : FALLBACK;
}

interface Message {
  id: number;
  from: 'user' | 'bot';
  text: string;
}

/** Fake typing delay before the bot "answers". */
const TYPING_MS = 600;

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

/**
 * Floating scripted support chat. Purely local state — no store writes,
 * no network. The Help page can open it remotely by dispatching a
 * `callit:open-support` window event.
 */
export default function SupportBot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { id: 0, from: 'bot', text: GREETING },
  ]);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');

  const reducedMotion = useReducedMotion();
  const nextId = useRef(1);
  const timeouts = useRef<number[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Pending bot replies must not fire into an unmounted component.
  useEffect(() => {
    const pending = timeouts.current;
    return () => pending.forEach((t) => window.clearTimeout(t));
  }, []);

  // The Help page's "Chat with support" button opens the widget.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('callit:open-support', onOpen);
    return () => window.removeEventListener('callit:open-support', onOpen);
  }, []);

  // Keep the newest message in view; focus the input when opening.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, messages, typing]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    toggleRef.current?.focus();
  };

  /** Push the user message, show the typing dots, then the bot reply. */
  const send = (text: string, cannedAnswer?: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const answer = cannedAnswer ?? matchAnswer(trimmed);
    setMessages((m) => [...m, { id: nextId.current++, from: 'user', text: trimmed }]);
    setTyping(true);
    const t = window.setTimeout(() => {
      setTyping(false);
      setMessages((m) => [...m, { id: nextId.current++, from: 'bot', text: answer }]);
    }, TYPING_MS);
    timeouts.current.push(t);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send(draft);
    setDraft('');
  };

  return (
    <>
      {/* Panel — conditional render with entrance animation only (no
          AnimatePresence exit; broken with React 19.2). */}
      {open && (
        <motion.div
          role="dialog"
          aria-label="Callitnow support chat"
          initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
          }}
          className="fixed bottom-20 right-4 z-40 flex h-[420px] w-[340px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-line bg-surface-2 shadow-2xl"
        >
          {/* Header */}
          <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-4 py-3">
            <span aria-hidden className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-green" />
            <div className="min-w-0">
              <div className="text-sm font-extrabold text-tx">Callitnow Support</div>
              <div className="text-[11px] font-semibold text-tx-mut">
                Online — replies instantly
              </div>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close support chat"
              className="ml-auto rounded-lg p-1.5 text-tx-mut transition-colors hover:bg-surface-3 hover:text-tx"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>

          {/* Messages */}
          <div
            ref={listRef}
            aria-live="polite"
            className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-3"
          >
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  'max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed',
                  m.from === 'bot'
                    ? 'self-start rounded-bl-md bg-surface-3 text-tx-sec'
                    : 'self-end rounded-br-md border border-green/25 bg-green/15 text-tx'
                )}
              >
                {m.text}
              </div>
            ))}
            {typing && (
              <div
                aria-label="Support bot is typing"
                className="flex items-center gap-1 self-start rounded-2xl rounded-bl-md bg-surface-3 px-3 py-2.5"
              >
                {[0, 150, 300].map((delay) => (
                  <span
                    key={delay}
                    aria-hidden
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-tx-mut"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Quick replies */}
          <div className="flex shrink-0 flex-wrap gap-1.5 px-3 pb-2">
            {QUICK_REPLIES.map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={() => send(q.label, q.answer)}
                className="rounded-full border border-line bg-surface-3 px-2.5 py-1 text-[11px] font-bold text-tx-sec transition-colors hover:border-green/40 hover:text-tx"
              >
                {q.label}
              </button>
            ))}
          </div>

          {/* Input */}
          <form onSubmit={onSubmit} className="flex shrink-0 gap-2 border-t border-line p-2.5">
            <Input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type a question…"
              aria-label="Message the support bot"
              className="h-9 text-[13px]"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              aria-label="Send message"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-green/60 bg-green text-green-ink transition-colors hover:bg-[#12E88A] disabled:pointer-events-none disabled:opacity-45"
            >
              <Send className="h-4 w-4" aria-hidden />
            </button>
          </form>
        </motion.div>
      )}

      {/* Floating toggle button */}
      <button
        ref={toggleRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-label={open ? 'Close support chat' : 'Open support chat'}
        aria-expanded={open}
        className="glow-green fixed bottom-4 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-green/60 bg-green text-green-ink transition-colors hover:bg-[#12E88A]"
      >
        {open ? (
          <X className="h-5 w-5" aria-hidden />
        ) : (
          <MessageCircle className="h-5 w-5" aria-hidden />
        )}
      </button>
    </>
  );
}
