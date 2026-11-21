'use client';

import { useEffect, useState } from 'react';
import { type Api, type Job, waitForJob } from './jobs';

type Recipient = {
  id: string;
  name: string;
  capacity: number;
  allocation: number;
  score: number;
  distanceKm: number;
  travelMinutes: number;
  closedRequests: number;
  fulfillmentRateEstimate: number;
  method: 'RECIPIENT_PICKUP' | 'FARM_DROPOFF';
  factors: { demand: number; freshness: number };
};
type Plan = {
  reason?: string;
  recommendations: Recipient[];
  available: number;
  allocated: number;
  unallocated: number;
  unit: string;
  crop: string;
  deadline: string;
  startAt: string;
  evaluatedAt: string;
  dropoffRoute: { id: string; arrivalMinutes: number }[];
  dropoffRouteKm: number;
  separateDropoffTripsKm: number;
  expectedFulfilledEstimate: number;
};

const reasons: Record<string, string> = {
  no_eligible_recipients: 'No recipients meet the crop, storage, capacity, or pickup requirements.',
  listing_unavailable: 'This listing or pickup location is unavailable.',
  no_available_produce: 'There is no available quantity within the pickup and freshness window.',
  weight_required:
    'Use a listing in kilograms or pounds to compare quantity with recipient capacity.',
};

export function RecommendationPanel({ listingId, request, json }: Api & { listingId: string }) {
  const [plan, setPlan] = useState<Plan>();
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    const path = '/intelligence/listings/' + listingId + '/recommendations';
    async function load() {
      setBusy(true);
      setError('');
      try {
        const existing =
          revision === 0
            ? (await request<{ job: Job<Plan> | null }>(path, { signal: abort.signal })).job
            : null;
        const job = existing ?? (await json<Job<Plan>>(path, 'POST'));
        const completed = await waitForJob(job, request, abort.signal);
        if (!abort.signal.aborted) setPlan(completed.output);
      } catch (cause) {
        if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!abort.signal.aborted) setBusy(false);
      }
    }
    void load();
    return () => abort.abort();
  }, [listingId, request, json, revision]);

  return (
    <section
      aria-label="Recipient allocation"
      className="space-y-4 rounded-2xl border border-emerald-900/15 bg-emerald-50/70 p-5 text-emerald-950"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">
          Recipient allocation {plan?.crop && '· ' + plan.crop}
        </h3>
        <button
          type="button"
          disabled={busy}
          onClick={() => setRevision((v) => v + 1)}
          className="rounded-lg border border-emerald-800 px-3 py-1.5 text-sm font-medium disabled:opacity-40"
        >
          Recalculate
        </button>
      </div>
      {busy && (
        <p role="status" className="text-sm">
          Checking eligible recipients…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      )}
      {plan?.reason && <p className="text-sm">{reasons[plan.reason] ?? plan.reason}</p>}
      {!!plan?.recommendations.length && (
        <>
          <p className="text-sm">
            <strong>
              {plan.allocated} {plan.unit} proposed
            </strong>{' '}
            · {plan.unallocated} {plan.unit} unallocated · {plan.expectedFulfilledEstimate}{' '}
            {plan.unit} expected fulfilled
          </p>
          <p className="text-sm">
            Pickup by {new Date(plan.deadline).toLocaleString()}. Confirm availability with
            recipients. The plan is advisory and quantities remain available until reserved in the
            marketplace.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="border-b border-emerald-900/20">
                <tr>
                  <th className="pb-2">Recipient</th>
                  <th>Proposed / capacity</th>
                  <th>Distance · travel</th>
                  <th>Ranking</th>
                </tr>
              </thead>
              <tbody>
                {plan.recommendations.map((recipient) => (
                  <tr key={recipient.id} className="border-b border-emerald-900/10">
                    <th scope="row" className="py-2 pr-3 font-medium">
                      {recipient.name}
                      <span className="block text-xs font-normal">
                        {recipient.method === 'RECIPIENT_PICKUP'
                          ? 'Recipient pickup'
                          : 'Farm drop-off'}
                      </span>
                    </th>
                    <td>
                      {recipient.allocation} / {recipient.capacity} {plan.unit}
                    </td>
                    <td>
                      {recipient.distanceKm} km · ~{recipient.travelMinutes} min
                    </td>
                    <td>
                      <details>
                        <summary>{Math.round(recipient.score * 100)} / 100</summary>
                        <p>
                          Estimated fulfillment{' '}
                          {Math.round(recipient.fulfillmentRateEstimate * 100)}% ·{' '}
                          {recipient.closedRequests} closed requests
                        </p>
                        <p>
                          Demand {Math.round(recipient.factors.demand * 100)} / 100 · Freshness{' '}
                          {Math.round(recipient.factors.freshness * 100)} / 100
                        </p>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {plan.dropoffRoute.length > 0 && (
            <div className="space-y-1 text-sm">
              <p>
                <strong>Farm drop-off loop</strong> · ~{plan.dropoffRouteKm} km (
                {plan.separateDropoffTripsKm} km as separate round trips)
              </p>
              <ol className="list-decimal pl-5">
                {plan.dropoffRoute.map((stop) => (
                  <li key={stop.id}>
                    {plan.recommendations.find((r) => r.id === stop.id)?.name} ·{' '}
                    {stop.arrivalMinutes} min from departure
                  </li>
                ))}
              </ol>
            </div>
          )}
          <p className="text-xs">
            Travel estimates use public coordinates. Calculated{' '}
            {new Date(plan.evaluatedAt).toLocaleString()}.
          </p>
        </>
      )}
    </section>
  );
}
