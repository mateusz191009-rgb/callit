'use client';

/**
 * The Twitch panel (v25.19) — the esports hero's right half, and the "live
 * stats" block on an esports event page.
 *
 * Deliberately opt-in and deliberately quiet:
 *   - It renders NOTHING unless lib/streams.ts knows an official channel for
 *     this tournament. No channel, no panel — never a guess, never an embed of
 *     someone's restream.
 *   - The frame only mounts after the user asks for it. A Twitch iframe is a
 *     video player: mounting one automatically on a category page would start
 *     a video download for every visitor, including on phones. The poster
 *     underneath is the event's own artwork, so the panel looks finished
 *     either way.
 *   - The label names the LEAGUE, not the match. We know LEC is on this
 *     channel; we do not know that this fixture is the one currently on air.
 *
 * `parent` comes from window.location.hostname, which is what Twitch requires
 * and what makes this work on localhost, previews and production without a
 * config entry.
 */

import { useEffect, useState } from 'react';
import { Play, Tv } from 'lucide-react';
import { streamChannelFor, twitchEmbedUrl } from '@/lib/streams';
import { cn } from '@/lib/utils';

export default function StreamPanel({
  title,
  poster,
  className,
  /** Start the player as soon as the host is known (event pages, where the
   *  user came specifically for this match). Hubs leave it false. */
  autoStart = false,
}: {
  /** Event title — the tournament is read out of it. */
  title: string;
  /** Event artwork, shown until the player mounts. */
  poster?: string;
  className?: string;
  autoStart?: boolean;
}) {
  // Read on the client only: there is no hostname during SSR, and Twitch
  // rejects the frame without the right one.
  const [host, setHost] = useState('');
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    setHost(window.location.hostname);
  }, []);

  const channel = streamChannelFor(title);
  if (!channel) return null;

  const live = playing || autoStart;

  return (
    <div className={cn('relative overflow-hidden bg-ink', className)}>
      {live && host ? (
        <iframe
          title={`${channel.label} live stream`}
          src={twitchEmbedUrl(channel.channel, host)}
          allowFullScreen
          // No `allow="autoplay"`: muted autoplay is permitted without it, and
          // granting it would let the frame start audio on its own.
          className="absolute inset-0 h-full w-full border-0"
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          disabled={!host}
          className="group absolute inset-0 flex h-full w-full items-center justify-center"
          aria-label={`Watch the ${channel.label} stream`}
        >
          {poster && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={poster}
              alt=""
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover opacity-40 transition-opacity group-hover:opacity-50"
            />
          )}
          <span className="relative flex flex-col items-center gap-2">
            <span className="grid h-11 w-11 place-items-center rounded-full border border-line-strong bg-surface-2/90 text-tx transition-colors group-hover:border-green group-hover:text-green">
              <Play className="ml-0.5 h-5 w-5" aria-hidden />
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2/90 px-2.5 py-1 text-[11px] font-bold text-tx-sec">
              <Tv className="h-3 w-3" aria-hidden />
              {channel.label} stream
            </span>
          </span>
        </button>
      )}
    </div>
  );
}
