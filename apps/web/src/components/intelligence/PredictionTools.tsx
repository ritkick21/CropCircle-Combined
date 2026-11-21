'use client';

import { useState, type FormEvent } from 'react';
import { type Api, type Job, waitForJob } from './jobs';

type Estimate = {
  crop: string;
  source?: string;
  estimate?: number;
  low?: number;
  high?: number;
  unit?: string;
  period?: string | number;
  weather?: string;
  status?: string;
};
type Assessment = {
  assessment: 'AI_HYPOTHESIS' | 'INSUFFICIENT_EVIDENCE';
  hypotheses: { category: string; score: number }[];
  photoAnalyzed: boolean;
  cropInTraining: boolean;
  photoSignal?: string;
  similarLabeledExamples?: { condition: string; similarity: number }[];
};
export type Models = {
  version: string;
  runId: string;
  surplusCrops: string[];
  demandProxyCrops: string[];
  platformDemandModel: boolean;
  evaluation: Record<string, Record<string, number | string>>;
};

const input = 'w-full rounded-lg border border-emerald-900/20 bg-white px-3 py-2 text-sm';
const action =
  'rounded-lg bg-emerald-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';
const options = [
  ['priorAcreage', 'Previous acreage'],
  ['priorHarvestKg', 'Previous harvest (kg)'],
  ['priorSurplusKg', 'Previous unutilized crop (kg)'],
  ['spring_temp_f', 'Spring average (°F)'],
  ['summer_temp_f', 'Summer average (°F)'],
  ['spring_rain_in', 'Spring rain (in)'],
  ['summer_rain_in', 'Summer rain (in)'],
] as const;
const categoryLabels: Record<string, string> = {
  DISEASE: 'Possible crop disease',
  PEST: 'Possible pest damage',
  NUTRIENT: 'Possible nutrient deficiency',
  HEALTHY: 'No visible stress detected by the photo model',
};

export function ForecastTool({
  kind,
  organizationId,
  models,
  api,
  onComplete,
}: {
  kind: 'SURPLUS' | 'DEMAND';
  organizationId?: string;
  models?: Models;
  api: Api;
  onComplete: () => void;
}) {
  const surplus = kind === 'SURPLUS';
  const crops = (surplus ? models?.surplusCrops : models?.demandProxyCrops) ?? [
    'apple',
    'grape',
    'pear',
  ];
  const [result, setResult] = useState<Estimate>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const numeric = ['acreage', ...options.map(([key]) => key)].flatMap((key) => {
      const value = fields.get(key);
      return value ? [[key, Number(value)]] : [];
    });
    setBusy(true);
    setError('');
    setResult(undefined);
    try {
      const job = await api.json<Job<Estimate>>('/intelligence/forecasts', 'POST', {
        kind,
        crop: fields.get('crop'),
        organizationId,
        ...Object.fromEntries(numeric),
      });
      const finished = await waitForJob(job, api.request);
      setResult(finished.output);
      onComplete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="space-y-3 rounded-2xl border border-emerald-900/15 bg-white p-5">
      <h3 className="text-lg font-semibold">
        {surplus ? 'Crop surplus forecast' : 'Recipient demand forecast'}
      </h3>
      <p className="text-sm text-stone-600">
        {surplus
          ? 'Estimate a season’s unutilized crop using historical U.S. harvests and growing-season weather.'
          : 'Forecast requested produce when local history is available. The public baseline estimates U.S. fresh availability.'}
      </p>
      <form onSubmit={(event) => void submit(event)} className="space-y-3">
        <div className={surplus ? 'grid grid-cols-2 gap-3' : ''}>
          <label className="space-y-1 text-sm font-medium">
            Crop
            {surplus ? (
              <select className={input} name="crop" defaultValue="apple" aria-label="Surplus crop">
                {crops.map((crop) => (
                  <option key={crop} value={crop}>
                    {crop}
                  </option>
                ))}
              </select>
            ) : (
              <input
                required
                className={input}
                aria-label="Demand crop"
                name="crop"
                list="demand-crops"
                defaultValue="apple"
              />
            )}
            {!surplus && (
              <datalist id="demand-crops">
                {crops.map((crop) => (
                  <option key={crop} value={crop} />
                ))}
              </datalist>
            )}
          </label>
          {surplus && (
            <label className="space-y-1 text-sm font-medium">
              Acres
              <input
                className={input}
                required
                name="acreage"
                type="number"
                min="0.01"
                step="any"
                defaultValue="5"
              />
            </label>
          )}
        </div>
        {surplus && (
          <details className="text-sm">
            <summary className="cursor-pointer">Add farm history and weather</summary>
            <div className="mt-2 grid grid-cols-2 gap-3">
              {options.map(([key, label]) => (
                <label className="space-y-1" key={key}>
                  {label}
                  <input className={input} name={key} type="number" step="any" />
                </label>
              ))}
            </div>
          </details>
        )}
        <button className={action} disabled={busy}>
          {busy ? 'Forecasting…' : surplus ? 'Forecast surplus' : 'Forecast demand'}
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      )}
      {result && (
        <div role="status" className="space-y-1 rounded-lg bg-emerald-50 p-3 text-sm">
          {result.estimate === undefined ? (
            <p>No supported forecast for this crop with the available history.</p>
          ) : (
            <>
              <p className="font-semibold">
                {result.period} estimate · {result.estimate.toLocaleString()} {result.unit}
              </p>
              <p>
                Estimated range {result.low?.toLocaleString()}–{result.high?.toLocaleString()} (80%
                target coverage)
              </p>
              <p>
                {result.source}
                {result.weather ? ' · ' + result.weather : ''}
              </p>
            </>
          )}
        </div>
      )}
    </article>
  );
}

export function ClassificationTool({ api, onComplete }: { api: Api; onComplete: () => void }) {
  const [result, setResult] = useState<Assessment>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const photo = fields.get('photo');
    if (photo instanceof File && photo.size > 3_000_000) {
      setError('Choose a photo under 3 MB.');
      return;
    }
    if (photo instanceof File && !photo.size) fields.delete('photo');
    setBusy(true);
    setResult(undefined);
    setError('');
    try {
      const job = await api.request<Job<Assessment>>('/intelligence/classification', {
        method: 'POST',
        body: fields,
      });
      const finished = await waitForJob(job, api.request);
      setResult(finished.output);
      onComplete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="space-y-3 rounded-2xl border border-emerald-900/15 bg-white p-5">
      <h3 className="text-lg font-semibold">Crop issue hypotheses</h3>
      <p className="text-sm text-stone-600">
        Describe symptoms and optionally include a leaf photo. A qualified expert can verify the
        diagnosis.
      </p>
      <form className="space-y-3" onSubmit={(event) => void submit(event)}>
        <label className="block space-y-1 text-sm font-medium">
          Crop
          <input className={input} name="crop" required maxLength={120} />
        </label>
        <label className="block space-y-1 text-sm font-medium">
          Symptoms
          <textarea
            className={input}
            name="symptoms"
            required
            minLength={10}
            maxLength={2000}
            rows={3}
            placeholder="Where on the plant did the symptoms appear? What changed?"
          />
        </label>
        <label className="block space-y-1 text-sm font-medium">
          Leaf photo (optional)
          <input
            className="block max-w-full text-sm"
            type="file"
            name="photo"
            accept="image/jpeg,image/png,image/webp"
          />
        </label>
        <button className={action} disabled={busy}>
          {busy ? 'Analyzing…' : 'Analyze symptoms'}
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      )}
      {result && (
        <div role="status" className="space-y-1 rounded-lg bg-amber-50 p-3 text-sm">
          <strong>
            {result.assessment === 'AI_HYPOTHESIS'
              ? 'Unverified AI hypotheses'
              : 'Insufficient evidence for a hypothesis'}
          </strong>
          {result.hypotheses.map((row) => (
            <p key={row.category}>
              {categoryLabels[row.category] ?? row.category} · score {row.score.toFixed(2)}
            </p>
          ))}
          {!!result.hypotheses.length && (
            <p>Scores are uncalibrated. Consult an agricultural expert before treatment.</p>
          )}
          {!!result.similarLabeledExamples?.length && (
            <p>
              Similar labeled examples:{' '}
              {result.similarLabeledExamples.map((row) => row.condition).join(', ')}.
            </p>
          )}
          {result.photoAnalyzed && (
            <p>
              Experimental photo signal: {categoryLabels[result.photoSignal ?? ''] ?? 'unclear'}.
              Performance on new crops is limited.
            </p>
          )}
          {!result.cropInTraining && <p>The submitted crop was outside the training examples.</p>}
        </div>
      )}
    </article>
  );
}
