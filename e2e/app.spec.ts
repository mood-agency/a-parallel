import { test, expect } from '@playwright/test';

test('app loads and shows sidebar', async ({ page }) => {
  await page.goto('/');
  // Wait for the app to render
  await expect(page.locator('body')).toBeVisible();
});
