'use client';
import { useEffect, useState } from 'react';
import type { useCropCircleApi } from './useCropCircleApi';

export function MediaLinks({ keys, request }: { keys: string[]; request: ReturnType<typeof useCropCircleApi>['request'] }) {
  const [links, setLinks] = useState<{ key: string; url: string }[]>([]);
  useEffect(() => {
    let live = true;
    Promise.all(keys.map(async key => {
      try { return { key, url: (await request<{url:string}>(`/media/view?key=${encodeURIComponent(key)}`)).url }; }
      catch { return null; }
    })).then(values => { if (live) setLinks(values.filter((value): value is { key: string; url: string } => value !== null)); });
    return () => { live = false; };
  }, [keys, request]);
  if (!keys.length) return null;
  return <div className="flex flex-wrap gap-2">{links.map(({ key, url }, index) => key.endsWith('.pdf') ? <a className="text-sm underline" key={key} href={url} target="_blank" rel="noreferrer">Document {index+1}</a> : <a key={key} href={url} target="_blank" rel="noreferrer">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={url} alt={`Shared image ${index+1}`} className="h-24 w-24 rounded object-cover" />
  </a>)}</div>;
}
