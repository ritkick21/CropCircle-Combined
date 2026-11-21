import type { useCropCircleApi } from '../stage5/useCropCircleApi';

export type Api = Pick<ReturnType<typeof useCropCircleApi>, 'request' | 'json'>;
export type Job<T = unknown> = {
  id: string;
  kind: 'RECOMMENDATION' | 'SURPLUS' | 'DEMAND' | 'CLASSIFY' | 'SIMILARITY';
  status: 'QUEUED' | 'RUNNING' | 'COMPLETE' | 'FAILED';
  subjectId?: string;
  output?: T;
  modelVersion?: string;
  error?: string;
  createdAt: string;
};

export function pending(job: Job) {
  return job.status === 'QUEUED' || job.status === 'RUNNING';
}

export async function waitForJob<T>(job: Job<T>, request: Api['request'], signal?: AbortSignal) {
  for (let attempt = 0; pending(job) && attempt < 25 && !signal?.aborted; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    if (signal?.aborted) return job;
    job = await request<Job<T>>('/intelligence/jobs/' + job.id, { signal });
  }
  if (job.status === 'FAILED') throw new Error(job.error ?? 'Analysis failed');
  if (pending(job) && !signal?.aborted)
    throw new Error('Analysis is still queued. Check Sustainability for the result.');
  return job;
}
