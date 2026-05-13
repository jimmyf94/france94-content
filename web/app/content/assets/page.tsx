import { Suspense } from 'react';

import { AssetLibrary } from './AssetLibrary';

export default function ContentAssetsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg)] text-[var(--text)]">
      <Suspense fallback={<p className="p-8 text-[var(--muted)]">Loading…</p>}>
        <AssetLibrary />
      </Suspense>
    </div>
  );
}
