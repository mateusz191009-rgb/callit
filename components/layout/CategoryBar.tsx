'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bitcoin,
  Clapperboard,
  Cpu,
  Earth,
  Flame,
  Gamepad2,
  Landmark,
  Sparkles,
  TrendingUp,
  Trophy,
  Volleyball,
  type LucideIcon,
} from 'lucide-react';
import { BaseballIcon, BasketballIcon } from '@/components/icons';
import { useCallitStore } from '@/lib/store';
import { useCategories } from '@/lib/useMarkets';
import type { BuiltinCategory } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Shared category icon set (also used by MarketCard/EventCard fallbacks). */
export const CATEGORY_ICONS: Record<BuiltinCategory, LucideIcon> = {
  politics: Landmark,
  sports: Trophy,
  football: Volleyball,
  basketball: BasketballIcon,
  baseball: BaseballIcon,
  esports: Gamepad2,
  crypto: Bitcoin,
  economy: TrendingUp,
  'tech-science': Cpu,
  world: Earth,
  'pop-culture': Clapperboard,
  custom: Sparkles,
};

/**
 * Horizontal category nav pinned right under the fixed Topbar — ALL
 * breakpoints (v12: the desktop sidebar is gone, Polymarket-style; the
 * secondary destinations moved into the profile menu). Sticky works here
 * because AppShell's <main> uses overflow-x-clip, which does not create a
 * scroll container (same reason the lg:sticky rails on market pages keep
 * sticking). z-30 sits below the Topbar (z-50).
 */
export default function CategoryBar() {
  const pathname = usePathname();
  const setHomeTab = useCallitStore((s) => s.setHomeTab);
  // Same source as everywhere: built-ins + admin-created categories.
  const categories = useCategories();

  return (
    <nav
      aria-label="Categories"
      className="sticky top-16 z-30 border-b border-line bg-surface"
    >
      <div className="mx-auto flex max-w-[1400px] items-center gap-1 overflow-x-auto px-2 py-1.5 sm:px-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
