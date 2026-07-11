const { test, expect } = require('@playwright/test');

test('weapon backpack back arrow returns to the main scene', async ({ page }) => {
  test.setTimeout(30000);
  await page.goto('/zhaoyun-adou/index.html?cloud=off', { waitUntil: 'domcontentloaded' });

  await page.waitForFunction(() => {
    const findNode = (root, name) => {
      if (!root) return null;
      if (root.name === name) return root;
      const children = root._children || root._childs || [];
      for (const child of children) {
        const found = findNode(child, name);
        if (found) return found;
      }
      return null;
    };
    const weaponBtn = findNode(window.Laya && window.Laya.stage, 'weaponBtn');
    return !!weaponBtn && weaponBtn.__featureUnlockPatched === true;
  }, null, { timeout: 15000 });

  await page.evaluate(() => {
    const findNode = (root, name) => {
      if (!root) return null;
      if (root.name === name) return root;
      const children = root._children || root._childs || [];
      for (const child of children) {
        const found = findNode(child, name);
        if (found) return found;
      }
      return null;
    };
    findNode(window.Laya.stage, 'weaponBtn').event(window.Laya.Event.CLICK);
  });

  await page.waitForFunction(() => {
    const findNode = (root, name) => {
      if (!root) return null;
      if (root.name === name) return root;
      const children = root._children || root._childs || [];
      for (const child of children) {
        const found = findNode(child, name);
        if (found) return found;
      }
      return null;
    };
    const backButton = findNode(window.Laya.stage, 'xBtn');
    return !!findNode(window.Laya.stage, 'weaponPanel')
      && !!backButton
      && backButton.__featureUnlockPatched === true
      && backButton.mouseEnabled === true;
  }, null, { timeout: 10000 });

  const backButtonPoint = await page.evaluate(() => {
    const findNode = (root, name) => {
      if (!root) return null;
      if (root.name === name) return root;
      const children = root._children || root._childs || [];
      for (const child of children) {
        const found = findNode(child, name);
        if (found) return found;
      }
      return null;
    };
    const backButton = findNode(window.Laya.stage, 'xBtn');
    const stagePoint = backButton.localToGlobal(
      new window.Laya.Point(backButton.width / 2, backButton.height / 2),
    );
    const canvasRect = document.querySelector('canvas').getBoundingClientRect();
    return {
      x: canvasRect.left + stagePoint.x / window.Laya.stage.width * canvasRect.width,
      y: canvasRect.top + stagePoint.y / window.Laya.stage.height * canvasRect.height,
    };
  });
  await page.mouse.click(backButtonPoint.x, backButtonPoint.y);

  await expect.poll(async () => page.evaluate(() => {
    const findNode = (root, name) => {
      if (!root) return null;
      if (root.name === name) return root;
      const children = root._children || root._childs || [];
      for (const child of children) {
        const found = findNode(child, name);
        if (found) return found;
      }
      return null;
    };
    return {
      weaponSceneOpen: !!findNode(window.Laya.stage, 'weaponPanel'),
      mainSceneVisible: !!findNode(window.Laya.stage, 'weaponBtn'),
    };
  }), { timeout: 3000 }).toEqual({
    weaponSceneOpen: false,
    mainSceneVisible: true,
  });
});
