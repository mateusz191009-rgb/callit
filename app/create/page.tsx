'use client';

import { useEffect } from 'react';
import { Coins } from 'lucide-react';
import CreateMarketForm from '@/components/create/CreateMarketForm';
import { feeLabel } from '@/lib/format';
import { useCallitStore } from '@/lib/store';

export default function CreatePage() {
  // v25.47 — the reason to create a market, on the page that asks you to.
  // The fee split was only ever explained next to the seed input (step 8)
  // and in the help FAQ, i.e. after the decision was already made. The rate
  // is READ, never hardcoded: an admin can retune the split, and `lpFeeBps`
  // is what NEW markets lock in — exactly the market this page creates.
  const platformSettings = useCallitStore((s) => s.platformSettings);
  const refreshPlatformSettings = useCallitStore((s) => s.refreshPlatformSettings);
  useEffect(() => {
    if (!platformSettings) void refreshPlatformSettings();
  }, [platformSettings, refreshPlatformSettings]);

  const lpFeeBps = platformSettings?.lpFeeBps ?? null;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight text-tx">
          Create a market
        </h1>
        <p className="mt-2 text-tx-sec">
          Launch your own prediction market in under a minute. No permission
          needed.
        </p>

        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-green/25 bg-green/[0.06] p-4">
          <Coins className="mt-0.5 h-4 w-4 shrink-0 text-green" aria-hidden />
          <p className="text-sm leading-relaxed text-tx-sec">
            <span className="font-bold text-tx">
              You earn from every trade on it.
            </span>{' '}
            {lpFeeBps !== null ? (
              <>
                A market you create pays you {feeLabel(lpFeeBps)} of every dollar
                traded on it
              </>
            ) : (
              <>
                A market you create pays you the liquidity provider&apos;s share
                of the trading fee
              </>
            )}{' '}
            — it builds up while the market is live and you can claim it onto
            your balance at any time from{' '}
            <span className="font-bold text-tx">
              Portfolio &rarr; Creator earnings
            </span>
            . Your seed comes back on top when the market resolves.
          </p>
        </div>
      </div>
      <CreateMarketForm />
    </div>
  );
}
