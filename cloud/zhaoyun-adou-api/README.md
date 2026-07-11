# 赵云与阿斗浏览器云服务

Cloudflare Worker + D1 + Durable Objects，提供：

- 昵称 + 4～6 位 PIN 注册/登录
- 完整 `playerData` 云存档
- 按原游戏段位、胜场、达成时间排序的唯一总榜
- 好友 1v1 实时生存赛：6 位房间码、邀请链接、准备/加载同步、生命与波次同步
- 双方普通段位资料同步；各自使用普通存档的武器、道具和独立随机士兵
- WebRTC 战场画面镜像，NAT 穿透失败时自动回落到 coturn 中继
- Durable Objects + WebSocket 房间协调和 WebRTC 信令转发，断线保留 30 秒
- 独立好友战绩，不污染原游戏段位、普通胜负和总局数
- 旧存档保护：对局数优先，其次比较 `_saveTime`

## 本地开发

```bash
# 根目录执行
npm install
npx wrangler d1 migrations apply DB --local \
  --config cloud/zhaoyun-adou-api/wrangler.jsonc
npm run dev:cloud-api
```

另开终端启动静态站点：

```bash
python3 -m http.server 4173
```

访问 <http://127.0.0.1:4173/zhaoyun-adou/>。本地页面默认连接
`http://127.0.0.1:8787`。

本地密钥放在 `cloud/zhaoyun-adou-api/.dev.vars`，该文件已被 Git 忽略。可从
`.dev.vars.example` 复制后填写：`PIN_PEPPER` 使用随机值；`TURN_SECRET` 必须与
coturn 的 `static-auth-secret` 一致。

## 验证

```bash
npm run typecheck:cloud
npm run test:cloud-api
npm run test:pvp-e2e
# 双浏览器测试会强制走 TURN，并验证双方 mediaTransport=中继、overlay 像素、结算与存档恢复
npx wrangler deploy --dry-run \
  --config cloud/zhaoyun-adou-api/wrangler.jsonc
npx playwright test tests/zhaoyun-cloud.spec.js
```

## 生产部署

1. 创建 D1 数据库：

   ```bash
   npx wrangler d1 create zhaoyun-adou
   ```

2. 将命令返回的 `database_id` 加入 `wrangler.jsonc` 的 `DB` 绑定。
3. 生成随机 `PIN_PEPPER`，并通过交互式命令保存（不要提交到 Git）：

   ```bash
   openssl rand -hex 32
   npx wrangler secret put PIN_PEPPER \
     --config cloud/zhaoyun-adou-api/wrangler.jsonc
   ```

4. 配置 coturn 的共享密钥，并把同一个值保存为 Worker Secret：

   ```bash
   openssl rand -hex 32
   npx wrangler secret put TURN_SECRET \
     --config cloud/zhaoyun-adou-api/wrangler.jsonc
   ```

5. 执行远程迁移并部署：

   ```bash
   npx wrangler d1 migrations apply DB --remote \
     --config cloud/zhaoyun-adou-api/wrangler.jsonc
   npx wrangler deploy \
     --config cloud/zhaoyun-adou-api/wrangler.jsonc
   ```

6. 生产 Worker 通过 `wrangler.jsonc` 绑定到 `https://api.euv.pp.ua`；
   浏览器默认使用 DMIT 美西优化线路上的 Caddy 中转
   `https://relay.euv.pp.ua`。`api.euv.pp.ua` 和 `workers.dev` 保留为
   运维备用入口，避免国内客户端直接依赖 `workers.dev`。

部署 Worker 时，`wrangler.jsonc` 中的 `pvp-room-v1` 会创建 SQLite-backed
Durable Object 类；`0002_pvp.sql` 会创建房间目录、比赛记录和好友战绩表。

## 国内线路中转

`relay.euv.pp.ua` 使用 DNS-only A 记录指向 DMIT VPS，由 Caddy 同时转发
普通 HTTPS 和 WebSocket。不要给该记录开启 Cloudflare 代理，否则会重新经过
当前国内抖动较大的 Anycast 链路。

```caddyfile
relay.euv.pp.ua {
    encode zstd gzip
    reverse_proxy https://zhaoyun-adou-api.dqpmyyww.workers.dev {
        header_up Host zhaoyun-adou-api.dqpmyyww.workers.dev
        flush_interval -1
        transport http {
            tls_server_name zhaoyun-adou-api.dqpmyyww.workers.dev
            dial_timeout 10s
            response_header_timeout 1h
        }
    }
}
```

Cloudflare Worker、D1 和 Durable Object 仍是业务后端；VPS 只负责传输中转，
不保存 PIN、Session、存档或好友战绩。

## WebRTC 与 TURN

- Laya 主画布由浏览器 `captureStream(12)` 捕获，视频轨道限制约 `900 kbps / 12 fps`。
- WebSocket 只负责房间状态和 WebRTC 信令；音视频数据不经过 Durable Object。
- `GET /v1/pvp/ice` 为已登录玩家签发 2 小时有效的 TURN REST 临时凭据，用户名格式为 `<expiresAt>:<playerId>`，密码使用 `TURN_SECRET` 做 HMAC-SHA1。
- coturn 使用 `use-auth-secret`，realm 为 `turn.euv.pp.ua`；监听 `3478/TCP+UDP`，relay 端口范围为 `49160-49200`。
- `turn.euv.pp.ua` 必须是 DNS-only 记录。客户端默认 `iceTransportPolicy: "all"`，直连失败时才使用 TURN；测试可设置 `window.ZHAOYUN_PVP_FORCE_RELAY = true` 强制中继。
- 远端视频仅用于好友状态镜像，不参与胜负判定；生命归零、断线和结算仍由房间状态机处理。

## 好友对战协议

- `POST /v1/pvp/rooms`：创建房间
- `POST /v1/pvp/rooms/:code/join`：加入房间
- `POST /v1/pvp/rooms/:code/ticket`：获取一次性 WebSocket 票据
- `GET /v1/pvp/rooms/:code/socket?ticket=...`：实时房间连接
- `GET /v1/pvp/ice`：签发 WebRTC STUN/TURN 配置和临时凭据
- `GET /v1/pvp/stats`：好友战绩和最近比赛

每个房间对应一个 Durable Object。双方准备后先进入 `loading`，两端都确认
`BattleScene` 已加载才进入 `running`。WebSocket 消息包含段位 `profile`、生命/波次
进度，以及只转发给对端的 `rtc_ready` / `rtc_offer` / `rtc_answer` / `rtc_ice`
信令。任一方生命归零、认输或断线超过 30 秒时，由房间对象统一结算并写入 D1；
好友局使用临时存档副本，不会写回普通胜负、总局数、段位或道具消耗。

## 安全边界

- PIN 使用 Worker Secret 作为 HMAC pepper；数据库中不保存明文 PIN。
- 连续 5 次错误会锁定该昵称 5 分钟。
- 会话令牌为 256 位随机值，D1 中只保存 SHA-256 摘要。
- 最多允许 20 个玩家，适合小范围熟人使用。
- 客户端游戏逻辑仍可被浏览器用户篡改，因此这里只做字段、频率和房间身份校验，不承诺强反作弊。
- 好友生存赛由客户端上报生命和波次，定位是 4～5 人熟人娱乐 MVP，不适合公开竞技或奖励结算。
