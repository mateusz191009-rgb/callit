'use client';

import { useRef, useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { ICON_ACCEPT, prepareIcon, type PreparedIcon } from '@/lib/upload';
import { cn } from '@/lib/utils';

/**
 * The market's picture (v25.28).
 *
 * The file never leaves this component as the user picked it: `prepareIcon`
 * re-encodes it to a 256px square JPEG first (a phone photo is 4 MB and 4000px
 * wide; the icon renders at 56). What the form holds afterwards is the data
 * URL — which is both the preview and, in local demo mode, the icon itself.
 * The upload to storage happens at submit, not here, so a user who changes
 * their mind three times does not leave three orphans in the bucket.
 */
export default function IconUpload({
  value,
  onChange,
}: {
  /** The prepared icon, or null. Owned by the form. */
  value: PreparedIcon | null;
  onChange: (icon: PreparedIcon | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await prepareIcon(file));
    } catch (e) {
      onChange(null);
      setError(e instanceof Error ? e.message : 'That image could not be read.');
    } finally {
      setBusy(false);
      // Let the same file be picked again after a removal.
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border',
            value ? 'border-line' : 'border-dashed border-line-strong bg-surface-3'
          )}
        >
          {value ? (
            // Not next/image: a data URL has no loader and no known
            // dimensions, and this is a 256px thumbnail we just produced.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value.dataUrl} alt="" className="h-full w-full object-cover" />
          ) : busy ? (
            <Loader2 className="h-5 w-5 animate-spin text-tx-mut" aria-hidden />
          ) : (
            <ImagePlus className="h-5 w-5 text-tx-mut" aria-hidden />
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="rounded-lg border border-line bg-surface-3 px-3 py-1.5 text-xs font-bold text-tx-sec transition-colors hover:border-green/50 hover:text-tx disabled:opacity-50"
          >
            {value ? 'Replace image' : 'Upload an image'}
          </button>
          {value && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold text-tx-mut transition-colors hover:text-danger"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              Remove
            </button>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={ICON_ACCEPT}
            className="sr-only"
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
        </div>
      </div>

      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : (
        <p className="text-xs leading-relaxed text-tx-mut">
          Square works best — anything else is centre-cropped to 256px. Without
          one, your market wears its category icon.
        </p>
      )}
    </div>
  );
}
