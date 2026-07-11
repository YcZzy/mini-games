import { DurableObject } from "cloudflare:workers";

const TICKET_TTL_MS = 2 * 60 * 1000;
const MAX_SOCKET_MESSAGE_BYTES = 32 * 1024;
const MAX_SDP_BYTES = 20 * 1024;
const MAX_ICE_CANDIDATE_BYTES = 4 * 1024;
const MIN_PROGRESS_INTERVAL_MS = 150;
const encoder = new TextEncoder();

type RoomPhase = "lobby" | "loading" | "running" | "finished" | "closed";
type ResultReason = "eliminated" | "disconnect" | "forfeit";

export interface PvpPlayerIdentity {
  id: string;
  nickname: string;
}

export interface PvpRoomView {
  code: string;
  phase: RoomPhase;
  seed: number;
  players: Array<{
    id: string;
    nickname: string;
    side: 0 | 1;
    ready: boolean;
    loaded: boolean;
    connected: boolean;
    rankName: string;
    hp: number;
    wave: number;
    reconnectDeadline: number | null;
  }>;
  startedAt: number | null;
  finishedAt: number | null;
  winnerPlayerId: string | null;
  reason: string | null;
}

export type PvpRpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

interface RoomRow {
  [key: string]: SqlStorageValue;
  code: string;
  phase: RoomPhase;
  seed: number;
  host_id: string;
  host_name: string;
  host_rank: string;
  guest_id: string | null;
  guest_name: string | null;
  guest_rank: string | null;
  host_ready: number;
  guest_ready: number;
  host_loaded: number;
  guest_loaded: number;
  host_hp: number;
  guest_hp: number;
  host_wave: number;
  guest_wave: number;
  host_disconnected_at: number;
  guest_disconnected_at: number;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  expires_at: number;
  winner_id: string | null;
  reason: string | null;
}

interface TicketRow {
  [key: string]: SqlStorageValue;
  player_id: string;
  expires_at: number;
}

interface TableColumnRow {
  [key: string]: SqlStorageValue;
  name: string;
}

interface ConnectionAttachment {
  playerId: string;
  nickname: string;
  side: 0 | 1;
  connectedAt: number;
  lastProgressAt: number;
}

interface SocketMessage {
  type?: unknown;
  ready?: unknown;
  rankName?: unknown;
  hp?: unknown;
  wave?: unknown;
  elapsed?: unknown;
  sdp?: unknown;
  candidate?: unknown;
}

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function integerInRange(value: unknown, minimum: number, maximum: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const integer = Math.trunc(value);
  return integer >= minimum && integer <= maximum ? integer : null;
}

function normalizeRankName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const rankName = value.normalize("NFKC").trim();
  const length = Array.from(rankName).length;
  if (length < 1 || length > 24 || /[\p{Cc}\p{Cf}]/u.test(rankName)) return null;
  return rankName;
}

function normalizeDescription(
  value: unknown,
  expectedType: "offer" | "answer",
): { type: "offer" | "answer"; sdp: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.type !== expectedType || typeof record.sdp !== "string") return null;
  if (encoder.encode(record.sdp).byteLength < 1 || encoder.encode(record.sdp).byteLength > MAX_SDP_BYTES) {
    return null;
  }
  return { type: expectedType, sdp: record.sdp };
}

function normalizeIceCandidate(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.candidate !== "string" || record.candidate.length > 2_048) return null;
  if (record.sdpMid !== null && record.sdpMid !== undefined && typeof record.sdpMid !== "string") return null;
  if (
    record.sdpMLineIndex !== null &&
    record.sdpMLineIndex !== undefined &&
    integerInRange(record.sdpMLineIndex, 0, 64) === null
  ) return null;
  const normalized = {
    candidate: record.candidate,
    sdpMid: typeof record.sdpMid === "string" ? record.sdpMid.slice(0, 64) : null,
    sdpMLineIndex: typeof record.sdpMLineIndex === "number" ? Math.trunc(record.sdpMLineIndex) : null,
    ...(typeof record.usernameFragment === "string"
      ? { usernameFragment: record.usernameFragment.slice(0, 128) }
      : {}),
  };
  return encoder.encode(JSON.stringify(normalized)).byteLength <= MAX_ICE_CANDIDATE_BYTES
    ? normalized
    : null;
}

function rpcError<T>(code: string, message: string): PvpRpcResult<T> {
  return { ok: false, error: { code, message } };
}

export class PvpRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS room (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          code TEXT NOT NULL,
          phase TEXT NOT NULL,
          seed INTEGER NOT NULL,
          host_id TEXT NOT NULL,
          host_name TEXT NOT NULL,
          host_rank TEXT NOT NULL DEFAULT '军士.一',
          guest_id TEXT,
          guest_name TEXT,
          guest_rank TEXT,
          host_ready INTEGER NOT NULL DEFAULT 0,
          guest_ready INTEGER NOT NULL DEFAULT 0,
          host_loaded INTEGER NOT NULL DEFAULT 0,
          guest_loaded INTEGER NOT NULL DEFAULT 0,
          host_hp INTEGER NOT NULL DEFAULT 3,
          guest_hp INTEGER NOT NULL DEFAULT 3,
          host_wave INTEGER NOT NULL DEFAULT 1,
          guest_wave INTEGER NOT NULL DEFAULT 1,
          host_disconnected_at INTEGER NOT NULL DEFAULT 0,
          guest_disconnected_at INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          started_at INTEGER,
          finished_at INTEGER,
          expires_at INTEGER NOT NULL,
          winner_id TEXT,
          reason TEXT
        );
        CREATE TABLE IF NOT EXISTS tickets (
          token_hash TEXT PRIMARY KEY,
          player_id TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tickets_expiry ON tickets(expires_at);
      `);
      const columns = new Set(
        this.ctx.storage.sql
          .exec<TableColumnRow>("PRAGMA table_info(room)")
          .toArray()
          .map((column) => column.name),
      );
      if (!columns.has("host_rank")) {
        this.ctx.storage.sql.exec("ALTER TABLE room ADD COLUMN host_rank TEXT NOT NULL DEFAULT '军士.一'");
      }
      if (!columns.has("guest_rank")) {
        this.ctx.storage.sql.exec("ALTER TABLE room ADD COLUMN guest_rank TEXT");
      }
    });
  }

  async initialize(
    code: string,
    host: PvpPlayerIdentity,
    seed: number,
    createdAt: number,
    expiresAt: number,
  ): Promise<PvpRoomView> {
    const existing = this.readRoom();
    if (!existing) {
      this.ctx.storage.sql.exec(
        `INSERT INTO room
           (singleton, code, phase, seed, host_id, host_name, created_at, expires_at)
         VALUES (1, ?, 'lobby', ?, ?, ?, ?, ?)`,
        code,
        seed,
        host.id,
        host.nickname,
        createdAt,
        expiresAt,
      );
    }
    await this.scheduleAlarm();
    return this.roomView(this.readRequiredRoom());
  }

  async join(player: PvpPlayerIdentity): Promise<PvpRpcResult<{ side: 0 | 1; room: PvpRoomView }>> {
    const room = this.readRoom();
    if (!room) return rpcError("room_not_found", "房间不存在");
    if (room.phase === "closed" || room.phase === "finished" || room.expires_at <= Date.now()) {
      return rpcError("room_closed", "房间已经结束");
    }
    if (room.host_id === player.id) {
      return { ok: true, data: { side: 0, room: this.roomView(room) } };
    }
    if (room.guest_id === player.id) {
      return { ok: true, data: { side: 1, room: this.roomView(room) } };
    }
    if (room.guest_id) return rpcError("room_full", "房间已有两名玩家");
    if (room.phase !== "lobby") return rpcError("room_started", "对战已经开始");

    this.ctx.storage.sql.exec(
      `UPDATE room
          SET guest_id = ?, guest_name = ?, guest_rank = '军士.一',
              guest_ready = 0, guest_loaded = 0,
              guest_hp = 3, guest_wave = 1, guest_disconnected_at = 0
        WHERE singleton = 1`,
      player.id,
      player.nickname,
    );
    await this.env.DB.prepare(
      `UPDATE pvp_rooms SET guest_player_id = ?1 WHERE code = ?2 AND guest_player_id IS NULL`,
    )
      .bind(player.id, room.code)
      .run();

    const updated = this.readRequiredRoom();
    this.broadcast({ type: "room", room: this.roomView(updated) });
    return { ok: true, data: { side: 1, room: this.roomView(updated) } };
  }

  async issueTicket(
    player: PvpPlayerIdentity,
  ): Promise<PvpRpcResult<{ ticket: string; side: 0 | 1; room: PvpRoomView }>> {
    const room = this.readRoom();
    if (!room) return rpcError("room_not_found", "房间不存在");
    if (room.phase === "closed" || room.expires_at <= Date.now()) {
      return rpcError("room_closed", "房间已经结束");
    }
    const side = this.sideForPlayer(room, player.id);
    if (side === null) return rpcError("not_in_room", "你还没有加入该房间");

    const now = Date.now();
    const ticket = randomToken();
    const tokenHash = await sha256Hex(ticket);
    this.ctx.storage.sql.exec("DELETE FROM tickets WHERE expires_at <= ?", now);
    this.ctx.storage.sql.exec(
      "INSERT INTO tickets (token_hash, player_id, expires_at) VALUES (?, ?, ?)",
      tokenHash,
      player.id,
      now + TICKET_TTL_MS,
    );
    return { ok: true, data: { ticket, side, room: this.roomView(room) } };
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const ticket = new URL(request.url).searchParams.get("ticket") ?? "";
    if (!/^[A-Za-z0-9_-]{20,80}$/.test(ticket)) {
      return new Response("Invalid ticket", { status: 401 });
    }
    const tokenHash = await sha256Hex(ticket);
    const now = Date.now();
    const ticketRow = this.ctx.storage.sql
      .exec<TicketRow>(
        "SELECT player_id, expires_at FROM tickets WHERE token_hash = ? LIMIT 1",
        tokenHash,
      )
      .toArray()[0];
    this.ctx.storage.sql.exec("DELETE FROM tickets WHERE token_hash = ? OR expires_at <= ?", tokenHash, now);
    if (!ticketRow || ticketRow.expires_at <= now) {
      return new Response("Ticket expired", { status: 401 });
    }

    const room = this.readRoom();
    if (!room || room.phase === "closed" || room.expires_at <= now) {
      return new Response("Room closed", { status: 410 });
    }
    const side = this.sideForPlayer(room, ticketRow.player_id);
    if (side === null) return new Response("Not in room", { status: 403 });
    const nickname = side === 0 ? room.host_name : room.guest_name;
    if (!nickname) return new Response("Player missing", { status: 403 });

    for (const existing of this.ctx.getWebSockets()) {
      const attachment = this.attachment(existing);
      if (attachment?.playerId === ticketRow.player_id) {
        existing.close(4001, "Replaced by a newer connection");
      }
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    const attachment: ConnectionAttachment = {
      playerId: ticketRow.player_id,
      nickname,
      side,
      connectedAt: now,
      lastProgressAt: 0,
    };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server);
    this.setDisconnectedAt(side, 0);

    const connectedRoom = this.readRequiredRoom();
    server.send(JSON.stringify({ type: "welcome", side, room: this.roomView(connectedRoom) }));
    this.broadcast({ type: "room", room: this.roomView(connectedRoom) });
    if (this.allPlayersConnected(connectedRoom)) {
      this.broadcast({ type: "resume", room: this.roomView(connectedRoom) });
    }
    await this.scheduleAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, rawMessage: string | ArrayBuffer): Promise<void> {
    const attachment = this.attachment(ws);
    if (!attachment) {
      ws.close(4003, "Missing connection identity");
      return;
    }
    if (typeof rawMessage !== "string" || encoder.encode(rawMessage).byteLength > MAX_SOCKET_MESSAGE_BYTES) {
      this.sendError(ws, "invalid_message", "消息格式不正确");
      return;
    }

    let message: SocketMessage;
    try {
      message = JSON.parse(rawMessage) as SocketMessage;
    } catch {
      this.sendError(ws, "invalid_json", "消息格式不正确");
      return;
    }

    const room = this.readRoom();
    if (!room) {
      this.sendError(ws, "room_not_found", "房间不存在");
      return;
    }

    if (message.type === "ping") {
      ws.send(JSON.stringify({ type: "pong", at: Date.now() }));
      return;
    }

    if (message.type === "profile") {
      const rankName = normalizeRankName(message.rankName);
      if (!rankName) {
        this.sendError(ws, "invalid_profile", "段位信息不正确");
        return;
      }
      const column = attachment.side === 0 ? "host_rank" : "guest_rank";
      this.ctx.storage.sql.exec(`UPDATE room SET ${column} = ? WHERE singleton = 1`, rankName);
      this.broadcast({ type: "room", room: this.roomView(this.readRequiredRoom()) });
      return;
    }

    if (message.type === "rtc_ready") {
      if ((room.phase === "loading" || room.phase === "running") && room.guest_id) {
        this.sendPeer(ws, { type: "rtc_ready", side: attachment.side });
      }
      return;
    }

    if (message.type === "rtc_offer" || message.type === "rtc_answer") {
      if ((room.phase !== "loading" && room.phase !== "running") || !room.guest_id) return;
      const expectedType = message.type === "rtc_offer" ? "offer" : "answer";
      if (
        (expectedType === "offer" && attachment.side !== 0) ||
        (expectedType === "answer" && attachment.side !== 1)
      ) {
        this.sendError(ws, "invalid_rtc_role", "实时画面连接角色不正确");
        return;
      }
      const description = normalizeDescription(message.sdp, expectedType);
      if (!description) {
        this.sendError(ws, "invalid_rtc_sdp", "实时画面协商信息不正确");
        return;
      }
      this.sendPeer(ws, { type: message.type, side: attachment.side, sdp: description });
      return;
    }

    if (message.type === "rtc_ice") {
      if ((room.phase !== "loading" && room.phase !== "running") || !room.guest_id) return;
      const candidate = normalizeIceCandidate(message.candidate);
      if (!candidate) {
        this.sendError(ws, "invalid_rtc_candidate", "实时画面网络信息不正确");
        return;
      }
      this.sendPeer(ws, { type: "rtc_ice", side: attachment.side, candidate });
      return;
    }

    if (message.type === "ready") {
      if (room.phase !== "lobby") {
        this.sendError(ws, "invalid_phase", "当前不能修改准备状态");
        return;
      }
      const ready = message.ready === true;
      const column = attachment.side === 0 ? "host_ready" : "guest_ready";
      this.ctx.storage.sql.exec(`UPDATE room SET ${column} = ? WHERE singleton = 1`, ready ? 1 : 0);
      const updated = this.readRequiredRoom();
      this.broadcast({ type: "room", room: this.roomView(updated) });
      if (
        updated.guest_id &&
        updated.host_ready === 1 &&
        updated.guest_ready === 1 &&
        this.allPlayersConnected(updated)
      ) {
        this.ctx.storage.sql.exec(
          `UPDATE room
              SET phase = 'loading', host_loaded = 0, guest_loaded = 0,
                  host_hp = 3, guest_hp = 3, host_wave = 1, guest_wave = 1,
                  started_at = NULL, finished_at = NULL, winner_id = NULL, reason = NULL
            WHERE singleton = 1`,
        );
        const loadingRoom = this.readRequiredRoom();
        await this.env.DB.prepare("UPDATE pvp_rooms SET status = 'loading' WHERE code = ?1")
          .bind(loadingRoom.code)
          .run();
        this.broadcast({ type: "load", seed: loadingRoom.seed, room: this.roomView(loadingRoom) });
      }
      return;
    }

    if (message.type === "loaded") {
      if (room.phase !== "loading") return;
      const column = attachment.side === 0 ? "host_loaded" : "guest_loaded";
      this.ctx.storage.sql.exec(`UPDATE room SET ${column} = 1 WHERE singleton = 1`);
      const updated = this.readRequiredRoom();
      this.broadcast({ type: "room", room: this.roomView(updated) });
      if (
        updated.host_loaded === 1 &&
        updated.guest_loaded === 1 &&
        this.allPlayersConnected(updated)
      ) {
        const startAt = Date.now() + 1200;
        this.ctx.storage.sql.exec(
          "UPDATE room SET phase = 'running', started_at = ? WHERE singleton = 1",
          startAt,
        );
        await this.env.DB.prepare(
          "UPDATE pvp_rooms SET status = 'running', started_at = ?1 WHERE code = ?2",
        )
          .bind(startAt, updated.code)
          .run();
        const runningRoom = this.readRequiredRoom();
        this.broadcast({ type: "go", startAt, room: this.roomView(runningRoom) });
      }
      return;
    }

    if (message.type === "progress") {
      if (room.phase !== "running") return;
      const now = Date.now();
      const hp = integerInRange(message.hp, 0, 3);
      const wave = integerInRange(message.wave, 0, 10_000);
      const elapsed = integerInRange(message.elapsed, 0, 24 * 60 * 60 * 1000);
      if (hp === null || wave === null || elapsed === null) {
        this.sendError(ws, "invalid_progress", "对战状态不正确");
        return;
      }
      // 生命归零是终局事件，不能因为刚发送过普通进度而被限流丢弃。
      if (hp > 0 && now - attachment.lastProgressAt < MIN_PROGRESS_INTERVAL_MS) return;
      attachment.lastProgressAt = now;
      ws.serializeAttachment(attachment);
      if (attachment.side === 0) {
        this.ctx.storage.sql.exec(
          "UPDATE room SET host_hp = ?, host_wave = ? WHERE singleton = 1",
          hp,
          wave,
        );
      } else {
        this.ctx.storage.sql.exec(
          "UPDATE room SET guest_hp = ?, guest_wave = ? WHERE singleton = 1",
          hp,
          wave,
        );
      }
      this.broadcast({ type: "progress", side: attachment.side, hp, wave, elapsed });
      if (hp === 0) await this.finish(attachment.side === 0 ? 1 : 0, "eliminated");
      return;
    }

    if (message.type === "leave" || message.type === "forfeit") {
      if (room.phase === "running" || room.phase === "loading") {
        await this.finish(attachment.side === 0 ? 1 : 0, "forfeit");
      } else if (attachment.side === 0) {
        await this.closeRoom();
      } else {
        this.removeGuest();
        const updated = this.readRequiredRoom();
        await this.env.DB.prepare(
          "UPDATE pvp_rooms SET guest_player_id = NULL WHERE code = ?1",
        )
          .bind(updated.code)
          .run();
        this.broadcast({ type: "room", room: this.roomView(updated) });
      }
      return;
    }

    this.sendError(ws, "unknown_message", "不支持的消息类型");
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    await this.handleDisconnect(ws);
  }

  override async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error(JSON.stringify({ message: "pvp websocket error", error: String(error) }));
    await this.handleDisconnect(ws);
  }

  override async alarm(): Promise<void> {
    const room = this.readRoom();
    if (!room) return;
    const now = Date.now();
    if (room.expires_at <= now && room.phase !== "finished" && room.phase !== "closed") {
      await this.closeRoom();
      return;
    }

    const reconnectMs = this.reconnectMs();
    for (const side of [0, 1] as const) {
      const playerId = side === 0 ? room.host_id : room.guest_id;
      const disconnectedAt = side === 0 ? room.host_disconnected_at : room.guest_disconnected_at;
      if (!playerId || !disconnectedAt || this.isPlayerConnected(playerId)) continue;
      if (disconnectedAt + reconnectMs > now) continue;

      if (room.phase === "running" || room.phase === "loading") {
        await this.finish(side === 0 ? 1 : 0, "disconnect");
        return;
      }
      if (side === 0) {
        await this.closeRoom();
        return;
      }
      this.removeGuest();
      await this.env.DB.prepare("UPDATE pvp_rooms SET guest_player_id = NULL WHERE code = ?1")
        .bind(room.code)
        .run();
      this.broadcast({ type: "room", room: this.roomView(this.readRequiredRoom()) });
    }
    await this.scheduleAlarm();
  }

  private readRoom(): RoomRow | null {
    return this.ctx.storage.sql.exec<RoomRow>("SELECT * FROM room WHERE singleton = 1").toArray()[0] ?? null;
  }

  private readRequiredRoom(): RoomRow {
    const room = this.readRoom();
    if (!room) throw new Error("PVP room is not initialized");
    return room;
  }

  private sideForPlayer(room: RoomRow, playerId: string): 0 | 1 | null {
    if (room.host_id === playerId) return 0;
    if (room.guest_id === playerId) return 1;
    return null;
  }

  private attachment(ws: WebSocket): ConnectionAttachment | null {
    try {
      return ws.deserializeAttachment() as ConnectionAttachment | null;
    } catch {
      return null;
    }
  }

  private connectedPlayerIds(): Set<string> {
    const ids = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const attachment = this.attachment(ws);
      if (attachment) ids.add(attachment.playerId);
    }
    return ids;
  }

  private isPlayerConnected(playerId: string, excluded?: WebSocket): boolean {
    return this.ctx.getWebSockets().some((ws) => {
      if (ws === excluded || ws.readyState !== WebSocket.OPEN) return false;
      return this.attachment(ws)?.playerId === playerId;
    });
  }

  private allPlayersConnected(room: RoomRow): boolean {
    if (!room.guest_id) return false;
    const connected = this.connectedPlayerIds();
    return connected.has(room.host_id) && connected.has(room.guest_id);
  }

  private roomView(room: RoomRow): PvpRoomView {
    const connected = this.connectedPlayerIds();
    const reconnectMs = this.reconnectMs();
    const players: PvpRoomView["players"] = [
      {
        id: room.host_id,
        nickname: room.host_name,
        side: 0,
        ready: room.host_ready === 1,
        loaded: room.host_loaded === 1,
        connected: connected.has(room.host_id),
        rankName: room.host_rank || "军士.一",
        hp: room.host_hp,
        wave: room.host_wave,
        reconnectDeadline: room.host_disconnected_at
          ? room.host_disconnected_at + reconnectMs
          : null,
      },
    ];
    if (room.guest_id && room.guest_name) {
      players.push({
        id: room.guest_id,
        nickname: room.guest_name,
        side: 1,
        ready: room.guest_ready === 1,
        loaded: room.guest_loaded === 1,
        connected: connected.has(room.guest_id),
        rankName: room.guest_rank || "军士.一",
        hp: room.guest_hp,
        wave: room.guest_wave,
        reconnectDeadline: room.guest_disconnected_at
          ? room.guest_disconnected_at + reconnectMs
          : null,
      });
    }
    return {
      code: room.code,
      phase: room.phase,
      seed: room.seed,
      players,
      startedAt: room.started_at,
      finishedAt: room.finished_at,
      winnerPlayerId: room.winner_id,
      reason: room.reason,
    };
  }

  private broadcast(message: unknown): void {
    const payload = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      try {
        ws.send(payload);
      } catch (error) {
        console.error(JSON.stringify({ message: "pvp broadcast failed", error: String(error) }));
      }
    }
  }

  private sendPeer(source: WebSocket, message: unknown): void {
    const sourceSide = this.attachment(source)?.side;
    if (sourceSide === undefined) return;
    const payload = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === source || ws.readyState !== WebSocket.OPEN) continue;
      if (this.attachment(ws)?.side === sourceSide) continue;
      try {
        ws.send(payload);
      } catch (error) {
        console.error(JSON.stringify({ message: "pvp peer relay failed", error: String(error) }));
      }
    }
  }

  private sendError(ws: WebSocket, code: string, message: string): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "error", error: { code, message } }));
    }
  }

  private setDisconnectedAt(side: 0 | 1, value: number): void {
    const column = side === 0 ? "host_disconnected_at" : "guest_disconnected_at";
    this.ctx.storage.sql.exec(`UPDATE room SET ${column} = ? WHERE singleton = 1`, value);
  }

  private removeGuest(): void {
    this.ctx.storage.sql.exec(
      `UPDATE room
          SET guest_id = NULL, guest_name = NULL, guest_rank = NULL,
              guest_ready = 0, guest_loaded = 0,
              guest_hp = 3, guest_wave = 1, guest_disconnected_at = 0,
              host_ready = 0
        WHERE singleton = 1`,
    );
  }

  private async handleDisconnect(ws: WebSocket): Promise<void> {
    const attachment = this.attachment(ws);
    if (!attachment || this.isPlayerConnected(attachment.playerId, ws)) return;
    const room = this.readRoom();
    if (!room || room.phase === "finished" || room.phase === "closed") return;

    const disconnectedAt = Date.now();
    this.setDisconnectedAt(attachment.side, disconnectedAt);
    const updated = this.readRequiredRoom();
    this.broadcast({
      type: "peer_disconnected",
      side: attachment.side,
      deadline: disconnectedAt + this.reconnectMs(),
      room: this.roomView(updated),
    });
    await this.scheduleAlarm();
  }

  private reconnectMs(): number {
    const seconds = Number.parseInt(this.env.PVP_RECONNECT_SECONDS, 10);
    return (Number.isFinite(seconds) ? Math.max(5, seconds) : 30) * 1000;
  }

  private async scheduleAlarm(): Promise<void> {
    const room = this.readRoom();
    if (!room) return;
    const candidates = [room.expires_at];
    const reconnectMs = this.reconnectMs();
    if (room.host_disconnected_at) candidates.push(room.host_disconnected_at + reconnectMs);
    if (room.guest_disconnected_at) candidates.push(room.guest_disconnected_at + reconnectMs);
    const next = Math.min(...candidates.filter((value) => value > Date.now()));
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next);
  }

  private async finish(winnerSide: 0 | 1, reason: ResultReason): Promise<void> {
    const room = this.readRoom();
    if (!room || room.phase === "finished" || room.phase === "closed" || !room.guest_id) return;
    const winnerId = winnerSide === 0 ? room.host_id : room.guest_id;
    const loserId = winnerSide === 0 ? room.guest_id : room.host_id;
    const winnerWave = winnerSide === 0 ? room.host_wave : room.guest_wave;
    const loserWave = winnerSide === 0 ? room.guest_wave : room.host_wave;
    const finishedAt = Date.now();

    this.ctx.storage.sql.exec(
      `UPDATE room
          SET phase = 'finished', finished_at = ?, winner_id = ?, reason = ?
        WHERE singleton = 1`,
      finishedAt,
      winnerId,
      reason,
    );
    const finishedRoom = this.readRequiredRoom();
    try {
      await this.env.DB.prepare(
        `UPDATE pvp_rooms
            SET status = 'finished', winner_player_id = ?1, loser_player_id = ?2,
                result_reason = ?3, finished_at = ?4
          WHERE code = ?5`,
      )
        .bind(winnerId, loserId, reason, finishedAt, room.code)
        .run();
      const inserted = await this.env.DB.prepare(
        `INSERT INTO pvp_matches
           (id, room_code, winner_player_id, loser_player_id, reason,
            winner_wave, loser_wave, started_at, finished_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(room_code) DO NOTHING`,
      )
        .bind(
          crypto.randomUUID(),
          room.code,
          winnerId,
          loserId,
          reason,
          winnerWave,
          loserWave,
          room.started_at ?? room.created_at,
          finishedAt,
        )
        .run();
      if (Number(inserted.meta.changes ?? 0) > 0) {
        await this.env.DB.batch([
          this.env.DB.prepare(
            `INSERT INTO pvp_stats (player_id, wins, losses, games, updated_at)
             VALUES (?1, 1, 0, 1, ?2)
             ON CONFLICT(player_id) DO UPDATE SET
               wins = pvp_stats.wins + 1,
               games = pvp_stats.games + 1,
               updated_at = excluded.updated_at`,
          ).bind(winnerId, finishedAt),
          this.env.DB.prepare(
            `INSERT INTO pvp_stats (player_id, wins, losses, games, updated_at)
             VALUES (?1, 0, 1, 1, ?2)
             ON CONFLICT(player_id) DO UPDATE SET
               losses = pvp_stats.losses + 1,
               games = pvp_stats.games + 1,
               updated_at = excluded.updated_at`,
          ).bind(loserId, finishedAt),
        ]);
      }
    } catch (error) {
      console.error(
        JSON.stringify({ message: "pvp result persistence failed", roomCode: room.code, error: String(error) }),
      );
    }
    this.broadcast({
      type: "result",
      winnerSide,
      winnerPlayerId: winnerId,
      loserPlayerId: loserId,
      reason,
      room: this.roomView(finishedRoom),
    });
    await this.scheduleAlarm();
  }

  private async closeRoom(): Promise<void> {
    const room = this.readRoom();
    if (!room || room.phase === "closed") return;
    const finishedAt = Date.now();
    this.ctx.storage.sql.exec(
      "UPDATE room SET phase = 'closed', finished_at = ? WHERE singleton = 1",
      finishedAt,
    );
    await this.env.DB.prepare(
      "UPDATE pvp_rooms SET status = 'closed', finished_at = ?1 WHERE code = ?2",
    )
      .bind(finishedAt, room.code)
      .run();
    this.broadcast({ type: "closed", room: this.roomView(this.readRequiredRoom()) });
    for (const ws of this.ctx.getWebSockets()) ws.close(1000, "Room closed");
  }
}
