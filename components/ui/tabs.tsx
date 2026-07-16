'use client';

import { useId } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface TabItem<T extends string = string> {
  value: T;
  label: string;
}

/**
 * Underline tabs with a shared framer-motion `layoutId` so the active
 * indicator slides between tabs.
 */
export default function Tabs<T extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  const id = useId();

  // ARIA tabs keyboard pattern: roving tabindex + arrow-key navigation.
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (index + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next === -1) return;
    e.preventDefault();
    onChange(items[next].value);
    const tab = e.currentTarget.parentElement?.children[next] as HTMLElement | undefined;
    tab?.focus();
  };

  return (
    <div
      role="tablist"
      className={cn('flex items-center gap-1 overflow-x-auto border-b border-line', className)}
    >
      {items.map((item, index) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              'relative shrink-0 px-3.5 py-2.5 text-sm font-bold transition-colors',
              active ? 'text-tx' : 'text-tx-mut hover:text-tx-sec'
            )}
          >
            {item.label}
            {active && (
              <motion.span
                layoutId={`tab-underline-${id}`}
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-green"
                transition={{ type: 'spring', stiffness: 500, damping: 40 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
