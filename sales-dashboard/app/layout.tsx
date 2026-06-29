import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Espace Commercial — Connecteo One',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
