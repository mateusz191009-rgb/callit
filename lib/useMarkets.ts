'use client';

import { useEffect, useMemo } from 'react';
import type { EventGroup, Market, Position } from './types';
import { CATEGORIES } from './types';
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

export function useAllMarkets(): { markets: Market[]; loading: boolean } {
  const poly = useCallitStore((s) => s.poly);
  const polyLoaded = useCallitStore((s) => s.polyLoaded);
  const overrides = useCallitStore((s) => s.marketOverrides);
  const hydrated = useCallitStore((s) => s._hasHydrated);
  const banned = useBannedMarketIds();
  const { markets: community, loading: communityLoading } = useCommunityMarkets();

  const markets = useMemo(
    () => [
      ...community,
      ...poly
        .filter((m) => !banned.includes(m.id))
        .map((m) => mergeMarket(m, overrides[m.id])),
    ],
    [community, poly, overrides, banned]
  );

  return { markets, loading: !hydrated || !polyLoaded || communityLoading };
}

/** Trending multi-outcome events. Banned outcome markets are removed;
 *  events whose outcomes are all banned are dropped entirely. */
export function useEvents(): { events: EventGroup[]; loading: boolean } {
  const polyEvents = useCallitStore((s) => s.polyEvents);
  const polyLoaded = useCallitStore((s) => s.polyLoaded);
  const overrides = useCallitStore((s) => s.marketOverrides);
  const hydrated = useCallitStore((s) => s._hasHydrated);
  const banned = useBannedMarketIds();

  const events = useMemo(
    () =>
      polyEvents
        .map((e) => ({
          ...e,
          markets: e.markets
            .filter((m) => !banned.includes(m.id))
            .map((m) => mergeMarket(m, overrides[m.id])),
        }))
        .filter((e) => e.markets.length > 0),
    [polyEvents, overrides, banned]
  );

  return { events, loading: !hydrated || !polyLoaded };
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
    return m;
  }, [cloudMarkets, userMarkets, poly, polyEvents, overrides]);

  return {
    map,
    loading: !hydrated || !polyLoaded || (cloudFeedEnabled && !cloudLoaded),
  };
}

export function useMarket(id: string): Market | undefined {
  const userMarkets = useCallitStore((s) => s.userMarkets);
  const cloudMarkets = useCallitStore((s) => s.cloudMarkets);
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
    return feed ? mergeMarket(feed, overrides[id]) : undefined;
  }, [id, cloudMarkets, userMarkets, poly, polyEvents, overrides]);
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

/** How often the Polymarket feed is refreshed. One request per 90s is
 *  comfortably inside the public Gamma API limits. */
export const POLY_REFRESH_MS = 90_000;

let polyFetchStarted = false;
let polyIntervalActive = false;

/**
 * Fetches trending Polymarket markets + events (API proxy with mock
 * fallback) and pushes them into the store. The initial fetch runs once
 * per session; after that the feed is refetched every 90 seconds so
 * `source: 'polymarket'` markets always show LIVE odds (mergeMarket makes
 * the fresh feed win over local overrides — anti-scam). Refresh failures
 * are silent: the last good payload stays in place.
 *
 * In cloud mode it ALSO keeps the shared book fresh on the same cadence
 * (mount + 90s), and refetches immediately whenever an RPC changed it
 * (create/resolve/ban/community trade) via the `onSharedBookChanged`
 * channel — so a market another user just launched shows up here too.
 */
export function usePolymarketLoader() {
  const setPolymarkets = useCallitStore((s) => s.setPolymarkets);
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
          if (fallbackToMocks) setPolymarkets(getMockPolymarketData());
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
    const id = setInterval(() => {
      void load(false);
      void refreshCommunityMarkets();
    }, POLY_REFRESH_MS);
    // An RPC just changed the shared book — don't wait out the interval.
    const unsubscribe = onSharedBookChanged(() => void refreshCommunityMarkets());
    return () => {
      clearInterval(id);
      unsubscribe();
      polyIntervalActive = false;
    };
  }, [setPolymarkets, refreshCommunityMarkets]);
}
