import type { Metadata } from 'next';
import { Farmline } from '@/components/farmline/Farmline';

export const metadata: Metadata = { title: 'FarmLine crop help | CropCircle' };

export default function FarmlinePage() {
  return <Farmline />;
}
