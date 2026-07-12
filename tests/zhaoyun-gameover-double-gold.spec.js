const { test, expect } = require('@playwright/test');

test('game over double gold is claimed immediately on click', async ({ page }) => {
  test.setTimeout(30000);
  await page.goto('/zhaoyun-adou/index.html?cloud=off', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.Laya && window.Laya.stage, null, { timeout: 15000 });

  await page.evaluate(() => {
    window.Laya.Scene.open('scene/GameOverScene.ls', true, {
      isWin: true,
      isPvp: false,
      rankChange: 0,
      gold: 10,
    });
  });

  await page.waitForFunction(() => {
    const find = (root, name) => {
      if (!root) return null;
      if (root.name === name) return root;
      for (const child of root._children || root._childs || []) {
        const found = find(child, name);
        if (found) return found;
      }
      return null;
    };
    return !!find(window.Laya.stage, 'getBtnAd');
  }, null, { timeout: 10000 });

  const handlerSource = await page.evaluate(() => {
    const find = (root, name) => {
      if (!root) return null;
      if (root.name === name) return root;
      for (const child of root._children || root._childs || []) {
        const found = find(child, name);
        if (found) return found;
      }
      return null;
    };
    const doubleGoldButton = find(window.Laya.stage, 'getBtnAd');
    const normalGoldButton = find(window.Laya.stage, 'getBtn');

    doubleGoldButton.visible = true;
    doubleGoldButton.mouseEnabled = true;
    normalGoldButton.mouseEnabled = true;

    const originalSetTimeout = window.setTimeout;
    window.setTimeout = (callback, delay, ...args) => {
      if (delay === 50) return 0;
      return originalSetTimeout(callback, delay, ...args);
    };
    const source = String(doubleGoldButton._events.click._items[0]);
    doubleGoldButton.event(window.Laya.Event.CLICK);
    window.setTimeout = originalSetTimeout;
    return source;
  });

  expect(handlerSource).not.toContain('sW[');
  await page.waitForTimeout(1200);
  const savedGold = await page.evaluate(() => JSON.parse(localStorage.getItem('playerData'))._gold);
  expect(savedGold).toBe(20);
});
