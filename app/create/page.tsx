'use client';

import CreateMarketForm from '@/components/create/CreateMarketForm';

export default function CreatePage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight text-tx">
          Create a market
        </h1>
        <p className="mt-2 text-tx-sec">
          Launch your own prediction market in under a minute. No permission
          needed.
        </p>
      </div>
      <CreateMarketForm />
    </div>
  );
}
