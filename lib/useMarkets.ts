'use client';

import { useEffect, useMemo } from 'react';
import type { EventGroup, FeedOdds, Market, Position } from './types';
import { CATEGORIES } from './types';
import { buildCommunityEvents } from './community';
import { isStaleResolved } from './format';
import { mergeMarket, useCallitStore } from './store';
import { seedMarkets } from './seed';
import { getMockPolymarketData } from './polymarket';
import { supabaseEnabled } from './supabase';
import { onSharedBookChanged } from './cloud';

/**
 * Merged market selectors: community markets + Polymarket (flat markets
 * AND event outcome markets).
 *
 * Where the community markets come from depends on the mode:
 *
 *  * CLOUD FEED (`supabaseEnabled` — sign-in NOT required, the `markets`
 *    table is readable by anon): the shared book from Postgres. A market
 *    one user creates is a market EVERYONE sees and trades, and its
 *    price/volume/status are whatever the server says — no local
 *    overrides are applied to it, because only the RPCs may move it.
 *  * LOCAL (no Supabase configured): `store.userMarkets` + `seedMarkets`
 *    with store overrides via `mergeMarket` — exactly the v3/v4 behavior.
 *
 * Polymarket markets are unchanged in both modes: the LIVE feed wins over
 * local overrides (`mergeMarket` keeps only status/resolvedOutcome +
 * appended chart points — anti-scam).
 *
 * Banned markets are excluded from every feed (cloud: `markets.banned`
 * via `cloudBannedIds`; local: `bannedMarketIds`) but still resolve
 * through `useMarket`/`useMarketMap` — gate lists, not lookups.
 */

/** True when the shared book (Postgres) backs the community feed. */
export const cloudFeedEnabled = supabaseEnabled;

/**
 * Every id hidden from the feeds: the local admin ban list plus, in cloud
 * mode, `markets.banned` from the DB (which also covers Global markets —
 * those render from the API payload, so the flag can't travel with them).
 */
export function useBannedMarketIds(): string[] {
  const local = useCallitStore((s) => s.bannedMarketIds);
  const cloud = useCallitStore((s) => s.cloudBannedIds);
  return useMemo(
    () => (cloudFeedEnabled ? [...local, ...cloud] : local),
    [local, cloud]
  );
}

/**
 * The community half of the feed (no Polymarket markets), banned entries
 * removed. Cloud: the shared book. Local: userMarkets + seedMarkets.
 */
export function useCommunityMarkets(): { markets: Market[]; loading: boolean } {
  const userMarkets = useCallitStore((s) => s.userMarkets);
  const cloudMarkets = useCallitStore((s) => s.cloudMarkets);
  const cloudLoaded = useCallitStore((s) => s.cloudMarketsLoaded);
  const overrides = useCallitStore((s) => s.marketOverrides);
  const hydrated = useCallitStore((s) => s._hasHydrated);
  const banned = useBannedMarketIds();

  const markets = useMemo(() => {
    if (cloudFeedEnabled) {
      // The server owns these rows outright — no override merge.
      return cloudMarkets.filter((m) => !banned.includes(m.id));
    }
    return [...userMarkets, ...seedMarkets]
      .filter((m) => !banned.includes(m.id))
      .map((m) => mergeMarket(m, overrides[m.id]));
  }, [cloudMarkets, userMarkets, overrides, banned]);

  return {
    markets,
    loading: !hydrated || (cloudFeedEnabled && !cloudLoaded),
  };
}

export function useAllMarkets(): { markets: Market[]; loading: boolean; error: boolean } {
  const poly = useCallitStore((s) => s.poly);
  const polyLoaded = useCallitStore((s) => s.polyLoaded);
  const polyError = useCallitStore((s) => s.polyError);
  const overrides = useCallitStore((s) => s.marketOverrides);
  const hydrated = useCallitStore((s) => s._hasHydrated);
  const banned = useBannedMarketIds();
  const { markets: community, loading: communityLoading } = useCommunityMarkets();

  const markets = useMemo(
    () =>
      [
        ...community,
        ...poly
          .filter((m) => !banned.includes(m.id))
          .map((m) => mergeMarket(m, overrides[m.id])),
        // v9 — resolved markets get a 48h feed grace window, then leave the
        // feeds. Lookups (useMarket/useMarketMap) are NOT gated: direct
        // URLs, portfolio history and the admin tables keep resolving.
      ].filter((m) => !isStaleResolved(m)),
    [community, poly, overrides, banned]
  );

  return { markets, loading: !hydrated || !polyLoaded || communityLoading, error: polyError };
}

/**
 * Trending multi-outcome events. Banned outcome markets are removed; events
 * whose outcomes are all banned are dropped entirely.
 *
 * v25.28 — community events come through here too. A user-created event is
 * N rows in the same book as every other community market, tied together by
 * `eventId`; `buildCommunityEvents` turns them back into the EventGroup that
 * EventCard, MixedGrid, the hubs and /event/[id] already know how to render.
 * Every consumer that pairs this hook with `useAllMarkets` already drops
 * markets whose `eventId` is on screen, so the outcomes stop rendering twice
 * without any of them changing.
 */
export function useEvents(): { events: EventGroup[]; loading: boolean; error: boolean } {
  const polyEvents = useCallitStore((s) => s.polyEvents);
  const polyLoaded = useCallitStore((s) => s.polyLoaded);
  const polyError = useCallitStore((s) => s.polyError);
  const overrides = useCallitStore((s) => s.marketOverrides);
  const hydrated = useCallitStore((s) => s._hasHydrated);
  const banned = useBannedMarketIds();
  const { markets: community } = useCommunityMarkets();

  const events = useMemo(
    () => [
      ...buildCommunityEvents(community.filter((m) => !isStaleResolved(m))),
      ...polyEvents
        .map((e) => ({
          ...e,
          markets: e.markets
            .filter((m) => !banned.includes(m.id))
            .map((m) => mergeMarket(m, overrides[m.id]))
            // v9 — long-resolved outcomes leave the event card too.
            .filter((m) => !isStaleResolved(m)),
        }))
        .filter((e) => e.markets.length > 0),
    ],
    [community, polyEvents, overrides, banned]
  );

  return { events, loading: !hydrated || !polyLoaded, error: polyError };
}

/**
 * Lookup map over EVERY known market — community + Polymarket flat
 * markets + event outcome markets — with overrides applied. Banned
 * markets are intentionally included: this is a lookup (portfolio rows,
 * detail views), not a feed, and positions on banned markets must keep
 * resolving to a question and a live price.
 */
export function useMarketMap(): { map: Map<string, Market>; loading: boolean } {
  const userMarkets = useCallitStore((s) => s.userMarkets);
  const cloudMarkets = useCallitStore((s) => s.cloudMarkets);
  const cloudPositionMarkets = useCallitStore((s) => s.cloudPositionMarkets);
  const cloudLoaded = useCallitStore((s) => s.cloudMarketsLoaded);
  const poly = useCallitStore((s) => s.poly);
  const polyEvents = useCallitStore((s) => s.polyEvents);
  const polyLoaded = useCallitStore((s) => s.polyLoaded);
  const overrides = useCallitStore((s) => s.marketOverrides);
  const hydrated = useCallitStore((s) => s._hasHydrated);

  const map = useMemo(() => {
    const m = new Map<string, Market>();
    // Community first: the shared book (or the local lists) wins over a
    // feed row with the same id.
    if (cloudFeedEnabled) {
      for (const market of cloudMarkets) if (!m.has(market.id)) m.set(market.id, market);
    } else {
      for (const market of [...userMarkets, ...seedMarkets]) {
        if (!m.has(market.id)) m.set(market.id, mergeMarket(market, overrides[market.id]));
      }
    }
    for (const market of [...poly, ...polyEvents.flatMap((e) => e.markets)]) {
      if (!m.has(market.id)) m.set(market.id, mergeMarket(market, overrides[market.id]));
    }
    // v19 — last resort: the DB rows behind the user's positions. A Global
    // market that closed upstream is gone from the trending feed, but its
    // row (question, status, resolved outcome) lives on in the book — this
    // is what keeps a finished game's position from rendering as
    // "Unknown market". Server-owned rows, so no override merge.
    if (cloudFeedEnabled) {
      for (const market of cloudPositionMarkets) {
        if (!m.has(market.id)) m.set(market.id, market);
      }
    }
    return m;
  }, [cloudMarkets, cloudPositionMarkets, userMarkets, poly, polyEvents, overrides]);

  return {
    map,
    loading: !hydrated || !polyLoaded || (cloudFeedEnabled && !cloudLoaded),
  };
}

export function useMarket(id: string): Market | undefined {
  const userMarkets = useCallitStore((s) => s.userMarkets);
  const cloudMarkets = useCallitStore((s) => s.cloudMarkets);
  const cloudPositionMarkets = useCallitStore((s) => s.cloudPositionMarkets);
  const poly = useCallitStore((s) => s.poly);
  const polyEvents = useCallitStore((s) => s.polyEvents);
  const overrides = useCallitStore((s) => s.marketOverrides);

  return useMemo(() => {
    if (cloudFeedEnabled) {
      const cloud = cloudMarkets.find((m) => m.id === id);
      if (cloud) return cloud;
    }
    const base = cloudFeedEnabled
      ? undefined
      : (userMarkets.find((m) => m.id === id) ?? seedMarkets.find((m) => m.id === id));
    const feed =
      base ??
      poly.find((m) => m.id === id) ??
      polyEvents.flatMap((e) => e.markets).find((m) => m.id === id);
    if (feed) return mergeMarket(feed, overrides[id]);
    // v19 — same last resort as useMarketMap: a held market that left the
    // trending feed still resolves from its DB row (server-owned, no
    // override merge), so the detail page and portfolio links keep working.
    return cloudFeedEnabled
      ? cloudPositionMarkets.find((m) => m.id === id)
      : undefined;
  }, [id, cloudMarkets, cloudPositionMarkets, userMarkets, poly, polyEvents, overrides]);
}

/**
 * The signed-in user's positions. CLOUD: `positions` straight from the
 * DB (the server books them — `store.positions` is never written there).
 * LOCAL: the persisted `store.positions`. Use this everywhere instead of
 * reading `store.positions` directly.
 */
export function usePositions(): Position[] {
  const local = useCallitStore((s) => s.positions);
  const cloud = useCallitStore((s) => s.cloudPositions);
  const user = useCallitStore((s) => s.user);
  return cloudFeedEnabled && user ? cloud : local;
}

/**
 * Full category list: built-in CATEGORIES + admin-created custom
 * categories from the store. Use this (not raw CATEGORIES) anywhere the
 * complete list is needed — selects, chips, admin tables.
 */
export function useCategories(): { value: string; label: string }[] {
  const custom = useCallitStore((s) => s.customCategories);
  return useMemo(() => [...CATEGORIES, ...custom], [custom]);
}

/** How often the Polymarket feed is refreshed. v14: 90s -> 60s — the odds
 *  a user trades at should never be a minute and a half old just because
 *  of the client poll (stale-quote window; the route's cache-control is
 *  30s for the same reason). Still trivially inside the public API
 *  limits. */
export const POLY_REFRESH_MS = 60_000;

/**
 * v25.18 — how often the FULL feed is refetched, as opposed to the odds.
 *
 * The 60s beat now fetches /api/polymarket/odds (~300 KB: prices, volumes,
 * live flags) instead of the whole ~12 MB payload, because that is the only
 * part that changes between two polls — the owner's point: "market
 * beschreibungen etc. brauchen wir nur einmal eigentlich nur die quoten und
 * livetiming bei manchen markets".
 *
 * The full payload still has to come back periodically, because it is the only
 * thing that carries STRUCTURE: markets listed since the last load, markets
 * that closed and left the feed, a game that gained a section. 5 minutes is
 * well inside the "New" badge's 48h window and inside the providers' own 2-5
 * minute memos, so a longer gap would buy nothing anyway.
 */
export const POLY_FULL_REFRESH_MS = 5 * 60_000;

let polyFetchStarted = false;
let polyIntervalActive = false;
/** Consecutive failures of the 60s odds beat — see `loadOdds`. */
let oddsFailStreak = 0;

/**
 * Fetches trending Polymarket markets + events (API proxy with mock
 * fallback) and pushes them into the store. The initial fetch runs once
 * per session; after that the feed is refetched every 60 seconds so
 * `source: 'polymarket'` markets always show LIVE odds (mergeMarket makes
 * the fresh feed win over local overrides — anti-scam). Refresh failures
 * are silent: the last good payload stays in place.
 *
 * In cloud mode it ALSO keeps the shared book fresh on the same cadence
 * (mount + 60s), and refetches immediately whenever an RPC changed it
 * (create/resolve/ban/community trade) via the `onSharedBookChanged`
 * channel — so a market another user just launched shows up here too.
 */
export function usePolymarketLoader() {
  const setPolymarkets = useCallitStore((s) => s.setPolymarkets);
  const setPolyError = useCallitStore((s) => s.setPolyError);
  const applyPolyOdds = useCallitStore((s) => s.applyPolyOdds);
  const refreshCommunityMarkets = useCallitStore((s) => s.refreshCommunityMarkets);

  useEffect(() => {
    const load = (fallbackToMocks: boolean) =>
      fetch('/api/polymarket')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((data: { markets: Market[]; events: EventGroup[] }) =>
          setPolymarkets({
            markets: Array.isArray(data.markets) ? data.markets : [],
            events: Array.isArray(data.events) ? data.events : [],
          })
        )
        .catch(() => {
          // Order matters: setPolymarkets clears polyError, so the flag is
          // raised after the mock fallback — the mocks are a degraded state,
          // not a healthy one.
          if (fallbackToMocks) setPolymarkets(getMockPolymarketData());
          setPolyError(true);
        });

    /** v25.18 — the cheap beat. A single failure costs nothing: the store
     *  keeps the prices it has, and the next tick (or the next full refresh)
     *  recovers. Two in a row is different — the quotes on screen are then
     *  over two minutes old, which is the stale-quote problem this beat
     *  exists to prevent, so at that point the UI is told. */
    const loadOdds = () =>
      fetch('/api/polymarket/odds')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((odds: FeedOdds) => {
          oddsFailStreak = 0;
          applyPolyOdds(odds);
          setPolyError(false);
        })
        .catch(() => {
          oddsFailStreak += 1;
          if (oddsFailStreak >= 2) setPolyError(true);
        });

    if (!polyFetchStarted) {
      polyFetchStarted = true;
      void load(true);
      void refreshCommunityMarkets();
    }
    // Only one live-refresh interval app-wide, even if the loader is
    // mounted more than once.
    if (polyIntervalActive) return;
    polyIntervalActive = true;
    // Wall-clock, not a tick counter: a tab that was backgrounded (where
    // browsers throttle timers hard) would otherwise think it is up to date
    // after a handful of coalesced ticks.
    let lastFullAt = Date.now();
    const id = setInterval(() => {
      if (Date.now() - lastFullAt >= POLY_FULL_REFRESH_MS) {
        lastFullAt = Date.now();
        void load(false);
      } else {
        void loadOdds();
      }
      void refreshCommunityMarkets();
    }, POLY_REFRESH_MS);
    // An RPC just changed the shared book — don't wait out the interval.
    const unsubscribe = onSharedBookChanged(() => void refreshCommunityMarkets());
    return () => {
      clearInterval(id);
      unsubscribe();
      polyIntervalActive = false;
    };
  }, [setPolymarkets, applyPolyOdds, refreshCommunityMarkets]);
}
