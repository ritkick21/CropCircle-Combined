'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Image from 'next/image';

const destinations = [
  ['/farmline', 'Crop help'],
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
          <span className="site-logo">
            <Image
              src="/cropcircle-logo.png"
              alt=""
              width={520}
              height={466}
              sizes="48px"
              priority
            />
          </span>
          CropCircle
        </Link>
        <nav aria-label="Main navigation">
          {destinations.map(([href, label]) => (
            <Link key={href} href={href} aria-current={pathname === href ? 'page' : undefined}>
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
