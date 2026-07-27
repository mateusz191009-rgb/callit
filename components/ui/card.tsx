import { cn } from '@/lib/utils';

/**
 * Padding roles, not sizes. Pick by what the card IS:
 *
 * - `tight`   grid cards — dense, many on screen at once
 * - `default` panels and sections — the overwhelming majority
 * - `roomy`   placeholder / empty-state blocks that need air
 * - `none`    the shell only, when the padding belongs to an inner element
 *             (a card with its own scroll area, or a divided list)
 */
export type CardPadding = 'none' | 'tight' | 'default' | 'roomy';

const paddings: Record<CardPadding, string> = {
  none: '',
  tight: 'p-3.5',
  default: 'p-5',
  roomy: 'p-8',
};

export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  padding?: CardPadding;
  /** Semantic element. `section`/`article` when the card is a real landmark
   *  in the page outline, not just a box. */
  as?: 'div' | 'section' | 'article';
}

/**
 * The standard card surface.
 *
 * The shell itself is the `.card-surface` class in globals.css — radius,
 * border and background, defined once. This component is the typed way to
 * reach it from new code, and the reason the padding scale has names
 * instead of whichever `p-*` the author happened to type.
 *
 * Existing markup uses `card-surface` directly with its own padding; both
 * resolve to the same shell, so there is exactly one place to change a
 * border colour or a radius.
 */
export default function Card({
  padding = 'default',
  as: Tag = 'div',
  className,
  children,
  ...props
}: CardProps) {
  return (
    <Tag className={cn('card-surface', paddings[padding], className)} {...props}>
      {children}
    </Tag>
  );
}
