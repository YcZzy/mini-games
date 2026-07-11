# 赵云与阿斗 · 本地运行说明

这是一个解包的微信小游戏（LayaAir 3 引擎）。原本只能在微信里跑，通过下面几个垫片文件让它在浏览器里也能玩。

## 怎么跑

需要通过本地 HTTP 服务器访问（浏览器不允许 `file://` 直接 fetch 资源）：

```bash
# 在“游戏合集”根目录执行
python3 -m http.server 8080
```

另开一个终端启动浏览器版云服务：

```bash
npm run dev:cloud-api
```

本地密钥放在 `cloud/zhaoyun-adou-api/.dev.vars`。`PIN_PEPPER` 用于 PIN
摘要；`TURN_SECRET` 必须与 coturn 的 `static-auth-secret` 一致，才能签发好友画面
中继凭据。可从 `.dev.vars.example` 复制后填写，密钥文件不要提交。

然后浏览器打开：<http://localhost:8080/zhaoyun-adou/index.html>

如果只想跳过云登录测试原游戏，可访问 `index.html?cloud=off`。

**建议用竖屏**：游戏是竖屏（640×1386）。桌面浏览器是横屏会拉伸。两种办法：
- Chrome 开发者工具 → 设备工具栏（Toggle device toolbar）→ 选一个手机型号（如 iPhone 12，竖屏）。
- 或把浏览器窗口拉成竖长条。

## 文件说明

| 文件 | 作用 |
|---|---|
| `index.html` | 合集内入口。设 `window.GameGlobal = window`，手机端铺满可见视口，并按序加载下面几个脚本。 |
| `wx-shim.js` | **核心**。把 `wx.*`（微信 API）映射到浏览器 API，并阻止原小游戏排行榜接口。 |
| `browser-cloud.js` | 昵称/PIN 登录、云存档合并与自动同步、浏览器总榜，以及原排行榜入口替换。 |
| `browser-pvp.js` / `.css` | 好友房间、WebSocket 重连、普通存档的临时对战副本、段位资料、生命/波次同步、WebRTC 好友战场镜像和结果界面。 |
| `cloud-config.js` | 云 API 地址；本地默认连接 Wrangler 的 `127.0.0.1:8787`。 |
| `mini-game-loader.js` | 提供 `define` / `require` 模块加载器（解包后的 game.js 用微信运行时的模块系统）。 |
| `laya-interceptor.js` | 在 `window.Laya` 赋值瞬间修补：令 `Laya.Browser.onWXMiniGame=true`、恢复画布原型链、删除 adapter 挂的伪造 addEventListener。 |
| `input-fix.js` | 输入修复。adapter 把主画布的 addEventListener 换成了伪造版本，Laya 监听收不到真实事件；这里在 InputManager 就绪后用真实 EventTarget API 直接挂鼠标/触摸监听。 |
| `game.js` | 原始解包文件（含 weapp-adapter + Laya 引擎 + 游戏逻辑，单文件 5.6MB），未改动。 |

## 已知情况

- ✅ 启动、加载、主菜单、武器/商店等界面都能渲染，鼠标/触摸输入正常（已验证 Laya 能收到 CLICK 事件）。
- ✅ 浏览器版使用独立的 Cloudflare D1 云存档和总榜，不再调用原小游戏总榜/省榜。
- ✅ 首次进入用昵称和 PIN 创建玩家；换设备可使用同一凭据恢复进度。
- ✅ 主界面提供“好友对战”：创建 6 位房间码/邀请链接，双方使用各自普通存档中的真实段位、武器和道具进行独立守城竞速。
- ✅ 好友局各自随机刷新士兵；道具在临时存档副本中使用，不扣普通存档库存。
- ✅ 对战中通过 WebRTC 镜像好友阵位、士兵、武器、道具效果和操作栏，并同步双方生命、波次及正常段位。
- ✅ 默认优先直连，NAT 穿透失败时自动使用 `turn.euv.pp.ua` 中继；断线等待 30 秒，超时判负。
- ✅ 好友结果只写入独立好友战绩，不增加普通胜负/总局数，也不改变段位。
- ⚠️ 原小游戏的随机在线匹配仍不可用，浏览器版使用独立好友房间代替。
- ⚠️ 短暂网络断线会自动重连房间和好友画面；若刷新或关闭整个页面，本地阵型无法精确恢复，会重新载入战场。
- ⚠️ `share_v2.json` 被 CDN 的 CORS 拦截时会使用本地默认配置。
- 桌面端用鼠标点；触屏设备用触摸。鼠标会自动映射成单点触摸。
- 安卓 Chrome 可在游戏「设置」里打开「全屏模式」；浏览器要求全屏必须由用户点击触发，因此需要点设置里的开关。

## 好友画面与 TURN

好友房间的控制状态继续走 Durable Object WebSocket；战场画面则从 Laya 主画布
`captureStream(12)`，通过 WebRTC 视频轨道发送。远端视频绘制到独立 overlay canvas：
上半区旋转 180° 显示好友战场，右上角额外裁剪好友道具操作栏。发送端限制约
`900 kbps / 12 fps`，避免移动网络占用过高。

登录玩家从 `GET /v1/pvp/ice` 获取 2 小时有效的 TURN 临时凭据。正常运行使用
`iceTransportPolicy: "all"`；排查中继时可在页面启动前设置
`window.ZHAOYUN_PVP_FORCE_RELAY = true`，此时 HUD 的媒体状态应显示“中继”。

## 原理简述

微信小游戏运行时提供：`wx.*` API、`GameGlobal` 全局、`define/require` 模块系统。
解包后的 `game.js` 把 weapp-adapter（把浏览器 API 桥接到 wx）+ Laya 引擎 + 游戏逻辑全打在一个文件里。
所以只要在浏览器里补上 `wx`（指向浏览器 API）和 `define/require`，并处理几处 adapter 对 DOM 的破坏（伪造 document.body、伪造 addEventListener），就能形成闭环跑起来。
