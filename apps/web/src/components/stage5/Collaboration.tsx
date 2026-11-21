'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FarmerConversationSummary } from '@cropcircle/shared-types';
import { SignIn, useCropCircleApi } from './useCropCircleApi';
import { type Job, waitForJob } from '../intelligence/jobs';
import { MediaLinks } from './MediaLinks';
import { FarmerMessages } from '../realtime/FarmerMessages';
import { Notifications } from '../realtime/Notifications';
import { usePresence, useRealtimeRefresh, useRooms } from '../realtime/useRealtime';

type Issue = { id: string; cropType: string; category: string; title: string; symptoms: string; region: string; observedAt: string; treatmentHistory?: string; author: { id: string; displayName: string | null }; diagnosisStatus: string; imageKeys: string[] };
type Farmer = { farmer: { id: string; displayName: string | null }; reportId: string; cropType: string; category: string; region: string; distanceKm: number | null; score: number; sharedInterests: string[] };
type Expert = { id: string; displayName: string | null; roles: string[]; memberships: { organization: { name: string; type: string } }[] };
type Group = { id: string; name: string; description: string; cropTypes: string[]; interests: string[]; _count?: { members: number }; members?: { role: string; user: { id: string; displayName: string | null } }[]; posts?: { id: string; body: string; attachmentKeys: string[]; author: { displayName: string | null } }[]; observations?: { id: string; title: string; method: string; observation: string; observedAt: string; attachmentKeys: string[]; author: { displayName: string | null } }[] };
type Invitation = { id: string; group: { name: string }; invitedBy: { displayName: string | null } };
const categories = ['DISEASE','PEST','SOIL','NUTRIENT','IRRIGATION','WEATHER','CROP_FAILURE'];

export function Collaboration() {
  const api = useCropCircleApi();
  const { user, request, setError, socket } = api;
  const [issues, setIssues] = useState<Issue[]>([]);
  const [experts, setExperts] = useState<Expert[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [groupId, setGroupId] = useState('');
  const [groupDetail, setGroupDetail] = useState<Group | null>(null);
  const selectedGroup = groupDetail?.id === groupId ? groupDetail : null;
  const [similar, setSimilar] = useState<{ report: Issue; matches: Farmer[]; semantic: boolean }>();
  const [finding, setFinding] = useState(false);
  const [conversationId, setConversationId] = useState('');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [issue, setIssue] = useState({ title: '', cropType: '', category: 'DISEASE', symptoms: '', region: '', observedAt: new Date().toISOString().slice(0,10), treatmentHistory: '', interests: '', publicLat: '', publicLng: '', imageKeys: [] as string[] });
  const [group, setGroup] = useState({ name: '', description: '', cropTypes: '', interests: '' });
  const [post, setPost] = useState({ body: '', attachmentKeys: [] as string[] });
  const [observation, setObservation] = useState({ title: '', method: '', observation: '', observedAt: new Date().toISOString().slice(0,10), attachmentKeys: [] as string[] });
  const [inviteUserId, setInviteUserId] = useState('');
  const [message, setMessage] = useState('');
  const [sendingPost, setSendingPost] = useState(false);
  const postKey = useRef<{ input: string; id: string } | undefined>(undefined);
  const refreshSequence = useRef({ value: 0 }).current;
  const groupSequence = useRef({ value: 0, groupId: '' }).current;
  const online = usePresence(socket, 'group', selectedGroup?.id);
  const refresh = useCallback(async () => {
    if (!user) return;
    const sequence = ++refreshSequence.value;
    try {
      const [reports, directory, researchGroups, invites] = await Promise.all([
        request<{items:Issue[]}>(`/collaboration/issues?q=${encodeURIComponent(q)}${category ? `&category=${category}` : ''}`),
        request<Expert[]>('/collaboration/experts'), request<Group[]>('/collaboration/groups'), request<Invitation[]>('/collaboration/invitations'),
      ]);
      if (sequence === refreshSequence.value) {
        setIssues(reports.items); setExperts(directory); setGroups(researchGroups); setInvitations(invites);
      }
    } catch (cause) { if (sequence === refreshSequence.value) setError(String(cause)); }
  }, [user, request, setError, q, category, refreshSequence]);
  const refreshGroup = useCallback(async () => {
    if (!user || !groupId || groupSequence.groupId !== groupId) return;
    const sequence = ++groupSequence.value;
    try {
      const detail = await request<Group>('/collaboration/groups/' + groupId);
      if (sequence === groupSequence.value) setGroupDetail(detail);
    } catch (cause) {
      if (sequence === groupSequence.value) { setGroupDetail(null); setError(String(cause)); }
    }
  }, [user, groupId, request, setError, groupSequence]);
  useEffect(() => { void refresh(); return () => { refreshSequence.value++; }; }, [refresh, refreshSequence]);
  useEffect(() => {
    groupSequence.groupId = groupId;
    void refreshGroup();
    return () => { groupSequence.groupId = ''; groupSequence.value++; };
  }, [groupId, refreshGroup, groupSequence]);
  useEffect(() => {
    if (user) return;
    setGroupId('');
    setGroupDetail(null);
    setInvitations([]);
    setSimilar(undefined);
    setConversationId('');
    setPost({ body: '', attachmentKeys: [] });
  }, [user]);
  useRooms(socket, [{ kind: 'topic', topic: 'issues' }], refresh);
  useRooms(socket, selectedGroup ? [{ kind: 'group', id: selectedGroup.id }] : [], refreshGroup);
  useRealtimeRefresh(socket, refresh, event => event.type === 'AGRICULTURAL_ISSUE_CREATED' || event.type === 'FARMER_MATCH_FOUND', !!user);
  useRealtimeRefresh(socket, refreshGroup, event =>
    (event.type === 'GROUP_MESSAGE_CREATED' || event.type === 'GROUP_ACTIVITY_UPDATED') && event.payload.groupId === groupId, !!user && !!groupId);

  const act = async (operation: () => Promise<unknown>, success: string) => {
    try {
      setError('');
      await operation();
      setMessage(success);
      await Promise.all([refresh(), refreshGroup()]);
    } catch (cause) { setError(String(cause)); }
  };
  const findFarmers = async (report: Issue) => {
    setFinding(true);
    setError('');
    setSimilar(undefined);
    try {
      const job = await api.json<Job<{ matches: Farmer[] }>>('/intelligence/issues/' + report.id + '/similarity', 'POST');
      const completed = await waitForJob(job, request);
      setSimilar({ report, matches: completed.output?.matches ?? [], semantic: true });
    } catch {
      try {
        const matches = await request<Farmer[]>('/collaboration/issues/' + report.id + '/similar');
        setSimilar({ report, matches, semantic: false });
      } catch (cause) {
        setError(String(cause));
      }
    } finally {
      setFinding(false);
    }
  };
  const openConversation = (report: Issue, match: Farmer) => api.json<FarmerConversationSummary>('/realtime/conversations', 'POST', {
    issueId: report.id, matchedIssueId: match.reportId,
  }).then(item => {
    setConversationId(item.id);
    document.getElementById('farmer-messages')?.scrollIntoView({ block: 'nearest' });
  }).catch(cause => setError(String(cause)));
  const sendPost = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!groupId || sendingPost) return;
    const input = JSON.stringify([groupId, post]);
    const id = postKey.current?.input === input ? postKey.current.id : crypto.randomUUID();
    postKey.current = { input, id };
    setSendingPost(true);
    await act(async () => {
      await api.json('/collaboration/groups/' + groupId + '/posts', 'POST', { ...post, clientId: id });
      setPost({ body: '', attachmentKeys: [] });
      postKey.current = undefined;
    }, 'Post added');
    setSendingPost(false);
  };
  const uploadFiles = async (files: FileList | null, done: (keys: string[]) => void) => { try { done(await Promise.all(Array.from(files ?? []).map(api.upload))); } catch (cause) { api.setError(String(cause)); } };
  if (api.loading) return <main className="p-8">Checking session…</main>;
  if (!api.user) return <SignIn login={api.login} error={api.error} />;
  return <main className="mx-auto max-w-7xl space-y-8 p-4 sm:p-8"><header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4"><div><h1 className="text-3xl font-semibold">Farmer collaboration</h1><p className="text-sm text-gray-600">Share observations and find peers and agricultural specialists.</p></div><nav className="flex flex-wrap items-center gap-3 text-sm"><Notifications socket={socket} request={request} /><a href="/marketplace" className="underline">Marketplace</a><a href="/map" className="underline">Map</a><a href="/sustainability" className="underline">Crop analysis</a><button className="underline" onClick={() => void api.logout()}>Sign out</button></nav></header>{api.error && <p role="alert" className="rounded bg-red-50 p-3 text-red-800">{api.error}</p>}{message && <p role="status" className="rounded bg-green-50 p-3 text-green-900">{message}</p>}
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]"><section className="space-y-4"><h2 className="text-xl font-semibold">Agricultural issue reports</h2><p className="text-sm text-amber-800">Community reports are unverified observations, not confirmed diagnoses. Consult a qualified expert before treatment.</p><div className="flex gap-2"><input aria-label="Search reports" placeholder="Search reports" className="flex-1 rounded border p-2" value={q} onChange={event => setQ(event.target.value)} /><select aria-label="Issue category" className="rounded border p-2" value={category} onChange={event => setCategory(event.target.value)}><option value="">All issues</option>{categories.map(value => <option key={value}>{value}</option>)}</select></div>{issues.map(report => <article key={report.id} className="space-y-2 rounded border bg-white p-4"><h3 className="font-semibold">{report.title}</h3><p className="text-sm">{report.cropType} · {report.category.replace('_',' ')} · {report.region} · {report.observedAt.slice(0,10)}</p><p className="text-sm">Symptoms: {report.symptoms}</p>{report.treatmentHistory && <p className="text-sm">Treatment history: {report.treatmentHistory}</p>}<MediaLinks keys={report.imageKeys} request={api.request} /><p className="text-xs text-amber-800">Unverified farmer report by {report.author.displayName ?? 'Farmer'}</p><button disabled={finding} className="text-sm underline disabled:opacity-50" onClick={() => void findFarmers(report)}>Find similar farmers</button></article>)}{finding && <p role="status">Comparing reports…</p>}{similar && <div className="rounded border bg-green-50 p-4">
      <h3 className="font-semibold">Similar farmers for {similar.report.title}</h3>
      <p className="text-xs">{similar.semantic ? "Ranked by symptoms, crop, issue category, interests, and available public proximity." : "Showing matches by crop, issue category, and interests."}</p>
      {similar.matches.length === 0 && <p className="text-sm">No matching farmer reports yet.</p>}
      {similar.matches.map(match => <p key={match.reportId} className="text-sm">
        {match.farmer.displayName ?? 'Farmer'} · {match.cropType} / {match.category} · {match.region}
        {similar.semantic && ' · ' + Math.round(match.score * 100) + '% similarity score'}
        {match.distanceKm !== null && ` · ${Math.round(match.distanceKm)} km`}
        {match.sharedInterests.length > 0 && ` · ${match.sharedInterests.join(', ')}`}
        {similar.report.author.id === user?.id && <button className="ml-2 underline" onClick={() => void openConversation(similar.report, match)}>Message farmer</button>}
      </p>)}
    </div>}</section>
    <aside className="space-y-5"><section className="rounded border bg-white p-4"><h2 className="text-xl font-semibold">Report an issue</h2><form className="mt-3 space-y-2" onSubmit={event => { event.preventDefault();
      if (Boolean(issue.publicLat) !== Boolean(issue.publicLng)) { setError('Enter both regional coordinates or leave both blank.'); return; }
      void act(() => api.json('/collaboration/issues', 'POST', {
        ...issue,
        publicLat: issue.publicLat ? Number(issue.publicLat) : undefined,
        publicLng: issue.publicLng ? Number(issue.publicLng) : undefined,
        interests: issue.interests.split(',').map(value => value.trim()).filter(Boolean),
        treatmentHistory: issue.treatmentHistory || undefined,
      }), 'Issue report shared');
     }}><input required aria-label="Report title" placeholder="Title" className="w-full rounded border p-2" value={issue.title} onChange={event => setIssue({ ...issue, title: event.target.value })} /><input required aria-label="Crop type" placeholder="Crop type" className="w-full rounded border p-2" value={issue.cropType} onChange={event => setIssue({ ...issue, cropType: event.target.value })} /><select aria-label="Category" className="w-full rounded border p-2" value={issue.category} onChange={event => setIssue({ ...issue, category: event.target.value })}>{categories.map(value => <option key={value}>{value}</option>)}</select><textarea required minLength={10} aria-label="Symptoms" placeholder="Symptoms and observations" className="w-full rounded border p-2" value={issue.symptoms} onChange={event => setIssue({ ...issue, symptoms: event.target.value })} /><input required aria-label="General region" placeholder="General region, no home address" className="w-full rounded border p-2" value={issue.region} onChange={event => setIssue({ ...issue, region: event.target.value })} /><details className="text-sm"><summary>Approximate public location (optional)</summary>
      <p className="mt-1">Use a regional point for nearby farmer matches.</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label>Latitude<input type="number" step="any" min="-90" max="90" value={issue.publicLat} onChange={event => setIssue({ ...issue, publicLat: event.target.value })} className="w-full rounded border p-2" /></label>
        <label>Longitude<input type="number" step="any" min="-180" max="180" value={issue.publicLng} onChange={event => setIssue({ ...issue, publicLng: event.target.value })} className="w-full rounded border p-2" /></label>
      </div>
    </details><label className="block text-sm">Observation date<input type="date" required className="mt-1 w-full rounded border p-2" value={issue.observedAt} onChange={event => setIssue({ ...issue, observedAt: event.target.value })} /></label><textarea aria-label="Treatment history" placeholder="Treatment history" className="w-full rounded border p-2" value={issue.treatmentHistory} onChange={event => setIssue({ ...issue, treatmentHistory: event.target.value })} /><input aria-label="Research interests" placeholder="Research interests, comma separated" className="w-full rounded border p-2" value={issue.interests} onChange={event => setIssue({ ...issue, interests: event.target.value })} /><label className="block text-sm">Images<input className="mt-1 w-full" type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={event => void uploadFiles(event.target.files, keys => setIssue(current => ({ ...current, imageKeys: [...current.imageKeys, ...keys] })))} /></label><button className="rounded bg-green-800 px-4 py-2 text-white">Share report</button></form></section><section className="rounded border bg-white p-4"><h2 className="text-xl font-semibold">Expert directory</h2>{experts.map(expert => <p className="border-b py-2 text-sm" key={expert.id}>{expert.displayName ?? 'Agricultural expert'} · {expert.roles.filter(role => role !== 'USER').join(', ')}{expert.memberships[0] && ` · ${expert.memberships[0].organization.name}`}</p>)}</section></aside></div>
    <FarmerMessages socket={socket} request={request} userId={api.user.id} conversationId={conversationId} onOpen={setConversationId} />
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]"><section className="space-y-3"><h2 className="text-xl font-semibold">Research groups</h2>{groups.map(item => <article key={item.id} className="rounded border bg-white p-4"><h3 className="font-semibold">{item.name}</h3><p className="text-sm">{item.description}</p><p className="text-xs">Crops: {item.cropTypes.join(', ')} · Interests: {item.interests.join(', ')} · {item._count?.members ?? 0} members</p><div className="mt-2 flex gap-3"><button className="underline" onClick={() => setGroupId(item.id)}>Open</button><button className="underline" onClick={() => void act(() => api.json(`/collaboration/groups/${item.id}/join`,'POST'), 'Joined group')}>Join</button></div></article>)}{invitations.length > 0 && <section className="rounded border bg-white p-4"><h3 className="font-semibold">Invitations</h3>{invitations.map(invitation => <div key={invitation.id} className="flex gap-2 py-2 text-sm"><span>{invitation.group.name} from {invitation.invitedBy.displayName}</span><button className="underline" onClick={() => void act(() => api.json(`/collaboration/invitations/${invitation.id}/accept`,'POST'), 'Invitation accepted')}>Accept</button><button className="underline" onClick={() => void act(() => api.json(`/collaboration/invitations/${invitation.id}/reject`,'POST'), 'Invitation rejected')}>Reject</button></div>)}</section>}</section>
    <aside className="rounded border bg-white p-4"><h2 className="text-xl font-semibold">Create research group</h2><form className="mt-3 space-y-2" onSubmit={event => { event.preventDefault(); void act(() => api.json('/collaboration/groups','POST',{ name: group.name, description: group.description, cropTypes: group.cropTypes.split(',').map(s => s.trim()).filter(Boolean), interests: group.interests.split(',').map(s => s.trim()).filter(Boolean) }), 'Group created'); }}><input required aria-label="Group name" placeholder="Group name" className="w-full rounded border p-2" value={group.name} onChange={event => setGroup({ ...group, name: event.target.value })} /><textarea required aria-label="Group description" placeholder="What are you researching?" className="w-full rounded border p-2" value={group.description} onChange={event => setGroup({ ...group, description: event.target.value })} /><input aria-label="Group crops" placeholder="Crop types, comma separated" className="w-full rounded border p-2" value={group.cropTypes} onChange={event => setGroup({ ...group, cropTypes: event.target.value })} /><input aria-label="Group interests" placeholder="Interests, comma separated" className="w-full rounded border p-2" value={group.interests} onChange={event => setGroup({ ...group, interests: event.target.value })} /><button className="rounded bg-green-800 px-4 py-2 text-white">Create group</button></form></aside></div>
    {selectedGroup && <section className="space-y-4 rounded border bg-white p-4"><h2 className="text-xl font-semibold">{selectedGroup.name}</h2><p>{selectedGroup.description}</p><p className="text-sm">Members: {selectedGroup.members?.map(member => (member.user.displayName ?? 'Farmer') + (online ? (online.includes(member.user.id) ? ' (online)' : ' (offline)') : '')).join(', ')}</p><form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void act(() => api.json(`/collaboration/groups/${selectedGroup.id}/invitations`,'POST',{ userId: inviteUserId }), 'Invitation sent'); }}><input required aria-label="Invite user ID" placeholder="Invite farmer user ID" className="rounded border p-2" value={inviteUserId} onChange={event => setInviteUserId(event.target.value)} /><button className="rounded border px-3">Invite</button></form><div className="grid gap-6 lg:grid-cols-2"><div><h3 className="font-semibold">Discussion and shared files</h3><form className="mt-2 space-y-2" onSubmit={event => void sendPost(event)}><textarea required aria-label="Discussion post" disabled={sendingPost} maxLength={3000} placeholder="Share an update" className="w-full rounded border p-2" value={post.body} onChange={event => setPost({ ...post, body: event.target.value })} /><input aria-label="Discussion attachment" type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" onChange={event => void uploadFiles(event.target.files, keys => setPost(current => ({ ...current, attachmentKeys: [...current.attachmentKeys, ...keys] })))} /><button disabled={sendingPost} className="rounded bg-green-800 px-3 py-2 text-white disabled:opacity-50">Post</button></form>{selectedGroup.posts?.map(item => <article className="border-b py-3 text-sm" key={item.id}><strong>{item.author.displayName ?? 'Member'}</strong><p>{item.body}</p><MediaLinks keys={item.attachmentKeys} request={api.request} /></article>)}</div><div><h3 className="font-semibold">Experiments and observations</h3><form className="mt-2 space-y-2" onSubmit={event => { event.preventDefault(); void act(() => api.json(`/collaboration/groups/${selectedGroup.id}/observations`,'POST',observation), 'Observation added'); }}><input required aria-label="Experiment title" placeholder="Experiment title" className="w-full rounded border p-2" value={observation.title} onChange={event => setObservation({ ...observation, title: event.target.value })} /><textarea required aria-label="Method" placeholder="Method" className="w-full rounded border p-2" value={observation.method} onChange={event => setObservation({ ...observation, method: event.target.value })} /><textarea required aria-label="Observation" placeholder="Observation" className="w-full rounded border p-2" value={observation.observation} onChange={event => setObservation({ ...observation, observation: event.target.value })} /><input aria-label="Observation date" type="date" className="rounded border p-2" value={observation.observedAt} onChange={event => setObservation({ ...observation, observedAt: event.target.value })} /><input aria-label="Observation attachment" type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" onChange={event => void uploadFiles(event.target.files, keys => setObservation(current => ({ ...current, attachmentKeys: [...current.attachmentKeys, ...keys] })))} /><button className="rounded bg-green-800 px-3 py-2 text-white">Record observation</button></form>{selectedGroup.observations?.map(item => <article className="border-b py-3 text-sm" key={item.id}><strong>{item.title}</strong> · {item.observedAt.slice(0,10)}<p>Method: {item.method}</p><p>Observation: {item.observation}</p><MediaLinks keys={item.attachmentKeys} request={api.request} /></article>)}</div></div></section>}
  </main>;
}
