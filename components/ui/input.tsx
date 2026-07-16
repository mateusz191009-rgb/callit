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
      className={cn(
        'h-11 w-full rounded-xl border bg-surface-3 px-3.5 text-sm text-tx',
        'placeholder:text-tx-mut transition-colors',
        'hover:border-line-strong focus:border-green/60 focus:outline-none',
        error ? 'border-danger/60' : 'border-line',
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';

export default Input;
