import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, role: 'admin' | 'reviewer') {
  await page.goto('/');
  await page.getByLabel('Work email').fill(`e2e-${role}@example.test`);
  await page.getByLabel('Password').fill(`local-e2e-${role}-password`);
  await page.getByRole('button', { name: 'Sign in to Studio' }).click();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
}

async function openProjectGovernance(page: Page) {
  await page.getByRole('button', { name: 'Open screen library' }).click();
  await page.getByLabel('Active client project').selectOption('phase5-project');
  await page.getByRole('button', { name: 'Close screen library' }).click();
  await page.getByRole('button', { name: /Governance/ }).click();
  await expect(page.getByRole('heading', { name: 'Phase 5 test project members' })).toBeVisible();
}

test('an admin can add and remove an existing Studio member', async ({ page }, testInfo) => {
  test.skip(!['desktop', 'phone'].includes(testInfo.project.name), 'Check desktop and phone layouts.');
  await signIn(page, 'admin');
  await openProjectGovernance(page);
  const card = page.getByRole('region', { name: 'Project members' });
  await expect(card.locator('.project-member-row').filter({ hasText: 'e2e-admin@example.test' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Current admin' })).toBeDisabled();
  const designerRow = card.locator('.project-member-row').filter({ hasText: 'e2e-designer@example.test' });
  if (await designerRow.count()) {
    await designerRow.getByRole('button', { name: 'Remove from project' }).click();
    await expect(designerRow).toHaveCount(0);
  }

  await card.getByLabel('Studio member to add').selectOption('e2e-designer');
  await card.getByRole('button', { name: 'Add to project' }).click();
  await expect(designerRow).toBeVisible();
  await expect(page.getByText('e2e-designer@example.test added to Phase 5 test project.')).toBeVisible();
  await expect(page.locator('.audit-row').filter({ hasText: 'project member added' }).filter({ hasText: 'Phase 5 test project' }).first()).toBeVisible();
  await designerRow.getByRole('button', { name: 'Remove from project' }).click();
  await expect(designerRow).toHaveCount(0);
  await expect(page.getByText('e2e-designer@example.test removed from Phase 5 test project.')).toBeVisible();
  await expect(page.locator('.audit-row').filter({ hasText: 'project member removed' }).filter({ hasText: 'Phase 5 test project' }).first()).toBeVisible();
});

test('the server denies reviewer changes and admin self-removal', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Role enforcement only needs one viewport.');
  await signIn(page, 'reviewer');
  await openProjectGovernance(page);
  await expect(page.getByText('Only an active Studio admin who belongs to this project can change its members.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to project' })).toHaveCount(0);

  const auth = await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-emulator-key', {
    data: { email: 'e2e-reviewer@example.test', password: 'local-e2e-reviewer-password', returnSecureToken: true },
  });
  expect(auth.ok()).toBe(true);
  const { idToken } = await auth.json() as { idToken: string };
  const denied = await request.post('/api/projects/members', {
    headers: { Authorization: `Bearer ${idToken}` },
    data: { projectId: 'phase5-project', targetUid: 'e2e-designer', action: 'add' },
  });
  expect(denied.status()).toBe(403);

  const adminAuth = await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-emulator-key', {
    data: { email: 'e2e-admin@example.test', password: 'local-e2e-admin-password', returnSecureToken: true },
  });
  expect(adminAuth.ok()).toBe(true);
  const { idToken: adminToken } = await adminAuth.json() as { idToken: string };
  const selfRemoval = await request.post('/api/projects/members', {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { projectId: 'phase5-project', targetUid: 'e2e-admin', action: 'remove' },
  });
  expect(selfRemoval.status()).toBe(400);
});
