const { test, expect } = require('@playwright/test');

test('sort direction persists after clicking a station', async ({ page }) => {
  await page.goto('http://localhost:8080');

  // Wait for data to load
  await page.waitForSelector('#ranking .station-row', { timeout: 15000 });

  // Click the descending sort button (↑)
  await page.click('#sort-desc');
  await page.waitForTimeout(500); // wait for re-render

  // Get first station's name in descending order
  const firstDesc = await page.locator('#ranking .station-row').first().getAttribute('data-id');
  console.log('First station (desc):', firstDesc);

  // Click on a station row (not the favorite button)
  await page.locator('#ranking .station-row').nth(2).click();
  await page.waitForTimeout(500); // wait for map animation/render

  // Check if sort is still descending (first station should still be the expensive one)
  const firstAfterClick = await page.locator('#ranking .station-row').first().getAttribute('data-id');
  console.log('First station after click:', firstAfterClick);

  // The bug: firstAfterClick != firstDesc (it reverts to asc)
  expect(firstAfterClick).toBe(firstDesc);
});