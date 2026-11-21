import type { Metadata } from 'next';
import { SiteNav } from '@/components/SiteNav';
import './globals.css';

export const metadata: Metadata = {
  title: 'CropCircle',
  description: 'Agricultural sustainability platform',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased"><SiteNav />{children}</body>
    </html>
  );
}
