'use client';

import { forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}

/** Styled native select — keyboard/screen-reader friendly out of the box. */
const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, error, children, ...props }, ref) => (
    <div className={cn('relative', className)}>
      <select
        ref={ref}
        aria-invalid={error || undefined}
        className={cn(
          // See input.tsx for why there is no `focus:outline-none` and why the
          // font steps up to 16px on touch.
          'h-11 w-full appearance-none rounded-xl border bg-surface-3 pl-3.5 pr-9 text-sm coarse:text-base text-tx',
          'transition-colors hover:border-line-strong focus:border-green/60',
          '[&>option]:bg-surface-2 [&>option]:text-tx',
          error ? 'border-danger/60' : 'border-line'
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tx-mut"
        aria-hidden
      />
    </div>
  )
);
Select.displayName = 'Select';

export default Select;
