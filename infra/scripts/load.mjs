import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

const api = new URL(process.env.STAGE8_API_URL ?? 'http://localhost:3001/api/v1');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(api.hostname), 'Use an isolated local demo stack');
const root = api.href.replace(/\/$/, '');

async function sample(path, count, concurrency, options) {
  const statuses = new Map();
  const durations = [];
  let index = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (index++ < count) {
      const start = performance.now();
      const response = await fetch(root + path, { ...options, signal: AbortSignal.timeout(15_000) });
      await response.arrayBuffer();
      statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
      durations.push(performance.now() - start);
    }
  }));
  durations.sort((a, b) => a - b);
  const p95 = Math.round(durations[Math.ceil(count * .95) - 1]);
  console.log(JSON.stringify({ path, count, concurrency, p95Ms: p95, statuses: Object.fromEntries(statuses) }));
  return { statuses, p95 };
}

const baseline = await sample('/health/ready', 60, 6);
assert.equal(baseline.statuses.get(200), 60);
assert.ok(baseline.p95 < 4000, 'Readiness p95 exceeded the local demo budget');
const stress = await sample('/map/filters', 280, 28);
assert.ok(stress.statuses.get(429) > 0, 'The distributed limiter did not shed excess requests');
assert.ok([...stress.statuses.keys()].every((status) => status === 401 || status === 429));
const recovered = await fetch(root + '/health/ready', { signal: AbortSignal.timeout(5000) });
assert.equal(recovered.status, 200);
