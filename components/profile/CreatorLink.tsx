'use client';

import Link from 'next/link';
import { censorName } from '@/lib/format';
import { cloudFeedEnabled } from '@/lib/useMarkets';

/**
 * v8 — the creator line on market pages. The DISPLAY stays censored
 * ('ma***z' — privacy on the market itself), but in cloud mode it links to
 * the creator's PUBLIC profile at /u/<username>, whose fields are public by
 * construction (username, join date, market count — never email/balance).
 *
 * `createdBy` holds the creator's real username on cloud/community markets
 * (v3+). Local-mode rows ('guest', wallet addresses from v2) get plain
 * text — a dead profile link is worse than no link.
 */
export default function CreatorLink({ createdBy }: { createdBy?: string }) {
  const name = createdBy?.trim();
  if (!name) return <span>—</span>;

  const linkable = cloudFeedEnabled && name !== 'guest' && !name.startsWith('0x');
  if (!linkable) return <span>{censorName(name)}</span>;

  return (
    <Link
      href={`/u/${encodeURIComponent(name)}`}
      className="font-semibold text-green underline-offset-2 hover:underline"
    >
      {censorName(name)}
    </Link>
  );
}
