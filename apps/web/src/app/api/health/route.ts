import type { HealthResponse } from '@cropcircle/shared-types';

export const dynamic = 'force-dynamic';

export function GET(): Response {
  const health: HealthResponse = {
    status: 'ok',
    service: 'web',
    timestamp: new Date().toISOString(),
  };
  return Response.json(health, { headers: { 'Cache-Control': 'no-store' } });
}
