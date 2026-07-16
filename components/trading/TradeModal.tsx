'use client';

import { useRef } from 'react';
import type { Market, Side } from '@/lib/types';
import { useCallitStore } from '@/lib/store';
import { useMarket } from '@/lib/useMarkets';
import Modal from '@/components/ui/modal';
import TradePanel from './TradePanel';

/** Global trade modal driven by `store.tradeModal`. Caches the last
 *  non-null market in a ref so the content never blanks while the
 *  modal exit-animates after closing. */
export default function TradeModal() {
  const tradeModal = useCallitStore((s) => s.tradeModal);
  const closeTradeModal = useCallitStore((s) => s.closeTradeModal);
  const market = useMarket(tradeModal?.marketId ?? '');

  // Keep the last non-null market + side rendered during the exit animation.
  const lastMarket = useRef<Market | null>(null);
  const lastSide = useRef<Side>('yes');
  if (market) lastMarket.current = market;
  if (tradeModal) lastSide.current = tradeModal.side;

  const shown = market ?? lastMarket.current;
  const side = lastSide.current;

  if (!shown) return null;

  // The panel renders its own market header (icon + question), so the
  // modal title stays a plain label instead of repeating the question.
  return (
    <Modal open={Boolean(tradeModal && market)} onClose={closeTradeModal} title="Trade">
      <TradePanel
        key={shown.id + side}
        market={shown}
        defaultSide={side}
        variant="modal"
        onTraded={closeTradeModal}
      />
    </Modal>
  );
}
