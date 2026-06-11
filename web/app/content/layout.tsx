import { ContentNav } from './ContentNav';

export default function ContentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[100dvh] flex-col bg-[var(--bg)] text-[var(--text)]">
      <ContentNav />
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
