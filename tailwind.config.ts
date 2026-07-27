import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';

/**
 * Callit design tokens — dark navy theme, green as the single hero accent.
 * Yes = green, No = sky (brand decision — never red for "No").
 * Red (danger) is reserved for errors and negative PnL only.
 */
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: '#0E1C28', // page background
        surface: { DEFAULT: '#13273A', 2: '#1C2E3C', 3: '#24384A' }, // sidebar/topbar, cards, hover/inputs
        line: { DEFAULT: '#2C4356', strong: '#3A5570' }, // borders
        green: { DEFAULT: '#00E17E', deep: '#00B868', ink: '#0A2A1C' }, // primary / pressed / text ON green
        // `ink` = text ON a solid fill, `bright` = text on a /10../15 TINT of
        // the same color. Green needs no `bright` (it clears AA on its own
        // tint at 6.5:1); sky and danger are darker and do not — see the
        // contrast note above `tx.mut`.
        sky: { DEFAULT: '#3B9DF8', deep: '#2E7FD1', ink: '#06243D', bright: '#7AC0FB' }, // secondary = the "No" side
        danger: { DEFAULT: '#FF5C7A', bright: '#FF8DA1' }, // errors, negative PnL
        amber: '#FFB547', // warnings, "Ends soon"
        // `mut` is the app's default small-text color and is almost always
        // set at 10-12px, so it never gets the large-text exemption. It must
        // clear 4.5:1 on the DARKEST surface it lands on (surface-3): the old
        // #6F8CA4 managed only 3.43:1 there. #8FA8BC gives 4.84:1 on
        // surface-3, 5.66:1 on surface-2, 7.06:1 on ink.
        tx: { DEFAULT: '#FFFFFF', sec: '#C7D5E0', mut: '#8FA8BC' }, // text hierarchy
      },
      fontFamily: {
        sans: ['var(--font-nunito)', 'Nunito', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      /**
       * The sub-14px steps, named.
       *
       * Tailwind's built-in scale bottoms out at `text-xs` (12px), so
       * everything smaller was written as an arbitrary value — `text-[11px]`
       * alone appeared 73 times. The scale was already real and consistent;
       * it just had no names, so nothing stopped a 74th size appearing.
       *
       * DELIBERATELY no line-height. These are drop-in replacements for the
       * arbitrary values, which inherit their leading — pairing a
       * line-height with them here would have silently re-flowed every one
       * of the ~120 call sites. Adding one is a separate, deliberate change.
       */
      fontSize: {
        nano: '10px',
        micro: '11px',
        mini: '13px',
      },
      boxShadow: {
        'glow-green':
          '0 0 0 1px rgba(0,225,126,.35), 0 0 18px rgba(0,225,126,.18), 0 0 44px rgba(0,225,126,.10), inset 0 0 12px rgba(0,225,126,.05)',
        'glow-sky':
          '0 0 0 1px rgba(59,157,248,.35), 0 0 18px rgba(59,157,248,.18), 0 0 44px rgba(59,157,248,.10), inset 0 0 12px rgba(59,157,248,.05)',
      },
      keyframes: {
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.6s infinite',
        marquee: 'marquee 45s linear infinite',
      },
    },
  },
  plugins: [
    // `coarse:` = touch input, at ANY viewport width. Used for the 16px
    // minimum on text fields: iOS Safari zooms the page on focus below that
    // and never zooms back out, which then leaves the sticky topbar
    // overhanging. A `sm:` breakpoint would miss a phone in landscape.
    plugin(({ addVariant }) => {
      addVariant('coarse', '@media (pointer: coarse)');
    }),
  ],
};

export default config;
