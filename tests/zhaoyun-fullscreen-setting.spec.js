const { test, expect } = require('@playwright/test');

test.use({
  viewport: { width: 390, height: 650 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
});

test('zhao yun settings include a fullscreen toggle', async ({ page }) => {
  test.setTimeout(30000);
  await page.addInitScript(() => {
    window.__fullscreenRequested = false;
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get() { return window.__fakeFullscreenElement || null; },
    });
    Element.prototype.requestFullscreen = function () {
      window.__fullscreenRequested = true;
      window.__fakeFullscreenElement = this;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    };
    document.exitFullscreen = function () {
      window.__fakeFullscreenElement = null;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    };
  });

  await page.goto('/zhaoyun-adou/index.html?cloud=off', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.Laya && window.Laya.stage && window.canvas, null, { timeout: 15000 });
  await page.evaluate(() => window.Laya.Scene.open('scene/SettingScene.ls'));
  await page.waitForFunction(() => window.__fullscreenToggleInjected === true, null, { timeout: 10000 });

  const initial = await page.evaluate(() => {
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
      hasToggle: !!findNode(window.Laya.stage, 'fullscreenBox'),
      labelText: findNode(window.Laya.stage, 'fullscreenLabel')?.text,
      checked: findNode(window.Laya.stage, 'fullscreenCheckOK')?.visible,
    };
  });

  expect(initial).toEqual({ hasToggle: true, labelText: '全屏模式', checked: false });

  const afterClick = await page.evaluate(async () => {
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
    findNode(window.Laya.stage, 'fullscreenBox').event(window.Laya.Event.CLICK);
    await new Promise((resolve) => setTimeout(resolve, 50));
    return {
      requested: window.__fullscreenRequested,
      pref: localStorage.getItem(window.__gameFullscreen.storageKey),
      checked: findNode(window.Laya.stage, 'fullscreenCheckOK').visible,
    };
  });

  expect(afterClick).toEqual({ requested: true, pref: '1', checked: true });
});
