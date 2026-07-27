'use client';

import { supabase } from './supabase';

/**
 * Market icons: pick a file, get a URL back (v25.28).
 *
 * Two steps, and the first one is the important one. A phone camera photo is
 * 3-5 MB and 4000px wide; a market icon renders at 56px. So the browser
 * re-encodes it to a square ICON_PX thumbnail before anything is uploaded or
 * stored — the file that leaves the device is ~15-30 KB, which is what makes
 * the local-mode fallback (a data URL in localStorage) survivable at all.
 *
 * Then, in cloud mode, it goes to the `market-icons` bucket and the market row
 * stores the public URL. Without Supabase — local demo mode — there is nowhere
 * to put a file, so the data URL IS the icon. Both paths hand back a string
 * the <img> can render, and neither can throw: a failed upload degrades to the
 * data URL, and a market with no icon falls back to its category glyph exactly
 * as it always has.
 */

/** Rendered at 56px at most; 256 covers a 2x display and a future bigger card. */
const ICON_PX = 256;

/** What the file input accepts, and what the bucket's mime whitelist allows. */
export const ICON_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

/** Reject before decoding — a 50 MB RAW file should not become a canvas. */
const MAX_INPUT_BYTES = 12 * 1024 * 1024;

export interface PreparedIcon {
  /** Square, ICON_PX, JPEG. Ready to upload or to store as-is. */
  blob: Blob;
  /** The same image as a data URL — the preview, and the local-mode icon. */
  dataUrl: string;
}

/** Load a File into an <img> we can draw. Object URLs, not FileReader: no
 *  base64 round trip for a file that may be several megabytes. */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file is not an image we can read.'));
    };
    img.src = url;
  });
}

/**
 * Square-crop + downscale to ICON_PX. Center-cropped rather than letterboxed:
 * every icon in the app is rendered in a square and a letterboxed one would
 * sit in bars of its own background.
 */
export async function prepareIcon(file: File): Promise<PreparedIcon> {
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('That image is too large — pick one under 12 MB.');
  }
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  if (!side) throw new Error('That image is empty.');

  const canvas = document.createElement('canvas');
  canvas.width = ICON_PX;
  canvas.height = ICON_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not process that image.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    img,
    (img.naturalWidth - side) / 2,
    (img.naturalHeight - side) / 2,
    side,
    side,
    0,
    0,
    ICON_PX,
    ICON_PX
  );

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.85)
  );
  if (!blob) throw new Error('Your browser could not process that image.');
  return { blob, dataUrl: canvas.toDataURL('image/jpeg', 0.85) };
}

/**
 * Put the prepared icon somewhere a market row can point at.
 *
 * Returns the public URL in cloud mode, and the data URL in local mode or
 * when the upload fails — including the case where the operator has not run
 * the v25.28 migration and the bucket does not exist yet. That fallback is
 * deliberate: the market still gets its picture, and the only cost is a
 * bigger row for that one market.
 */
export async function uploadIcon(icon: PreparedIcon): Promise<string> {
  if (!supabase) return icon.dataUrl;
  try {
    // The AUTH id, not the store's user object — the storage policy compares
    // the first path segment to auth.uid(), and the store only knows an
    // email and a username.
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return icon.dataUrl;
    // `<uid>/<name>` — the folder is what scopes writes to their owner.
    const name = `${uid}/${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}.jpg`;
    const { error } = await supabase.storage.from('market-icons').upload(name, icon.blob, {
      contentType: 'image/jpeg',
      cacheControl: '31536000',
      upsert: false,
    });
    if (error) return icon.dataUrl;
    const { data } = supabase.storage.from('market-icons').getPublicUrl(name);
    return data?.publicUrl || icon.dataUrl;
  } catch {
    return icon.dataUrl;
  }
}
