'use client';

import { ArrowDownRight, BarChart3, Leaf, PackageCheck, Sprout, Users } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Notifications } from '../realtime/Notifications';
import { SignIn, useCropCircleApi } from '../stage5/useCropCircleApi';
import { ClassificationTool, ForecastTool, type Models } from './PredictionTools';
import { RecommendationPanel } from './RecommendationPanel';
import type { Job } from './jobs';

type Organization = { id: string; name: string; type: string };
type Scope = 'farmer' | 'organization' | 'admin';
type Dashboard = {
  totals: {
    redistributedKg: number;
    redistributedBoxes: number;
    activeListings: number;
    fulfilledRequests: number;
  };
  wasteEstimate: { kg: number; factor: number };
  fulfillment: { mode: 'DONATION' | 'SALE'; fulfilled: number; requests: number }[];
  demand: { crop: string; pendingKg: number; pendingBoxes: number; pendingRequests: number }[];
  destinations: { id: string; name: string; kg: number; boxes: number; lng: number; lat: number }[];
  collaboration: { issues: number; conversations: number; groupPosts: number };
  listings: { id: string; cropName: string; organization: { name: string } }[];
  predictions: Job<{
    crop?: string;
    estimate?: number;
    low?: number;
    high?: number;
    unit?: string;
    assessment?: string;
    matches?: unknown[];
    allocated?: number;
    reason?: string;
  }>[];
};
type Monitoring = {
  activity: { kind: string; status: string; version: string | null; count: number }[];
  drift: {
    version: string;
    windowDays: number;
    features: {
      model: string;
      feature: string;
      samples: number;
      outsideRange: number | null;
      status: string;
    }[];
  };
};

const outputLabels = {
  RECOMMENDATION: 'Recipient recommendations',
  SURPLUS: 'Surplus forecast',
  DEMAND: 'Demand forecast',
  CLASSIFY: 'Issue hypotheses',
  SIMILARITY: 'Farmer similarity',
};
const numeric = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const fmt = (value: number) => numeric.format(value);
const panel = 'rounded-2xl border border-emerald-900/15 bg-white p-5';
const headings = { farmer: 'My farm', organization: 'Organization', admin: 'Platform' };

function PredictionHistory({ rows }: { rows: Dashboard['predictions'] }) {
  return (
    <div className={panel}>
      <h3 className="text-lg font-semibold">Recent analyses</h3>
      {rows.length ? (
        <ul className="mt-2 divide-y divide-stone-100">
          {rows.map((row) => {
            const output = row.output;
            return (
              <li key={row.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm">
                <div>
                  <strong>
                    {outputLabels[row.kind]}
                    {output?.crop ? ' · ' + output.crop : ''}
                  </strong>
                  {output?.estimate !== undefined && (
                    <p>
                      {fmt(output.estimate)} {output.unit} estimated · range {fmt(output.low ?? 0)}–
                      {fmt(output.high ?? 0)}
                    </p>
                  )}
                  {output?.allocated !== undefined && (
                    <p>
                      {fmt(output.allocated)} {output.unit} proposed for allocation
                    </p>
                  )}
                  {output?.assessment && (
                    <p>
                      {output.assessment === 'AI_HYPOTHESIS'
                        ? 'Unverified hypotheses'
                        : 'Insufficient evidence'}
                    </p>
                  )}
                  {output?.matches && <p>{output.matches.length} similar farmers</p>}
                </div>
                <span className="text-stone-500">
                  {new Date(row.createdAt).toLocaleDateString()} · {row.status.toLowerCase()}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-stone-600">Completed and queued analyses appear here.</p>
      )}
    </div>
  );
}

function ModelMonitoring({ models, monitoring }: { models?: Models; monitoring?: Monitoring }) {
  const labels: Record<string, string> = {
    surplus: 'Surplus proxy',
    publicDemandProxy: 'U.S. availability proxy',
    platformDemand: 'CropCircle demand',
    symptomCategory: 'Symptom text',
    photoCategory: 'Leaf photo',
    similarityProxy: 'Semantic retrieval proxy',
  };
  return (
    <div className={panel}>
      <h3 className="text-lg font-semibold">Model evaluation and monitoring</h3>
      {models && (
        <>
          <p className="mt-1 break-words text-sm text-stone-600">
            {models.version} · MLflow run {models.runId}
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {Object.entries(models.evaluation).map(([key, m]) => (
              <li key={key}>
                <strong>{labels[key] ?? key}</strong> · {m.test_rows} holdout rows
                {typeof m.holdout_mae === 'number' &&
                  ' · MAE ' +
                    fmt(m.holdout_mae) +
                    (key === 'surplus'
                      ? ' kg/acre'
                      : key === 'platformDemand'
                        ? ' kg requested'
                        : ' million kg')}
                {typeof m.holdout_macro_f1 === 'number' &&
                  ' · macro F1 ' + m.holdout_macro_f1.toFixed(2)}
                {typeof m.holdout_category_agreement === 'number' &&
                  ' · issue-category agreement ' + fmt(m.holdout_category_agreement * 100) + '%'}
                {typeof m.holdout_interval_coverage === 'number' &&
                  ' · interval coverage ' + fmt(m.holdout_interval_coverage * 100) + '%'}
              </li>
            ))}
          </ul>
        </>
      )}
      {monitoring && (
        <>
          <h4 className="mt-4 text-sm font-semibold">Prediction logs · last 30 days</h4>
          <ul className="space-y-1 text-sm">
            {monitoring.activity.map((row, index) => (
              <li key={index}>
                {row.kind.toLowerCase()} · {row.status.toLowerCase()} · {row.count}
              </li>
            ))}
          </ul>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-medium">
              Feature drift · {monitoring.drift.windowDays}-day window
            </summary>
            <ul className="mt-2 space-y-1">
              {monitoring.drift.features.map((feature) => (
                <li key={feature.model + feature.feature}>
                  {labels[feature.model] ?? feature.model} · {feature.feature.replaceAll('_', ' ')}{' '}
                  · {feature.samples} samples · {feature.status.replaceAll('_', ' ')}
                  {feature.outsideRange !== null &&
                    ' · ' + fmt(feature.outsideRange * 100) + '% outside reference'}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}

export function Sustainability() {
  const api = useCropCircleApi();
  const { request, user } = api;
  const [scope, setScope] = useState<Scope>('farmer');
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organization, setOrganization] = useState('');
  const [data, setData] = useState<Dashboard>();
  const [models, setModels] = useState<Models>();
  const [monitoring, setMonitoring] = useState<Monitoring>();
  const [listingId, setListingId] = useState('');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  const admin = user?.roles.includes('ADMIN');

  useEffect(() => {
    if (!user) return;
    const abort = new AbortController();
    const options = { signal: abort.signal };
    void request<Organization[]>('/organizations', options)
      .then((items) => {
        if (!abort.signal.aborted) {
          setOrganizations(items);
          setOrganization(items[0]?.id ?? '');
          setScope(
            user.roles.includes('ADMIN')
              ? 'admin'
              : items.length && items.every((org) => org.type !== 'farm')
                ? 'organization'
                : 'farmer',
          );
        }
      })
      .catch((cause) => {
        if (!abort.signal.aborted) setError(String(cause));
      });
    void request<Models>('/intelligence/models', options)
      .then(setModels)
      .catch(() => undefined);
    return () => abort.abort();
  }, [request, user]);

  useEffect(() => {
    if (!user || (scope === 'organization' && !organization)) return;
    const abort = new AbortController();
    const params = new URLSearchParams({ scope });
    if (scope === 'organization') params.set('organizationId', organization);
    void request<Dashboard>('/intelligence/dashboard?' + params, { signal: abort.signal })
      .then((result) => {
        if (!abort.signal.aborted) {
          setData(result);
          setError('');
        }
      })
      .catch((cause) => {
        if (!abort.signal.aborted) setError(String(cause));
      });
    if (scope === 'admin')
      void request<Monitoring>('/intelligence/monitoring', { signal: abort.signal })
        .then(setMonitoring)
        .catch((cause) => {
          if (!abort.signal.aborted) setError(String(cause));
        });
    return () => abort.abort();
  }, [organization, request, revision, scope, user]);

  function switchScope(next: Scope) {
    setData(undefined);
    setListingId('');
    setScope(next);
  }

  if (api.loading) return <main className="p-8">Checking session…</main>;
  if (!user) return <SignIn login={api.login} error={api.error} />;

  const scopes: Scope[] = [
    'farmer',
    ...(organizations.length ? ['organization' as const] : []),
    ...(admin ? ['admin' as const] : []),
  ];
  const maxDestination = Math.max(1, ...(data?.destinations.map((item) => item.kg) ?? []));
  return (
    <main className="min-h-screen bg-[#f6f7f1] text-[#182d25]">
      <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-8">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-950/15 pb-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <Sprout size={21} aria-hidden="true" /> CropCircle
          </Link>
          <nav className="flex flex-wrap items-center gap-4 text-sm font-medium">
            <a className="hover:underline" href="/marketplace">
              Marketplace
            </a>
            <a className="hover:underline" href="/map">
              Map
            </a>
            <a className="hover:underline" href="/collaboration">
              Collaboration
            </a>
            <Notifications request={request} socket={api.socket} />
            <button className="underline" onClick={() => void api.logout()}>
              Sign out
            </button>
          </nav>
        </header>
        <section className="flex flex-wrap items-end justify-between gap-5 rounded-2xl bg-[#163b2b] p-6 text-white sm:p-8">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Sustainability dashboard
            </h1>
            <p className="mt-2 max-w-xl text-sm text-emerald-100">
              Track where produce goes, what recipients are requesting, and how much surplus to plan
              for.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2" aria-label="Dashboard scope">
            {scopes.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={scope === value}
                onClick={() => {
                  if (value !== scope) switchScope(value);
                }}
                className={
                  'rounded-lg px-3 py-2 text-sm font-medium ' +
                  (scope === value
                    ? 'bg-white text-emerald-950'
                    : 'border border-white/40 hover:bg-white/10')
                }
              >
                {headings[value]}
              </button>
            ))}
          </div>
        </section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">{headings[scope]} overview</h2>
          <div className="flex flex-wrap items-center gap-3">
            {scope === 'organization' && (
              <select
                aria-label="Dashboard organization"
                className="rounded-lg border border-emerald-900/20 bg-white px-3 py-2 text-sm"
                value={organization}
                onChange={(event) => {
                  setData(undefined);
                  setListingId('');
                  setOrganization(event.target.value);
                }}
              >
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={refresh}
              className="rounded-lg border border-emerald-900/20 bg-white px-3 py-2 text-sm"
            >
              Refresh
            </button>
          </div>
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-900">
            {error}
          </p>
        )}
        {!data && !error && <p role="status">Loading dashboard…</p>}
        {data && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  label: 'Produce redistributed',
                  value: fmt(data.totals.redistributedKg) + ' kg',
                  detail: data.totals.redistributedBoxes
                    ? fmt(data.totals.redistributedBoxes) + ' boxes also recorded'
                    : 'Recorded fulfilled pickups',
                  icon: PackageCheck,
                },
                {
                  label: 'Estimated food waste avoided',
                  value: fmt(data.wasteEstimate.kg) + ' kg',
                  detail:
                    Math.round(data.wasteEstimate.factor * 100) +
                    '% of redistributed weight assumed at risk',
                  icon: Leaf,
                },
                {
                  label: 'Active listings',
                  value: fmt(data.totals.activeListings),
                  detail: 'Available produce listings',
                  icon: Sprout,
                },
                {
                  label: 'Farmer collaboration',
                  value: fmt(data.collaboration.issues),
                  detail:
                    data.collaboration.conversations +
                    ' chats · ' +
                    data.collaboration.groupPosts +
                    ' group posts',
                  icon: Users,
                },
              ].map(({ label, value, detail, icon: Icon }) => (
                <article className={panel} key={label}>
                  <Icon size={19} aria-hidden="true" className="mb-3 text-emerald-700" />
                  <p className="text-sm font-medium">{label}</p>
                  <p className="mt-1 text-3xl font-semibold tracking-tight">{value}</p>
                  <p className="mt-1 text-xs text-stone-600">{detail}</p>
                </article>
              ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <section className={panel}>
                <h3 className="text-lg font-semibold">Request fulfillment</h3>
                {(['DONATION', 'SALE'] as const).map((mode) => {
                  const row = data.fulfillment.find((entry) => entry.mode === mode);
                  const percentage = row ? (row.fulfilled / row.requests) * 100 : 0;
                  return (
                    <div key={mode} className="mt-4">
                      <p className="mb-1 flex justify-between gap-2 text-sm">
                        <strong>{mode === 'SALE' ? 'Sales' : 'Donations and free produce'}</strong>
                        <span>{row ? fmt(percentage) + '%' : 'No requests'}</span>
                      </p>
                      {row && (
                        <>
                          <progress
                            className="block w-full accent-emerald-700"
                            value={percentage}
                            max={100}
                            aria-label={mode + ' fulfillment'}
                          />
                          <p className="mt-1 text-xs text-stone-500">
                            {row.fulfilled} of {row.requests} submitted requests fulfilled
                          </p>
                        </>
                      )}
                    </div>
                  );
                })}
              </section>
              <section className={panel}>
                <h3 className="text-lg font-semibold">Recipient demand</h3>
                {data.demand.length ? (
                  <ul className="mt-3 space-y-2 text-sm">
                    {data.demand.map((item) => (
                      <li key={item.crop} className="flex justify-between gap-2">
                        <span className="capitalize">{item.crop}</span>
                        <span>
                          {fmt(item.pendingKg)} kg
                          {item.pendingBoxes ? ' + ' + fmt(item.pendingBoxes) + ' boxes' : ''} ·{' '}
                          {item.pendingRequests} pending
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-stone-600">
                    No pending requests for current listings.
                  </p>
                )}
              </section>
              <section className={panel}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-lg font-semibold">Where produce went</h3>
                  <a className="text-sm underline" href="/map">
                    Map <ArrowDownRight className="inline" size={14} />
                  </a>
                </div>
                {data.destinations.length ? (
                  <ul className="mt-3 space-y-3">
                    {data.destinations.map((item) => (
                      <li key={item.id}>
                        <p className="flex justify-between gap-2 text-sm">
                          <strong>{item.name}</strong>
                          <span>
                            {fmt(item.kg)} kg{item.boxes ? ' + ' + fmt(item.boxes) + ' boxes' : ''}
                          </span>
                        </p>
                        <div
                          aria-hidden="true"
                          className="my-1 h-2 overflow-hidden rounded bg-emerald-50"
                        >
                          <div
                            className="h-full rounded bg-emerald-600"
                            style={{ width: (100 * item.kg) / maxDestination + '%' }}
                          />
                        </div>
                        <p className="text-xs text-stone-500">
                          {item.lat.toFixed(3)}°, {item.lng.toFixed(3)}° · public recipient site
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-stone-600">
                    Fulfilled pickups with a public recipient site appear here.
                  </p>
                )}
              </section>
            </div>
            {scope !== 'admin' && data.listings.length > 0 && (
              <section className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-xl font-semibold">Recipient recommendations</h2>
                  <select
                    aria-label="Listing for recommendations"
                    className="rounded-lg border border-emerald-900/20 bg-white px-3 py-2 text-sm"
                    value={listingId}
                    onChange={(event) => setListingId(event.target.value)}
                  >
                    <option value="">Choose a listing</option>
                    {data.listings.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.cropName} · {item.organization.name}
                      </option>
                    ))}
                  </select>
                </div>
                {listingId && (
                  <RecommendationPanel
                    key={listingId}
                    listingId={listingId}
                    request={request}
                    json={api.json}
                  />
                )}
              </section>
            )}
          </>
        )}
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <BarChart3 size={22} aria-hidden="true" /> Forecasts and crop analysis
          </h2>
          <div className="grid gap-4 lg:grid-cols-3">
            <ForecastTool kind="SURPLUS" models={models} api={api} onComplete={refresh} />
            <ForecastTool
              key={scope + organization}
              kind="DEMAND"
              organizationId={scope === 'organization' ? organization : undefined}
              models={models}
              api={api}
              onComplete={refresh}
            />
            <ClassificationTool api={api} onComplete={refresh} />
          </div>
        </section>
        {data && <PredictionHistory rows={data.predictions} />}
        {scope === 'admin' && <ModelMonitoring models={models} monitoring={monitoring} />}
      </div>
    </main>
  );
}
