'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { buttonClasses } from '@/components/ui/button';

/**
 * v8 — the landing page the withdrawal-confirmation email links to:
 * /withdraw/confirm?token=… . Reads the token, POSTs it to
 * /api/withdrawals/confirm and shows the outcome. Works signed-out on
 * purpose (the token is the proof, not the session).
 */

type State =
  | { phase: 'working' }
  | { phase: 'done' }
  | { phase: 'error'; message: string };

function ConfirmInner() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<State>({ phase: 'working' });

  useEffect(() => {
    let alive = true;
    if (!token) {
      setState({ phase: 'error', message: 'This confirmation link is incomplete.' });
      return;
    }
    void (async () => {
      try {
        const res = await fetch('/api/withdrawals/confirm', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const body = (await res.json()) as { ok?: boolean; error?: string };
        if (!alive) return;
        if (body.ok) setState({ phase: 'done' });
        else
          setState({
            phase: 'error',
            message: body.error ?? 'Confirmation failed — try again later.',
          });
      } catch {
        if (alive) {
          setState({ phase: 'error', message: 'Confirmation failed — try again later.' });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  return (
    <div className="mx-auto max-w-md py-16">
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-line bg-surface-2 p-8 text-center">
        {state.phase === 'working' && (
          <>
            <Loader2 className="h-10 w-10 animate-spin text-green" aria-hidden />
            <h1 className="text-xl font-black text-tx">Confirming your withdrawal…</h1>
          </>
        )}
        {state.phase === 'done' && (
          <>
            <CheckCircle2 className="h-10 w-10 text-green" aria-hidden />
            <h1 className="text-xl font-black text-tx">Withdrawal confirmed</h1>
            <p className="text-sm text-tx-sec">
              It is now in review — our team pays out manually and you will see the
              status change in your wallet.
            </p>
          </>
        )}
        {state.phase === 'error' && (
          <>
            <XCircle className="h-10 w-10 text-danger" aria-hidden />
            <h1 className="text-xl font-black text-tx">Could not confirm</h1>
            <p className="text-sm text-tx-sec">{state.message}</p>
            <p className="text-xs text-tx-mut">
              If you already confirmed this withdrawal, no further action is needed.
            </p>
          </>
        )}
        <Link href="/wallet" className={buttonClasses('outline', 'md', 'mt-2')}>
          Back to wallet
        </Link>
      </div>
    </div>
  );
}

export default function WithdrawConfirmPage() {
  // useSearchParams needs a Suspense boundary during prerender.
  return (
    <Suspense fallback={null}>
      <ConfirmInner />
    </Suspense>
  );
}
