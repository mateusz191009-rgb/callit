'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Bitcoin,
  Briefcase,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  CircleHelp,
  Clapperboard,
  Cpu,
  Earth,
  Flame,
  FolderOpen,
  Gamepad2,
  Gift,
  Handshake,
  House,
  Landmark,
  LayoutGrid,
  Medal,
  Plus,
  Settings,
  Shield,
  Sparkles,
  TrendingUp,
  Trophy,
  Volleyball,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { buttonClasses } from '@/components/ui/button';
import Badge from '@/components/ui/badge';
import { useCallitStore } from '@/lib/store';
import { useCategories } from '@/lib/useMarkets';
import type { BuiltinCategory } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Shared with MobileCategoryBar so both navs show identical icons. */
export const CATEGORY_ICONS: Record<BuiltinCategory, LucideIcon> = {
  politics: Landmark,
  sports: Trophy,
  football: Volleyball,
  esports: Gamepad2,
  crypto: Bitcoin,
  economy: TrendingUp,
  'tech-science': Cpu,
  world: Earth,
  'pop-culture': Clapperboard,
  custom: Sparkles,
};

/* ------------------------------------------------------------------ */
/* Building blocks                                                     */
/* ------------------------------------------------------------------ */

interface NavItemProps {
  icon: LucideIcon;
  label: string;
  href?: string;
  active?: boolean;
  collapsed?: boolean;
  badge?: string;
  onClick?: () => void;
}

function NavItem({ icon: Icon, label, href, active, collapsed, badge, onClick }: NavItemProps) {
  const classes = cn(
    'group/item relative flex h-10 w-full items-center gap-3 rounded-xl px-3 text-sm font-bold transition-colors',
    active ? 'bg-surface-3 text-tx' : 'text-tx-sec hover:bg-surface-3/60 hover:text-tx',
    collapsed && 'justify-center gap-0 px-0'
  );

  const content = (
    <>
      {active && (
        <span
          aria-hidden
          className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-green"
        />
      )}
      <Icon
        className={cn(
          'h-[18px] w-[18px] shrink-0 transition-colors',
          active ? 'text-green' : 'text-tx-mut group-hover/item:text-tx-sec'
        )}
        aria-hidden
      />
      {!collapsed && <span className="truncate">{label}</span>}
      {!collapsed && badge && (
        <Badge variant="amber" className="ml-auto shrink-0">
          {badge}
        </Badge>
      )}
    </>
  );

  // Collapsed rail lives inside a scroll container, so a custom tooltip
  // would be clipped — the native title escapes it reliably.
  return href ? (
    <Link
      href={href}
      onClick={onClick}
      className={classes}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
    >
      {content}
    </Link>
  ) : (
    <button
      type="button"
      onClick={onClick}
      className={classes}
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
    >
      {content}
    </button>
  );
}

function NavGroup({
  label,
  collapsed,
  children,
}: {
  label: string;
  collapsed?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);

  // Collapsed rail: no section header, icon items only, subtle divider.
  if (collapsed) {
    return <div className="mt-3 flex flex-col gap-1 border-t border-line pt-3">{children}</div>;
  }

  return (
    <div className="pt-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex h-8 w-full items-center justify-between rounded-lg px-3 text-[11px] font-bold uppercase tracking-[0.08em] text-tx-mut transition-colors hover:text-tx-sec"
      >
        {label}
        <ChevronDown
          className={cn('h-3.5 w-3.5 transition-transform duration-200', !open && '-rotate-90')}
          aria-hidden
        />
      </button>
      {/* Conditional render without AnimatePresence exit — exit completion
          is unreliable with React 19.2 and would leave items mounted. */}
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
        >
          <div className="flex flex-col gap-1 pt-1">{children}</div>
        </motion.div>
      )}
    </div>
  );
}

function CreateMarketLink({
  collapsed,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  if (collapsed) {
    return (
      <span className="flex w-full justify-center">
        <Link
          href="/create"
          onClick={onNavigate}
          aria-label="Create new market"
          title="Create new market"
          className={buttonClasses('primary', 'md', 'glow-green h-10 w-10 rounded-full px-0')}
        >
          <Plus className="h-5 w-5" aria-hidden />
        </Link>
      </span>
    );
  }
  return (
    <Link
      href="/create"
      onClick={onNavigate}
      className={buttonClasses('primary', 'md', 'glow-green w-full rounded-full')}
    >
      <Plus className="h-4 w-4" aria-hidden />
      Create new market
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Shared nav content (also rendered inside MobileNav)                 */
/* ------------------------------------------------------------------ */

export function SidebarNav({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const setHomeTab = useCallitStore((s) => s.setHomeTab);
  // Full category list: built-ins + admin-created custom categories.
  const categories = useCategories();

  return (
    <div className="flex flex-col gap-1">
      <NavItem
        icon={House}
        label="Home"
        href="/"
        active={pathname === '/'}
        collapsed={collapsed}
        onClick={onNavigate}
      />
      <NavItem
        icon={Flame}
        label="Trending"
        href="/"
        collapsed={collapsed}
        onClick={() => {
          setHomeTab('trending');
          onNavigate?.();
        }}
      />
      <NavItem
        icon={Medal}
        label="Leaderboard"
        href="/leaderboard"
        active={pathname.startsWith('/leaderboard')}
        collapsed={collapsed}
        badge="Soon"
        onClick={onNavigate}
      />
      <NavItem
        icon={Gift}
        label="Rewards"
        href="/rewards"
        active={pathname.startsWith('/rewards')}
        collapsed={collapsed}
        badge="Soon"
        onClick={onNavigate}
      />
      <NavItem
        icon={Handshake}
        label="Affiliates"
        href="/affiliate"
        active={pathname.startsWith('/affiliate')}
        collapsed={collapsed}
        onClick={onNavigate}
      />

      <NavGroup label="Prediction markets" collapsed={collapsed}>
        <CreateMarketLink collapsed={collapsed} onNavigate={onNavigate} />
        <NavItem
          icon={LayoutGrid}
          label="All markets"
          href="/"
          collapsed={collapsed}
          onClick={() => {
            setHomeTab('all');
            onNavigate?.();
          }}
        />
        <NavItem
          icon={FolderOpen}
          label="My markets"
          href="/"
          collapsed={collapsed}
          onClick={() => {
            setHomeTab('mine');
            onNavigate?.();
          }}
        />
        <NavItem
          icon={Briefcase}
          label="My positions"
          href="/portfolio"
          active={pathname.startsWith('/portfolio')}
          collapsed={collapsed}
          onClick={onNavigate}
        />
        <NavItem
          icon={Wallet}
          label="Wallet"
          href="/wallet"
          active={pathname.startsWith('/wallet')}
          collapsed={collapsed}
          onClick={onNavigate}
        />
      </NavGroup>

      <NavGroup label="Categories" collapsed={collapsed}>
        {/* Category hub pages — the home chips keep the store filter. */}
        {categories.map((c) => (
          <NavItem
            key={c.value}
            icon={(CATEGORY_ICONS as Record<string, LucideIcon>)[c.value] ?? Sparkles}
            label={c.label}
            href={`/category/${c.value}`}
            active={pathname === `/category/${c.value}`}
            collapsed={collapsed}
            onClick={onNavigate}
          />
        ))}
      </NavGroup>
    </div>
  );
}

/** Settings / Help footer items (shared with MobileNav). */
export function SidebarUtilities({ collapsed = false }: { collapsed?: boolean }) {
  const pathname = usePathname();
  const user = useCallitStore((s) => s.user);
  const setMobileNavOpen = useCallitStore((s) => s.setMobileNavOpen);
  // These items also render inside the mobile drawer (which passes no
  // onNavigate) — close it on navigation; a no-op on desktop.
  const closeMobileNav = () => setMobileNavOpen(false);
  // v3: admin access is bound to the admin account (no password unlock).
  const showAdmin = Boolean(user?.isAdmin);

  return (
    <div className="flex flex-col gap-1">
      {showAdmin && (
        <NavItem
          icon={Shield}
          label="Admin"
          href="/admin"
          active={pathname.startsWith('/admin')}
          collapsed={collapsed}
        />
      )}
      <NavItem
        icon={Settings}
        label="Settings"
        href="/settings"
        active={pathname.startsWith('/settings')}
        collapsed={collapsed}
        onClick={closeMobileNav}
      />
      <NavItem
        icon={CircleHelp}
        label="Help"
        href="/help"
        active={pathname.startsWith('/help')}
        collapsed={collapsed}
        onClick={closeMobileNav}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Desktop sidebar                                                     */
/* ------------------------------------------------------------------ */

export default function Sidebar() {
  const collapsed = useCallitStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useCallitStore((s) => s.setSidebarCollapsed);

  return (
    <aside
      className={cn(
        'fixed bottom-0 left-0 top-16 z-40 hidden flex-col border-r border-line bg-surface transition-[width] duration-300 lg:flex',
        collapsed ? 'w-[72px]' : 'w-[256px]'
      )}
    >
      <nav aria-label="Primary" className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <SidebarNav collapsed={collapsed} />
      </nav>

      <div className="shrink-0 border-t border-line px-3 py-3">
        <SidebarUtilities collapsed={collapsed} />
        <div className="mt-1">
          <NavItem
            icon={collapsed ? ChevronsRight : ChevronsLeft}
            label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            collapsed={collapsed}
            onClick={() => setSidebarCollapsed(!collapsed)}
          />
        </div>
      </div>
    </aside>
  );
}
