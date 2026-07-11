const { test, expect } = require('@playwright/test');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

test('zhao yun requires a player login, syncs saves, and uses only the browser leaderboard', async ({ page }) => {
  test.setTimeout(45000);
  const saveRequests = [];
  const legacyRankRequests = [];
  const legacyReportRequests = [];

  page.on('request', (request) => {
    if (/api01\.mihuangame\.com\/api\/v2\/zyyad\/game\/(country\/list|province\/detail\/list)/.test(request.url())) {
      legacyRankRequests.push(request.url());
    }
    if (/api01\.mihuangame\.com\/api\/v2\/zyyad\/game\/(start|end)(?:[/?#]|$)/.test(request.url())) {
      legacyReportRequests.push(request.url());
    }
  });

  await page.route('http://127.0.0.1:8787/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors, body: '' });
      return;
    }

    if (path === '/v1/auth/enter') {
      await route.fulfill({
        status: 201,
        headers: cors,
        body: JSON.stringify({
          ok: true,
          data: {
            token: 'test-token',
            player: { id: 'player-1', nickname: '测试赵云' },
            created: true,
            save: {
              save: {
                _nick: '测试赵云',
                _win: 3,
                _lose: 1,
                _curStar: 7,
                _saveTime: 100,
                _gold: 66,
              },
              revision: 1,
              gamesPlayed: 4,
              clientSaveTime: 100,
              updatedAt: 100,
            },
          },
        }),
      });
      return;
    }

    if (path === '/v1/save' && request.method() === 'PUT') {
      const body = request.postDataJSON();
      saveRequests.push(body.save);
      await route.fulfill({
        status: 200,
        headers: cors,
        body: JSON.stringify({
          ok: true,
          data: {
            save: {
              save: body.save,
              revision: saveRequests.length + 1,
              gamesPlayed: Number(body.save._win || 0) + Number(body.save._lose || 0),
              clientSaveTime: Number(body.save._saveTime || 0),
              updatedAt: Date.now(),
            },
          },
        }),
      });
      return;
    }

    if (path === '/v1/leaderboard') {
      await route.fulfill({
        status: 200,
        headers: cors,
        body: JSON.stringify({
          ok: true,
          data: {
            entries: [
              { position: 1, playerId: 'player-2', nickname: '阿斗', curStar: 20, rankId: 3, rankLevel: 5, wins: 8, losses: 2, updatedAt: 1, isCurrent: false },
              { position: 2, playerId: 'player-1', nickname: '测试赵云', curStar: 7, rankId: 1, rankLevel: 2, wins: 3, losses: 1, updatedAt: 2, isCurrent: true },
            ],
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      headers: cors,
      body: JSON.stringify({ ok: false, error: { code: 'not_found', message: 'not found' } }),
    });
  });

  await page.goto('/zhaoyun-adou/index.html', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '进入游戏' })).toBeVisible();
  await page.getByLabel('玩家昵称').fill('测试赵云');
  await page.getByLabel('云存档 PIN').fill('1234');
  await page.getByRole('button', { name: '进入游戏' }).click();

  await page.waitForFunction(() => window.Laya && window.Laya.stage && window.ZhaoCloud, null, { timeout: 20000 });
  await page.waitForFunction(() => {
    const findNode = (root, name) => {
      if (!root) return null;
      if (root.name === name) return root;
      for (const child of root._children || []) {
        const found = findNode(child, name);
        if (found) return found;
      }
      return null;
    };
    return findNode(window.Laya.stage, 'rankBtn')?.__browserCloudRankPatched === true;
  }, null, { timeout: 15000 });

  const loadedSave = await page.evaluate(() => JSON.parse(localStorage.getItem('playerData')));
  expect(loadedSave._nick).toBe('测试赵云');
  expect(loadedSave._gold).toBe(66);

  await page.evaluate(() => {
    const save = JSON.parse(localStorage.getItem('playerData'));
    save._gold = 99;
    save._saveTime = Date.now();
    localStorage.setItem('playerData', JSON.stringify(save));
  });
  await expect.poll(() => saveRequests.some((save) => save._gold === 99), { timeout: 5000 }).toBe(true);

  await page.evaluate(() => {
    const findNode = (root, name) => {
      if (!root) return null;
      if (root.name === name) return root;
      for (const child of root._children || []) {
        const found = findNode(child, name);
        if (found) return found;
      }
      return null;
    };
    findNode(window.Laya.stage, 'rankBtn').event(window.Laya.Event.CLICK);
  });

  await expect(page.getByRole('heading', { name: '总排行榜' })).toBeVisible();
  await expect(page.locator('.zhao-rank-row')).toHaveCount(2);
  await expect(page.locator('.zhao-rank-row.is-current')).toContainText('测试赵云（我）');
  expect(legacyRankRequests).toEqual([]);

  const blockedReport = await page.evaluate(() => new Promise((resolve, reject) => {
    window.wx.request({
      url: 'https://api01.mihuangame.com/api/v2/zyyad/game/start',
      method: 'GET',
      success: resolve,
      fail: reject,
    });
  }));
  expect(blockedReport).toMatchObject({ statusCode: 200 });
  expect(legacyReportRequests).toEqual([]);

  const oldRankSceneExists = await page.evaluate(() => {
    const walk = (node) => {
      if (!node) return false;
      if (String(node.url || node._url || '').includes('RankScene')) return true;
      return (node._children || []).some(walk);
    };
    return walk(window.Laya.stage);
  });
  expect(oldRankSceneExists).toBe(false);
});
