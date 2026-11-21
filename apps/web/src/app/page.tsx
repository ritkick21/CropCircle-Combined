import Link from 'next/link';
import { ArrowRight, ChartNoAxesCombined, MapPin, Store, UsersRound } from 'lucide-react';

const workspaces = [
  { href: '/marketplace', title: 'Surplus marketplace', description: 'Offer fresh produce for sale or donation and coordinate pickup.', icon: Store },
  { href: '/map', title: 'Resource map', description: 'Find nearby food banks, farm resources and distribution sites.', icon: MapPin },
  { href: '/collaboration', title: 'Farmer collaboration', description: 'Compare field observations and share what works with other growers.', icon: UsersRound },
  { href: '/sustainability', title: 'Sustainability', description: 'Track redistributed food and plan for the next harvest.', icon: ChartNoAxesCombined },
];

export default function Home() {
  return (
    <main className="site-frame landing">
      <section className="harvest-hero" aria-labelledby="harvest-heading">
        <div className="harvest-copy">
          <p className="harvest-eyebrow">For growers and food partners</p>
          <h1 id="harvest-heading">A local market<br />for what you grow.</h1>
          <p>Find a home for surplus produce, connect with local food organizations and see where your harvest goes.</p>
          <Link className="harvest-cta" href="/marketplace">Explore the marketplace <ArrowRight aria-hidden className="size-4" /></Link>
        </div>
      </section>
      <section className="workspace-section" aria-labelledby="workspace-heading">
        <h2 id="workspace-heading">Your local food network</h2>
        <div className="workspace-grid">
          {workspaces.map(({ href, title, description, icon: Icon }) => (
            <Link className="workspace-card" key={href} href={href}>
              <span className="workspace-icon"><Icon aria-hidden className="size-5" /></span>
              <h3>{title}</h3>
              <p>{description}</p>
              <ArrowRight aria-hidden className="workspace-arrow size-4" />
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
