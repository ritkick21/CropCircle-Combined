'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, ClipboardList, Microscope, Sprout } from 'lucide-react';
import { type FarmCase, type FarmlineWorkspace } from '@cropcircle/shared-types';
import { Notifications } from '../realtime/Notifications';
import { useRealtimeRefresh } from '../realtime/useRealtime';
import { SignIn, useCropCircleApi } from '../stage5/useCropCircleApi';
import { CaseCard, Library, Trials } from './WorkspacePanels';
import { ActionForm, Dictation, field, formText, panel, secondary } from './forms';

export type FarmApi = ReturnType<typeof useCropCircleApi>;
const tabs = [
  { id: 'report', label: 'Get help', icon: Sprout },
  { id: 'mine', label: 'My cases', icon: ClipboardList },
  { id: 'review', label: 'Review cases', icon: ClipboardList },
  { id: 'library', label: 'Source library', icon: BookOpen },
  { id: 'trials', label: 'Field trials', icon: Microscope },
] as const;
type View = (typeof tabs)[number]['id'];

export function Farmline() {
  const api = useCropCircleApi();
  if (api.loading)
    return (
      <main className="site-frame py-10" aria-busy="true">
        Loading FarmLine…
      </main>
    );
  if (!api.user) return <SignIn login={api.login} error={api.error} />;
  return <FarmlineWorkspaceView key={api.user.id} api={api} user={api.user} />;
}

function FarmlineWorkspaceView({
  api,
  user,
}: {
  api: FarmApi;
  user: NonNullable<FarmApi['user']>;
}) {
  const { request, json, socket } = api;
  const canReview = user.roles.some((role) => role === 'RESEARCHER' || role === 'PROFESSIONAL');
  const [workspace, setWorkspace] = useState<FarmlineWorkspace>();
  const [view, setView] = useState<View>(canReview ? 'review' : 'report');
  const [selected, setSelected] = useState('');
  const [loadError, setLoadError] = useState('');
  const [status, setStatus] = useState('');
  const sequence = useRef({ value: 0 }).current;
  const refresh = useCallback(async () => {
    const current = ++sequence.value;
    try {
      const result = await request<FarmlineWorkspace>('/farmline');
      if (current === sequence.value) {
        setWorkspace(result);
        setLoadError('');
      }
    } catch (cause) {
      if (current === sequence.value)
        setLoadError(cause instanceof Error ? cause.message : 'Unable to load FarmLine.');
    }
  }, [request, sequence]);

  useEffect(() => {
    void refresh();
    return () => {
      sequence.value++;
    };
  }, [refresh, sequence]);
  useRealtimeRefresh(socket, refresh, (event) => event.type === 'NOTIFICATION_CREATED', true);

  function navigate(next: View) {
    setView(next);
    setSelected('');
    setStatus('');
  }

  async function mutate(path: string, body: unknown, message: string, method = 'POST') {
    await json(path, method, body);
    setStatus(message);
    await refresh();
  }

  const cases = view === 'review' ? workspace?.incoming : workspace?.mine;
  const currentCase = cases?.find((item) => item.id === selected) ?? cases?.[0];

  return (
    <main className="site-frame pb-14 pt-7 sm:pt-10">
      <header className="farmline-heading mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl leading-tight tracking-tight sm:text-5xl">
            FarmLine crop help
          </h1>
          <p className="mt-2 max-w-xl text-[#435949]">
            Describe what you see in the field, find relevant guidance, and get a second opinion
            from a researcher.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Notifications socket={socket} request={request} />
          <button
            className={secondary}
            onClick={() =>
              void api.logout().catch(() => setLoadError('Unable to sign out. Try again.'))
            }
          >
            Sign out
          </button>
        </div>
      </header>
      <nav aria-label="FarmLine workspace" className="mb-5 flex flex-wrap gap-2 border-b pb-3">
        {tabs
          .filter((tab) => tab.id !== 'review' || canReview)
          .map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={view === id ? 'page' : undefined}
              className={
                view === id
                  ? 'inline-flex items-center gap-2 rounded-lg bg-[#174531] px-3 py-2 text-sm font-semibold text-white'
                  : secondary
              }
              onClick={() => navigate(id)}
            >
              <Icon aria-hidden className="size-4" /> {label}
            </button>
          ))}
      </nav>
      {loadError && (
        <p role="alert" className="mb-4 flex flex-wrap items-center gap-2 text-red-800">
          {loadError}{' '}
          <button className={secondary} onClick={() => void refresh()}>
            Retry
          </button>
        </p>
      )}
      {status && (
        <p role="status" className="mb-4 rounded-lg bg-[#e9efdf] px-4 py-3 text-[#174531]">
          {status}
        </p>
      )}
      {!workspace && !loadError && <p role="status">Loading cases and sources…</p>}
      {workspace && view === 'report' && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <ReportForm
            create={async (data) => {
              const item = await json<FarmCase>('/farmline/cases', 'POST', {
                crop: formText(data, 'crop'),
                region: formText(data, 'region'),
                description: formText(data, 'description'),
                openToTrials: data.has('openToTrials'),
              });
              setWorkspace(
                (previous) =>
                  previous && {
                    ...previous,
                    mine: [item, ...previous.mine.filter((value) => value.id !== item.id)],
                  },
              );
              setSelected(item.id);
              setView('mine');
              setStatus('Case saved. You can share it for review when you’re ready.');
              await refresh();
            }}
          />
          <aside className={panel}>
            <h2 className="font-serif text-2xl">More ways to get help</h2>
            <ul className="mt-3 space-y-4 text-sm text-[#435949]">
              <li>
                <button
                  className="font-semibold text-[#174531] underline"
                  onClick={() => navigate('library')}
                >
                  Browse extension and research sources
                </button>
              </li>
              <li>
                <Link className="font-semibold text-[#174531] underline" href="/collaboration">
                  Talk to other growers in Collaboration
                </Link>
              </li>
              <li>
                <Link className="font-semibold text-[#174531] underline" href="/sustainability">
                  Explore CropCircle’s crop issue tools
                </Link>
              </li>
              <li>
                <a
                  className="inline-flex items-center gap-1 font-semibold text-[#174531] underline"
                  href={workspace.extensionDirectory}
                  target="_blank"
                  rel="noreferrer"
                >
                  Find your extension office <ArrowUpRight aria-hidden className="size-4" />
                </a>
              </li>
            </ul>
          </aside>
        </div>
      )}
      {workspace && (view === 'mine' || view === 'review') && (
        <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <section className={panel}>
            <h2 className="mb-3 font-serif text-2xl">
              {view === 'mine' ? 'My cases' : 'Cases to review'}
            </h2>
            {!cases?.length && (
              <p className="text-sm text-[#435949]">
                {view === 'mine'
                  ? 'Your crop help requests will appear here.'
                  : 'Cases shared for your review will appear here.'}
              </p>
            )}
            <ul className="space-y-2">
              {cases?.map((item) => (
                <li key={item.id}>
                  <button
                    className="w-full rounded-lg border border-transparent px-3 py-2 text-left text-sm hover:bg-[#edf1e5] aria-[pressed=true]:border-[#9dab93] aria-[pressed=true]:bg-[#edf1e5]"
                    aria-pressed={item.id === currentCase?.id}
                    onClick={() => {
                      setSelected(item.id);
                      setStatus('');
                    }}
                  >
                    <span className="block break-words font-semibold">{item.crop}</span>
                    <span className="text-[#435949]">
                      {item.resolvedAt
                        ? 'Resolved'
                        : item.sharedAt
                          ? 'Shared for review'
                          : 'Private'}{' '}
                      · {new Date(item.createdAt).toLocaleDateString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          {currentCase && (
            <CaseCard
              key={currentCase.id}
              item={currentCase}
              workspace={workspace}
              owner={view === 'mine'}
              mutate={mutate}
            />
          )}
        </div>
      )}
      {workspace && view === 'library' && (
        <Library workspace={workspace} canReview={canReview} mutate={mutate} />
      )}
      {workspace && view === 'trials' && (
        <Trials workspace={workspace} userId={user.id} canReview={canReview} mutate={mutate} />
      )}
    </main>
  );
}

function ReportForm({ create }: { create: (data: FormData) => Promise<void> }) {
  const [crop, setCrop] = useState('');
  const [region, setRegion] = useState('');
  const [description, setDescription] = useState('');
  return (
    <section className={panel}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <h2 className="font-serif text-2xl">Describe a crop problem</h2>
        <button
          type="button"
          className={secondary}
          onClick={() => {
            setCrop('Sorghum');
            setRegion('Lubbock, TX');
            setDescription(
              'The leaves are sticky and shiny, with tiny yellow insects underneath. Some lower leaves are turning black, and the affected area is spreading.',
            );
          }}
        >
          Fill in a demo example
        </button>
      </div>
      <ActionForm submit={create} label="Find help">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-semibold">
            Crop
            <input
              name="crop"
              className={field}
              required
              minLength={2}
              maxLength={80}
              value={crop}
              onChange={(event) => setCrop(event.target.value)}
            />
          </label>
          <label className="block text-sm font-semibold">
            Region (optional)
            <input
              name="region"
              className={field}
              maxLength={100}
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              placeholder="City or county"
            />
          </label>
        </div>
        <Dictation
          append={(value) =>
            setDescription((previous) =>
              (previous ? previous.trimEnd() + ' ' + value : value).slice(0, 2000),
            )
          }
        />
        <label className="block text-sm font-semibold">
          What are you seeing?
          <textarea
            name="description"
            className={field}
            rows={5}
            minLength={12}
            maxLength={2000}
            required
            placeholder="Describe the symptoms, when they started, and how much of the field is affected."
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input className="mt-0.5 size-4 accent-[#174531]" name="openToTrials" type="checkbox" />{' '}
          I’m open to hearing about field trials.
        </label>
      </ActionForm>
    </section>
  );
}
