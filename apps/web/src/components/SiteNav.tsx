'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Sprout } from 'lucide-react';

const destinations = [
  ['/marketplace', 'Marketplace'],
  ['/map', 'Resource map'],
  ['/collaboration', 'Collaboration'],
  ['/sustainability', 'Sustainability'],
] as const;

export function SiteNav() {
  const pathname = usePathname();
  return (
    <header className="site-header">
      <div className="site-frame site-header-inner">
        <Link href="/" className="site-brand">
          <span className="site-logo"><Sprout aria-hidden className="size-5" /></span>
          CropCircle
        </Link>
        <nav aria-label="Main navigation">
          {destinations.map(([href, label]) => (
            <Link key={href} href={href} aria-current={pathname === href ? 'page' : undefined}>{label}</Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
