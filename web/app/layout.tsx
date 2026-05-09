import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'FR94 — Post review',
  description: 'Post candidate review dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
