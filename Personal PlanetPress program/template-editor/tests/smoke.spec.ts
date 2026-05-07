import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, '../fixtures/synthetic.OL-template');

test('app boots', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('header h1')).toHaveText('PlanetPress Template Editor');
});

test.describe('round-trip via synthetic fixture', () => {
  test.skip(
    !existsSync(fixturePath),
    'fixtures/synthetic.OL-template missing — generated in Phase 4',
  );

  test('open -> scripts panel shows 3 scripts', async ({ page }) => {
    await page.goto('/');

    // File System Access API needs a real user gesture, which Playwright can't
    // synthesize, so the app exposes a hidden <input type=file> for tests.
    const buf = readFileSync(fixturePath);
    await page.setInputFiles('input[type=file][data-testid=load-template]', {
      name: 'synthetic.OL-template',
      mimeType: 'application/zip',
      buffer: buf,
    });

    // Wait for the tree panel to appear (loading complete)
    await expect(page.locator('#tree-panel')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#tree-title')).toHaveText('synthetic.OL-template');

    // Switch to Scripts mode
    await page.click('#mode-scripts');

    // Three scripts should render (CustomerName / ShowIfActive / PageController)
    await expect(page.locator('.script-item')).toHaveCount(3, { timeout: 10_000 });

    // Verify each script is listed
    await expect(page.locator('.script-item').filter({ hasText: 'CustomerName' })).toBeVisible();
    await expect(page.locator('.script-item').filter({ hasText: 'ShowIfActive' })).toBeVisible();
    await expect(page.locator('.script-item').filter({ hasText: 'PageController' })).toBeVisible();
  });

  test('edit a script and verify it serialises back', async ({ page }) => {
    await page.goto('/');

    const buf = readFileSync(fixturePath);
    await page.setInputFiles('input[type=file][data-testid=load-template]', {
      name: 'synthetic.OL-template',
      mimeType: 'application/zip',
      buffer: buf,
    });

    await expect(page.locator('#tree-panel')).toBeVisible({ timeout: 15_000 });

    // Switch to Scripts, open CustomerName form
    await page.click('#mode-scripts');
    await expect(page.locator('.script-item[data-script-id]').filter({ hasText: 'CustomerName' })).toBeVisible({ timeout: 10_000 });
    await page.click('.script-item[data-script-id]:has-text("CustomerName")');

    // Script form should open
    await expect(page.locator('#script-form-view')).toHaveClass(/show/, { timeout: 5_000 });
    await expect(page.locator('#sf-name')).toHaveValue('CustomerName');

    // Edit the name
    await page.fill('#sf-name', 'CustomerNameEdited');
    await page.click('#sf-apply');

    // The scripts list should reflect the rename (use [data-script-id] to exclude the recent-scripts strip)
    await expect(page.locator('.script-item[data-script-id]').filter({ hasText: 'CustomerNameEdited' })).toBeVisible({ timeout: 5_000 });
  });
});
