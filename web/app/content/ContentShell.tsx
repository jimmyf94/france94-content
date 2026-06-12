'use client';

import { ContentNav } from './ContentNav';
import { ScheduleDrawerHost } from './ScheduleDrawerHost';

export function ContentShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[100dvh] flex-col bg-[var(--bg)] text-[var(--text)]">
      <ContentNav />
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      <ScheduleDrawerHost />
    </div>
  );
}
