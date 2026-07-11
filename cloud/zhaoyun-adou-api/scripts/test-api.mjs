import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const config = resolve(root, 'cloud/zhaoyun-adou-api/wrangler.jsonc');
const wrangler = resolve(root, 'node_modules/.bin/wrangler');
const state = await mkdtemp(resolve(tmpdir(), 'zhaoyun-d1-test-'));
const port = 8791;
const base = `http://127.0.0.1:${port}`;
let worker;

function runWrangler(args) {
  const result = spawnSync(wrangler, args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${result.stdout}\n${result.stderr}`);
  }
}

async function waitForWorker() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error('Worker did not become ready');
}

async function api(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { response, json: await response.json() };
}

function connectRoom(code, ticket) {
  const socket = new WebSocket(`${base.replace('http:', 'ws:')}/v1/pvp/rooms/${code}/socket?ticket=${encodeURIComponent(ticket)}`);
  const messages = [];
  const waiters = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    messages.push(message);
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (waiter.predicate(message)) {
        waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      }
    }
  });
  const opened = new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', rejectOpen, { once: true });
  });
  function waitFor(predicate, timeout = 5000) {
    const existing = messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolveMessage, rejectMessage) => {
      const waiter = { predicate, resolve: resolveMessage, timer: null };
      waiter.timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        rejectMessage(new Error(`Timed out waiting for room message; received ${JSON.stringify(messages)}`));
      }, timeout);
      waiters.push(waiter);
    });
  }
  return { socket, opened, waitFor, messages };
}

try {
  runWrangler([
    'd1', 'migrations', 'apply', 'DB', '--local',
    '--config', config, '--persist-to', state,
  ]);

  worker = spawn(
    wrangler,
    ['dev', '--config', config, '--port', String(port), '--ip', '127.0.0.1', '--persist-to', state],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  await waitForWorker();

  const oversized = await api('/v1/auth/enter', {
    method: 'POST',
    body: { nickname: '超大请求', pin: '1234', padding: 'x'.repeat(257 * 1024) },
  });
  assert.equal(oversized.response.status, 413);
  assert.equal(oversized.json.error.code, 'payload_too_large');

  const aliceEnter = await api('/v1/auth/enter', {
    method: 'POST',
    body: { nickname: '阿斗', pin: '1234' },
  });
  assert.equal(aliceEnter.response.status, 201);
  assert.equal(aliceEnter.json.ok, true);
  assert.equal(aliceEnter.json.data.player.nickname, '阿斗');
  const aliceToken = aliceEnter.json.data.token;

  const wrongPin = await api('/v1/auth/enter', {
    method: 'POST',
    body: { nickname: '阿斗', pin: '9999' },
  });
  assert.equal(wrongPin.response.status, 401);
  assert.equal(wrongPin.json.error.code, 'invalid_credentials');

  const aliceSave = {
    _nick: '会被服务端替换',
    _win: 2,
    _lose: 1,
    _curStar: 15,
    _saveTime: 200,
    _gold: 88,
  };
  const savedAlice = await api('/v1/save', {
    method: 'PUT', token: aliceToken, body: { save: aliceSave },
  });
  assert.equal(savedAlice.response.status, 200);
  assert.equal(savedAlice.json.data.save.save._nick, '阿斗');
  assert.equal(savedAlice.json.data.save.gamesPlayed, 3);

  const bobEnter = await api('/v1/auth/enter', {
    method: 'POST',
    body: { nickname: '赵云', pin: '567890' },
  });
  assert.equal(bobEnter.response.status, 201);
  const bobToken = bobEnter.json.data.token;

  const turn = await api('/v1/pvp/ice', { token: aliceToken });
  assert.equal(turn.response.status, 200);
  assert.equal(turn.json.data.ttlSeconds, 7200);
  assert.ok(turn.json.data.expiresAt > Date.now());
  assert.match(turn.json.data.iceServers[1].username, /^\d+:/);
  assert.ok(turn.json.data.iceServers[1].credential.length >= 20);
  assert.ok(turn.json.data.iceServers[1].urls.some((url) => url.startsWith('turn:turn.euv.pp.ua:3478')));

  const savedBob = await api('/v1/save', {
    method: 'PUT', token: bobToken,
    body: { save: { _win: 1, _lose: 0, _curStar: 21, _saveTime: 300 } },
  });
  assert.equal(savedBob.response.status, 200);

  const leaderboard = await api('/v1/leaderboard', { token: aliceToken });
  assert.equal(leaderboard.response.status, 200);
  assert.deepEqual(
    leaderboard.json.data.entries.map((entry) => entry.nickname),
    ['赵云', '阿斗'],
  );
  assert.equal(leaderboard.json.data.entries[1].isCurrent, true);

  const staleSave = await api('/v1/save', {
    method: 'PUT', token: aliceToken,
    body: { save: { _win: 1, _lose: 0, _curStar: 5, _saveTime: 100 } },
  });
  assert.equal(staleSave.response.status, 409);
  assert.equal(staleSave.json.error.code, 'cloud_save_newer');
  assert.equal(staleSave.json.error.details.cloudSave.save._gold, 88);

  const aliceLogin = await api('/v1/auth/enter', {
    method: 'POST',
    body: { nickname: '阿斗', pin: '1234' },
  });
  assert.equal(aliceLogin.response.status, 200);
  assert.equal(aliceLogin.json.data.save.save._gold, 88);

  const resume = await api('/v1/auth/resume', {
    method: 'POST', token: aliceLogin.json.data.token,
  });
  assert.equal(resume.response.status, 200);
  assert.equal(resume.json.data.player.nickname, '阿斗');

  const createdRoom = await api('/v1/pvp/rooms', {
    method: 'POST', token: aliceToken,
  });
  assert.equal(createdRoom.response.status, 201);
  assert.match(createdRoom.json.data.code, /^\d{6}$/);
  assert.equal(createdRoom.json.data.side, 0);
  const roomCode = createdRoom.json.data.code;

  const joinedRoom = await api(`/v1/pvp/rooms/${roomCode}/join`, {
    method: 'POST', token: bobToken,
  });
  assert.equal(joinedRoom.response.status, 200);
  assert.equal(joinedRoom.json.data.side, 1);
  assert.equal(joinedRoom.json.data.room.players.length, 2);

  const aliceRoom = connectRoom(roomCode, createdRoom.json.data.ticket);
  const bobRoom = connectRoom(roomCode, joinedRoom.json.data.ticket);
  await Promise.all([aliceRoom.opened, bobRoom.opened]);
  await Promise.all([
    aliceRoom.waitFor((message) => message.type === 'welcome'),
    bobRoom.waitFor((message) => message.type === 'welcome'),
  ]);

  aliceRoom.socket.send(JSON.stringify({ type: 'profile', rankName: '校尉.一' }));
  bobRoom.socket.send(JSON.stringify({ type: 'profile', rankName: '百将.一' }));
  const profiledRoom = await aliceRoom.waitFor(
    (message) => message.type === 'room'
      && message.room.players.length === 2
      && message.room.players.every((player) => player.rankName !== '军士.一'),
  );
  assert.deepEqual(profiledRoom.room.players.map((player) => player.rankName), ['校尉.一', '百将.一']);

  bobRoom.socket.close(1000, 'reconnect test');
  const disconnected = await aliceRoom.waitFor(
    (message) => message.type === 'peer_disconnected' && message.side === 1,
  );
  assert.ok(disconnected.deadline > Date.now());

  const reconnectTicket = await api(`/v1/pvp/rooms/${roomCode}/ticket`, {
    method: 'POST', token: bobToken,
  });
  assert.equal(reconnectTicket.response.status, 200);
  const bobReconnected = connectRoom(roomCode, reconnectTicket.json.data.ticket);
  await bobReconnected.opened;
  await bobReconnected.waitFor((message) => message.type === 'welcome');
  await aliceRoom.waitFor((message) => message.type === 'resume');

  aliceRoom.socket.send(JSON.stringify({ type: 'ready', ready: true }));
  bobReconnected.socket.send(JSON.stringify({ type: 'ready', ready: true }));
  await Promise.all([
    aliceRoom.waitFor((message) => message.type === 'load'),
    bobReconnected.waitFor((message) => message.type === 'load'),
  ]);

  aliceRoom.socket.send(JSON.stringify({ type: 'rtc_ready' }));
  const rtcReady = await bobReconnected.waitFor(
    (message) => message.type === 'rtc_ready' && message.side === 0,
  );
  assert.equal(rtcReady.side, 0);
  aliceRoom.socket.send(JSON.stringify({
    type: 'rtc_offer',
    sdp: { type: 'offer', sdp: 'v=0\r\ns=test-offer\r\n' },
  }));
  const rtcOffer = await bobReconnected.waitFor((message) => message.type === 'rtc_offer');
  assert.equal(rtcOffer.sdp.type, 'offer');
  bobReconnected.socket.send(JSON.stringify({
    type: 'rtc_answer',
    sdp: { type: 'answer', sdp: 'v=0\r\ns=test-answer\r\n' },
  }));
  const rtcAnswer = await aliceRoom.waitFor((message) => message.type === 'rtc_answer');
  assert.equal(rtcAnswer.sdp.type, 'answer');
  bobReconnected.socket.send(JSON.stringify({
    type: 'rtc_ice',
    candidate: { candidate: 'candidate:test', sdpMid: '0', sdpMLineIndex: 0 },
  }));
  const rtcIce = await aliceRoom.waitFor((message) => message.type === 'rtc_ice');
  assert.equal(rtcIce.candidate.candidate, 'candidate:test');

  aliceRoom.socket.send(JSON.stringify({ type: 'loaded' }));
  bobReconnected.socket.send(JSON.stringify({ type: 'loaded' }));
  await Promise.all([
    aliceRoom.waitFor((message) => message.type === 'go'),
    bobReconnected.waitFor((message) => message.type === 'go'),
  ]);

  aliceRoom.socket.send(JSON.stringify({ type: 'progress', hp: 3, wave: 4, elapsed: 12000 }));
  bobReconnected.socket.send(JSON.stringify({ type: 'progress', hp: 3, wave: 3, elapsed: 12900 }));
  bobReconnected.socket.send(JSON.stringify({ type: 'progress', hp: 0, wave: 3, elapsed: 13000 }));
  const result = await aliceRoom.waitFor((message) => message.type === 'result');
  assert.equal(result.winnerSide, 0);
  assert.equal(result.reason, 'eliminated');

  const pvpStats = await api('/v1/pvp/stats', { token: aliceToken });
  assert.equal(pvpStats.response.status, 200);
  assert.deepEqual(pvpStats.json.data.stats, { wins: 1, losses: 0, games: 1 });
  assert.equal(pvpStats.json.data.recent[0].winnerNickname, '阿斗');
  assert.equal(pvpStats.json.data.recent[0].loserNickname, '赵云');
  assert.equal(pvpStats.json.data.recent[0].winnerWave, 4);

  aliceRoom.socket.close();
  bobReconnected.socket.close();
  console.log('Cloud API integration tests passed');
} finally {
  if (worker) {
    worker.kill('SIGTERM');
    await new Promise((resolveExit) => {
      worker.once('exit', resolveExit);
      setTimeout(resolveExit, 2_000);
    });
  }
  await rm(state, { recursive: true, force: true });
}
