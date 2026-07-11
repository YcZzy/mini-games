import { PvpRoom, type PvpPlayerIdentity, type PvpRpcResult } from "./pvp-room";

export { PvpRoom } from "./pvp-room";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_PLAYERS = 20;
const LOGIN_ATTEMPTS_BEFORE_LOCK = 5;
const LOGIN_LOCK_MS = 5 * 60 * 1000;
const encoder = new TextEncoder();

interface PlayerRow {
  id: string;
  nickname: string;
  nickname_key: string;
  pin_salt: string;
  pin_hash: string;
  failed_attempts: number;
  locked_until: number;
  created_at: number;
}

interface SessionPlayerRow {
  id: string;
  nickname: string;
  expires_at: number;
}

interface SaveRow {
  player_id: string;
  payload: string;
  games_played: number;
  wins: number;
  losses: number;
  cur_star: number;
  rank_id: number;
  rank_level: number;
  client_save_time: number;
  revision: number;
  updated_at: number;
}

interface LeaderboardRow {
  id: string;
  nickname: string;
  wins: number | null;
  losses: number | null;
  cur_star: number | null;
  rank_id: number | null;
  rank_level: number | null;
  sort_time: number;
}

interface AuthenticatedPlayer {
  id: string;
  nickname: string;
  tokenHash: string;
}

interface SaveMetadata {
  gamesPlayed: number;
  wins: number;
  losses: number;
  curStar: number;
  rankId: number;
  rankLevel: number;
  clientSaveTime: number;
}

interface PvpRoomDirectoryRow {
  code: string;
  status: string;
  expires_at: number;
}

interface PvpStatsRow {
  wins: number | null;
  losses: number | null;
  games: number | null;
}

interface PvpMatchRow {
  id: string;
  room_code: string;
  winner_player_id: string;
  loser_player_id: string;
  winner_name: string;
  loser_name: string;
  reason: string;
  winner_wave: number;
  loser_wave: number;
  started_at: number;
  finished_at: number;
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

function corsHeaders(): Headers {
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Max-Age": "86400",
  });
}

function json(data: unknown, status = 200): Response {
  const headers = corsHeaders();
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return Response.json(data, { status, headers });
}

function success(data: unknown, status = 200): Response {
  return json({ ok: true, data }, status);
}

function failure(error: ApiError): Response {
  return json(
    {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    },
    error.status,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readBoundedText(request: Request): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new ApiError(413, "payload_too_large", "请求内容过大");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new ApiError(413, "payload_too_large", "请求内容过大");
  }

  const text = await readBoundedText(request);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", "请求格式不正确");
  }
  if (!isRecord(parsed)) {
    throw new ApiError(400, "invalid_body", "请求内容必须是对象");
  }
  return parsed;
}

function normalizeNickname(value: unknown): { display: string; key: string } {
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_nickname", "请输入玩家昵称");
  }
  const display = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  const length = Array.from(display).length;
  if (length < 1 || length > 16 || /[\p{Cc}\p{Cf}]/u.test(display)) {
    throw new ApiError(400, "invalid_nickname", "昵称须为 1～16 个有效字符");
  }
  return { display, key: display.toLocaleLowerCase("zh-CN") };
}

function normalizePin(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4,6}$/.test(value)) {
    throw new ApiError(400, "invalid_pin", "PIN 须为 4～6 位数字");
  }
  return value;
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function hexToFixedHash(value: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/i.test(value)) return new Uint8Array(32);
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

async function pinHash(env: Env, playerId: string, salt: string, pin: string): Promise<Uint8Array> {
  if (!env.PIN_PEPPER) throw new Error("PIN_PEPPER is not configured");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.PIN_PEPPER),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${playerId}:${salt}:${pin}`),
  );
  return new Uint8Array(signature);
}

async function turnCredential(env: Env, username: string): Promise<string> {
  if (!env.TURN_SECRET) throw new Error("TURN_SECRET is not configured");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.TURN_SECRET),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(username));
  return bytesToBase64(new Uint8Array(signature));
}

async function verifyPin(env: Env, player: PlayerRow, pin: string): Promise<boolean> {
  const actual = await pinHash(env, player.id, player.pin_salt, pin);
  const expected = hexToFixedHash(player.pin_hash);
  return crypto.subtle.timingSafeEqual(actual, expected);
}

async function findPlayerByNickname(env: Env, nicknameKey: string): Promise<PlayerRow | null> {
  return env.DB.prepare(
    `SELECT id, nickname, nickname_key, pin_salt, pin_hash,
            failed_attempts, locked_until, created_at
       FROM players
      WHERE nickname_key = ?1
      LIMIT 1`,
  )
    .bind(nicknameKey)
    .first<PlayerRow>();
}

async function createPlayer(
  env: Env,
  nickname: { display: string; key: string },
  pin: string,
  now: number,
): Promise<PlayerRow> {
  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM players").first<{ count: number }>();
  if (Number(count?.count ?? 0) >= MAX_PLAYERS) {
    throw new ApiError(403, "registration_closed", "玩家名额已满，请联系管理员");
  }

  const id = crypto.randomUUID();
  const salt = randomHex(16);
  const hash = bytesToHex(await pinHash(env, id, salt, pin));
  try {
    await env.DB.prepare(
      `INSERT INTO players
         (id, nickname, nickname_key, pin_salt, pin_hash, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`,
    )
      .bind(id, nickname.display, nickname.key, salt, hash, now)
      .run();
  } catch (error) {
    const existing = await findPlayerByNickname(env, nickname.key);
    if (existing) {
      throw new ApiError(409, "nickname_race", "该昵称刚被创建，请重新登录");
    }
    throw error;
  }

  const player = await findPlayerByNickname(env, nickname.key);
  if (!player) throw new Error("Player insert did not return a row");
  return player;
}

async function recordFailedLogin(env: Env, player: PlayerRow, now: number): Promise<void> {
  const attempts = Number(player.failed_attempts) + 1;
  const shouldLock = attempts >= LOGIN_ATTEMPTS_BEFORE_LOCK;
  await env.DB.prepare(
    `UPDATE players
        SET failed_attempts = ?1,
            locked_until = ?2,
            updated_at = ?3
      WHERE id = ?4`,
  )
    .bind(shouldLock ? 0 : attempts, shouldLock ? now + LOGIN_LOCK_MS : 0, now, player.id)
    .run();
}

async function createSession(env: Env, playerId: string, now: number): Promise<string> {
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const configuredDays = Number.parseInt(env.SESSION_TTL_DAYS, 10);
  const ttlDays = Number.isFinite(configuredDays) ? configuredDays : 90;
  const expiresAt = now + ttlDays * 24 * 60 * 60 * 1000;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?1").bind(now),
    env.DB.prepare(
      `INSERT INTO sessions (token_hash, player_id, expires_at, created_at)
       VALUES (?1, ?2, ?3, ?4)`,
    ).bind(tokenHash, playerId, expiresAt, now),
  ]);
  return token;
}

async function authenticate(request: Request, env: Env): Promise<AuthenticatedPlayer> {
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    throw new ApiError(401, "unauthorized", "请重新登录");
  }
  const token = authorization.slice(7).trim();
  if (!token) throw new ApiError(401, "unauthorized", "请重新登录");
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT p.id, p.nickname, s.expires_at
       FROM sessions s
       JOIN players p ON p.id = s.player_id
      WHERE s.token_hash = ?1 AND s.expires_at > ?2
      LIMIT 1`,
  )
    .bind(tokenHash, now)
    .first<SessionPlayerRow>();
  if (!row) throw new ApiError(401, "unauthorized", "登录已过期，请重新登录");
  return { id: row.id, nickname: row.nickname, tokenHash };
}

function safeInteger(value: unknown, maximum = 1_000_000_000): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(maximum, Math.max(0, Math.trunc(value)));
}

function rankFromCurStar(curStar: number): { rankId: number; rankLevel: number } {
  if (curStar <= 250) {
    if (curStar === 0) return { rankId: 0, rankLevel: 1 };
    let rankId = Math.floor(curStar / 5);
    let rankLevel = curStar - rankId * 5;
    if (rankLevel === 0) {
      rankId -= 1;
      rankLevel = 5;
    }
    return { rankId: Math.min(49, Math.max(0, rankId)), rankLevel };
  }

  const rankLevel = Math.max(1, curStar - 250);
  if (rankLevel <= 25) return { rankId: 50, rankLevel };
  if (rankLevel <= 50) return { rankId: 51, rankLevel };
  if (rankLevel <= 75) return { rankId: 52, rankLevel };
  return { rankId: 53, rankLevel };
}

function normalizeSave(value: unknown, nickname: string): { save: Record<string, unknown>; metadata: SaveMetadata } {
  if (!isRecord(value)) throw new ApiError(400, "invalid_save", "存档格式不正确");
  const save: Record<string, unknown> = { ...value, _nick: nickname };
  const wins = safeInteger(save._win);
  const losses = safeInteger(save._lose);
  const curStar = safeInteger(save._curStar, 10_000_000);
  const clientSaveTime = safeInteger(save._saveTime, Date.now() + 5 * 60 * 1000);
  const { rankId, rankLevel } = rankFromCurStar(curStar);
  return {
    save,
    metadata: {
      gamesPlayed: wins + losses,
      wins,
      losses,
      curStar,
      rankId,
      rankLevel,
      clientSaveTime,
    },
  };
}

function parseSaveRow(row: SaveRow | null): Record<string, unknown> | null {
  if (!row) return null;
  let save: unknown;
  try {
    save = JSON.parse(row.payload);
  } catch {
    throw new Error("Stored save payload is invalid JSON");
  }
  if (!isRecord(save)) throw new Error("Stored save payload is not an object");
  return {
    save,
    revision: row.revision,
    gamesPlayed: row.games_played,
    clientSaveTime: row.client_save_time,
    updatedAt: row.updated_at,
  };
}

async function getSaveRow(env: Env, playerId: string): Promise<SaveRow | null> {
  return env.DB.prepare(
    `SELECT player_id, payload, games_played, wins, losses, cur_star,
            rank_id, rank_level, client_save_time, revision, updated_at
       FROM saves
      WHERE player_id = ?1
      LIMIT 1`,
  )
    .bind(playerId)
    .first<SaveRow>();
}

async function handleEnter(request: Request, env: Env): Promise<Response> {
  const body = await readJsonObject(request);
  const nickname = normalizeNickname(body.nickname);
  const pin = normalizePin(body.pin);
  const now = Date.now();
  let player = await findPlayerByNickname(env, nickname.key);
  let created = false;

  if (!player) {
    player = await createPlayer(env, nickname, pin, now);
    created = true;
  } else {
    if (Number(player.locked_until) > now) {
      throw new ApiError(429, "temporarily_locked", "PIN 尝试次数过多，请稍后再试", {
        retryAfter: Math.ceil((Number(player.locked_until) - now) / 1000),
      });
    }
    if (!(await verifyPin(env, player, pin))) {
      await recordFailedLogin(env, player, now);
      throw new ApiError(401, "invalid_credentials", "昵称或 PIN 不正确");
    }
  }

  await env.DB.prepare(
    `UPDATE players SET failed_attempts = 0, locked_until = 0, updated_at = ?1 WHERE id = ?2`,
  )
    .bind(now, player.id)
    .run();
  const token = await createSession(env, player.id, now);
  const save = parseSaveRow(await getSaveRow(env, player.id));
  return success(
    {
      token,
      player: { id: player.id, nickname: player.nickname },
      save,
      created,
    },
    created ? 201 : 200,
  );
}

async function handleResume(request: Request, env: Env): Promise<Response> {
  const player = await authenticate(request, env);
  const save = parseSaveRow(await getSaveRow(env, player.id));
  return success({ player: { id: player.id, nickname: player.nickname }, save });
}

async function handleLogout(request: Request, env: Env): Promise<Response> {
  const player = await authenticate(request, env);
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(player.tokenHash).run();
  return success({ loggedOut: true });
}

async function handleGetSave(request: Request, env: Env): Promise<Response> {
  const player = await authenticate(request, env);
  return success({ save: parseSaveRow(await getSaveRow(env, player.id)) });
}

async function handlePutSave(request: Request, env: Env): Promise<Response> {
  const player = await authenticate(request, env);
  const body = await readJsonObject(request);
  const normalized = normalizeSave(body.save, player.nickname);
  const payload = JSON.stringify(normalized.save);
  if (encoder.encode(payload).byteLength > MAX_BODY_BYTES) {
    throw new ApiError(413, "save_too_large", "存档内容过大");
  }

  const metadata = normalized.metadata;
  const now = Date.now();
  const result = await env.DB.prepare(
    `INSERT INTO saves
       (player_id, payload, games_played, wins, losses, cur_star, rank_id,
        rank_level, client_save_time, revision, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10)
     ON CONFLICT(player_id) DO UPDATE SET
       payload = excluded.payload,
       games_played = excluded.games_played,
       wins = excluded.wins,
       losses = excluded.losses,
       cur_star = excluded.cur_star,
       rank_id = excluded.rank_id,
       rank_level = excluded.rank_level,
       client_save_time = excluded.client_save_time,
       revision = saves.revision + 1,
       updated_at = excluded.updated_at
     WHERE excluded.games_played > saves.games_played
        OR (excluded.games_played = saves.games_played
            AND excluded.client_save_time > saves.client_save_time)`,
  )
    .bind(
      player.id,
      payload,
      metadata.gamesPlayed,
      metadata.wins,
      metadata.losses,
      metadata.curStar,
      metadata.rankId,
      metadata.rankLevel,
      metadata.clientSaveTime,
      now,
    )
    .run();

  const current = await getSaveRow(env, player.id);
  if (Number(result.meta.changes ?? 0) === 0) {
    throw new ApiError(409, "cloud_save_newer", "云端已有更新的进度", {
      cloudSave: parseSaveRow(current),
    });
  }
  return success({ save: parseSaveRow(current) });
}

async function handleLeaderboard(request: Request, env: Env): Promise<Response> {
  const player = await authenticate(request, env);
  const query = await env.DB.prepare(
    `SELECT p.id, p.nickname,
            s.wins, s.losses, s.cur_star, s.rank_id, s.rank_level,
            COALESCE(s.updated_at, p.created_at) AS sort_time
       FROM players p
       LEFT JOIN saves s ON s.player_id = p.id
      ORDER BY COALESCE(s.cur_star, 0) DESC,
               COALESCE(s.wins, 0) DESC,
               COALESCE(s.updated_at, p.created_at) ASC,
               p.nickname_key ASC
      LIMIT 50`,
  ).all<LeaderboardRow>();

  const entries = query.results.map((row, index) => {
    const curStar = Number(row.cur_star ?? 0);
    const fallbackRank = rankFromCurStar(curStar);
    return {
      position: index + 1,
      playerId: row.id,
      nickname: row.nickname,
      curStar,
      rankId: Number(row.rank_id ?? fallbackRank.rankId),
      rankLevel: Number(row.rank_level ?? fallbackRank.rankLevel),
      wins: Number(row.wins ?? 0),
      losses: Number(row.losses ?? 0),
      updatedAt: Number(row.sort_time),
      isCurrent: row.id === player.id,
    };
  });
  return success({ entries });
}

function normalizeRoomCode(value: string): string {
  if (!/^\d{6}$/.test(value)) {
    throw new ApiError(400, "invalid_room_code", "房间码须为 6 位数字");
  }
  return value;
}

function randomRoomCode(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(Number(bytes[0] ?? 0) % 1_000_000).padStart(6, "0");
}

function randomSeed(): number {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return Number(bytes[0] ?? 0) & 0x7fffffff;
}

function pvpPlayer(player: AuthenticatedPlayer): PvpPlayerIdentity {
  return { id: player.id, nickname: player.nickname };
}

function unwrapPvp<T>(result: PvpRpcResult<T>): T {
  if (result.ok) return result.data;
  const statusByCode: Record<string, number> = {
    room_not_found: 404,
    room_closed: 410,
    room_full: 409,
    room_started: 409,
    not_in_room: 403,
  };
  throw new ApiError(statusByCode[result.error.code] ?? 400, result.error.code, result.error.message);
}

async function handleCreatePvpRoom(request: Request, env: Env): Promise<Response> {
  const player = await authenticate(request, env);
  const now = Date.now();
  const configuredHours = Number.parseInt(env.PVP_ROOM_TTL_HOURS, 10);
  const ttlHours = Number.isFinite(configuredHours) ? Math.max(1, configuredHours) : 6;
  const expiresAt = now + ttlHours * 60 * 60 * 1000;
  const seed = randomSeed();
  let code = "";

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = randomRoomCode();
    try {
      const result = await env.DB.prepare(
        `INSERT INTO pvp_rooms
           (code, host_player_id, status, seed, created_at, expires_at)
         VALUES (?1, ?2, 'lobby', ?3, ?4, ?5)`,
      )
        .bind(candidate, player.id, seed, now, expiresAt)
        .run();
      if (Number(result.meta.changes ?? 0) > 0) {
        code = candidate;
        break;
      }
    } catch (error) {
      const collision = await env.DB.prepare("SELECT code FROM pvp_rooms WHERE code = ?1")
        .bind(candidate)
        .first<{ code: string }>();
      if (!collision) throw error;
    }
  }
  if (!code) throw new ApiError(503, "room_code_unavailable", "暂时无法创建房间，请重试");

  const stub = env.PVP_ROOM.getByName(code);
  const room = await stub.initialize(code, pvpPlayer(player), seed, now, expiresAt);
  const ticket = unwrapPvp(await stub.issueTicket(pvpPlayer(player)));
  return success({ code, side: 0, ticket: ticket.ticket, room }, 201);
}

async function handleJoinPvpRoom(request: Request, env: Env, codeValue: string): Promise<Response> {
  const player = await authenticate(request, env);
  const code = normalizeRoomCode(codeValue);
  const directory = await env.DB.prepare(
    "SELECT code, status, expires_at FROM pvp_rooms WHERE code = ?1 LIMIT 1",
  )
    .bind(code)
    .first<PvpRoomDirectoryRow>();
  if (!directory) throw new ApiError(404, "room_not_found", "房间不存在");
  if (directory.expires_at <= Date.now() || directory.status === "closed" || directory.status === "finished") {
    throw new ApiError(410, "room_closed", "房间已经结束");
  }

  const stub = env.PVP_ROOM.getByName(code);
  const joined = unwrapPvp(await stub.join(pvpPlayer(player)));
  const ticket = unwrapPvp(await stub.issueTicket(pvpPlayer(player)));
  return success({ code, side: joined.side, ticket: ticket.ticket, room: ticket.room });
}

async function handlePvpTicket(request: Request, env: Env, codeValue: string): Promise<Response> {
  const player = await authenticate(request, env);
  const code = normalizeRoomCode(codeValue);
  const stub = env.PVP_ROOM.getByName(code);
  const ticket = unwrapPvp(await stub.issueTicket(pvpPlayer(player)));
  return success({ code, side: ticket.side, ticket: ticket.ticket, room: ticket.room });
}

async function handlePvpIce(request: Request, env: Env): Promise<Response> {
  const player = await authenticate(request, env);
  const ttlSeconds = 2 * 60 * 60;
  const expiresAt = (Math.floor(Date.now() / 1000) + ttlSeconds) * 1000;
  const username = `${Math.floor(expiresAt / 1000)}:${player.id}`;
  const credential = await turnCredential(env, username);
  return success({
    expiresAt,
    ttlSeconds,
    iceServers: [
      { urls: ["stun:turn.euv.pp.ua:3478"] },
      {
        urls: [
          "turn:turn.euv.pp.ua:3478?transport=udp",
          "turn:turn.euv.pp.ua:3478?transport=tcp",
        ],
        username,
        credential,
      },
    ],
  });
}

async function handlePvpStats(request: Request, env: Env): Promise<Response> {
  const player = await authenticate(request, env);
  const stats = await env.DB.prepare(
    "SELECT wins, losses, games FROM pvp_stats WHERE player_id = ?1 LIMIT 1",
  )
    .bind(player.id)
    .first<PvpStatsRow>();
  const recent = await env.DB.prepare(
    `SELECT m.id, m.room_code, m.winner_player_id, m.loser_player_id,
            winner.nickname AS winner_name, loser.nickname AS loser_name,
            m.reason, m.winner_wave, m.loser_wave, m.started_at, m.finished_at
       FROM pvp_matches m
       JOIN players winner ON winner.id = m.winner_player_id
       JOIN players loser ON loser.id = m.loser_player_id
      WHERE m.winner_player_id = ?1 OR m.loser_player_id = ?1
      ORDER BY m.finished_at DESC
      LIMIT 10`,
  )
    .bind(player.id)
    .all<PvpMatchRow>();
  return success({
    stats: {
      wins: Number(stats?.wins ?? 0),
      losses: Number(stats?.losses ?? 0),
      games: Number(stats?.games ?? 0),
    },
    recent: recent.results.map((match) => ({
      id: match.id,
      roomCode: match.room_code,
      winnerPlayerId: match.winner_player_id,
      loserPlayerId: match.loser_player_id,
      winnerNickname: match.winner_name,
      loserNickname: match.loser_name,
      reason: match.reason,
      winnerWave: match.winner_wave,
      loserWave: match.loser_wave,
      startedAt: match.started_at,
      finishedAt: match.finished_at,
      won: match.winner_player_id === player.id,
    })),
  });
}

async function route(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";

  if (request.method === "GET" && path === "/health") {
    const result = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    return success({ status: result?.ok === 1 ? "ok" : "degraded" });
  }
  if (request.method === "POST" && path === "/v1/auth/enter") return handleEnter(request, env);
  if (request.method === "POST" && path === "/v1/auth/resume") return handleResume(request, env);
  if (request.method === "POST" && path === "/v1/auth/logout") return handleLogout(request, env);
  if (request.method === "GET" && path === "/v1/save") return handleGetSave(request, env);
  if (request.method === "PUT" && path === "/v1/save") return handlePutSave(request, env);
  if (request.method === "GET" && path === "/v1/leaderboard") return handleLeaderboard(request, env);
  if (request.method === "POST" && path === "/v1/pvp/rooms") return handleCreatePvpRoom(request, env);
  if (request.method === "GET" && path === "/v1/pvp/ice") return handlePvpIce(request, env);
  if (request.method === "GET" && path === "/v1/pvp/stats") return handlePvpStats(request, env);

  const joinMatch = path.match(/^\/v1\/pvp\/rooms\/(\d{6})\/join$/);
  if (request.method === "POST" && joinMatch?.[1]) {
    return handleJoinPvpRoom(request, env, joinMatch[1]);
  }
  const ticketMatch = path.match(/^\/v1\/pvp\/rooms\/(\d{6})\/ticket$/);
  if (request.method === "POST" && ticketMatch?.[1]) {
    return handlePvpTicket(request, env, ticketMatch[1]);
  }
  const socketMatch = path.match(/^\/v1\/pvp\/rooms\/(\d{6})\/socket$/);
  if (request.method === "GET" && socketMatch?.[1]) {
    return env.PVP_ROOM.getByName(socketMatch[1]).fetch(request);
  }
  throw new ApiError(404, "not_found", "接口不存在");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      if (error instanceof ApiError) return failure(error);
      console.error(
        JSON.stringify({
          message: "request failed",
          error: error instanceof Error ? error.message : String(error),
          path: new URL(request.url).pathname,
        }),
      );
      return failure(new ApiError(500, "internal_error", "服务器暂时不可用"));
    }
  },
} satisfies ExportedHandler<Env>;
