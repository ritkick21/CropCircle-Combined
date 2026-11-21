import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const api = process.env.STAGE8_API_URL ?? 'http://localhost:3001/api/v1';
const mail = process.env.AUTH_TEST_MAIL_URL ?? 'http://localhost:8025';

async function codeFor(request: APIRequestContext, email: string) {
  let code = '';
  await expect
    .poll(
      async () => {
        const results = await request.get(mail + '/api/v1/search', {
          params: { query: 'to:' + email },
        });
        const [latest] = (await results.json()).messages ?? [];
        if (!latest) return false;
        const message = await request.get(mail + '/api/v1/message/' + latest.ID);
        code = (await message.json()).Text.match(/^([A-Za-z0-9_-]{43})\s*$/m)?.[1] ?? '';
        return Boolean(code);
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  return code;
}

async function verifiedAccount(request: APIRequestContext, displayName: string) {
  const email = `farmline-${randomUUID()}@example.invalid`;
  const password = randomUUID();
  expect((await request.post(api + '/auth/registrations', { data: { email } })).status()).toBe(202);
  expect(
    (
      await request.post(api + '/auth/email-verification', {
        data: { token: await codeFor(request, email), displayName, password },
      })
    ).status(),
  ).toBe(204);
  return { email, password };
}

async function signIn(page: Page, account: { email: string; password: string }) {
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'FarmLine crop help' })).toBeVisible();
}

test('grower registers, gets sourced guidance, shares a case, receives a reply and publishes a fix', async ({
  browser,
  page,
  request,
}) => {
  const db = process.env.FARMLINE_TEST_DATABASE_URL;
  test.skip(
    !db,
    'Set FARMLINE_TEST_DATABASE_URL to the local demo database to provision a test researcher.',
  );
  test.setTimeout(75_000);
  expect((await request.get(api + '/farmline')).status()).toBe(401);
  const reviewerName = 'FarmLine Test Researcher ' + randomUUID().slice(0, 8);
  const reviewer = await verifiedAccount(request, reviewerName);
  execFileSync(
    process.execPath,
    [
      '--import',
      './apps/api/node_modules/tsx/dist/loader.mjs',
      'apps/api/test/demo-role.ts',
      'RESEARCHER',
      reviewer.email,
    ],
    {
      env: { ...process.env, DATABASE_URL: db },
    },
  );
  const researcherContext = await browser.newContext();
  try {
    const researcher = await researcherContext.newPage();
    await researcher.goto(
      new URL('/farmline', process.env.STAGE8_WEB_URL ?? 'http://localhost:3000').href,
    );
    await signIn(researcher, reviewer);
    await expect(researcher.getByRole('heading', { name: 'Cases to review' })).toBeVisible();

    const grower = { email: `farmline-${randomUUID()}@example.invalid`, password: randomUUID() };
    await page.goto('/');
    await expect(page.locator('.site-logo img')).toBeVisible();
    await expect
      .poll(() =>
        page.locator('.site-logo img').evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBeGreaterThan(0);
    await page.getByRole('link', { name: 'Get crop help', exact: true }).click();
    await page.getByRole('link', { name: 'Create an account' }).click();
    await expect(page.getByRole('heading', { name: 'Create a CropCircle account' })).toBeVisible();
    await page.getByLabel('Email', { exact: true }).fill(grower.email);
    await page.getByRole('button', { name: 'Send verification email' }).click();
    await page.getByLabel('Verification code').fill(await codeFor(request, grower.email));
    await page.getByLabel('Display name').fill('FarmLine Test Grower');
    await page.getByLabel('Password', { exact: true }).fill(grower.password);
    await page.getByRole('button', { name: 'Verify email' }).click();
    await page.waitForURL('**/farmline');
    await signIn(page, grower);

    await page.getByRole('button', { name: 'Fill in a demo example' }).click();
    const crop = 'Sorghum ' + randomUUID().slice(0, 8);
    await page.getByLabel('Crop', { exact: true }).fill(crop);
    await page.getByRole('button', { name: 'Find help', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Check for sorghum aphids' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Agronomic Management Practices/ })).toBeVisible();
    await expect(page.getByText('Private case', { exact: true })).toBeVisible();
    await expect(researcher.getByRole('button', { name: new RegExp(crop) })).toHaveCount(0);
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(page.getByRole('heading', { name: 'Ask an expert' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      360,
    );
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByLabel('Who can review this?').selectOption({ label: reviewerName });
    await page.getByRole('button', { name: 'Share for review', exact: true }).click();

    await researcher.getByRole('button', { name: new RegExp(crop) }).click({ timeout: 15_000 });
    await expect(researcher.getByRole('heading', { name: crop, exact: true })).toBeVisible();
    await expect(
      researcher.getByLabel('Reply type').locator('option[value=TRIAL_OFFER]'),
    ).toHaveCount(0);
    const advice = 'Compare the underside of newer and older leaves and send photos.';
    await researcher.getByLabel('Your reply').fill(advice);
    await researcher.getByRole('button', { name: 'Send reply' }).click();
    await expect(page.getByText(advice, { exact: true })).toBeVisible({ timeout: 15_000 });

    const resolution = 'Scouted the borders and worked with extension to confirm the insects.';
    await page.getByLabel('What worked?').fill(resolution);
    await page.getByLabel('Share the crop and what worked with other growers.').check();
    await page.getByRole('button', { name: 'Mark resolved' }).click();
    await expect(page.getByText('Case resolved.', { exact: true })).toBeVisible();

    await researcher.reload();
    await researcher.getByRole('button', { name: 'Source library' }).click();
    await researcher.getByLabel('Search by crop or topic').fill(crop);
    await expect(researcher.getByText(resolution, { exact: true })).toBeVisible();
    await expect(researcher.getByText('Lubbock, TX', { exact: true })).toHaveCount(0);

    const sourceTitle = 'Sorghum field notes ' + crop;
    await researcher.getByLabel('Source title').fill(sourceTitle);
    await researcher.getByLabel('Crop', { exact: true }).fill(crop);
    await researcher
      .getByLabel('Source URL')
      .fill('https://example.org/farmline-test/' + randomUUID());
    await researcher
      .getByLabel('Summary', { exact: true })
      .fill('Local demo fixture for a sorghum reference.');
    await researcher.getByRole('button', { name: 'Add to library' }).click();
    await expect(researcher.getByRole('link', { name: sourceTitle })).toBeVisible();

    await researcher.getByRole('button', { name: 'Field trials' }).click();
    const trial = 'Test observation plot for ' + crop;
    await researcher.getByLabel('Trial title').fill(trial);
    await researcher.getByLabel('Crop', { exact: true }).fill('Sorghum');
    await researcher
      .getByLabel('Trial details')
      .fill('Observe insect counts on the field edge across several visits.');
    await researcher.getByRole('button', { name: 'Publish trial' }).click();
    await expect(researcher.getByRole('heading', { name: trial })).toBeVisible();
    await researcher
      .getByRole('listitem')
      .filter({ hasText: trial })
      .getByRole('button', { name: 'Remove trial' })
      .click();
    await expect(researcher.getByRole('heading', { name: trial })).toHaveCount(0);

    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Sustainability' })
      .click();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  } finally {
    await researcherContext.close();
  }
});
