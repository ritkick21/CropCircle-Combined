import { createApiClient } from '@cropcircle/api-client';
import type { ReadinessResponse } from '@cropcircle/shared-types';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const api = createApiClient({
    baseUrl: process.env.API_INTERNAL_URL ?? 'http://localhost:3001/api/v1',
  });

  try {
    const readiness = await api.health.ready();
    const result: ReadinessResponse = {
      status: readiness.status,
      service: 'web',
      timestamp: new Date().toISOString(),
      dependencies: { api: { status: readiness.status } },
    };
    return Response.json(result, {
      status: readiness.status === 'ok' ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    const result: ReadinessResponse = {
      status: 'unavailable',
      service: 'web',
      timestamp: new Date().toISOString(),
      dependencies: { api: { status: 'unavailable' } },
    };
    return Response.json(result, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
