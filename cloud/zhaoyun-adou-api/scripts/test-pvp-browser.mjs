import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const config = resolve(root, 'cloud/zhaoyun-adou-api/wrangler.jsonc');
const wrangler = resolve(root, 'node_modules/.bin/wrangler');
const state = await mkdtemp(resolve(tmpdir(), 'zhaoyun-pvp-browser-'));
const workerPort = 8787;
const webPort = 4175;
const gameUrl = `http://127.0.0.1:${webPort}/zhaoyun-adou/index.html`;
const forceRelay = process.env.PVP_FORCE_RELAY !== '0';
let worker;
let webServer;
let browser;

function runWrangler(args) {
  const result = spawnSync(wrangler, args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`);
}

async function waitFor(url, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Service did not become ready: ${url}`);
}

async function login(page, nickname, pin) {
  await page.goto(gameUrl, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('玩家昵称').fill(nickname);
  await page.getByLabel('云存档 PIN').fill(pin);
  await page.getByRole('button', { name: '进入游戏' }).click();
  await page.waitForFunction(
    () => window.Laya && window.Laya.stage && document.querySelector('#zhao-pvp-entry:not([hidden])'),
    null,
    { timeout: 30000 },
  );
}

async function configureSave(page, values) {
  return page.evaluate(async (settings) => {
    const wasTemporary = ZhaoCloud.getState().temporarySaveMode;
    ZhaoCloud.setTemporarySaveMode(true);
    try {
      const save = ZhaoCloud.getLocalSave();
      Object.assign(save, settings, { _saveTime: Date.now() });
      ZhaoCloud.replaceLocalSave(save);
      const result = await ZhaoCloud.request('/v1/save', { method: 'PUT', body: { save } });
      if (result?.save?.save) ZhaoCloud.replaceLocalSave(result.save.save);
      return ZhaoCloud.getLocalSave();
    } finally {
      ZhaoCloud.setTemporarySaveMode(wasTemporary);
    }
  }, values);
}

try {
  runWrangler([
    'd1', 'migrations', 'apply', 'DB', '--local',
    '--config', config, '--persist-to', state,
  ]);
  worker = spawn(
    wrangler,
    ['dev', '--config', config, '--port', String(workerPort), '--ip', '127.0.0.1', '--persist-to', state],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  webServer = spawn('python3', ['-m', 'http.server', String(webPort), '--bind', '127.0.0.1'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await Promise.all([
    waitFor(`http://127.0.0.1:${workerPort}/health`),
    waitFor(`http://127.0.0.1:${webPort}/`),
  ]);

  browser = await chromium.launch({ headless: true });
  const hostContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await Promise.all([
    hostContext.addInitScript((enabled) => { window.ZHAOYUN_PVP_FORCE_RELAY = enabled; }, forceRelay),
    guestContext.addInitScript((enabled) => { window.ZHAOYUN_PVP_FORCE_RELAY = enabled; }, forceRelay),
  ]);
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const errors = [];
  for (const [label, page] of [['host', host], ['guest', guest]]) {
    page.on('pageerror', (error) => errors.push(`${label}: ${error.stack || error.message}`));
    page.on('console', (message) => {
      if (
        message.type() === 'error' &&
        !/share_v2|401|CORS|Failed to load resource|本局对手强度预估/.test(message.text())
      ) {
        errors.push(`${label} console: ${message.text()}`);
      }
    });
  }

  await Promise.all([
    login(host, '主公测试', '2468'),
    login(guest, '好友测试', '1357'),
  ]);
  // 战斗栏最多容纳 2 个主动道具和 6 个被动道具；二维项表示 [道具 ID, 等级]。
  const configuredSaves = await Promise.all([
    configureSave(host, {
      _curStar: 17,
      _lastStar: 17,
      _win: 7,
      _lose: 3,
      _equip: [10, 10, 10, 20, 0, 20, 20, 10, 31, 31, 31, 0],
      _props: [[2, 2], [3, 2], 11, 12, 13],
      _lowPrProps: [0, 1, 2],
    }),
    configureSave(guest, {
      _curStar: 43,
      _lastStar: 43,
      _win: 11,
      _lose: 5,
      _equip: [19, 19, 19, 29, 9, 29, 29, 19, 43, 43, 43, 9],
      _props: [[4, 2], [5, 2], 14, 15, 16],
      _lowPrProps: [3, 4, 5],
    }),
  ]);
  await host.locator('#zhao-pvp-entry').click();
  await host.getByRole('button', { name: '创建好友房间' }).click();
  await host.waitForURL(/\?pvp=\d{6}/, { timeout: 20000 });
  const code = new URL(host.url()).searchParams.get('pvp');
  assert.match(code, /^\d{6}$/);
  await host.waitForFunction(() => window.ZhaoPvp?.getState().connected === true, null, { timeout: 30000 });

  await guest.goto(`${gameUrl}?pvp=${code}`, { waitUntil: 'domcontentloaded' });
  await guest.waitForFunction(
    () => window.Laya && window.ZhaoPvp?.getState().connected === true,
    null,
    { timeout: 30000 },
  );
  await Promise.all([
    host.waitForFunction(() => window.ZhaoPvp?.getState().room?.players?.length === 2
      && ZhaoPvp.getState().room.players.every((player) => player.rankName && player.rankName !== '军士.一')),
    guest.waitForFunction(() => window.ZhaoPvp?.getState().room?.players?.length === 2
      && ZhaoPvp.getState().room.players.every((player) => player.rankName && player.rankName !== '军士.一')),
  ]);

  const temporarySaves = await Promise.all([host, guest].map((page) => page.evaluate(() => ({
    temporary: ZhaoCloud.getState().temporarySaveMode,
    current: JSON.parse(localStorage.getItem('playerData')),
    original: JSON.parse(localStorage.getItem('zhaoyun.pvp.originalSave')),
  }))));
  for (let index = 0; index < temporarySaves.length; index += 1) {
    const save = temporarySaves[index];
    const configured = configuredSaves[index];
    assert.equal(save.temporary, true);
    assert.ok(save.original);
    assert.deepEqual(save.current._equip, configured._equip);
    assert.deepEqual(save.current._props, configured._props);
    assert.deepEqual(save.current._lowPrProps, configured._lowPrProps);
    assert.equal(save.current._curStar, configured._curStar);
    assert.equal(save.current._win, configured._win);
    assert.equal(save.current._lose, configured._lose);
  }
  const roomProfiles = await host.evaluate(() => ZhaoPvp.getState().room.players.map((player) => player.rankName));
  assert.equal(roomProfiles.length, 2);
  assert.notEqual(roomProfiles[0], roomProfiles[1]);

  await host.locator('#zhao-pvp-ready').click();
  await guest.locator('#zhao-pvp-ready').click();
  await Promise.all([
    host.waitForFunction(() => window.ZhaoPvp?.getState().battleLoaded === true, null, { timeout: 45000 }),
    guest.waitForFunction(() => window.ZhaoPvp?.getState().battleLoaded === true, null, { timeout: 45000 }),
  ]);
  await Promise.all([
    host.waitForFunction(() => window.ZhaoPvp?.getState().started === true, null, { timeout: 15000 }),
    guest.waitForFunction(() => window.ZhaoPvp?.getState().started === true, null, { timeout: 15000 }),
  ]);
  await Promise.all([
    host.waitForFunction(() => ZhaoPvp.getState().mediaConnected === true, null, { timeout: 60000 }),
    guest.waitForFunction(() => ZhaoPvp.getState().mediaConnected === true, null, { timeout: 60000 }),
  ]);
  if (forceRelay) {
    // DataChannel-only path may not always expose candidate-pair stats immediately.
    await Promise.all([
      host.waitForFunction(() => {
        const s = ZhaoPvp.getState();
        return s.mediaConnected && (s.mediaTransport === '中继' || s.mediaStatus === '中继' || s.remoteBattleStateReceived);
      }, null, { timeout: 60000 }),
      guest.waitForFunction(() => {
        const s = ZhaoPvp.getState();
        return s.mediaConnected && (s.mediaTransport === '中继' || s.mediaStatus === '中继' || s.remoteBattleStateReceived);
      }, null, { timeout: 60000 }),
    ]);
  }
  await Promise.all([host, guest].map((page) => page.evaluate(() => {
    const BattleScene = Laya.ClassUtils.getClass('a1VsRozfQfKce35jblVR3w');
    let scene = null;
    (function walk(node) {
      if (node instanceof BattleScene) scene = node;
      for (const child of node?._children || []) walk(child);
    })(Laya.stage);
    try { scene.refreshBtn?.event(Laya.Event.CLICK); } catch {}
  })));
  await Promise.all([host, guest].map((page) => page.waitForFunction(() => {
    const BattleScene = Laya.ClassUtils.getClass('a1VsRozfQfKce35jblVR3w');
    let scene = null;
    (function walk(node) {
      if (node instanceof BattleScene) scene = node;
      for (const child of node?._children || []) walk(child);
    })(Laya.stage);
    return (scene.refreshBox?._children || []).some((node) => /^soldier_/.test(node.name || ''));
  }, null, { timeout: 15000 })));
  await Promise.all([host, guest].map((page) => page.evaluate(() => {
    const BattleScene = Laya.ClassUtils.getClass('a1VsRozfQfKce35jblVR3w');
    let scene = null;
    (function walk(node) {
      if (node instanceof BattleScene) scene = node;
      for (const child of node?._children || []) walk(child);
    })(Laya.stage);
    // Place an asymmetric local unit in the lower half so the peer can mirror it natively.
    const card = (scene.refreshBox?._children || []).find((node) => /^soldier_/.test(node.name || ''));
    if (card && typeof scene.c$ === 'function') {
      // Host/guest both put a unit at left-lower; peer should show it at right-upper after mirror.
      scene.c$(card, 1, 8);
      const FrameAnim = card.getChildByName('sp').constructor;
      ['bow', 'knife', 'pike', 'cavalry'].forEach((animId, index) => {
        const unit = new Laya.Sprite();
        unit.name = `soldier_sync_${animId}`;
        unit.size(80, 80);
        const body = new FrameAnim(animId);
        body.name = 'sp';
        body.pos(40, 40);
        body.size(80, 80);
        body.pivot(40, 40);
        body.play('zhan', true);
        unit.addChild(body);
        const level = new Laya.Clip('resources/img/gameObject/bitmapFont/number5.png', 5, 1);
        level.name = 'lvl';
        level.pos(60, 0);
        level.size(20, 20);
        level.sheet = '12345';
        level.value = String(index + 1);
        unit.addChild(level);
        scene.c$(unit, index * 2, 5);
      });
    }
  })));
  await Promise.all([host, guest].map((page) => page.waitForFunction(() => {
    const pvp = ZhaoPvp.getState();
    if (pvp.opponentRenderMode !== 'native-mirror' || pvp.remoteBattleStateReceived !== true) return false;
    const BattleScene = Laya.ClassUtils.getClass('a1VsRozfQfKce35jblVR3w');
    let scene = null;
    (function walk(node) {
      if (node instanceof BattleScene) scene = node;
      for (const child of node?._children || []) walk(child);
    })(Laya.stage);
    const peers = (scene.gameObjectBox?._children || []).filter((node) => String(node.name || '').startsWith('peer_'));
    if (!peers.length) return false;
    // Mirrored from local (1,8) => (6,1) => x=480,y=80. Allow nearby cells if placement jitter.
    return peers.some((node) => node.y < 400 && node.rotation === 0 && (node.scaleY == null || node.scaleY > 0));
  }, null, { timeout: 20000 })));
  const opponentLayouts = await Promise.all([host, guest].map((page) => page.evaluate(() => {
    const BattleScene = Laya.ClassUtils.getClass('a1VsRozfQfKce35jblVR3w');
    let scene = null;
    (function walk(node) {
      if (node instanceof BattleScene) scene = node;
      for (const child of node?._children || []) walk(child);
    })(Laya.stage);
    const peers = (scene.gameObjectBox?._children || [])
      .filter((node) => String(node.name || '').startsWith('peer_'))
      .map((node) => ({
        name: node.name,
        x: node.x,
        y: node.y,
        rotation: node.rotation,
        scaleX: node.scaleX,
        scaleY: node.scaleY,
        childNames: (node._children || []).map((child) => child.name),
      }));
    return {
      overlayPresent: !!document.querySelector('#zhao-pvp-peer-overlay'),
      operationInsetPresent: document.body.innerText.includes('好友操作'),
      peers,
      state: ZhaoPvp.getState(),
    };
  })));
  for (const layout of opponentLayouts) {
    assert.equal(layout.overlayPresent, false);
    assert.equal(layout.operationInsetPresent, false);
    assert.ok(layout.peers.length >= 1, 'expected native peer units in upper half');
    assert.ok(layout.peers.every((peer) => peer.y < 400), 'peer units must stay in upper half');
    assert.ok(layout.peers.every((peer) => peer.rotation === 0), 'peer units must not be rotated');
    assert.ok(layout.peers.every((peer) => (peer.scaleY == null || peer.scaleY > 0)), 'peer units must not be flipped');
    assert.equal(layout.state.opponentRenderMode, 'native-mirror');
    assert.equal(layout.state.remoteBattleStateReceived, true);
  }

  await Promise.all([host, guest].map((page) => page.waitForFunction(() => {
    const BattleScene = Laya.ClassUtils.getClass('a1VsRozfQfKce35jblVR3w');
    let scene = null;
    (function walk(node) {
      if (node instanceof BattleScene) scene = node;
      for (const child of node?._children || []) walk(child);
    })(Laya.stage);
    return ['bow', 'knife', 'pike', 'cavalry'].every((animId, index) => {
      const node = scene.gameObjectBox?.getChildByName?.(`peer_soldier_sync_${animId}`);
      const body = node?.getChildByName?.('sp');
      const frame = body?._children?.[0];
      const level = node?.getChildByName?.('lvl');
      return body?.animId === animId
        && body?.pivotX === 40
        && body?.pivotY === 40
        && !!(frame?.texture || frame?._texture)
        && level?.value === String(index + 1);
    });
  }, null, { timeout: 15000 })));
  await Promise.all([host, guest].map((page) => page.evaluate(() => {
    const BattleScene = Laya.ClassUtils.getClass('a1VsRozfQfKce35jblVR3w');
    let scene = null;
    (function walk(node) {
      if (node instanceof BattleScene) scene = node;
      for (const child of node?._children || []) walk(child);
    })(Laya.stage);
    ['bow', 'knife', 'pike', 'cavalry'].forEach((animId) => {
      const node = scene.gameObjectBox?.getChildByName?.(`peer_soldier_sync_${animId}`);
      if (node) node.__syncContinuityMarker = animId;
    });
  })));
  await Promise.all([host, guest].map((page) => page.evaluate(async () => {
    const BattleScene = Laya.ClassUtils.getClass('a1VsRozfQfKce35jblVR3w');
    let scene = null;
    (function walk(node) {
      if (node instanceof BattleScene) scene = node;
      for (const child of node?._children || []) walk(child);
    })(Laya.stage);
    for (let cycle = 0; cycle < 6; cycle += 1) {
      ['bow', 'knife', 'pike', 'cavalry'].forEach((animId) => {
        const body = scene.gameObjectBox
          ?.getChildByName?.(`soldier_sync_${animId}`)
          ?.getChildByName?.('sp');
        body?.play(cycle % 2 === 0 ? 'attack' : 'zhan', cycle % 2 !== 0);
      });
      await new Promise((done) => setTimeout(done, 120));
    }
  })));
  await Promise.all([host, guest].map((page) => page.waitForFunction(() => {
    const BattleScene = Laya.ClassUtils.getClass('a1VsRozfQfKce35jblVR3w');
    let scene = null;
    (function walk(node) {
      if (node instanceof BattleScene) scene = node;
      for (const child of node?._children || []) walk(child);
    })(Laya.stage);
    return ['bow', 'knife', 'pike', 'cavalry'].every((animId) => (
      scene.gameObjectBox?.getChildByName?.(`peer_soldier_sync_${animId}`)?.__syncContinuityMarker === animId
    ));
  }, null, { timeout: 3000 })));

  const glyphStability = await Promise.all([host, guest].map((page) => page.evaluate(async () => {
    const BattleScene = Laya.ClassUtils.getClass('a1VsRozfQfKce35jblVR3w');
    let scene = null;
    (function walk(node) {
      if (node instanceof BattleScene) scene = node;
      for (const child of node?._children || []) walk(child);
    })(Laya.stage);
    for (let sample = 0; sample < 40; sample += 1) {
      const complete = ['bow', 'knife', 'pike', 'cavalry'].every((animId) => {
        const body = scene.gameObjectBox
          ?.getChildByName?.(`peer_soldier_sync_${animId}`)
          ?.getChildByName?.('sp');
        const frame = body?._children?.[0];
        return !!(frame?.texture || frame?._texture);
      });
      if (!complete) return false;
      await new Promise((done) => setTimeout(done, 50));
    }
    return true;
  })));
  assert.deepEqual(glyphStability, [true, true], 'peer unit glyph textures must stay loaded while animating');

  const guestEnemy = await guest.evaluate(() => {
    const BattleScene = Laya.ClassUtils.getClass('a1VsRozfQfKce35jblVR3w');
    let scene = null;
    (function walk(node) {
      if (node instanceof BattleScene) scene = node;
      for (const child of node?._children || []) walk(child);
    })(Laya.stage);
    Laya.timer.scale = 0;
    const image = (name, skin, x, y, width, height) => {
      const node = new Laya.Image();
      node.name = name;
      node.skin = skin;
      node.pos(x, y);
      node.size(width, height);
      return node;
    };
    const enemy = new Laya.Sprite();
    enemy.name = 'enemy_sync_probe';
    enemy.size(80, 80);
    enemy.pivot(40, 80);
    enemy.pos(40, 750);
    enemy.addChild(image('shadow', 'resources/img/gameObject/enemy/shadow1.png', 16.5, 60, 47, 20));
    const hp = image('hpBgImg', 'resources/img/gameObject/enemy/hpBg.png', 9, 3, 62, 11);
    hp.visible = true;
    hp.addChild(image('hpImg1', 'resources/img/gameObject/enemy/hp1.png', 4, 3, 17, 5));
    hp.addChild(image('hpImg2', 'resources/img/gameObject/enemy/hp2.png', 4, 3, 31, 5));
    enemy.addChild(hp);
    const stun = image('stun', 'resources/img/gameObject/enemy/stun1.png', 41, -14, 53, 30);
    stun.visible = false;
    enemy.addChild(stun);
    enemy.addChild(image('sp', 'resources/img/gameObject/enemy/mob_0.png', 40, 80, 80, 80));
    scene.gameObjectBox.addChild(enemy);
    const localAiEnemy = new Laya.Sprite();
    localAiEnemy.name = 'enemy_opponent_probe';
    localAiEnemy.size(80, 80);
    localAiEnemy.pivot(40, 80);
    localAiEnemy.pos(600, 80);
    localAiEnemy.addChild(image('sp', 'resources/img/gameObject/enemy/mob_0.png', 40, 80, 80, 80));
    scene.gameObjectBox.addChild(localAiEnemy);
    return enemy.name;
  });

  await host.waitForFunction((enemyName) => {
    const BattleScene = Laya.ClassUtils.getClass('a1VsRozfQfKce35jblVR3w');
    let scene = null;
    (function walk(node) {
      if (node instanceof BattleScene) scene = node;
      for (const child of node?._children || []) walk(child);
    })(Laya.stage);
    const enemy = scene.gameObjectBox?.getChildByName?.(`peer_${enemyName}`);
    const hp = enemy?.getChildByName?.('hpBgImg');
    const hp1 = hp?.getChildByName?.('hpImg1');
    const hp2 = hp?.getChildByName?.('hpImg2');
    return !!enemy
      && Math.abs(enemy.x - 600) < 1
      && Math.abs(enemy.y - 70) < 1
      && hp?.visible === true
      && Math.abs(hp1?.width - 17) < 1
      && Math.abs(hp2?.width - 31) < 1;
  }, guestEnemy, { timeout: 15000 });
  await guest.evaluate((enemyName) => {
    const BattleScene = Laya.ClassUtils.getClass('a1VsRozfQfKce35jblVR3w');
    let scene = null;
    (function walk(node) {
      if (node instanceof BattleScene) scene = node;
      for (const child of node?._children || []) walk(child);
    })(Laya.stage);
    scene.gameObjectBox.getChildByName(enemyName).pos(0, 600);
  }, guestEnemy);
  await host.waitForFunction((enemyName) => {
    const BattleScene = Laya.ClassUtils.getClass('a1VsRozfQfKce35jblVR3w');
    let scene = null;
    (function walk(node) {
      if (node instanceof BattleScene) scene = node;
      for (const child of node?._children || []) walk(child);
    })(Laya.stage);
    const enemy = scene.gameObjectBox?.getChildByName?.(`peer_${enemyName}`);
    return !!enemy
      && Math.abs(enemy.x - 560) < 1
      && Math.abs(enemy.y - 120) < 1;
  }, guestEnemy, { timeout: 5000 });
  await new Promise((done) => setTimeout(done, 400));
  assert.equal(await host.evaluate(() => {
    const BattleScene = Laya.ClassUtils.getClass('a1VsRozfQfKce35jblVR3w');
    let scene = null;
    (function walk(node) {
      if (node instanceof BattleScene) scene = node;
      for (const child of node?._children || []) walk(child);
    })(Laya.stage);
    return !!scene.gameObjectBox?.getChildByName?.('peer_enemy_opponent_probe');
  }), false, 'local AI route must not be mirrored as the friend route');

  await guest.evaluate((enemyName) => {
    const BattleScene = Laya.ClassUtils.getClass('a1VsRozfQfKce35jblVR3w');
    let scene = null;
    (function walk(node) {
      if (node instanceof BattleScene) scene = node;
      for (const child of node?._children || []) walk(child);
    })(Laya.stage);
    const enemy = scene.gameObjectBox.getChildByName(enemyName);
    enemy.pos(200, 480);
    const hp = enemy.getChildByName('hpBgImg');
    hp.getChildByName('hpImg1').width = 8;
    hp.getChildByName('hpImg2').width = 22;
  }, guestEnemy);
  await host.waitForFunction((enemyName) => {
    const BattleScene = Laya.ClassUtils.getClass('a1VsRozfQfKce35jblVR3w');
    let scene = null;
    (function walk(node) {
      if (node instanceof BattleScene) scene = node;
      for (const child of node?._children || []) walk(child);
    })(Laya.stage);
    const enemy = scene.gameObjectBox?.getChildByName?.(`peer_${enemyName}`);
    const hp = enemy?.getChildByName?.('hpBgImg');
    return !!enemy
      && Math.abs(enemy.x - 360) < 1
      && Math.abs(enemy.y - 240) < 1
      && Math.abs(hp?.getChildByName?.('hpImg1')?.width - 8) < 1
      && Math.abs(hp?.getChildByName?.('hpImg2')?.width - 22) < 1;
  }, guestEnemy, { timeout: 5000 });
  // 实际敌兵进入道路后根节点 pivot 会从 (40,80) 变为 (0,0)，但 sp
  // 动画容器内部的真实帧仍使用脚底锚点 (40,80)。镜像图片必须保留该锚点，
  // 否则“贼”字会相对道路向右偏 40px、向下偏 80px。
  await guest.evaluate((enemyName) => {
    const BattleScene = Laya.ClassUtils.getClass('a1VsRozfQfKce35jblVR3w');
    let scene = null;
    (function walk(node) {
      if (node instanceof BattleScene) scene = node;
      for (const child of node?._children || []) walk(child);
    })(Laya.stage);
    scene.gameObjectBox.getChildByName(enemyName).pivot(0, 0);
  }, guestEnemy);
  await host.waitForFunction((enemyName) => {
    const BattleScene = Laya.ClassUtils.getClass('a1VsRozfQfKce35jblVR3w');
    let scene = null;
    (function walk(node) {
      if (node instanceof BattleScene) scene = node;
      for (const child of node?._children || []) walk(child);
    })(Laya.stage);
    const enemy = scene.gameObjectBox?.getChildByName?.(`peer_${enemyName}`);
    const body = enemy?.getChildByName?.('sp');
    const bodyLeft = enemy.x - enemy.pivotX + body.x - body.pivotX;
    const bodyTop = enemy.y - enemy.pivotY + body.y - body.pivotY;
    return !!enemy
      && Math.abs(enemy.x - 360) < 1
      && Math.abs(enemy.y - 240) < 1
      && body.pivotX === 40
      && body.pivotY === 80
      && bodyLeft >= 360 && bodyLeft + body.width <= 440
      && bodyTop >= 240 && bodyTop + body.height <= 320;
  }, guestEnemy, { timeout: 5000 });
  await guest.evaluate((enemyName) => {
    const BattleScene = Laya.ClassUtils.getClass('a1VsRozfQfKce35jblVR3w');
    let scene = null;
    (function walk(node) {
      if (node instanceof BattleScene) scene = node;
      for (const child of node?._children || []) walk(child);
    })(Laya.stage);
    scene.gameObjectBox.getChildByName(enemyName)?.destroy(true);
    Laya.timer.scale = 1;
  }, guestEnemy);
  await host.waitForFunction((enemyName) => {
    const BattleScene = Laya.ClassUtils.getClass('a1VsRozfQfKce35jblVR3w');
    let scene = null;
    (function walk(node) {
      if (node instanceof BattleScene) scene = node;
      for (const child of node?._children || []) walk(child);
    })(Laya.stage);
    return !scene.gameObjectBox?.getChildByName?.(`peer_${enemyName}`);
  }, guestEnemy, { timeout: 5000 });

  await guest.evaluate(() => {
    const BattleScene = Laya.ClassUtils.getClass('a1VsRozfQfKce35jblVR3w');
    let scene = null;
    (function walk(node) {
      if (node instanceof BattleScene) scene = node;
      for (const child of node?._children || []) walk(child);
    })(Laya.stage);
    scene.sw.wy.Zi = 2;
  });
  await host.waitForFunction(() => {
    const state = ZhaoPvp.getState();
    const peer = state.room?.players?.find((player) => player.side !== state.side);
    const BattleScene = Laya.ClassUtils.getClass('a1VsRozfQfKce35jblVR3w');
    let scene = null;
    (function walk(node) {
      if (node instanceof BattleScene) scene = node;
      for (const child of node?._children || []) walk(child);
    })(Laya.stage);
    return peer?.hp === 2
      && scene.sw.wy.Ki === 2
      && document.querySelector('#zhao-pvp-hud .is-opponent .zhao-pvp-hearts')?.textContent === '♥♥♡';
  }, null, { timeout: 10000 });

  await guest.evaluate(() => {
    const BattleScene = Laya.ClassUtils.getClass('a1VsRozfQfKce35jblVR3w');
    let scene = null;
    (function walk(node) {
      if (node instanceof BattleScene) scene = node;
      for (const child of node?._children || []) walk(child);
    })(Laya.stage);
    scene.sw.wy.Zi = 0;
  });
  await Promise.all([
    host.getByRole('heading', { name: '好友对战胜利' }).waitFor({ timeout: 15000 }),
    guest.getByRole('heading', { name: '好友对战失败' }).waitFor({ timeout: 15000 }),
  ]);

  await Promise.all([
    host.getByRole('button', { name: '返回主界面' }).click(),
    guest.getByRole('button', { name: '返回主界面' }).click(),
  ]);
  await Promise.all([
    host.waitForURL((url) => !url.searchParams.has('pvp'), { timeout: 20000 }),
    guest.waitForURL((url) => !url.searchParams.has('pvp'), { timeout: 20000 }),
  ]);
  await Promise.all([
    host.waitForFunction(() => window.ZhaoCloud && document.querySelector('#zhao-pvp-entry:not([hidden])'), null, { timeout: 30000 }),
    guest.waitForFunction(() => window.ZhaoCloud && document.querySelector('#zhao-pvp-entry:not([hidden])'), null, { timeout: 30000 }),
  ]);
  const restored = await Promise.all([host, guest].map((page) => page.evaluate(() => ({
    temporary: ZhaoCloud.getState().temporarySaveMode,
    original: localStorage.getItem('zhaoyun.pvp.originalSave'),
    active: localStorage.getItem('zhaoyun.pvp.active'),
    save: ZhaoCloud.getLocalSave(),
  }))));
  for (let index = 0; index < restored.length; index += 1) {
    const item = restored[index];
    const configured = configuredSaves[index];
    assert.equal(item.temporary, false);
    assert.ok(!item.original);
    assert.ok(!item.active);
    assert.equal(item.save._win, configured._win);
    assert.equal(item.save._lose, configured._lose);
    assert.equal(item.save._curStar, configured._curStar);
    assert.deepEqual(item.save._equip, configured._equip);
    assert.deepEqual(item.save._props, configured._props);
    assert.deepEqual(item.save._lowPrProps, configured._lowPrProps);
  }
  assert.deepEqual(errors, []);
  console.log(`PVP browser E2E passed (room ${code})`);
} finally {
  if (browser) await browser.close();
  for (const process of [worker, webServer]) {
    if (!process) continue;
    process.kill('SIGTERM');
    await new Promise((resolveExit) => {
      process.once('exit', resolveExit);
      setTimeout(resolveExit, 2000);
    });
  }
  await rm(state, { recursive: true, force: true });
}
