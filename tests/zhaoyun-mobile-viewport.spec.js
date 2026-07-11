const { test, expect } = require('@playwright/test');

test.use({
  viewport: { width: 390, height: 650 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
});

test('zhao yun mobile viewport resize keeps bottom touch coordinates in stage', async ({ page }) => {
  test.setTimeout(30000);

  await page.goto('/zhaoyun-adou/index.html?cloud=off', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.Laya && window.Laya.stage && window.canvas, null, { timeout: 15000 });
  await page.waitForTimeout(1000);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(700);

  const resized = await page.evaluate(() => {
    const rect = window.canvas.getBoundingClientRect();
    return {
      rectHeight: rect.height,
      stageHeight: window.Laya.stage.height,
      expectedStageHeight: rect.height / (rect.width / window.Laya.stage.width),
      backButtonCount: document.querySelectorAll('#collection-back').length,
    };
  });

  expect(resized.backButtonCount).toBe(0);
  expect(resized.stageHeight).toBeGreaterThan(resized.expectedStageHeight - 2);

  await page.touchscreen.tap(195, 794);
  await page.waitForTimeout(100);

  const bottomTouch = await page.evaluate(() => ({
    mouseY: window.Laya.stage.mouseY,
    stageHeight: window.Laya.stage.height,
  }));

  expect(bottomTouch.mouseY).toBeLessThan(bottomTouch.stageHeight);
});
