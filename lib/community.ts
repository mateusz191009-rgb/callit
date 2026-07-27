import type { EventGroup, Market } from './types';

/**
 * The community hub's route segment — `/category/community`.
 *
 * NOT a category: it filters by SOURCE across every topic, so it is absent
 * from CATEGORIES (the create form must never offer it as a topic) and lives
 * only as a route plus a bar item. It exists because a market with no volume
 * yet is otherwise unfindable among four hundred feed events — which would
 * make creating one pointless.
 */
export const COMMUNITY_HUB = 'community';
export const COMMUNITY_LABEL = 'Community';

/**
 * Community markets -> event cards (v25.28).
 *
 * A feed event arrives from the API as a whole object with its own title,
 * icon and outcome list. A community event has no such object: it is N rows in
 * `markets` that share an `event_id`, each carrying the event's title and icon
 * (see create_event_rpc). This rebuilds the group the rest of the app already
 * knows how to render — EventCard, MixedGrid, the hubs and /event/[id] all
 * take an EventGroup and never ask where it came from.
 *
 * Rows without an `eventId` are plain binary markets and are not our business;
 * a group that has lost all but one outcome (banned, or a stale-resolved
 * filter upstream) is handed back as nothing, because a one-sided "event" is
 * just that market and it is already rendering on its own.
 */
export function buildCommunityEvents(markets: Market[]): EventGroup[] {
  const byEvent = new Map<string, Market[]>();
  for (const m of markets) {
    if (!m.eventId) continue;
    const list = byEvent.get(m.eventId);
    if (list) list.push(m);
    else byEvent.set(m.eventId, [m]);
  }

  const events: EventGroup[] = [];
  for (const [id, outcomes] of byEvent) {
    if (outcomes.length < 2) continue;
    // Highest chance first, the order every event card and outcome table
    // expects (EventGroup's contract: markets sorted by yesPrice desc).
    const sorted = [...outcomes].sort((a, b) => b.yesPrice - a.yesPrice);
    const first = sorted[0];
    events.push({
      id,
      // The title is denormalized onto every row; falling back to the row's
      // own question keeps a pre-migration or hand-made group renderable
      // instead of titling it "undefined".
      title: first.eventTitle ?? first.question,
      icon: sorted.find((m) => m.icon)?.icon,
      category: first.category,
      // The outcomes share an end date at creation, but a group is only as
      // open as its longest-running row.
      endDate: sorted.reduce(
        (latest, m) => (m.endDate > latest ? m.endDate : latest),
        first.endDate
      ),
      volume: sorted.reduce((sum, m) => sum + m.volume, 0),
      createdAt: sorted.reduce(
        (earliest, m) =>
          m.createdAt && (!earliest || m.createdAt < earliest) ? m.createdAt : earliest,
        first.createdAt
      ),
      markets: sorted,
    });
  }

  // Same order the feed hands events over in: biggest book first.
  return events.sort((a, b) => b.volume - a.volume);
}

/** The ids of every market that belongs to one of `events` — what a caller
 *  filters out to avoid rendering an outcome twice (once in its event card,
 *  once as a standalone market). */
export function outcomeIdsOf(events: EventGroup[]): Set<string> {
  const ids = new Set<string>();
  for (const e of events) for (const m of e.markets) ids.add(m.id);
  return ids;
}
