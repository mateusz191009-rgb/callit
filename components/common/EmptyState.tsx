'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import Button, { buttonClasses } from '@/components/ui/button';

export default function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-line px-6 py-10">
      {Icon && (
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-3 text-tx-sec">
          <Icon className="h-6 w-6" aria-hidden />
        </div>
      )}
      <h3 className="text-center font-bold text-tx">{title}</h3>
      {description && (
        <p className="-mt-1 max-w-sm text-center text-sm text-tx-mut">{description}</p>
      )}
      {actionLabel &&
        (actionHref ? (
          <Link href={actionHref} className={buttonClasses('primary', 'md', 'mt-1')}>
            {actionLabel}
          </Link>
        ) : onAction ? (
          <Button variant="primary" size="md" className="mt-1" onClick={onAction}>
            {actionLabel}
          </Button>
        ) : null)}
    </div>
  );
}
