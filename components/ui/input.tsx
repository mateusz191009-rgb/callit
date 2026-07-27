'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => (
    <input
      ref={ref}
      // The `error` prop was visual-only; without this a screen reader is
      // never told the field is rejected. Callers that already pass their own
      // aria-invalid keep it, since {...props} is spread after.
      aria-invalid={error || undefined}
      className={cn(
        // `coarse:text-base` — 16px on touch, or iOS Safari zooms on focus.
        // No `focus:outline-none`: it out-specifies the global
        // `*:focus-visible` ring in globals.css, and the border tint left
        // behind is only 2.96:1 against the resting border — not a
        // perceivable focus state on its own.
        'h-11 w-full rounded-xl border bg-surface-3 px-3.5 text-sm coarse:text-base text-tx',
        'placeholder:text-tx-mut transition-colors',
        'hover:border-line-strong focus:border-green/60',
        error ? 'border-danger/60' : 'border-line',
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';

export default Input;
