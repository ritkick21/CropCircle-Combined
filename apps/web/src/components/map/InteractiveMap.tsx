'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import Link from 'next/link';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map } from 'maplibre-gl';
import type { ResourceCategory as Category, ResourceMarker as Marker, ResourceDetail as Detail } from '@cropcircle/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRoot, loadAccessToken, refreshAccessToken, rememberAccessToken } from '../realtime/access-session';
import { Notifications } from '../realtime/Notifications';
import { useRealtime, useRealtimeRefresh, useRooms } from '../realtime/useRealtime';

const labels: Record<Category, string> = {
  FOOD_BANK: 'Food banks',
  COMMUNITY_FOOD: 'Community food',
  FOSTER_SUPPORT: 'Foster support',
  FARMER: 'Farmers',
  FARMERS_MARKET: 'Farmers markets',
  GROCERY_RESTAURANT: 'Grocers & restaurants',
  WHOLESALER: 'Wholesalers',
  RESEARCH_CENTER: 'Research centers',
  EXTENSION_SERVICE: 'Extension services',
  SPECIALIST: 'Specialists',
};
const colors: Record<Category, string> = {
  FOOD_BANK: '#178454',
  COMMUNITY_FOOD: '#29876c',
  FOSTER_SUPPORT: '#8358a5',
  FARMER: '#8b6d19',
  FARMERS_MARKET: '#c97626',
  GROCERY_RESTAURANT: '#b5474c',
  WHOLESALER: '#526eb7',
  RESEARCH_CENTER: '#4d6a91',
  EXTENSION_SERVICE: '#3b7896',
  SPECIALIST: '#774e87',
};
const symbols: Record<Category, string> = {
  FOOD_BANK: '♥',
  COMMUNITY_FOOD: '◆',
  FOSTER_SUPPORT: '★',
  FARMER: '●',
  FARMERS_MARKET: '▣',
  GROCERY_RESTAURANT: '■',
  WHOLESALER: '⬡',
  RESEARCH_CENTER: '✦',
  EXTENSION_SERVICE: '✚',
  SPECIALIST: '✳',
};
const mapStyle = process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/liberty';
const geocodeUrl = process.env.NEXT_PUBLIC_GEOCODE_URL ?? 'https://photon.komoot.io/api';
const routeUrl = process.env.NEXT_PUBLIC_ROUTE_URL ?? 'https://router.project-osrm.org/route/v1/driving';
const wrapLongitude = (value: number) => ((value + 180) % 360 + 360) % 360 - 180;
type ProduceMarker = { id: string; cropName: string; availableQuantity: string; unit: string; mode: string; lng: number; lat: number; organization: { name: string } };
type RecipientMarker = { id: string; organizationName: string; demand: string | null; acceptedCrops: string[]; lng: number; lat: number };

function MapMarker({ marker }: { marker: Marker }) {
  return (
    <span aria-hidden style={{ color: colors[marker.category] }}>
      {symbols[marker.category]}
    </span>
  );
}
function MarkerCluster({ count }: { count: number }) {
  return <p className="text-xs text-gray-700" aria-live="polite">{count} resources in view. Nearby markers are grouped on the map.</p>;
}
function MapLegend() {
  return (
    <div className="grid grid-cols-2 gap-1 text-xs sm:grid-cols-3">
      {(Object.keys(labels) as Category[]).map((c) => (
        <span key={c}>
          <span style={{ color: colors[c] }}>{symbols[c]}</span> {labels[c]}
        </span>
      ))}
    </div>
  );
}
function MapFilters({
  categories,
  onChange,
}: {
  categories: Category[];
  onChange: (value: Category[]) => void;
}) {
  return (
    <fieldset className="space-y-1 text-sm"><legend className="font-semibold">Map layers</legend>
      {(Object.keys(labels) as Category[]).map((category) => <label key={category} className="flex items-center gap-2"><input type="checkbox" checked={categories.includes(category)} onChange={(event) => onChange(event.target.checked ? [...categories, category] : categories.filter((entry) => entry !== category))} /><span style={{ color: colors[category] }}>{symbols[category]}</span>{labels[category]}</label>)}
    </fieldset>
  );
}
function LocationSearch({
  value,
  onChange,
  onSearch,
}: {
  value: string;
  onChange: (s: string) => void;
  onSearch: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSearch();
      }}
      className="flex gap-2"
    >
      <input
        aria-label="Search organization, location or crop"
        className="min-w-0 flex-1 rounded border p-2"
        placeholder="Organization, location or crop"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button className="rounded bg-green-800 px-3 text-white">Search</button>
    </form>
  );
}
function ResourceDetailPanel({ detail, onRoute }: { detail: Detail | null; onRoute: () => void }) {
  if (!detail) return <p className="text-sm text-gray-600">Select a marker for details.</p>;
  return (
    <section aria-label="Resource details" className="space-y-2 text-sm">
      <h2 className="text-lg font-semibold">
        <MapMarker marker={detail} /> {detail.name}
      </h2>
      <p>
        {labels[detail.category]} · {detail.available ? 'Available' : 'Unavailable'}
      </p>
      <p>Organization: {detail.organizationName}</p>
      {detail.description && <p>{detail.description}</p>}
      {detail.addressLabel && <p>{detail.addressLabel}</p>}
      <p>
        Accepted crops:{' '}
        {detail.acceptedCrops.length ? detail.acceptedCrops.join(', ') : 'Not specified'}
      </p>
      <p>Capacity: {detail.capacityKg === null ? 'Not specified' : `${detail.capacityKg} kg`}</p>
      <p>Hours: {detail.hours ? JSON.stringify(detail.hours) : 'Not specified'}</p>
      {detail.category !== 'FARMER' && detail.category !== 'FOSTER_SUPPORT' && <button onClick={onRoute} className="rounded border px-3 py-2">Show driving route from map center</button>}
    </section>
  );
}
function NearbyResourcesPanel({
  radius,
  setRadius,
  onSearch,
  items,
}: {
  radius: number;
  setRadius: (n: number) => void;
  onSearch: () => void;
  items: Detail[];
}) {
  return (
    <section className="space-y-2 text-sm">
      <h2 className="font-semibold">Nearby resources</h2>
      <label>
        Radius (km){' '}
        <input
          className="w-20 rounded border p-1"
          type="number"
          min="1"
          max="500"
          value={radius}
          onChange={(e) => setRadius(Number(e.target.value))}
        />
      </label>{' '}
      <button className="rounded border px-2 py-1" onClick={onSearch}>
        Find nearby
      </button>
      {items.map((i) => (
        <p key={i.id}>
          {i.name} · {i.distanceMeters === null ? '' : `${(i.distanceMeters / 1000).toFixed(1)} km`}
        </p>
      ))}
    </section>
  );
}

function ResourceManager({
  request,
  onChanged,
  isAdmin,
}: {
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  onChanged: () => void;
  isAdmin: boolean;
}) {
  const [organizations, setOrganizations] = useState<
    { id: string; name: string; membershipRole: string }[]
  >([]);
  const [owned, setOwned] = useState<Detail[]>([]);
  const [pending, setPending] = useState<Detail[]>([]);
  const [reviewReason, setReviewReason] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [category, setCategory] = useState<Category>('FOOD_BANK');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [addressLabel, setAddressLabel] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [crops, setCrops] = useState('');
  const [capacity, setCapacity] = useState('');
  const [available, setAvailable] = useState(true);
  const [hours, setHours] = useState('');
  const [message, setMessage] = useState('');
  const reload = useCallback(async () => {
    const [orgs, locations] = await Promise.all([
      request<typeof organizations>('/organizations'),
      request<Detail[]>('/locations/mine'),
    ]);
    setOrganizations(
      orgs.filter((o) => o.membershipRole === 'OWNER' || o.membershipRole === 'MANAGER'),
    );
    setOwned(locations);
    if (isAdmin) setPending(await request<Detail[]>('/locations/pending'));
  }, [request, isAdmin]);
  useEffect(() => {
    void reload().catch((error: unknown) => setMessage(String(error)));
  }, [reload]);
  const select = (id: string) => {
    setSelectedId(id);
    const item = owned.find((entry) => entry.id === id);
    if (!item) return;
    setName(item.name);
    setDescription(item.description ?? '');
    setAddressLabel(item.addressLabel ?? '');
    setLat(String(item.lat));
    setLng(String(item.lng));
    setCrops(item.acceptedCrops.join(', '));
    setCapacity(item.capacityKg === null ? '' : String(item.capacityKg));
    setAvailable(item.available);
    setHours(
      item.hours && typeof item.hours === 'object'
        ? Object.entries(item.hours)
            .map(([day, value]) => `${day}:${value}`)
            .join(', ')
        : '',
    );
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage('');
    try {
      const parsedHours: Record<string, string> = {};
      for (const part of hours
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)) {
        const separator = part.indexOf(':');
        if (separator < 0) throw new Error('Hours must use day:HH:MM-HH:MM');
        parsedHours[part.slice(0, separator).trim()] = part.slice(separator + 1).trim();
      }
      const prior = owned.find((item) => item.id === selectedId);
      const coordinates =
        !prior || prior.lat !== Number(lat) || prior.lng !== Number(lng)
          ? { lat: Number(lat), lng: Number(lng) }
          : {};
      const body = {
        name,
        description,
        ...(addressLabel !== (prior?.addressLabel ?? '') ? { addressLabel } : {}),
        ...coordinates,
        acceptedCrops: crops
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        capacityKg: capacity ? Number(capacity) : undefined,
        available,
        hours: parsedHours,
        ...(selectedId ? {} : { category }),
      };
      if (!selectedId && !organizationId) throw new Error('Select an organization');
      await request(
        selectedId ? `/locations/${selectedId}` : `/locations/organizations/${organizationId}`,
        {
          method: selectedId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      setMessage(
        selectedId
          ? 'Resource saved. Location changes require renewed review.'
          : 'Resource submitted for admin review.',
      );
      await reload();
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Save failed');
    }
  };
  const publish = async (id: string) => {
    try {
      if (reviewReason.trim().length < 10) throw new Error('Enter a review reason of at least 10 characters.');
      await request(`/locations/${id}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reviewReason }) });
      await reload();
      onChanged();
      setMessage('Resource published.');
      setReviewReason('');
    } catch (error) {
      setMessage(String(error));
    }
  };
  return (
    <details className="rounded border p-3 text-sm">
      <summary className="cursor-pointer font-semibold">Manage resources</summary>
      {isAdmin && (
        <section className="mt-3 space-y-2">
          <h2 className="font-semibold">Pending verification</h2>
          {pending.map((item) => (
            <div key={item.id} className="rounded border p-2">
              <p>
                {item.name} · {labels[item.category]} · {item.lat.toFixed(2)}, {item.lng.toFixed(2)}
              </p>
              <label className="block">Review reason<input className="mt-1 w-full rounded border p-2" minLength={10} maxLength={1000} value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} /></label>
              <button className="rounded border px-2 py-1" onClick={() => void publish(item.id)}>
                Verify and publish
              </button>
            </div>
          ))}
        </section>
      )}
      <form onSubmit={(event) => void save(event)} className="mt-3 space-y-2">
        <label className="block">
          Resource
          <select
            className="mt-1 w-full rounded border p-2"
            value={selectedId}
            onChange={(event) => select(event.target.value)}
          >
            <option value="">New resource</option>
            {owned.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {!selectedId && (
          <>
            <label className="block">
              Organization
              <select
                required
                className="mt-1 w-full rounded border p-2"
                value={organizationId}
                onChange={(event) => setOrganizationId(event.target.value)}
              >
                <option value="">Select</option>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              Category
              <select
                className="mt-1 w-full rounded border p-2"
                value={category}
                onChange={(event) => setCategory(event.target.value as Category)}
              >
                {(Object.keys(labels) as Category[]).map((entry) => (
                  <option key={entry} value={entry}>
                    {labels[entry]}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <label className="block">
          Name
          <input
            required
            maxLength={160}
            className="mt-1 w-full rounded border p-2"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="block">Description<textarea maxLength={1000} className="mt-1 w-full rounded border p-2" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        {(selectedId ? owned.find((entry) => entry.id === selectedId)?.category : category) !== 'FARMER' && (selectedId ? owned.find((entry) => entry.id === selectedId)?.category : category) !== 'FOSTER_SUPPORT' && <label className="block">Public address label<input maxLength={240} className="mt-1 w-full rounded border p-2" value={addressLabel} onChange={(event) => setAddressLabel(event.target.value)} /></label>}
        <div className="grid grid-cols-2 gap-2">
          <label>
            Latitude
            <input
              required
              type="number"
              step="any"
              min="-90"
              max="90"
              className="mt-1 w-full rounded border p-2"
              value={lat}
              onChange={(event) => setLat(event.target.value)}
            />
          </label>
          <label>
            Longitude
            <input
              required
              type="number"
              step="any"
              min="-180"
              max="180"
              className="mt-1 w-full rounded border p-2"
              value={lng}
              onChange={(event) => setLng(event.target.value)}
            />
          </label>
        </div>
        <label className="block">
          Accepted crops, comma separated
          <input
            className="mt-1 w-full rounded border p-2"
            value={crops}
            onChange={(event) => setCrops(event.target.value)}
          />
        </label>
        <label className="block">
          Capacity (kg)
          <input
            type="number"
            min="0"
            step="0.01"
            className="mt-1 w-full rounded border p-2"
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
          />
        </label>
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={available}
            onChange={(event) => setAvailable(event.target.checked)}
          />
          Available
        </label>
        <label className="block">
          Hours (e.g. mon:09:00-17:00, tue:closed)
          <input
            className="mt-1 w-full rounded border p-2"
            value={hours}
            onChange={(event) => setHours(event.target.value)}
          />
        </label>
        <button className="rounded bg-green-800 px-3 py-2 text-white">Save resource</button>
      </form>
      {message && (
        <p role="status" className="mt-2">
          {message}
        </p>
      )}
    </details>
  );
}

export function InteractiveMap() {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null);
  const refreshSequence = useRef(0);
  const viewportRequest = useRef<AbortController | null>(null);
  const token = useRef('');
  const [authenticated, setAuthenticated] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authPending, setAuthPending] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [categories, setCategories] = useState<Category[]>(Object.keys(labels) as Category[]);
  const [search, setSearch] = useState('');
  const [crop, setCrop] = useState('');
  const [radius, setRadius] = useState(25);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [markerTotal, setMarkerTotal] = useState(0);
  const [nearby, setNearby] = useState<Detail[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [produce, setProduce] = useState<ProduceMarker[]>([]);
  const [showProduce, setShowProduce] = useState(true);
  const [recipients, setRecipients] = useState<RecipientMarker[]>([]);
  const [showRecipients, setShowRecipients] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const renew = useCallback(async () => {
    const previous = token.current;
    const renewed = await refreshAccessToken();
    if (token.current !== previous) return token.current || null;
    token.current = renewed ?? '';
    if (!renewed) setAuthenticated(false);
    return renewed;
  }, []);
  const socket = useRealtime(authenticated, token, renew);
  useEffect(() => {
    let live = true;
    loadAccessToken()
      .then(async (access) => {
        if (access && live) {
          token.current = access;
          const me = await fetch(`${apiRoot}/auth/me`, {
            headers: { Authorization: `Bearer ${access}` },
          });
          if (me.ok && live) {
            setIsAdmin(((await me.json()) as { roles: string[] }).roles.includes('ADMIN'));
            setAuthenticated(true);
          }
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) setAuthPending(false);
      });
    return () => {
      live = false;
    };
  }, []);
  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setAuthPending(true);
    try {
      const response = await fetch(`${apiRoot}/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) throw new Error('Sign-in failed. Check your email and password.');
      const data = (await response.json()) as { accessToken: string; expiresIn: number };
      rememberAccessToken(data);
      token.current = data.accessToken;
      setAuthenticated(true);
      const me = await fetch(`${apiRoot}/auth/me`, {
        headers: { Authorization: `Bearer ${data.accessToken}` },
      });
      if (me.ok) setIsAdmin(((await me.json()) as { roles: string[] }).roles.includes('ADMIN'));
      setPassword('');
      void refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed.');
    } finally {
      setAuthPending(false);
    }
  };
  const logout = async () => {
    try {
      await fetch(`${apiRoot}/auth/logout`, { method: 'POST', credentials: 'include' });
    } finally {
      rememberAccessToken();
      token.current = '';
      setAuthenticated(false);
      setIsAdmin(false);
      setMarkers([]);
      setDetail(null);
      setNearby([]);
      setProduce([]);
      setRecipients([]);
    }
  };
  const request = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const send = () => fetch(`${apiRoot}${path}`, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${token.current}` },
      cache: 'no-store',
    });
    const used = token.current;
    let response = await send();
    if (response.status === 401 && (token.current !== used || await renew())) response = await send();
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? 'Sign in with a valid access token.'
          : `Map request failed (${response.status}).`,
      );
    return response.json() as Promise<T>;
  }, [renew]);
  const refresh = useCallback(async () => {
    if (!map.current || !token.current) return;
    const sequence = ++refreshSequence.current;
    const b = map.current.getBounds();
    if (!b) return;
    viewportRequest.current?.abort();
    const controller = new AbortController();
    viewportRequest.current = controller;
    const signal = controller.signal;
    setLoading(true);
    setError('');
    try {
      const p = new URLSearchParams({
        west: String(b.getEast() - b.getWest() >= 360 ? -180 : wrapLongitude(b.getWest())),
        south: String(Math.max(-90, b.getSouth())),
        east: String(b.getEast() - b.getWest() >= 360 ? 180 : wrapLongitude(b.getEast())),
        north: String(Math.min(90, b.getNorth())),
        zoom: String(Math.floor(map.current.getZoom())),
      });
      if (search) p.set('q', search);
      if (crop) p.set('crop', crop);
      const all: Marker[] = [];
      let total = 0;
      for (let offset = 0; offset < 2000; offset += 100) {
        p.set('limit', '100');
        p.set('offset', String(offset));
        const page = await request<{ items: Marker[]; total: number }>(`/map/markers?${p}`, { signal });
        if (sequence !== refreshSequence.current) return;
        all.push(...page.items);
        total = page.total;
        if (all.length >= total || page.items.length === 0) break;
      }
      setMarkers(all);
      setMarkerTotal(total);
      const [offers, opportunities] = await Promise.all([
        request<{ items: ProduceMarker[] }>('/marketplace/map?limit=100', { signal }),
        request<RecipientMarker[]>('/marketplace/recipients/map?limit=100', { signal }),
      ]);
      if (sequence === refreshSequence.current) {
        setProduce(offers.items);
        setRecipients(opportunities);
      }
    } catch (e) {
      if (!signal.aborted && sequence === refreshSequence.current) setError(e instanceof Error ? e.message : 'Unable to load map.');
    } finally {
      if (sequence === refreshSequence.current) setLoading(false);
    }
  }, [search, crop, request]);
  useRooms(socket, [{ kind: 'topic', topic: 'map' }], refresh);
  useRealtimeRefresh(socket, refresh, event => event.type === 'MAP_MARKER_UPDATED', authenticated);
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);
  useEffect(() => {
    if (!authenticated || !container.current || map.current) return;
    maplibregl.setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).toString());

    const instance = new maplibregl.Map({
      container: container.current,
      style: mapStyle,
      center: [-98.5, 39.8],
      zoom: 3,
    });
    map.current = instance;
    instance.addControl(new maplibregl.NavigationControl());
    instance.on('error', () => setError('Map tiles could not be loaded. Check the map style URL and connection.'));
    instance.on('load', () => {
      instance.addSource('resources', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterRadius: 50,
      });
      instance.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'resources',
        filter: ['has', 'point_count'],
        paint: { 'circle-color': '#166534', 'circle-radius': 20 },
      });
      instance.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'resources',
        filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 13 },
        paint: { 'text-color': '#ffffff' },
      });
      instance.addLayer({
        id: 'resource-points',
        type: 'circle',
        source: 'resources',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': 11,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-color': ['get', 'color'],
        },
      });
      instance.addLayer({
        id: 'resource-symbols',
        type: 'symbol',
        source: 'resources',
        filter: ['!', ['has', 'point_count']],
        layout: { 'text-field': ['get', 'symbol'], 'text-size': 12 },
        paint: { 'text-color': '#ffffff' },
      });
      instance.addSource('produce', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      instance.addLayer({ id: 'produce-points', type: 'circle', source: 'produce', paint: { 'circle-color': '#e59a25', 'circle-radius': 9, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
      instance.addSource('recipients', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      instance.addLayer({ id: 'recipient-points', type: 'circle', source: 'recipients', paint: { 'circle-color': '#a03aa3', 'circle-radius': 8, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
      instance.on('click', 'produce-points', (event) => {
        const feature = event.features?.[0];
        if (!feature || feature.geometry.type !== 'Point') return;
        const props = feature.properties as { cropName: string; availableQuantity: string; unit: string; mode: string; organizationName: string };
        const panel = document.createElement('div');
        const title = document.createElement('strong'); title.textContent = props.cropName;
        const info = document.createElement('p'); info.textContent = `${props.availableQuantity} ${props.unit} · ${props.mode} · ${props.organizationName}`;
        const link = document.createElement('a'); link.href = '/marketplace'; link.textContent = 'Open marketplace'; link.style.textDecoration = 'underline';
        panel.append(title, info, link);
        new maplibregl.Popup().setLngLat(feature.geometry.coordinates as [number, number]).setDOMContent(panel).addTo(instance);
      });
      instance.on('click', 'recipient-points', (event) => {
        const feature = event.features?.[0];
        if (!feature || feature.geometry.type !== 'Point') return;
        const props = feature.properties as { organizationName: string; demand: string; acceptedCrops: string };
        const panel = document.createElement('div');
        const title = document.createElement('strong'); title.textContent = props.organizationName;
        const info = document.createElement('p'); info.textContent = props.demand || 'Recipient opportunity';
        const link = document.createElement('a'); link.href = '/marketplace'; link.textContent = 'View recipients'; link.style.textDecoration = 'underline';
        panel.append(title, info, link);
        new maplibregl.Popup().setLngLat(feature.geometry.coordinates as [number, number]).setDOMContent(panel).addTo(instance);
      });
      instance.on('click', 'resource-points', (e) => {
        const id = (e.features?.[0] as unknown as { properties?: { id?: string } } | undefined)
          ?.properties?.id as string | undefined;
        if (id)
          void request<Detail>(`/locations/${id}`)
            .then(setDetail)
            .catch((err) => setError(String(err)));
      });
      instance.on('click', 'clusters', (e) => {
        const features = instance.queryRenderedFeatures(e.point, { layers: ['clusters'] });
        const id = (features[0] as unknown as { properties?: { cluster_id?: number } } | undefined)
          ?.properties?.cluster_id as number | undefined;
        const geometry = (
          features[0] as unknown as
            { geometry?: { type: string; coordinates: number[] } } | undefined
        )?.geometry;
        if (id !== undefined && geometry?.type === 'Point')
          void (instance.getSource('resources') as GeoJSONSource).getClusterExpansionZoom(id)
            .then((zoom) => instance.easeTo({ center: geometry.coordinates as [number, number], zoom }))
            .catch(() => setError('Cluster could not be opened.'));
      });
      void refreshRef.current();
    });
    instance.on('moveend', () => void refreshRef.current());
    return () => {
      viewportRequest.current?.abort();
      instance.remove();
      map.current = null;
    };
  }, [request, authenticated]);
  useEffect(() => {
    const source = map.current?.getSource('resources') as GeoJSONSource | undefined;
    source?.setData({
      type: 'FeatureCollection',
      features: markers.filter((m) => categories.includes(m.category)).map((m) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [m.lng, m.lat] },
        properties: {
          id: m.id,
          name: m.name,
          color: colors[m.category],
          symbol: symbols[m.category],
        },
      })),
    });
  }, [markers, categories]);
  useEffect(() => {
    const source = map.current?.getSource('produce') as GeoJSONSource | undefined;
    source?.setData({ type: 'FeatureCollection', features: showProduce ? produce.filter(item => Number.isFinite(item.lng) && Number.isFinite(item.lat)).map(item => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [item.lng, item.lat] }, properties: { cropName: item.cropName, availableQuantity: item.availableQuantity, unit: item.unit, mode: item.mode, organizationName: item.organization.name } })) : [] });
  }, [produce, showProduce]);
  useEffect(() => {
    const source = map.current?.getSource('recipients') as GeoJSONSource | undefined;
    source?.setData({ type: 'FeatureCollection', features: showRecipients ? recipients.filter(item => Number.isFinite(item.lng) && Number.isFinite(item.lat)).map(item => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [item.lng, item.lat] }, properties: { organizationName: item.organizationName, demand: item.demand ?? '' } })) : [] });
  }, [recipients, showRecipients]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const findNearby = async () => {
    const center = map.current?.getCenter();
    if (!center || radius < 1 || radius > 500) return;
    setLoading(true);
    try {
      const p = new URLSearchParams({
        lng: String(center.lng),
        lat: String(center.lat),
        radiusKm: String(radius),
      });
      const result = await request<{ items: Detail[] }>(`/locations/nearby?${p}`);
      setNearby(result.items.filter((item) => categories.includes(item.category)));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  const showRoute = async () => {
    if (!detail || !map.current) return;
    const center = map.current.getCenter();
    try {
      const response = await fetch(
        `${routeUrl.replace(/\/$/, '')}/${center.lng},${center.lat};${detail.lng},${detail.lat}?geometries=geojson&overview=full`,
      );
      if (!response.ok) throw new Error('Route unavailable');
      const data = (await response.json()) as {
        routes?: { geometry: { type: 'LineString'; coordinates: number[][] } }[];
      };
      const geometry = data.routes?.[0]?.geometry;
      if (!geometry) throw new Error('No driving route found');
      if (map.current.getSource('route'))
        (map.current.getSource('route') as GeoJSONSource).setData({
          type: 'Feature',
          properties: {},
          geometry,
        });
      else {
        map.current.addSource('route', {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry },
        });
        map.current.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route',
          paint: { 'line-color': '#1d4ed8', 'line-width': 5 },
        });
      }
    } catch (e) {
      setError(String(e));
    }
  };
  const findPlace = async () => {
    if (!search.trim() || !map.current) return;
    try {
      const response = await fetch(
        `${geocodeUrl}?q=${encodeURIComponent(search)}&limit=1`,
      );
      if (!response.ok) throw new Error('Place search unavailable');
      const data = (await response.json()) as { features?: { geometry: { coordinates: [number, number] } }[] };
      const center = data.features?.[0]?.geometry.coordinates;
      if (!center) throw new Error('Place not found');
      setSearch('');
      map.current.flyTo({ center, zoom: 10 });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Place search unavailable');
    }
  };
  if (!authenticated)
    return (
      <main className="mx-auto max-w-md space-y-4 p-8">
        <h1 className="text-2xl font-semibold">CropCircle resource map</h1>
        {authPending ? (
          <p>Checking session…</p>
        ) : (
          <form onSubmit={(event) => void login(event)} className="space-y-3">
            <label className="block">
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 w-full rounded border p-2"
              />
            </label>
            <label className="block">
              Password
              <input
                type="password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 w-full rounded border p-2"
              />
            </label>
            <button className="rounded bg-green-800 px-4 py-2 text-white">Sign in</button>
            <p className="text-sm">New to CropCircle? <Link className="font-semibold underline" href="/account?returnTo=/map">Create an account</Link></p>
          </form>
        )}
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
      </main>
    );
  return (
    <main className="flex min-h-screen flex-col gap-4 p-4 lg:p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">CropCircle resource map</h1>
        <nav className="flex flex-wrap items-center gap-3 text-sm"><a className="underline" href="/marketplace">Marketplace</a><a className="underline" href="/collaboration">Collaboration</a>{authenticated && <Notifications socket={socket} request={request} />}</nav>
        <button className="rounded border px-3 py-2" onClick={() => void logout()}>
          Sign out
        </button>
      </header>
      <div className="grid gap-4 lg:grid-cols-[320px_1fr_300px]">
        <aside className="order-2 space-y-4 lg:order-1">
          <LocationSearch value={search} onChange={setSearch} onSearch={() => void refresh()} />
          <button className="rounded border px-3 py-2 text-sm" onClick={() => void findPlace()}>
            Find place on map
          </button>
          <label className="block text-sm">
            Crop{' '}
            <input
              className="ml-2 rounded border p-2"
              value={crop}
              onChange={(e) => setCrop(e.target.value)}
            />
          </label>
          <MapFilters categories={categories} onChange={setCategories} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showProduce} onChange={event => setShowProduce(event.target.checked)} />Available produce ({produce.length})</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showRecipients} onChange={event => setShowRecipients(event.target.checked)} />Recipient opportunities ({recipients.length})</label>
          <MapLegend />
          <MarkerCluster count={markers.filter((marker) => categories.includes(marker.category)).length} />
          {markerTotal > markers.length && <p className="text-sm text-amber-800">Showing {markers.length} of {markerTotal} resources. Zoom in to see the rest.</p>}
          <NearbyResourcesPanel
            radius={radius}
            setRadius={setRadius}
            onSearch={() => void findNearby()}
            items={nearby}
          />
          <ResourceManager request={request} onChanged={() => void refresh()} isAdmin={isAdmin} />
        </aside>
        <div className="relative order-1 lg:order-2">
          <div
            ref={container}
            aria-label="Interactive resource map"
            className="h-[55vh] min-h-96 w-full rounded-lg lg:h-[75vh]"
          />
          {loading && (
            <p className="absolute left-3 top-3 rounded bg-white p-2 text-sm">Loading resources…</p>
          )}
          {!loading && markers.length === 0 && (
            <p className="mt-2 text-sm">No resources match this map view.</p>
          )}
          {error && (
            <p role="alert" className="mt-2 text-red-700">
              {error}
            </p>
          )}
        </div>
        <aside className="order-3">
          <ResourceDetailPanel detail={detail} onRoute={() => void showRoute()} />
        </aside>
      </div>
    </main>
  );
}

