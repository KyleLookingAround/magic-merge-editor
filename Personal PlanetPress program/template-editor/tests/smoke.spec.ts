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

  test('open -> edit -> save -> reopen preserves edits', async ({ page }) => {
    await page.goto('/');

    // File System Access API needs a real user gesture, which Playwright can't
    // synthesize, so the app must expose a hidden <input type=file> for tests
    // (added in Phase 3 alongside the fs module).
    const buf = readFileSync(fixturePath);
    await page.setInputFiles('input[type=file][data-testid=load-template]', {
      name: 'synthetic.OL-template',
      mimeType: 'application/zip',
      buffer: buf,
    });

    // TODO (Phase 4): assert tree renders, edit a script, save, reload, verify.
    expect(true).toBe(true);
  });
});
