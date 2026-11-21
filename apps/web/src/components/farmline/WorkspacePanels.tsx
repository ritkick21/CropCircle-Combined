'use client';

import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import {
  farmCropMatches,
  farmReplyKinds,
  type FarmCase,
  type FarmlineWorkspace,
  type FarmReplyKind,
  type FarmResource,
} from '@cropcircle/shared-types';
import { ActionForm, field, formText, panel, secondary } from './forms';

type Mutate = (path: string, body: unknown, message: string, method?: string) => Promise<void>;
const replyLabel: Record<FarmReplyKind, string> = {
  ADVICE: 'Advice',
  TRIAL_OFFER: 'Field trial offer',
  SAMPLE_REQUEST: 'Sample request',
};
const resourceLabel: Record<FarmResource['kind'], string> = {
  GUIDE: 'Extension guide',
  FIELD_REPORT: 'Field report',
  RESEARCH: 'Research paper',
};
const title = 'font-serif text-2xl leading-tight';
const muted = 'text-sm text-[#435949]';

function ResourceLink({ resource }: { resource: FarmResource }) {
  return (
    <li className="space-y-1 py-2">
      <p className="text-xs font-semibold text-[#435949]">
        {resourceLabel[resource.kind]}
        {resource.publisher && ' · ' + resource.publisher}
      </p>
      <a
        className="inline-flex items-baseline gap-1 break-words font-semibold text-[#174531] underline [overflow-wrap:anywhere]"
        href={resource.url}
        target="_blank"
        rel="noreferrer"
      >
        {resource.title} <ArrowUpRight aria-hidden className="size-3 shrink-0" />
      </a>
      <p className={muted + ' break-words'}>{resource.summary}</p>
    </li>
  );
}

export function CaseCard({
  item,
  workspace,
  owner,
  mutate,
}: {
  item: FarmCase;
  workspace: FarmlineWorkspace;
  owner: boolean;
  mutate: Mutate;
}) {
  const path = '/farmline/cases/' + item.id;
  const matched = workspace.resources.filter((resource) =>
    farmCropMatches(item.crop, resource.crop),
  );
  const sources = item.guidance.sourceIds.flatMap((id) =>
    workspace.resources.filter((resource) => resource.id === id),
  );
  const related = matched.filter((resource) => !item.guidance.sourceIds.includes(resource.id));
  const fixes = workspace.fixes.filter(
    (fix) => fix.id !== item.id && farmCropMatches(item.crop, fix.crop),
  );
  const draft = [
    'Hello, could you help identify a crop problem?',
    'Crop: ' + item.crop,
    item.region && 'Region: ' + item.region,
    'Observations: ' + item.description,
    'What details or photos would help you confirm the cause?',
  ]
    .filter(Boolean)
    .join('\n\n');

  return (
    <div className="min-w-0 space-y-4">
      <article className={panel}>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="break-words font-serif text-3xl">{item.crop}</h2>
          <span className="rounded-full bg-[#edf0e4] px-3 py-1 text-xs font-semibold">
            {item.resolvedAt
              ? 'Resolved'
              : item.researcher
                ? 'Sent to ' + (item.researcher.displayName ?? 'a researcher')
                : item.sharedAt
                  ? 'Open for researcher review'
                  : 'Private case'}
          </span>
        </div>
        {(!owner || item.region) && (
          <p className={muted + ' mb-2'}>
            {[!owner && (item.grower.displayName ?? 'CropCircle grower'), item.region]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
        <p className="whitespace-pre-wrap break-words">{item.description}</p>
        {item.resolution && (
          <section className="mt-4 rounded-lg bg-[#edf1e5] p-3">
            <h3 className="font-semibold">What worked</h3>
            <p className="whitespace-pre-wrap break-words">{item.resolution}</p>
            {owner && item.publishFix && (
              <p className={muted + ' mt-2'}>Shared with the CropCircle community.</p>
            )}
          </section>
        )}
      </article>

      <section className={panel}>
        <h3 className={title}>{item.guidance.heading}</h3>
        <p className={muted + ' mt-2'}>{item.guidance.summary}</p>
        <h4 className="mt-4 font-semibold">What to do first</h4>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">
          {item.guidance.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        {sources.length > 0 && (
          <div className="mt-4 border-t pt-3">
            <h4 className="font-semibold">Sources for these steps</h4>
            <ul className="divide-y">
              {sources.map((resource) => (
                <ResourceLink key={resource.id} resource={resource} />
              ))}
            </ul>
          </div>
        )}
        {related.length > 0 && (
          <details className="mt-4 border-t pt-3">
            <summary className="cursor-pointer font-semibold">
              Related field reports and research
            </summary>
            <ul className="mt-2 divide-y">
              {related.map((resource) => (
                <ResourceLink key={resource.id} resource={resource} />
              ))}
            </ul>
          </details>
        )}
        {fixes.length > 0 && (
          <details className="mt-4 border-t pt-3">
            <summary className="cursor-pointer font-semibold">
              What worked for other growers
            </summary>
            <ul className="mt-2 divide-y">
              {fixes.map((fix) => (
                <li key={fix.id} className="whitespace-pre-wrap break-words py-2 text-sm">
                  {fix.resolution}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className={panel}>
        <h3 className={title}>Researcher replies</h3>
        <div aria-live="polite">
          {!item.replies.length && <p className={muted + ' mt-2'}>No replies yet.</p>}
          <ul className="mt-2 divide-y">
            {item.replies.map((reply) => (
              <li key={reply.id} className="py-3">
                <p className="font-semibold">
                  {replyLabel[reply.kind]}{' '}
                  <span className={muted + ' font-normal'}>
                    · {reply.author.displayName ?? 'CropCircle researcher'}
                  </span>
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words">{reply.body}</p>
              </li>
            ))}
          </ul>
        </div>
        {!owner && !item.resolvedAt && (
          <ActionForm
            reset
            submit={(data) =>
              mutate(
                path + '/replies',
                { kind: formText(data, 'kind'), body: formText(data, 'body') },
                'Reply sent.',
              )
            }
            label="Send reply"
          >
            <label className="block text-sm font-semibold">
              Reply type
              <select name="kind" className={field}>
                {farmReplyKinds
                  .filter((kind) => item.openToTrials || kind !== 'TRIAL_OFFER')
                  .map((kind) => (
                    <option key={kind} value={kind}>
                      {replyLabel[kind]}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block text-sm font-semibold">
              Your reply
              <textarea
                name="body"
                rows={3}
                className={field}
                minLength={5}
                maxLength={1500}
                required
              />
            </label>
          </ActionForm>
        )}
      </section>
      {owner && !item.resolvedAt && (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <section className={panel}>
            <h3 className={title}>Ask an expert</h3>
            {!item.sharedAt && (
              <ShareCase
                item={item}
                researchers={workspace.researchers}
                submit={(researcherId) =>
                  mutate(path + '/share', { researcherId }, 'Case shared for review.')
                }
              />
            )}
            <p className={muted + ' mt-4'}>
              <a
                className="font-semibold underline"
                href={workspace.extensionDirectory}
                target="_blank"
                rel="noreferrer"
              >
                Find your local extension office
              </a>
            </p>
            <details className="mt-2">
              <summary className="cursor-pointer text-sm font-semibold">
                Draft for an extension specialist
              </summary>
              <textarea
                aria-label="Draft for an extension specialist"
                className={field}
                rows={7}
                readOnly
                value={draft}
              />
            </details>
          </section>
          <section className={panel}>
            <h3 className={title + ' mb-3'}>Resolve this case</h3>
            <ActionForm
              label="Mark resolved"
              submit={(data) =>
                mutate(
                  path + '/solve',
                  { resolution: formText(data, 'resolution'), publishFix: data.has('publishFix') },
                  'Case resolved.',
                )
              }
            >
              <label className="block text-sm font-semibold">
                What worked?
                <textarea
                  name="resolution"
                  className={field}
                  rows={3}
                  minLength={5}
                  maxLength={1200}
                  required
                />
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="publishFix"
                  className="mt-0.5 size-4 accent-[#174531]"
                />{' '}
                Share the crop and what worked with other growers.
              </label>
            </ActionForm>
          </section>
        </div>
      )}
    </div>
  );
}

function ShareCase({
  item,
  researchers,
  submit,
}: {
  item: FarmCase;
  researchers: FarmlineWorkspace['researchers'];
  submit: (researcherId?: string) => Promise<void>;
}) {
  const ranked = researchers
    .map((person) => ({
      ...person,
      matches: person.trialCrops.some((crop) => farmCropMatches(crop, item.crop)),
    }))
    .sort((a, b) => Number(b.matches) - Number(a.matches));
  return (
    <div className="mt-3">
      <ActionForm
        label="Share for review"
        submit={(data) => submit(formText(data, 'researcher') || undefined)}
      >
        <label className="block text-sm font-semibold">
          Who can review this?
          <select name="researcher" className={field}>
            <option value="">Any CropCircle researcher</option>
            {ranked.map((person) => (
              <option key={person.id} value={person.id}>
                {person.displayName ?? 'CropCircle researcher'}
                {person.matches && ' · matching field trial'}
              </option>
            ))}
          </select>
        </label>
        <p className={muted}>
          Reviewers can see your name, report and replies. Use a city or county for the location.
        </p>
      </ActionForm>
    </div>
  );
}

export function Library({
  workspace,
  canReview,
  mutate,
}: {
  workspace: FarmlineWorkspace;
  canReview: boolean;
  mutate: Mutate;
}) {
  const [query, setQuery] = useState('');
  const search = query.trim().toLowerCase();
  const resources = workspace.resources.filter((item) =>
    [item.title, item.summary, item.crop, item.publisher ?? ''].some((value) =>
      value.toLowerCase().includes(search),
    ),
  );
  const fixes = workspace.fixes.filter((item) =>
    [item.crop, item.resolution].some((value) => value.toLowerCase().includes(search)),
  );
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <section className={panel}>
        <h2 className={title}>Source library</h2>
        <label className="mt-3 block text-sm font-semibold">
          Search by crop or topic
          <input
            type="search"
            className={field}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {!resources.length && <p className={muted + ' mt-3'}>No sources match your search.</p>}
        <ul className="mt-3 divide-y">
          {resources.map((item) => (
            <ResourceLink key={item.id} resource={item} />
          ))}
        </ul>
        {fixes.length > 0 && (
          <div className="mt-6 border-t pt-4">
            <h3 className={title}>Grower experiences</h3>
            <ul className="mt-2 divide-y">
              {fixes.map((item) => (
                <li key={item.id} className="py-2">
                  <p className="font-semibold">{item.crop}</p>
                  <p className="whitespace-pre-wrap break-words text-sm">{item.resolution}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      {canReview && (
        <section className={panel}>
          <h2 className={title + ' mb-3'}>Add a source</h2>
          <ActionForm
            reset
            label="Add to library"
            submit={(data) =>
              mutate(
                '/farmline/resources',
                {
                  title: formText(data, 'title'),
                  crop: formText(data, 'crop'),
                  kind: formText(data, 'kind'),
                  url: formText(data, 'url'),
                  summary: formText(data, 'summary'),
                },
                'Source added.',
              )
            }
          >
            <label className="block text-sm font-semibold">
              Source title
              <input name="title" className={field} minLength={4} maxLength={150} required />
            </label>
            <label className="block text-sm font-semibold">
              Crop
              <input name="crop" className={field} minLength={2} maxLength={80} required />
            </label>
            <label className="block text-sm font-semibold">
              Source type
              <select name="kind" className={field}>
                {Object.entries(resourceLabel).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-semibold">
              Source URL
              <input
                name="url"
                className={field}
                type="url"
                placeholder="https://"
                maxLength={600}
                required
              />
            </label>
            <label className="block text-sm font-semibold">
              Summary
              <textarea
                name="summary"
                className={field}
                rows={3}
                minLength={5}
                maxLength={500}
                required
              />
            </label>
          </ActionForm>
        </section>
      )}
    </div>
  );
}

export function Trials({
  workspace,
  canReview,
  userId,
  mutate,
}: {
  workspace: FarmlineWorkspace;
  canReview: boolean;
  userId: string;
  mutate: Mutate;
}) {
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState('');
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <section className={panel}>
        <h2 className={title}>Field trials</h2>
        {!workspace.trials.length && (
          <p className={muted + ' mt-3'}>Researchers haven’t listed any field trials yet.</p>
        )}
        {error && (
          <p role="alert" className="mt-2 text-sm text-red-800">
            {error}
          </p>
        )}
        <ul className="mt-3 divide-y">
          {workspace.trials.map((item) => (
            <li key={item.id} className="space-y-2 py-3">
              <p className={muted}>
                {item.crop} · {item.author.displayName ?? 'CropCircle researcher'}
              </p>
              <h3 className="break-words font-semibold">{item.title}</h3>
              <p className="whitespace-pre-wrap break-words text-sm">{item.description}</p>
              {item.author.id === userId && canReview && (
                <button
                  className={secondary}
                  disabled={!!removing}
                  onClick={async () => {
                    setRemoving(item.id);
                    setError('');
                    try {
                      await mutate(
                        '/farmline/trials/' + item.id,
                        undefined,
                        'Trial removed.',
                        'DELETE',
                      );
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : 'Unable to remove trial.');
                    } finally {
                      setRemoving('');
                    }
                  }}
                >
                  {removing === item.id ? 'Removing…' : 'Remove trial'}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
      {canReview && (
        <section className={panel}>
          <h2 className={title + ' mb-3'}>List a field trial</h2>
          <ActionForm
            reset
            label="Publish trial"
            submit={(data) =>
              mutate(
                '/farmline/trials',
                {
                  title: formText(data, 'title'),
                  crop: formText(data, 'crop'),
                  description: formText(data, 'description'),
                },
                'Trial published.',
              )
            }
          >
            <label className="block text-sm font-semibold">
              Trial title
              <input name="title" className={field} minLength={4} maxLength={120} required />
            </label>
            <label className="block text-sm font-semibold">
              Crop
              <input name="crop" className={field} minLength={2} maxLength={80} required />
            </label>
            <label className="block text-sm font-semibold">
              Trial details
              <textarea
                name="description"
                className={field}
                rows={4}
                minLength={5}
                maxLength={1200}
                required
              />
            </label>
          </ActionForm>
        </section>
      )}
    </div>
  );
}
