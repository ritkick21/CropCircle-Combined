import type { Metadata } from 'next';
import { Account } from '@/components/Account';

export const metadata: Metadata = { title: 'Create an account | CropCircle' };

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { returnTo } = await searchParams;
  const destinations = ['/farmline', '/marketplace', '/collaboration', '/sustainability', '/map'];
  return (
    <Account returnTo={returnTo && destinations.includes(returnTo) ? returnTo : '/farmline'} />
  );
}
