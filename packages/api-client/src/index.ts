import type { HealthResponse, ReadinessResponse } from '@cropcircle/shared-types';

export interface ApiClientOptions {
  /** Base URL includes the API version prefix, for example http://localhost:3001/api/v1. */
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
}

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`CropCircle API request failed with HTTP ${status}`);
    this.name = 'ApiClientError';
  }
}

export function createApiClient({
  baseUrl,
  fetch: fetchImpl = globalThis.fetch,
}: ApiClientOptions) {
  const root = baseUrl.replace(/\/+$/, '');

  async function get<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetchImpl(`${root}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...init?.headers },
    });
    if (!response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = await response.text();
      }
      throw new ApiClientError(response.status, body);
    }
    return (await response.json()) as T;
  }

  return {
    health: {
      live: (init?: RequestInit) => get<HealthResponse>('/health/live', init),
      ready: (init?: RequestInit) => get<ReadinessResponse>('/health/ready', init),
    },
  };
}
