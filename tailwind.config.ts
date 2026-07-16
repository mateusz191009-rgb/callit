import type { Config } from 'tailwindcss';

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
        sky: { DEFAULT: '#3B9DF8', deep: '#2E7FD1' }, // secondary = the "No" side
        danger: '#FF5C7A', // errors, negative PnL
        amber: '#FFB547', // warnings, "Ends soon"
        tx: { DEFAULT: '#FFFFFF', sec: '#C7D5E0', mut: '#6F8CA4' }, // text hierarchy
      },
      fontFamily: {
        sans: ['var(--font-nunito)', 'Nunito', 'ui-sans-serif', 'system-ui', 'sans-serif'],
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
  plugins: [],
};

export default config;
