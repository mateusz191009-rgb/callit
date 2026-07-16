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
      className={cn(
        'min-h-[110px] w-full rounded-xl border bg-surface-3 px-3.5 py-3 text-sm text-tx',
        'placeholder:text-tx-mut transition-colors resize-y',
        'hover:border-line-strong focus:border-green/60 focus:outline-none',
        error ? 'border-danger/60' : 'border-line',
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = 'Textarea';

export default Textarea;
