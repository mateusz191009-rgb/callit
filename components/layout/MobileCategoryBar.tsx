'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Flame, Sparkles, type LucideIcon } from 'lucide-react';
import { CATEGORY_ICONS } from './Sidebar';
import { useCallitStore } from '@/lib/store';
import { useCategories } from '@/lib/useMarkets';
import { cn } from '@/lib/utils';

/**
 * Mobile-only (< lg) horizontal category strip pinned right under the fixed
 * Topbar — the categories the desktop sidebar shows, reachable without
 * opening the burger drawer. Sticky works here because AppShell's <main>
 * uses overflow-x-clip, which does not create a scroll container (same
 * reason the lg:sticky rails on market pages keep sticking). z-30 sits
 * below the Topbar (z-50), sidebar (z-40) and drawer (z-[60]+).
 */
export default function MobileCategoryBar() {
  const pathname = usePathname();
  const setHomeTab = useCallitStore((s) => s.setHomeTab);
  // Same source as the sidebar: built-ins + admin-created categories.
  const categories = useCategories();

  return (
    <nav
      aria-label="Categories"
      className="sticky top-16 z-30 border-b border-line bg-surface lg:hidden"
    >
      <div className="flex items-center gap-1 overflow-x-auto px-2 py-1.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <BarItem
          icon={Flame}
          label="Trending"
          href="/"
          active={pathname === '/'}
          onClick={() => setHomeTab('trending')}
        />
        {categories.map((c) => (
          <BarItem
            key={c.value}
            icon={(CATEGORY_ICONS as Record<string, LucideIcon>)[c.value] ?? Sparkles}
            label={c.label}
            href={`/category/${c.value}`}
            active={pathname === `/category/${c.value}`}
          />
        ))}
      </div>
    </nav>
  );
}

function BarItem({
  icon: Icon,
  label,
  href,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  href: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[13px] font-bold transition-colors',
        active ? 'text-tx' : 'text-tx-sec hover:bg-surface-3/60 hover:text-tx'
      )}
    >
      <Icon
        className={cn('h-4 w-4 shrink-0', active ? 'text-green' : 'text-tx-mut')}
        aria-hidden
      />
      {label}
    </Link>
  );
}
