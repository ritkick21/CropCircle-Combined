import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './infra/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: process.env.STAGE8_WEB_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
});
