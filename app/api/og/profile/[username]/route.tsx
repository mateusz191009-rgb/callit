import { ImageResponse } from 'next/og';
import { fetchPublicProfile, winRateOf } from '@/lib/cloud';
import { ogFonts } from '@/lib/ogFont';
import { hashString } from '@/lib/utils';

/**
 * v25.40 — A TRADER'S CARD, AS A PNG.
 *
 * The `og:image` for /u/<username>, and the thing that makes "share my
 * profile" worth tapping: a pasted profile link previews as the record, not as
 * a generic site title.
 *
 * Same aggregates as the page, from the same `public_profile()` — counts,
 * sums and one ratio. Nothing here is derivable from the image that is not
 * already on the public page.
 *
 * satori rules apply, same as the bet card: no CSS file, no Tailwind, and
 * every div with more than one child sets `display: flex`.
 */

export const dynamic = 'force-dynamic';

const W = 1200;
const H = 630;

const INK = '#0E1C28';
const SURFACE_3 = '#24384A';
const LINE = '#2C4356';
const GREEN = '#00E17E';
const TX = '#FFFFFF';
const TX_MUT = '#8FA8BC';

/** The same six hues the profile page's avatar picks from — and the same
 *  `hashString`, so the card's initial tile matches the page it links to. */
const AVATAR_HUES = [150, 200, 100, 170, 130, 210];

function money(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  const fonts = await ogFonts();
  const name = decodeURIComponent(username ?? '').trim();
  const profile = await fetchPublicProfile(name);

  const handle = profile?.username ?? name ?? 'trader';
  const hue = AVATAR_HUES[hashString(handle) % AVATAR_HUES.length];
  const rate = profile ? winRateOf(profile) : null;

  const stats: { label: string; value: string }[] = profile
    ? [
        { label: 'WIN RATE', value: rate === null ? '—' : `${Math.round(rate * 100)}%` },
        { label: 'BETS SETTLED', value: String(profile.betsResolved) },
        { label: 'VOLUME', value: money(profile.volumeTraded) },
        {
          label: 'BEST CALL',
          value: profile.bestMultiple > 0 ? `${profile.bestMultiple.toFixed(2)}x` : '—',
        },
      ]
    : [];

  return new ImageResponse(
    (
      <div
        style={{
          width: W,
          height: H,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: INK,
          padding: 64,
          fontFamily: 'Nunito, sans-serif',
          color: TX,
          position: 'relative',
        }}
      >
        <div
          style={{ position: 'absolute', top: 0, left: 0, width: W, height: 10, background: GREEN }}
        />

        <div style={{ display: 'flex', fontSize: 40, fontWeight: 800, letterSpacing: '-0.045em' }}>
          <span>callit</span>
          <span style={{ color: GREEN }}>now</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 140,
              height: 140,
              borderRadius: 36,
              fontSize: 72,
              fontWeight: 800,
              background: `linear-gradient(135deg, hsl(${hue} 70% 38%), hsl(${hue + 30} 70% 24%))`,
            }}
          >
            {handle.slice(0, 1).toUpperCase()}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {/* One child — see the note in the bet card route: `@{handle}` is
                two nodes to satori and would 500 the whole image. */}
            <div style={{ fontSize: 68, fontWeight: 800, letterSpacing: '-0.02em' }}>
              {`@${clip(handle, 20)}`}
            </div>
            <div style={{ fontSize: 30, fontWeight: 400, color: TX_MUT, marginTop: 6 }}>
              {profile
                ? `${profile.betsPlaced} call${profile.betsPlaced === 1 ? '' : 's'} on callitnow`
                : 'Make the call. Make the market.'}
            </div>
          </div>
        </div>

        {stats.length > 0 ? (
          <div style={{ display: 'flex', gap: 20, width: '100%' }}>
            {stats.map((s) => (
              <div
                key={s.label}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  flex: 1,
                  border: `2px solid ${LINE}`,
                  background: SURFACE_3,
                  borderRadius: 20,
                  padding: '20px 24px',
                }}
              >
                <div style={{ fontSize: 20, fontWeight: 800, color: TX_MUT, letterSpacing: 1 }}>
                  {s.label}
                </div>
                <div style={{ fontSize: 48, fontWeight: 800, marginTop: 4 }}>{s.value}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', fontSize: 32, fontWeight: 400, color: TX_MUT }}>
            Trade real-world events — or launch your own market in seconds.
          </div>
        )}
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: fonts.length > 0 ? fonts : undefined,
      headers: {
        // Shorter than the bet card's: a profile's numbers move every time the
        // user trades, and a stale win rate on a shared link is the one thing
        // people will notice.
        'cache-control': 'public, max-age=120, s-maxage=600, stale-while-revalidate=3600',
      },
    }
  );
}
