/**
 * Esports streams (v25.19).
 *
 * Owner: "bei diesem esport hero die livestreams machen wie polymarket".
 *
 * WHAT WE DO NOT HAVE: a stream URL. Verified live against the Gamma API — an
 * esports event carries `live`, `teams`, `score` and `period`, and nothing that
 * points at a broadcast. Polymarket gets theirs from their own backend, so we
 * cannot mirror it and must not pretend to.
 *
 * WHAT WE DO HAVE: the tournament, spelled out in the event title
 * ("… - LEC Regular Season", "… - BLAST Bounty", "… - LPL Group Ascend"). An
 * esports league's official channel is stable for years — LEC has streamed on
 * twitch.tv/lec since 2019 — so a curated title -> channel map gets the right
 * broadcast without inventing data. Every channel below is the league's own
 * verified account, not a restreamer.
 *
 * THE HONEST FAILURE MODE, and why this is safe: if the channel is offline or
 * between matches, Twitch's own player says so. We only ever mount it for an
 * event the PROVIDER reports as live, and we never claim the stream shows this
 * particular match — the panel is labelled with the league, not the fixture.
 * Unknown tournament -> no channel -> no player, which is the common case and
 * costs nothing.
 */

export interface StreamChannel {
  /** Twitch channel login (lowercase). */
  channel: string;
  /** What the panel calls it — the league, never the match. */
  label: string;
}

/**
 * Tournament keyword -> official channel. Matched case-insensitively against
 * the event title, LONGEST KEY FIRST, so "lck challengers" cannot be swallowed
 * by "lck". Keep keys specific enough that a team name can never trigger one.
 */
const LEAGUE_CHANNELS: [string, StreamChannel][] = [
  // League of Legends
  ['lec', { channel: 'lec', label: 'LEC' }],
  ['lcs', { channel: 'lcs', label: 'LCS' }],
  ['lck', { channel: 'lck', label: 'LCK' }],
  ['lpl', { channel: 'lpl', label: 'LPL' }],
  ['worlds', { channel: 'riotgames', label: 'Worlds' }],
  ['msi', { channel: 'riotgames', label: 'MSI' }],
  // Counter-Strike
  ['blast', { channel: 'blastpremier', label: 'BLAST Premier' }],
  ['iem', { channel: 'esl_csgo', label: 'IEM' }],
  ['esl pro league', { channel: 'esl_csgo', label: 'ESL Pro League' }],
  ['starladder', { channel: 'starladder_cs_en', label: 'StarLadder' }],
  ['pgl', { channel: 'pgl', label: 'PGL' }],
  // Valorant
  ['vct', { channel: 'valorant', label: 'VCT' }],
  ['champions tour', { channel: 'valorant', label: 'VCT' }],
  ['game changers', { channel: 'valorant', label: 'VCT Game Changers' }],
  // Dota 2
  ['the international', { channel: 'dota2ti', label: 'The International' }],
  ['esl one', { channel: 'esl_dota2', label: 'ESL One' }],
  ['dreamleague', { channel: 'dreamleague', label: 'DreamLeague' }],
  // Rainbow Six / Overwatch / CoD
  ['six invitational', { channel: 'rainbow6', label: 'Six Invitational' }],
  ['owcs', { channel: 'overwatchleague', label: 'OWCS' }],
  ['call of duty league', { channel: 'callofduty', label: 'CDL' }],
];

const SORTED_LEAGUES = [...LEAGUE_CHANNELS].sort((a, b) => b[0].length - a[0].length);

/** The official channel for an event title, or null when we don't know one —
 *  which is the honest answer far more often than not. */
export function streamChannelFor(title: string): StreamChannel | null {
  const hay = ` ${title.toLowerCase()} `;
  for (const [key, channel] of SORTED_LEAGUES) {
    // Word-bounded: " lec " must not match "select" or "Alec".
    if (hay.includes(` ${key} `) || hay.includes(` ${key}-`) || hay.includes(`-${key} `)) {
      return channel;
    }
  }
  return null;
}

/**
 * The embed URL. `parent` MUST list the exact host serving the page or Twitch
 * refuses the frame, which is why this takes a hostname instead of hard-coding
 * one — localhost, the Vercel preview and the production domain all work
 * without a config entry.
 *
 * Muted by default: a stream that starts talking on its own is the fastest way
 * to make someone close the tab.
 */
export function twitchEmbedUrl(channel: string, hostname: string): string {
  const parent = encodeURIComponent(hostname);
  return `https://player.twitch.tv/?channel=${encodeURIComponent(
    channel
  )}&parent=${parent}&muted=true&autoplay=true`;
}
