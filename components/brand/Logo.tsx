import { cn } from '@/lib/utils';

/**
 * Callitnow brand logo — green squircle icon (check morphing into a price
 * arrow) + lowercase Nunito Black wordmark: "callit" in white, "now" in
 * Call green (assets/callitnow-brand-kit). Exact brand-kit design, do not
 * alter.
 *
 * The default `Logo` lockup is WORDMARK ONLY (owner request, re-confirmed
 * at the callitnow rebrand: on the page itself only the wordmark renders,
 * never the green icon). The icon still exists as `LogoIcon` for
 * off-page surfaces (favicon, PWA icons); pass `icon` to `Logo` only if
 * a surface ever needs the icon + text pairing again.
 */

export function LogoIcon({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={cn('shrink-0', className)}
      aria-hidden="true"
    >
      <rect width="100" height="100" rx="30" fill="#00E17E" />
      <path
        d="M26 57 L45 74 L70 43"
        stroke="#FFFFFF"
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M0 -9 L13 0 L0 9 Z" fill="#FFFFFF" transform="translate(74,38) rotate(-51)" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'font-black lowercase leading-none tracking-[-0.045em] text-white',
        className
      )}
    >
      callit<span className="text-green">now</span>
    </span>
  );
}

/**
 * Brand lockup. Wordmark only by default (~24px — a touch larger than the
 * old 22px so the topbar keeps its optical weight now that the icon no
 * longer carries part of it). Pass `icon` for the icon + wordmark pairing;
 * `iconSize` only applies then.
 */
export default function Logo({
  icon = false,
  iconSize = 30,
  textClassName = 'text-[24px]',
  className,
}: {
  icon?: boolean;
  iconSize?: number;
  textClassName?: string;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      {icon && <LogoIcon size={iconSize} />}
      <Wordmark className={textClassName} />
    </span>
  );
}
