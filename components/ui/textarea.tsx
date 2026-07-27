'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, ...props }, ref) => (
    <textarea
      ref={ref}
      aria-invalid={error || undefined}
      className={cn(
        // See input.tsx for why there is no `focus:outline-none` and why the
        // font steps up to 16px on touch.
        'min-h-[110px] w-full rounded-xl border bg-surface-3 px-3.5 py-3 text-sm coarse:text-base text-tx',
        'placeholder:text-tx-mut transition-colors resize-y',
        'hover:border-line-strong focus:border-green/60',
        error ? 'border-danger/60' : 'border-line',
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = 'Textarea';

export default Textarea;
