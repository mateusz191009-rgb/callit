import { ImageResponse } from 'next/og';
import { betVerdict, fetchSharedBet, multipleLabel, sharedSideLabel } from '@/lib/betShare';
import { ogFonts } from '@/lib/ogFont';

/**
 * v25.40 — THE SHARED BET SLIP, AS A PNG.
 *
 * Two jobs, one URL:
 *   1. the `og:image` for /bet/<token>, so the link unfurls as the card
 *      instead of as a grey rectangle in every chat app;
 *   2. the "Save image" button in the share sheet — which is why this is an
 *      API route and not the `opengraph-image.tsx` convention. Next fingerprints
 *      convention routes (`/opengraph-image-<hash>`), and a download button
 *      needs a URL that is stable enough to hand-write.
 *
 * IT IS A HAND-KEPT COPY of components/share/BetSlipCard.tsx. satori reads no
 * Tailwind and no CSS file, so the layout is re-expressed in inline styles;
 * the numbers themselves come from the same `betVerdict()` both sides call, so
 * the two can drift in looks but never in arithmetic.
 *
 * EVERY DIV WITH MORE THAN ONE CHILD SETS `display: flex` — satori has no
 * block layout, and a missing one is a silent mis-render, not an error.
 */

export const dynamic = 'force-dynamic';

const W = 1200;
const H = 630;

const INK = '#0E1C28';
const SURFACE_3 = '#24384A';
const LINE = '#2C4356';
const GREEN = '#00E17E';
const SKY = '#3B9DF8';
const SKY_BRIGHT = '#7AC0FB';
const DANGER = '#FF8DA1';
const AMBER = '#FFB547';
const TX = '#FFFFFF';
const TX_MUT = '#8FA8BC';

function money(n: number): string {
  const v = Math.abs(n);
  const s = v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(2);
  return `${n < 0 ? '-' : ''}$${s}`;
}

function cents(p: number): string {
  return `${Math.round(p * 100)}¢`;
}

/** satori has no line-clamp worth trusting — clip in JS instead. */
function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** A flat 1200x630 fallback, so a bad token still unfurls as something. */
function fallback(fonts: Awaited<ReturnType<typeof ogFonts>>) {
  return new ImageResponse(
    (
      <div
        style={{
          width: W,
          height: H,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: INK,
          color: TX,
          fontFamily: 'Nunito, sans-serif',
          fontSize: 64,
          fontWeight: 800,
          letterSpacing: '-0.045em',
        }}
      >
        <span>callit</span>
        <span style={{ color: GREEN }}>now</span>
      </div>
    ),
    { width: W, height: H, fonts: fonts.length > 0 ? fonts : undefined }
  );
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const fonts = await ogFonts();
  const bet = await fetchSharedBet(decodeURIComponent(token ?? ''));
  if (!bet) return fallback(fonts);

  const v = betVerdict(bet);
  const yes = bet.side === 'yes';
  const accent = yes ? GREEN : SKY;
  const sideText = yes ? GREEN : SKY_BRIGHT;
  const sideName = clip(sharedSideLabel(bet), 22);

  const status =
    v.outcome === 'won'
      ? { label: 'CALLED IT', color: GREEN }
      : v.outcome === 'lost'
        ? { label: 'MISSED', color: DANGER }
        : v.outcome === 'void'
          ? { label: 'CANCELLED — REFUNDED', color: AMBER }
          : { label: 'LIVE POSITION', color: TX_MUT };

  const payoutLabel =
    v.outcome === 'open' ? 'Now worth' : v.outcome === 'void' ? 'Refunded' : 'Payout';
  const payoutColor =
    v.outcome === 'lost' ? DANGER : v.pnl > 0 ? GREEN : TX;

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
        {/* The side's colour, as a bar rather than a blur: satori has no
            backdrop filters, and a hard edge scales down better anyway. */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: W,
            height: 10,
            background: accent,
          }}
        />

        {/* Brand + handle */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
          }}
        >
          <div style={{ display: 'flex', fontSize: 40, fontWeight: 800, letterSpacing: '-0.045em' }}>
            <span>callit</span>
            <span style={{ color: GREEN }}>now</span>
          </div>
          <div style={{ display: 'flex', fontSize: 30, fontWeight: 800, color: TX_MUT }}>
            {`@${clip(bet.username, 24)}`}
          </div>
        </div>

        {/* The question. 48/100 rather than 52/110: at the larger pair the
            worst case ran three full lines and consumed the last of the
            column's slack, so `space-between` had none left to give and the
            text sat flush against the hero box. */}
        <div
          style={{
            display: 'flex',
            fontSize: 48,
            fontWeight: 800,
            lineHeight: 1.15,
            maxWidth: 1000,
          }}
        >
          {clip(bet.question ?? 'A call on callitnow', 100)}
        </div>

        {/* Hero: side + multiple */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            border: `2px solid ${accent}55`,
            background: `${accent}18`,
            borderRadius: 24,
            padding: '24px 32px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: TX_MUT, letterSpacing: 1 }}>
              CALLED
            </div>
            <div style={{ fontSize: 56, fontWeight: 800, color: sideText, marginTop: 4 }}>
              {sideName}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: TX_MUT, letterSpacing: 1 }}>
              {multipleLabel(v.outcome).toUpperCase()}
            </div>
            {/* ONE child, not two. `{n}x` is a text node AND an expression to
                satori, which then demands `display: flex` on the div and 500s
                without it — a broken unfurl on every shared link. Interpolate
                the whole string; the same rule applies to every `@{handle}` in
                these routes. */}
            <div style={{ fontSize: 56, fontWeight: 800, marginTop: 4 }}>
              {`${v.multiple.toFixed(2)}x`}
            </div>
          </div>
        </div>

        {/* Receipt row + status */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            width: '100%',
          }}
        >
          <div style={{ display: 'flex', gap: 16 }}>
            <Figure label="Stake" value={money(bet.stake)} />
            <Figure label="Entry" value={cents(bet.avgPrice)} />
            <Figure label={payoutLabel} value={money(v.value)} color={payoutColor} />
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 26,
              fontWeight: 800,
              color: status.color,
              letterSpacing: 1,
              paddingBottom: 8,
            }}
          >
            {status.label}
          </div>
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: fonts.length > 0 ? fonts : undefined,
      headers: {
        // Long-lived on purpose: the token is immutable and chat apps refetch
        // an unfurl rarely. `stale-while-revalidate` still lets a resolved
        // market refresh the card within the hour.
        'cache-control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
      },
    }
  );
}

function Figure({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        border: `2px solid ${LINE}`,
        background: SURFACE_3,
        borderRadius: 16,
        padding: '14px 24px',
        minWidth: 190,
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 800, color: TX_MUT, letterSpacing: 1 }}>
        {label.toUpperCase()}
      </div>
      <div style={{ fontSize: 38, fontWeight: 800, color: color ?? TX, marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}
