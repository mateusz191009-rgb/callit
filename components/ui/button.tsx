'use client';

import { forwardRef, type ReactNode } from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ButtonVariant =
  | 'primary' // green, dark-green text
  | 'sky' // blue, for "No"-side actions
  | 'outline'
  | 'ghost'
  | 'danger'
  | 'yes-tint' // translucent green tint (quick-buy Yes)
  | 'no-tint'; // translucent sky tint (quick-buy No)

export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 rounded-xl font-bold select-none ' +
  'disabled:opacity-45 disabled:pointer-events-none whitespace-nowrap';

// v25: no hover glow — buttons state through bg/border shifts only. The
// static .glow-green stays available for the one CTA that earns it
// (TradePanel's trade button); green light means action, not decoration.
const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-green text-green-ink border border-green/60 hover:bg-[#12E88A] transition-colors',
  sky: 'bg-sky text-white border border-sky/60 hover:bg-[#4FA8F9] transition-colors',
  outline:
    'bg-transparent text-tx border border-line hover:border-line-strong hover:bg-surface-3 transition-colors',
  ghost: 'bg-transparent text-tx-sec border border-transparent hover:bg-surface-3 hover:text-tx',
  danger: 'bg-danger/15 text-danger border border-danger/40 hover:bg-danger/25',
  'yes-tint':
    'bg-green/10 text-green border border-green/25 hover:bg-green/20 hover:border-green/40 transition-colors',
  'no-tint':
    'bg-sky/10 text-sky border border-sky/25 hover:bg-sky/20 hover:border-sky/40 transition-colors',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

export function buttonClasses(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className?: string
) {
  return cn(base, variants[variant], sizes[size], className);
}

export interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children?: ReactNode;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, className, children, disabled, ...props }, ref) => (
    <motion.button
      ref={ref}
      whileTap={{ scale: 0.98 }}
      className={buttonClasses(variant, size, className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </motion.button>
  )
);
Button.displayName = 'Button';

export default Button;
