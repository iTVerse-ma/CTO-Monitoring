import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Connecteo One — Tenant Dashboard',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
