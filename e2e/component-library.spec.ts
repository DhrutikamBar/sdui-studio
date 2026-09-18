import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, role: 'admin' | 'reviewer' = 'admin') {
  await page.goto('/');
  await page.getByLabel('Work email').fill(`e2e-${role}@example.test`);
  await page.getByLabel('Password').fill(`local-e2e-${role}-password`);
  await page.getByRole('button', { name: 'Sign in to Studio' }).click();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
}

test('create, reuse, and archive a project component', async ({ page }, testInfo) => {
  test.skip(!['desktop', 'phone'].includes(testInfo.project.name), 'Desktop and phone cover the component workspace.');
  await signIn(page);
  await page.getByRole('button', { name: 'Open screen library' }).click();
  const sidebar = page.locator('.sidebar');
  await expect(sidebar.getByRole('button', { name: 'New Component' })).toBeVisible();
  await expect(sidebar.locator('.new-screen + .new-component')).toHaveCount(1);
  await sidebar.getByRole('button', { name: 'New Component' }).click();
  await expect(page.getByRole('heading', { name: 'New component' })).toBeVisible();
  await page.getByRole('button', { name: 'Card + product list' }).click();
  const name = `Product section ${testInfo.project.name} ${Date.now()}`;
  await page.getByLabel('Component name').fill(name);
  await page.getByLabel('Category').fill('Commerce');
  await page.getByLabel('Description', { exact: true }).fill('Header with product items');
  await page.getByRole('button', { name: 'Save component' }).click();
  await expect(page.locator('.component-feedback')).toContainText('saved to this project');
  await expect(page.locator('.saved-component').filter({ hasText: name })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
  await expect(page.locator('.saved-component-palette').getByRole('button', { name: new RegExp(name) })).toBeVisible();
  if (testInfo.project.name === 'desktop') {
    await page.getByRole('button', { name: 'Open screen library' }).click();
    await page.getByRole('button', { name: 'New client project' }).click();
    const projectName = `Component isolation ${Date.now()}`;
    await page.getByLabel('Project name').fill(projectName);
    await page.getByLabel('Android / iOS package name').fill('com.example.componentisolated');
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page.locator('.app-brand')).toContainText(projectName);
    await expect(page.locator('.saved-component-palette').getByRole('button', { name: new RegExp(name) })).toHaveCount(0);
    await page.getByRole('button', { name: 'Open screen library' }).click();
    await page.getByLabel('Active client project').selectOption('legacy');
    await expect(page.locator('.saved-component-palette').getByRole('button', { name: new RegExp(name) })).toBeVisible();
  }
  await page.locator('.saved-component-palette').getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByLabel('Advanced document editor')).toHaveValue(/Featured products/);
  await page.getByRole('button', { name: 'Save selected as component' }).click();
  await expect(page.getByRole('heading', { name: 'New component' })).toBeVisible();
  await expect(page.getByLabel('Advanced component JSON')).toHaveValue(/Featured products/);
  await page.locator('.saved-component').filter({ hasText: name }).getByRole('button', { name: 'Open' }).click();
  await page.getByRole('button', { name: 'Archive component' }).click();
  await expect(page.locator('.saved-component').filter({ hasText: name })).toHaveCount(0);
  await page.locator('.workspace-view-tabs button').filter({ hasText: 'Build' }).click();
  await expect(page.getByLabel('Advanced document editor')).toHaveValue(/Featured products/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
});

test('reviewers can browse but cannot save components', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One viewport checks role restrictions.');
  await signIn(page, 'reviewer');
  await page.getByRole('button', { name: 'Open screen library' }).click();
  await page.locator('.sidebar').getByRole('button', { name: 'New Component' }).click();
  await page.getByLabel('Component name').fill('Reviewer test');
  await expect(page.getByRole('button', { name: 'Save component' })).toBeDisabled();
  await expect(page.getByText('Reviewers can browse and insert components.')).toBeVisible();
});

