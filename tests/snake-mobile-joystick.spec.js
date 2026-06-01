const { test, expect } = require('@playwright/test');

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
});

test('mobile portrait uses a joystick instead of four direction buttons', async ({ page }) => {
  await page.goto('/snake/index.html');

  await expect(page.getByLabel('移动摇杆')).toBeVisible();
  await expect(page.getByRole('button', { name: '↑' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '←' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '→' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '↓' })).toHaveCount(0);
});

test('mobile portrait joystick thumb follows drag and recenters on release', async ({ page }) => {
  await page.goto('/snake/index.html');
  await page.getByRole('button', { name: '开始游戏' }).click();

  const joystick = page.getByLabel('移动摇杆');
  const start = await page.locator('#stick').boundingBox();
  const box = await joystick.boundingBox();
  expect(start).not.toBeNull();
  expect(box).not.toBeNull();

  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  await joystick.dispatchEvent('pointerdown', {
    pointerId: 1,
    pointerType: 'touch',
    clientX: centerX,
    clientY: centerY,
  });
  await joystick.dispatchEvent('pointermove', {
    pointerId: 1,
    pointerType: 'touch',
    clientX: centerX,
    clientY: centerY + 60,
  });

  await expect
    .poll(async () => {
      const dragged = await page.locator('#stick').boundingBox();
      return dragged.y;
    })
    .toBeGreaterThan(start.y + 20);

  await joystick.dispatchEvent('pointerup', {
    pointerId: 1,
    pointerType: 'touch',
    clientX: centerX,
    clientY: centerY + 60,
  });
  await expect
    .poll(async () => {
      const reset = await page.locator('#stick').boundingBox();
      return Math.abs(reset.y - start.y);
    })
    .toBeLessThan(2);
});
