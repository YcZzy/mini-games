const { test, expect } = require('@playwright/test');

test('battle share reward is granted immediately on click', async ({ page }) => {
  test.setTimeout(30000);
  await page.goto('/zhaoyun-adou/index.html?cloud=off', { waitUntil: 'domcontentloaded' });
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
    return !!find(window.Laya && window.Laya.stage, 'playBtn');
  }, null, { timeout: 15000 });

  await page.evaluate(() => {
    const find = (root, name) => {
      if (!root) return null;
      if (root.name === name) return root;
      for (const child of root._children || root._childs || []) {
        const found = find(child, name);
        if (found) return found;
      }
      return null;
    };
    find(window.Laya.stage, 'playBtn').event(window.Laya.Event.CLICK);
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
    return !!find(window.Laya.stage, 'shovelAd');
  }, null, { timeout: 10000 });

  const rewardsGrantedSynchronously = await page.evaluate(() => {
    const find = (root, name) => {
      if (!root) return null;
      if (root.name === name) return root;
      for (const child of root._children || root._childs || []) {
        const found = find(child, name);
        if (found) return found;
      }
      return null;
    };
    const shareButton = find(window.Laya.stage, 'shovelAd');
    const battleScene = shareButton._events.click._items[1];

    battleScene.sw.map.ve = true;
    battleScene.sw.map.Se = false;
    battleScene.sw.player.hasUsedFreeShovel = true;
    shareButton.visible = true;
    shareButton.event(window.Laya.Event.CLICK);
    const shovelGranted = battleScene.sw.map.ve === false;

    battleScene.sw.map.Se = true;
    battleScene.sw.player.hasUsedFreeBulldozer = true;
    shareButton.visible = true;
    shareButton.event(window.Laya.Event.CLICK);
    const bulldozerGranted = battleScene.sw.map.Se === false;

    return { shovelGranted, bulldozerGranted };
  });

  expect(rewardsGrantedSynchronously).toEqual({
    shovelGranted: true,
    bulldozerGranted: true,
  });
});
