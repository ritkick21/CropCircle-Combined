'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomSubscription } from '@cropcircle/shared-types';
import { SignIn, useCropCircleApi } from './useCropCircleApi';
import { RecommendationPanel } from '../intelligence/RecommendationPanel';
import { MediaLinks } from './MediaLinks';
import { Notifications } from '../realtime/Notifications';
import { useRealtimeRefresh, useRooms } from '../realtime/useRealtime';

type Organization = { id: string; name: string; type: string; verifiedAt: string | null; membershipRole: string };
type Location = { id: string; organizationId: string; name: string };
type Listing = { id: string; organizationId: string; cropName: string; variety?: string; quantity: string; reservedQuantity: string; availableQuantity?: string; unit: string; harvestDate: string; quality: string; storageConditions: string; shelfLifeDays: number; imageKeys: string[]; pickupAvailability: string; pickupFrom?: string | null; pickupUntil?: string | null; requiresColdStorage: boolean; mode: string; price?: string; expiresAt: string; locationId: string; organization: { name: string }; location: { name: string }; deletedAt?: string };
type Request = { id: string; listingId: string; organizationId: string; quantity: string; status: string; pickupAt: string | null; fulfilledAt: string | null; listing: { cropName: string; unit: string; organizationId: string; organization: { name: string } }; organization: { name: string } };
type Recipient = { id: string; organizationId: string; locationId?: string; organization: { name: string }; acceptedCrops: string[]; demand?: string; quantityLimit?: string; storageCapacity?: string; serviceRadiusKm?: number; pickup: boolean; delivery: boolean; coldStorage: boolean; acceptsSales: boolean; hours?: Record<string,string>; location?: { name: string } };
const initial = { cropName: '', variety: '', quantity: 1, unit: 'KG', harvestDate: new Date().toISOString().slice(0,10), quality: '', storageConditions: '', shelfLifeDays: 7, pickupAvailability: '', pickupFrom: '', pickupUntil: '', requiresColdStorage: false, mode: 'DONATION', price: '', expiresAt: '', locationId: '', imageKeys: [] as string[] };

const emptyProfile = { locationId: '', acceptedCrops: '', demand: '', quantityLimit: '', storageCapacity: '', serviceRadiusKm: '', pickup: true, delivery: false, coldStorage: false, acceptsSales: false, hours: '' };

function localDateTime(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function Marketplace() {
  const api = useCropCircleApi();
  const { user, request, setError, socket } = api;
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [pendingOrganizations, setPendingOrganizations] = useState<Organization[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [organizationId, setOrganizationId] = useState('');
  const [listings, setListings] = useState<Listing[]>([]);
  const [mine, setMine] = useState<Listing[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState('');
  const [form, setForm] = useState(initial);
  const [editing, setEditing] = useState('');
  const [recommendedListing, setRecommendedListing] = useState('');
  const [recommendationRevision, setRecommendationRevision] = useState(0);
  const [profile, setProfile] = useState(emptyProfile);
  const [orgName, setOrgName] = useState('');
  const [orgType, setOrgType] = useState('farm');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const refreshSequence = useRef({ value: 0 }).current;
  const profileVersion = useRef('');
  const requestIds = useRef(new Map<string, string>());
  const refresh = useCallback(async () => {
    if (!user) return;
    const sequence = ++refreshSequence.value;
    try {
      const [orgs, locs, publicListings, owned, reqs, people] = await Promise.all([
        request<Organization[]>('/organizations'), request<Location[]>('/locations/mine'),
        request<{items:Listing[]}>(`/marketplace/listings?q=${encodeURIComponent(search)}${mode ? `&mode=${mode}` : ''}`),
        request<Listing[]>('/marketplace/listings/mine'), request<Request[]>('/marketplace/requests'), request<{items:Recipient[]}>('/marketplace/recipients'),
      ]);
      if (sequence !== refreshSequence.value) return;
      setOrganizations(orgs); setLocations(locs); setListings(publicListings.items); setMine(owned); setRequests(reqs); setRecipients(people.items);
      setOrganizationId(current => orgs.some(org => org.id === current) ? current : orgs[0]?.id ?? '');
      if (user.roles.includes('ADMIN')) {
        const pending = await request<Organization[]>('/marketplace/organizations/pending');
        if (sequence === refreshSequence.value) setPendingOrganizations(pending);
      }
    } catch (cause) { if (sequence === refreshSequence.value) setError(String(cause)); }
  }, [user, request, setError, search, mode, refreshSequence]);
  useEffect(() => {
    void refresh();
    return () => { refreshSequence.value++; };
  }, [refresh, refreshSequence]);
  useEffect(() => {
    if (user) return;
    setOrganizations([]);
    setPendingOrganizations([]);
    setLocations([]);
    setOrganizationId('');
    setMine([]);
    setRecommendedListing('');
    setRequests([]);
    setEditing('');
    setForm(initial);
    requestIds.current.clear();
  }, [user]);
  const rooms: RoomSubscription[] = [{ kind: 'topic', topic: 'marketplace' },
    ...organizations.map(org => org.id).sort().map(id => ({ kind: 'organization' as const, id }))];
  useRooms(socket, rooms, refresh);
  useRealtimeRefresh(socket, refresh, ({ type }) => type.startsWith('LISTING_') || type.startsWith('DONATION_') ||
    type.startsWith('PURCHASE_') || type === 'REQUEST_CANCELLED' || type === 'PICKUP_SCHEDULED' || type === 'MAP_MARKER_UPDATED', !!user);
  useEffect(() => {
    const own = recipients.find(person => person.organizationId === organizationId);
    const version = JSON.stringify([organizationId, own]);
    if (version === profileVersion.current) return;
    profileVersion.current = version;
    setProfile(own ? { locationId: own.locationId ?? '', acceptedCrops: own.acceptedCrops.join(', '), demand: own.demand ?? '', quantityLimit: own.quantityLimit ?? '', storageCapacity: own.storageCapacity ?? '', serviceRadiusKm: own.serviceRadiusKm?.toString() ?? '', pickup: own.pickup, delivery: own.delivery, coldStorage: own.coldStorage, acceptsSales: own.acceptsSales, hours: own.hours?.description ?? '' } : emptyProfile);
  }, [organizationId, recipients]);
  const act = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true); api.setError(''); setMessage('');
    try { await operation(); setMessage(success); await refresh(); } catch (cause) { api.setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  };
  const sendRequest = (listingId: string, quantity: number) => {
    const key = JSON.stringify([listingId, organizationId, quantity]);
    const clientId = requestIds.current.get(key) ?? crypto.randomUUID();
    requestIds.current.set(key, clientId);
    return act(async () => {
      await api.json('/marketplace/listings/' + listingId + '/requests', 'POST', { organizationId, quantity, clientId });
      requestIds.current.delete(key);
    }, 'Request sent');
  };
  const saveListing = async () => {
    const item = await api.json<Listing>('/marketplace/listings' + (editing ? '/' + editing : ''), editing ? 'PUT' : 'POST', {
      ...form, organizationId,
      price: form.mode === 'SALE' ? Number(form.price) : undefined,
      variety: form.variety || undefined,
      expiresAt: new Date(form.expiresAt).toISOString(),
      pickupFrom: form.pickupFrom ? new Date(form.pickupFrom).toISOString() : null,
      pickupUntil: form.pickupUntil ? new Date(form.pickupUntil).toISOString() : null,
    });
    setRecommendedListing(item.id);
    setRecommendationRevision(value => value + 1);
    setEditing('');
    setForm(initial);
  };
  const selected = organizations.find(org => org.id === organizationId);
  const ownLocations = locations.filter(location => location.organizationId === organizationId);
  if (api.loading) return <main className="p-8">Checking session…</main>;
  if (!api.user) return <SignIn login={api.login} error={api.error} />;
  return <main className="mx-auto max-w-7xl space-y-8 p-4 sm:p-8">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4"><div><h1 className="text-3xl font-semibold">Surplus marketplace</h1><p className="text-sm text-gray-600">Offer produce, find recipients, and track pickups.</p></div><nav className="flex flex-wrap items-center gap-3 text-sm"><Notifications socket={socket} request={request} /><a className="underline" href="/map">Map</a><a className="underline" href="/collaboration">Farmer collaboration</a><a className="underline" href="/sustainability">Sustainability</a><button className="underline" onClick={() => void api.logout()}>Sign out</button></nav></header>
    {api.error && <p role="alert" className="rounded bg-red-50 p-3 text-red-800">{api.error}</p>}{message && <p role="status" className="rounded bg-green-50 p-3 text-green-900">{message}</p>}
    {api.user.roles.includes('ADMIN') && pendingOrganizations.length > 0 && <section className="rounded border bg-amber-50 p-4"><h2 className="font-semibold">Organizations awaiting verification</h2><div className="mt-2 flex flex-wrap gap-2">{pendingOrganizations.map(org => <button className="rounded border bg-white px-3 py-2 text-sm" key={org.id} onClick={() => void act(() => api.json(`/marketplace/organizations/${org.id}/verify`,'POST'), `${org.name} verified`)}>Verify {org.name} ({org.type})</button>)}</div></section>}
    <section className="rounded border bg-white p-4"><h2 className="text-xl font-semibold">Your organization</h2><div className="mt-3 flex flex-wrap gap-3"><select aria-label="Active organization" className="rounded border p-2" value={organizationId} onChange={event => setOrganizationId(event.target.value)}><option value="">Select organization</option>{organizations.map(org => <option value={org.id} key={org.id}>{org.name} ({org.type})</option>)}</select>{selected && <span className="self-center text-sm">{selected.verifiedAt ? 'Verified' : 'Awaiting verification'} · {selected.membershipRole}</span>}{selected && !selected.verifiedAt && api.user.roles.includes('ADMIN') && <button className="rounded border px-3" onClick={() => void act(() => api.json(`/marketplace/organizations/${selected.id}/verify`, 'POST'), 'Organization verified')}>Verify organization</button>}</div><form className="mt-4 flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void act(() => api.json('/organizations','POST',{ name: orgName, type: orgType }), 'Organization created'); setOrgName(''); }}><input required aria-label="New organization name" placeholder="New organization name" className="rounded border p-2" value={orgName} onChange={event => setOrgName(event.target.value)} /><select aria-label="Organization type" className="rounded border p-2" value={orgType} onChange={event => setOrgType(event.target.value)}><option value="farm">Farm</option><option value="food_bank">Food bank</option><option value="community_organization">Community organization</option><option value="produce_buyer">Produce buyer</option><option value="farmers_market">Farmers market</option></select><button className="rounded bg-green-800 px-4 py-2 text-white">Create</button></form><p className="mt-2 text-xs text-gray-600">Listings use approved public pickup locations. Create and publish one on the <a href="/map" className="underline">map</a> first.</p></section>
    <div className="grid gap-6 lg:grid-cols-[1fr_370px]"><section className="space-y-4"><div className="flex flex-wrap gap-2"><input aria-label="Search crops" className="flex-1 rounded border p-2" placeholder="Search crops or varieties" value={search} onChange={event => setSearch(event.target.value)} /><select aria-label="Listing type" className="rounded border p-2" value={mode} onChange={event => setMode(event.target.value)}><option value="">All offers</option><option value="DONATION">Donation</option><option value="FREE">Free</option><option value="SALE">Sale</option></select></div><h2 className="text-xl font-semibold">Available produce</h2>{listings.length === 0 && <p>No current listings match your search.</p>}{listings.map(item => <article key={item.id} className="space-y-2 rounded border bg-white p-4"><div className="flex justify-between gap-2"><h3 className="font-semibold">{item.cropName}{item.variety && ` · ${item.variety}`}</h3><span className="text-sm">{item.mode}</span></div><p className="text-sm">{item.availableQuantity} {item.unit} available · {item.organization.name} · {item.location.name}</p><p className="text-sm">Harvested {item.harvestDate.slice(0,10)} · {item.shelfLifeDays} day shelf life · Expires {new Date(item.expiresAt).toLocaleString()}</p><p className="text-sm">Quality: {item.quality}. Storage: {item.storageConditions}. Pickup: {item.pickupAvailability}.</p>{item.mode === 'SALE' && <p className="font-medium">Price: ${item.price} per {item.unit}</p>}<MediaLinks keys={item.imageKeys} request={api.request} /><form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void sendRequest(item.id, Number(data.get('quantity'))); }}><input aria-label={`Quantity for ${item.cropName}`} name="quantity" required type="number" min="0.01" max={item.availableQuantity} step="0.01" className="w-28 rounded border p-2" placeholder="Quantity" /><button disabled={!organizationId || item.organizationId === organizationId || busy} className="rounded bg-green-800 px-3 py-2 text-white disabled:opacity-40">Request {item.mode === 'SALE' ? 'purchase' : 'produce'}</button></form></article>)}</section>
    <aside className="space-y-5"><section className="rounded border bg-white p-4"><h2 className="text-xl font-semibold">Offer produce</h2><form className="mt-3 space-y-2" onSubmit={event => { event.preventDefault(); void act(saveListing, editing ? 'Listing updated' : 'Listing created. See recipient recommendations below.'); }}>
    <select required aria-label="Pickup location" className="w-full rounded border p-2" value={form.locationId} onChange={event => setForm({ ...form, locationId: event.target.value })}><option value="">Public pickup location</option>{ownLocations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select>
    <div className="grid grid-cols-2 gap-2"><input required placeholder="Crop name" aria-label="Crop name" className="rounded border p-2" value={form.cropName} onChange={event => setForm({ ...form, cropName: event.target.value })} /><input placeholder="Variety" aria-label="Variety" className="rounded border p-2" value={form.variety} onChange={event => setForm({ ...form, variety: event.target.value })} /><input required aria-label="Quantity" type="number" step="0.01" min="0.01" className="rounded border p-2" value={form.quantity} onChange={event => setForm({ ...form, quantity: Number(event.target.value) })} /><select aria-label="Unit" className="rounded border p-2" value={form.unit} onChange={event => setForm({ ...form, unit: event.target.value })}><option>KG</option><option>LB</option><option>BOX</option></select></div>
    <label className="block text-sm">Harvest date<input required type="date" className="mt-1 w-full rounded border p-2" value={form.harvestDate} onChange={event => setForm({ ...form, harvestDate: event.target.value })} /></label><input required placeholder="Quality" aria-label="Quality" className="w-full rounded border p-2" value={form.quality} onChange={event => setForm({ ...form, quality: event.target.value })} /><input required placeholder="Storage conditions" aria-label="Storage conditions" className="w-full rounded border p-2" value={form.storageConditions} onChange={event => setForm({ ...form, storageConditions: event.target.value })} /><label className="block text-sm">Shelf life from harvest (days)<input required type="number" min="1" max="365" className="mt-1 w-full rounded border p-2" value={form.shelfLifeDays} onChange={event => setForm({ ...form, shelfLifeDays: Number(event.target.value) })} /></label><input required placeholder="Pickup availability" aria-label="Pickup availability" className="w-full rounded border p-2" value={form.pickupAvailability} onChange={event => setForm({ ...form, pickupAvailability: event.target.value })} /><div className="grid gap-2 sm:grid-cols-2">
      <label className="block text-sm">Pickup from<input type="datetime-local" className="mt-1 w-full rounded border p-2" value={form.pickupFrom} onChange={event => setForm({ ...form, pickupFrom: event.target.value })} /></label>
      <label className="block text-sm">Pickup until<input type="datetime-local" className="mt-1 w-full rounded border p-2" value={form.pickupUntil} onChange={event => setForm({ ...form, pickupUntil: event.target.value })} /></label>
    </div><label className="block text-sm"><input type="checkbox" checked={form.requiresColdStorage} onChange={event => setForm({ ...form, requiresColdStorage: event.target.checked })} /> Requires cold storage</label><label className="block text-sm">Listing expiration<input required type="datetime-local" className="mt-1 w-full rounded border p-2" value={form.expiresAt} onChange={event => setForm({ ...form, expiresAt: event.target.value })} /></label><select aria-label="Offer type" className="w-full rounded border p-2" value={form.mode} onChange={event => setForm({ ...form, mode: event.target.value })}><option value="DONATION">Donation</option><option value="FREE">Free distribution</option><option value="SALE">Sale</option></select>{form.mode === 'SALE' && <input required aria-label="Price per unit" type="number" min="0.01" step="0.01" placeholder="Price per unit" className="w-full rounded border p-2" value={form.price} onChange={event => setForm({ ...form, price: event.target.value })} />}<label className="block text-sm">Images<input type="file" accept="image/png,image/jpeg,image/webp" multiple className="mt-1 w-full" onChange={event => { const files = Array.from(event.target.files ?? []); void Promise.all(files.map(api.upload)).then(keys => setForm(current => ({ ...current, imageKeys: [...current.imageKeys, ...keys] }))).catch(cause => api.setError(String(cause))); }} /></label>{form.imageKeys.length > 0 && <p className="text-xs">{form.imageKeys.length} images uploaded</p>}<button disabled={busy || !organizationId} className="rounded bg-green-800 px-4 py-2 text-white disabled:opacity-40">{editing ? 'Save listing' : 'Create listing'}</button>{editing && <button type="button" className="ml-2 underline" onClick={() => { setEditing(''); setForm(initial); }}>Cancel edit</button>}</form></section>
    <section className="rounded border bg-white p-4"><h2 className="text-xl font-semibold">Recipient profile</h2><form className="mt-3 space-y-2" onSubmit={event => { event.preventDefault(); void act(() => api.json(`/marketplace/organizations/${organizationId}/profile`,'PUT',{ locationId: profile.locationId || undefined, acceptedCrops: profile.acceptedCrops.split(',').map(s => s.trim()).filter(Boolean), demand: profile.demand, quantityLimit: profile.quantityLimit ? Number(profile.quantityLimit) : undefined, storageCapacity: profile.storageCapacity ? Number(profile.storageCapacity) : undefined, serviceRadiusKm: profile.serviceRadiusKm ? Number(profile.serviceRadiusKm) : undefined, pickup: profile.pickup, delivery: profile.delivery, coldStorage: profile.coldStorage, acceptsSales: profile.acceptsSales, hours: profile.hours ? { description: profile.hours } : undefined }), 'Recipient profile saved'); }}><select aria-label="Recipient public location" className="w-full rounded border p-2" value={profile.locationId} onChange={event => setProfile({ ...profile, locationId: event.target.value })}><option value="">No public location</option>{ownLocations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select><input aria-label="Accepted crops" placeholder="Accepted crops, comma separated" className="w-full rounded border p-2" value={profile.acceptedCrops} onChange={event => setProfile({ ...profile, acceptedCrops: event.target.value })} /><textarea aria-label="Produce demand" placeholder="Produce demand" className="w-full rounded border p-2" value={profile.demand} onChange={event => setProfile({ ...profile, demand: event.target.value })} /><div className="grid grid-cols-2 gap-2"><input aria-label="Quantity limit (kg)" type="number" min="0.01" step="0.01" placeholder="Quantity limit (kg)" className="rounded border p-2" value={profile.quantityLimit} onChange={event => setProfile({ ...profile, quantityLimit: event.target.value })} /><input aria-label="Storage capacity (kg)" type="number" min="0" step="0.01" placeholder="Storage capacity (kg)" className="rounded border p-2" value={profile.storageCapacity} onChange={event => setProfile({ ...profile, storageCapacity: event.target.value })} /></div><input aria-label="Service radius km" type="number" min="1" max="500" placeholder="Service radius km" className="w-full rounded border p-2" value={profile.serviceRadiusKm} onChange={event => setProfile({ ...profile, serviceRadiusKm: event.target.value })} /><input aria-label="Operating hours" placeholder="Operating hours" className="w-full rounded border p-2" value={profile.hours} onChange={event => setProfile({ ...profile, hours: event.target.value })} /><label className="mr-4 text-sm"><input type="checkbox" checked={profile.pickup} onChange={event => setProfile({ ...profile, pickup: event.target.checked })} /> Pickup</label><label className="text-sm"><input type="checkbox" checked={profile.delivery} onChange={event => setProfile({ ...profile, delivery: event.target.checked })} /> Accepts farm drop-off</label>
    <label className="block text-sm"><input type="checkbox" checked={profile.coldStorage} onChange={event => setProfile({ ...profile, coldStorage: event.target.checked })} /> Has cold storage</label>
    <label className="block text-sm"><input type="checkbox" checked={profile.acceptsSales} onChange={event => setProfile({ ...profile, acceptsSales: event.target.checked })} /> Accepts sale offers</label>
    <div><button disabled={!organizationId} className="rounded bg-green-800 px-4 py-2 text-white">Save profile</button></div></form></section></aside></div>
    <div className="grid gap-6 lg:grid-cols-2"><section><h2 className="mb-3 text-xl font-semibold">Recipient discovery</h2><div className="space-y-2">{recipients.map(person => <article key={person.id} className="rounded border bg-white p-3"><strong>{person.organization.name}</strong><p className="text-sm">Accepts: {person.acceptedCrops.join(', ') || 'Ask recipient'} · {person.pickup ? 'Pickup' : ''}{person.delivery ? ' · Delivery' : ''}</p><p className="text-sm">{person.demand}</p><p className="text-sm">Limit {person.quantityLimit ?? '—'} · Storage {person.storageCapacity ?? '—'} · Service {person.serviceRadiusKm ?? '—'} km</p></article>)}</div></section><section><h2 className="mb-3 text-xl font-semibold">Your listings</h2><div className="space-y-2">{mine.map(item => <article key={item.id} className="flex items-center justify-between gap-2 rounded border bg-white p-3"><div><strong>{item.cropName}</strong><p className="text-xs">{item.quantity} {item.unit} total · {item.reservedQuantity} reserved {item.deletedAt && '· Removed'}</p></div><div className="flex flex-wrap gap-2">{!item.deletedAt && <button className="underline" onClick={() => setRecommendedListing(item.id)}>Recommendations</button>}<button className="underline" onClick={() => { setEditing(item.id); setOrganizationId(item.organizationId); setForm({ cropName: item.cropName, variety: item.variety ?? '', quantity: Number(item.quantity), unit: item.unit, harvestDate: item.harvestDate.slice(0,10), quality: item.quality, storageConditions: item.storageConditions, shelfLifeDays: item.shelfLifeDays, imageKeys: item.imageKeys, pickupAvailability: item.pickupAvailability, pickupFrom: localDateTime(item.pickupFrom), pickupUntil: localDateTime(item.pickupUntil), requiresColdStorage: item.requiresColdStorage, mode: item.mode, price: item.price ?? '', expiresAt: localDateTime(item.expiresAt), locationId: item.locationId }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Edit</button><button className="text-red-700 underline" onClick={() => void act(() => api.json(`/marketplace/listings/${item.id}`,'DELETE'), 'Listing removed')}>Remove</button></div></article>)}</div></section></div>
    {recommendedListing && mine.some(item => item.id === recommendedListing && !item.deletedAt) && <RecommendationPanel key={recommendedListing + recommendationRevision} listingId={recommendedListing} request={request} json={api.json} />}
    <section><h2 className="mb-3 text-xl font-semibold">Requests and transaction history</h2><div className="grid gap-3 md:grid-cols-2">{requests.map(item => <article key={item.id} className="space-y-2 rounded border bg-white p-4"><h3 className="font-semibold">{item.listing.cropName} · {item.quantity} {item.listing.unit}</h3><p className="text-sm">{item.organization.name} → {item.listing.organization.name} · {item.status}</p>{item.pickupAt && <p className="text-sm">Pickup: {new Date(item.pickupAt).toLocaleString()}</p>}{item.fulfilledAt && <p className="text-sm">Fulfilled: {new Date(item.fulfilledAt).toLocaleString()}</p>}<div className="flex flex-wrap gap-2">{item.status === 'PENDING' && item.listing.organizationId === organizationId && <><input type="datetime-local" aria-label={`Pickup time for ${item.listing.cropName}`} id={`pickup-${item.id}`} className="rounded border p-1 text-sm" /><button className="rounded bg-green-800 px-2 py-1 text-white" onClick={() => { const value = (document.getElementById(`pickup-${item.id}`) as HTMLInputElement).value; if (!value) { api.setError('Choose a pickup time'); return; } void act(() => api.json(`/marketplace/requests/${item.id}/accept`,'POST',{ pickupAt: new Date(value).toISOString() }), 'Request accepted'); }}>Accept</button><button className="rounded border px-2" onClick={() => void act(() => api.json(`/marketplace/requests/${item.id}/reject`,'POST'), 'Request rejected')}>Reject</button></>}{item.status === 'ACCEPTED' && item.listing.organizationId === organizationId && <button className="rounded bg-green-800 px-2 py-1 text-white" onClick={() => void act(() => api.json(`/marketplace/requests/${item.id}/fulfill`,'POST'), 'Pickup fulfilled')}>Mark fulfilled</button>}{['PENDING','ACCEPTED'].includes(item.status) && item.organizationId === organizationId && <button className="rounded border px-2" onClick={() => void act(() => api.json(`/marketplace/requests/${item.id}/cancel`,'POST'), 'Request cancelled')}>Cancel</button>}</div></article>)}</div></section>
  </main>;
}
