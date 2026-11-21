import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const api = process.env.STAGE8_API_URL ?? 'http://localhost:3001/api/v1';
const mail = process.env.AUTH_TEST_MAIL_URL ?? 'http://localhost:8025';

test('grower signs in, changes workspace, keeps the session on reload, and signs out', async ({ page, request }) => {
  const email = `stage8-${randomUUID()}@example.invalid`;
  const password = randomUUID();
  expect((await request.post(api + '/auth/registrations', { data: { email } })).status()).toBe(202);
  let verification = '';
  await expect.poll(async () => {
    const response = await request.get(mail + '/api/v1/search', { params: { query: 'to:' + email } });
    const messages = (await response.json()).messages ?? [];
    if (messages.length === 0) return false;
    const message = await request.get(mail + '/api/v1/message/' + messages[0].ID);
    verification = (await message.json()).Text.match(/^([A-Za-z0-9_-]{43})\s*$/m)?.[1] ?? '';
    return Boolean(verification);
  }, { timeout: 10_000 }).toBe(true);
  expect((await request.post(api + '/auth/email-verification', {
    data: { token: verification, displayName: 'Demo Grower', password },
  })).status()).toBe(204);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A local market for what you grow.' })).toBeVisible();
  expect((await request.get(new URL('/harvest.webp', page.url()).href)).ok()).toBe(true);
  await page.getByRole('link', { name: 'Explore the marketplace' }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Surplus marketplace' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Sustainability' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to CropCircle' })).toBeVisible();
});

test('mobile navigation and workspace cards fit a narrow display', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Resource map Find nearby/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Resource map' }).click();
  await expect(page.getByRole('heading', { name: 'CropCircle resource map' })).toBeVisible();
});
