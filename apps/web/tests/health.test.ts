import { describe, expect, it } from 'vitest';

import { GET } from '../src/app/api/health/route';

describe('web health route', () => {
  it('reports a healthy web process without caching', async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      status: 'ok',
      service: 'web',
      timestamp: expect.any(String),
    });
  });
});
