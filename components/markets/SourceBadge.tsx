import { Globe } from 'lucide-react';
import Badge from '@/components/ui/badge';
import type { Market } from '@/lib/types';

export default function SourceBadge({ source }: { source: Market['source'] }) {
  return source === 'polymarket' ? (
    <Badge variant="sky">
      <Globe className="h-3 w-3 shrink-0" aria-hidden />
      Global
    </Badge>
  ) : (
    <Badge variant="green">Community</Badge>
  );
}
