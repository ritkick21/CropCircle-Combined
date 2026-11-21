const api = process.env.STAGE8_API_URL ?? 'http://localhost:3001/api/v1';
const web = process.env.STAGE8_WEB_URL ?? 'http://localhost:3000';
const ml = process.env.STAGE8_ML_URL ?? 'http://localhost:8000';

test('health and dependency contracts identify PostgreSQL, PostGIS, Redis and FastAPI', async () => {
  const response = await fetch(api + '/health/ready');
  expect(response.status).toBe(200);
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  const body = await response.json();
  expect(body).toMatchObject({ service: 'api', status: 'ok' });
  expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  for (const dependency of ['postgresql', 'postgis', 'redis', 'mlService']) {
    expect(body.dependencies[dependency]?.status).toBe('ok');
  }
  const dependency = await fetch(web + '/api/dependencies');
  expect(dependency.status).toBe(200);
  expect(await dependency.json()).toMatchObject({ service: 'web', status: 'ok' });
});

test('private resources and internal model metadata require authentication', async () => {
  const response = await fetch(api + '/map/markers?west=-180&east=180&south=-90&north=90');
  expect(response.status).toBe(401);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect((await fetch(ml + '/v1/models')).status).toBe(403);
});

test('request schema rejects unknown fields and cookie endpoints validate browser origin', async () => {
  const invalid = await fetch(api + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@example.invalid', password: 'demo fixture', roles: ['ADMIN'] }),
  });
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toMatchObject({ statusCode: 400 });
  const foreign = await fetch(api + '/auth/refresh', {
    method: 'POST', headers: { Origin: 'https://other.example.invalid' },
  });
  expect(foreign.status).toBe(403);
});
