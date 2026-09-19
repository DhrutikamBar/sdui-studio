import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, role: 'admin' | 'reviewer' = 'admin') {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.getByLabel('Work email').fill(`e2e-${role}@example.test`);
  await page.getByLabel('Password').fill(`local-e2e-${role}-password`);
  await page.getByRole('button', { name: 'Sign in to Studio' }).click();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
}

async function newScreen(page: Page) {
  const menu = page.getByRole('button', { name: 'Open screen library' });
  await expect(menu).toBeVisible();
  await expect(page.locator('.sidebar')).toBeHidden();
  await menu.click();
  await expect(page.locator('.sidebar')).toHaveClass(/mobile-open/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(menu).toBeFocused();
  await menu.click();
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.locator('.sidebar > .new-screen').click();
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(menu).toBeVisible();
  await expect(page.getByRole('heading', { name: 'New screen' })).toBeVisible();
  await expect(page.locator('.home-next-step')).toContainText('Save a draft');
}

test('theme follows the system, persists a choice, and spans sign-in and editor', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Theme behavior only needs one browser viewport.');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await signIn(page);
  await expect(page.getByRole('button', { name: 'Switch to dark mode' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('saving shows a spinner until the server responds', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One viewport is enough to verify the request state.');
  await signIn(page);
  await newScreen(page);
  let releaseWrite: (() => void) | undefined;
  let requestStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => { requestStarted = resolve; });
  await page.route('**/api/screens/versions', async (route) => {
    await new Promise<void>((resolve) => { releaseWrite = resolve; requestStarted(); });
    await route.continue();
  });
  await page.getByRole('button', { name: 'Save draft' }).click();
  await started;
  const saving = page.getByRole('button', { name: 'Saving draft…' });
  await expect(saving).toHaveAttribute('aria-busy', 'true');
  await expect(saving.locator('.loading-spinner')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish version' })).toBeDisabled();
  releaseWrite?.();
  await expect(page.locator('.notice').first()).toContainText('Draft v1 saved');
  await expect(page.getByRole('button', { name: 'Save draft' })).toHaveAttribute('aria-busy', 'false');
});

test('Figma to JSON reviews generated content before changing the draft', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One viewport verifies the conversion review flow.');
  await signIn(page);
  await page.locator('.workspace-view-tabs button').filter({ hasText: 'Figma to JSON' }).click();
  await expect(page.getByRole('heading', { name: 'Figma to JSON' })).toBeVisible();
  await expect(page.getByLabel('Advanced document editor')).toBeHidden();
  await page.getByLabel('Figma URL or file key').fill('https://www.figma.com/design/AbCdEf123456/Wallet?node-id=1-2');
  await page.getByLabel('Figma access token').fill('test-token');
  await page.route('**/api/figma/convert', async (route) => {
    const input = route.request().postDataJSON();
    expect(input.file).toContain('AbCdEf123456');
    expect(input.accessToken).toBe('test-token');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      document: { type: 'column', children: [{ type: 'text', props: { value: 'Imported balance' } }] },
      warnings: [{ nodeName: 'Icon', message: 'Manual asset needed.' }],
      node: { name: 'Wallet', id: '1:2', type: 'FRAME' },
    }) });
  });
  await page.getByRole('button', { name: 'Convert design', exact: true }).click();
  await expect(page.locator('.import-review')).toContainText('Imported balance');
  await expect(page.locator('.import-review')).toContainText('Icon: Manual asset needed.');
  await expect(page.getByLabel('Figma access token')).toHaveValue('');
  await page.getByRole('button', { name: 'Apply to draft' }).click();
  await expect(page.getByLabel('Advanced document editor')).toHaveValue(/Imported balance/);
});

test('draft, preview, publish, and archive work at each viewport', async ({ page }, testInfo) => {
  const width = testInfo.project.use.viewport?.width ?? 1440;
  await signIn(page);
  await newScreen(page);

  if (width <= 620) await expect(page.locator('.mobile-publish-bar')).toBeVisible();
  else await expect(page.locator('.mobile-publish-bar')).toBeHidden();

  const screenName = `phase4-${testInfo.project.name}-${Date.now()}`;
  await page.getByLabel('Screen name').fill(screenName);
  await page.getByLabel('Route', { exact: true }).fill(screenName);
  const editor = page.getByLabel('Advanced document editor');
  await editor.fill(JSON.stringify({ type: 'column', children: [{ type: 'text', props: { value: 'First version' } }] }, null, 2));

  await page.locator('.workspace-view-tabs button').filter({ hasText: 'Preview' }).click();
  await page.getByRole('button', { name: 'Open mobile preview' }).click();
  const preview = page.getByRole('dialog', { name: 'Mobile screen preview' });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Standard wallet' })).toHaveCount(0);
  await preview.getByRole('button', { name: 'Error', exact: true }).click();
  await expect(preview.getByRole('button', { name: 'Error', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(preview).toBeHidden();
  await page.locator('.workspace-view-tabs button').filter({ hasText: 'Build' }).click();
  const graph = page.getByRole('region', { name: 'JSON graph' });
  await expect(graph).toBeVisible();
  await expect(graph.getByRole('button', { name: 'column', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open widgets' })).toBeVisible();
  await page.getByRole('button', { name: 'Open widgets' }).click();
  await expect(page.locator('.palette-grid button').filter({ hasText: '+ column' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Widgets' })).toBeHidden();
  await expect(graph).toBeVisible();
  const initialOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(initialOverflow).toBe(false);

  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.locator('.notice').first()).toContainText('Draft v1 saved');
  await page.getByRole('button', { name: 'Publish version' }).click();
  const publishDialog = page.getByRole('dialog', { name: `Publish ${screenName}` });
  await expect(publishDialog).toBeVisible();
  await expect(publishDialog.getByRole('button', { name: 'Publish version' })).toBeDisabled();
  await publishDialog.getByLabel(/I tested content, loading, empty, and error previews/).check();
  await publishDialog.getByLabel('Release note').fill('Automated release check');
  await publishDialog.getByRole('button', { name: 'Publish version' }).click();
  await expect(publishDialog).toBeHidden();
  await expect(page.locator('.notice').first()).toContainText('Published v2');

  await editor.fill(JSON.stringify({ type: 'column', children: [{ type: 'text', props: { value: 'Second version' } }] }, null, 2));
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.locator('.notice').first()).toContainText('Draft v3 saved. Published v2 remains live.');
  const libraryScreen = page.locator('.screen-link').filter({ hasText: screenName });
  await expect(libraryScreen).toContainText('Draft v3');
  await expect(libraryScreen).toContainText('Live v2');

  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await page.getByRole('button', { name: 'Open screen library' }).click();
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await expect(libraryScreen).toContainText('Archived');
  await libraryScreen.click();
  await expect(page.getByRole('button', { name: 'Restore screen' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore screen' }).click();
  await expect(libraryScreen).toContainText('Live v2');
  await page.getByRole('button', { name: 'Archive', exact: true }).click();

  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(hasHorizontalOverflow).toBe(false);
});

test('reviewers cannot save screen versions', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Role enforcement only needs one viewport.');
  await signIn(page, 'reviewer');
  await newScreen(page);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.locator('.notice').first()).toContainText('Your account cannot save screen versions.');
});


