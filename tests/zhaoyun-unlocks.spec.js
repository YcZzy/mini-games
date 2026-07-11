const { test, expect } = require('@playwright/test');

test('zhao yun unlocks props and weapons immediately for old saves', async ({ page }) => {
  test.setTimeout(45000);
  const oldSave = {
    _gold: 0,
    _props: [],
    _weaponFragments: [],
    _openProps: false,
    _weaponFree: false,
    _consecutiveLoginDays: 1,
    _staminaAdCountToday: 3,
    _staminaShareCountToday: 2,
    _adPointShareCountToday: 1,
    _lastShareStaminaTime: 123456,
  };

  await page.goto('/zhaoyun-adou/index.html?cloud=off', { waitUntil: 'domcontentloaded' });
  await page.evaluate((save) => localStorage.setItem('playerData', JSON.stringify(save)), oldSave);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.wx && window.Laya, null, { timeout: 15000 });

  const sanitized = await page.evaluate(() => ({
    local: JSON.parse(localStorage.getItem('playerData')),
    wx: JSON.parse(window.wx.getStorageSync('playerData')),
  }));

  for (const save of [sanitized.local, sanitized.wx]) {
    expect(save._openProps).toBe(true);
    expect(save._weaponFree).toBe(true);
    expect(save._consecutiveLoginDays).toBeGreaterThanOrEqual(7);
    expect(save._staminaAdCountToday).toBe(0);
    expect(save._staminaShareCountToday).toBe(0);
    expect(save._adPointShareCountToday).toBe(0);
    expect(save._lastShareStaminaTime).toBe(0);
  }

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
    const shopBtn = findNode(window.Laya.stage, 'shopBtn');
    return !!shopBtn && shopBtn.visible === true && shopBtn.__featureUnlockPatched === true;
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
    findNode(window.Laya.stage, 'shopBtn').event(window.Laya.Event.CLICK);
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
    return !!findNode(window.Laya.stage, 'shopBg');
  }, null, { timeout: 10000 });

  await page.reload({ waitUntil: 'domcontentloaded' });
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
    const weaponBtn = findNode(window.Laya.stage, 'weaponBtn');
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
    return !!findNode(window.Laya.stage, 'weaponPanel');
  }, null, { timeout: 10000 });
});
