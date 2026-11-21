#!/usr/bin/env node

const endpoints = [
  { name: 'web', url: process.env.WEB_HEALTH_URL ?? 'http://localhost:3000/api/health' },
  {
    name: 'api',
    url: process.env.API_HEALTH_URL ?? 'http://localhost:3001/api/v1/health/ready',
  },
  { name: 'ml-service', url: process.env.ML_HEALTH_URL ?? 'http://localhost:8000/health/ready' },
];

let failed = false;
for (const endpoint of endpoints) {
  try {
    const response = await fetch(endpoint.url, { signal: AbortSignal.timeout(5000) });
    const body = await response.json();
    if (!response.ok || body.status !== 'ok') {
      failed = true;
      console.error(`${endpoint.name}: HTTP ${response.status} ${JSON.stringify(body)}`);
    } else {
      console.log(`${endpoint.name}: ok (${endpoint.url})`);
    }
  } catch (error) {
    failed = true;
    console.error(`${endpoint.name}: ${error.message}`);
  }
}

if (failed) process.exitCode = 1;
