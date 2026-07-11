const { test, expect } = require('@playwright/test');

test('homepage links to zhao yun and a dou', async ({ page }) => {
  await page.goto('/');

  const link = page.getByRole('link', { name: '赵云与阿斗' });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', 'zhaoyun-adou/index.html');
});
