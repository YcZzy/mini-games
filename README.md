# 游戏合集

精致的 HTML5 小游戏合集；大部分游戏为纯静态资源，「赵云与阿斗」另带云存档、排行榜和好友实时对战服务。

打开根目录的 `index.html` 即为游戏首页(卡片墙导航),点击卡片进入对应游戏。

## 目录结构

```
.
├── index.html        # 游戏首页(合集导航)
├── tetris/
│   └── index.html    # 俄罗斯方块
├── snake/
│   └── index.html    # 贪吃蛇
├── minesweeper/
│   └── index.html    # 扫雷
├── zhaoyun-adou/
│   ├── index.html    # 赵云与阿斗
│   └── resources/    # LayaAir 游戏资源
└── README.md
```

## 游戏列表

### 🎮 俄罗斯方块 (Tetris)
- **路径**: `tetris/index.html`
- **特性**: 
  - 经典 SRS 旋转系统 + 7-bag 随机
  - T-Spin、Combo、Back-to-Back 计分
  - Hold、Next×5、Ghost 虚影
  - 锁定延迟(500ms,最多 15 次重置)
  - DAS/ARR 横移优化
  - 极简深色 UI,统一设计语言
  - 触屏支持
  - 零依赖,单文件 HTML
- **操作**:
  - `← →` 移动,`↓` 软降,`空格` 硬降
  - `↑ / X` 顺时针旋转,`Z / Ctrl` 逆时针旋转
  - `C / Shift` 暂存(Hold)
  - `P` 暂停,`R` 重开
- **技术栈**: 原生 HTML5 Canvas 2D,IIFE 封装,无外部依赖

### 🐍 贪吃蛇 (Snake)
- **路径**: `snake/index.html`
- **特性**: 
  - 四种模式:经典撞墙、无界穿墙、迷宫障碍、极速加速
  - 道具系统:穿身、磁吸、减速、缩短(✂️)
  - 金苹果限时高分 · Combo 连击倍率(最高 ×9)
  - 平滑插值移动 + 穿墙补间渲染
  - 极简深色 UI,统一设计语言
  - 触屏摇杆支持
  - 零依赖,单文件 HTML
- **操作**:
  - `← → ↑ ↓ / WASD` 控制移动方向
  - `空格 / Enter` 开始,`P / 空格` 暂停/继续
  - `R` 重新开始
- **技术栈**: 原生 HTML5 Canvas 2D,IIFE 封装,无外部依赖

### 💣 扫雷 (Minesweeper)
- **路径**: `minesweeper/index.html`
- **特性**:
  - 经典三档难度:初级 9×9/10 雷,中级 16×16/40 雷,高级 30×16/99 雷
  - 首次翻开格及周围一圈保证无雷
  - 旗子标记,不使用问号状态
  - 数字格快捷展开
  - 按难度保存本地最佳用时
  - 移动端支持轻点翻开、长按插旗,大棋盘横向滚动
  - 零依赖,单文件 HTML
- **操作**:
  - 桌面:`左键` 翻开,`右键` 插旗,点击已翻开的数字格快捷展开
  - 移动端:`轻点` 翻开,`长按` 插旗
- **技术栈**: 原生 HTML/CSS/JavaScript,DOM 网格,IIFE 封装,无外部依赖

### 🐉 赵云与阿斗 (Zhao Yun & A Dou)
- **路径**: `zhaoyun-adou/index.html`
- **特性**:
  - 解包微信小游戏的浏览器适配版
  - LayaAir 3 引擎,竖屏手机比例显示
  - 内置 `wx.*` 垫片、模块加载器与输入修复
  - 支持桌面鼠标与移动端触摸
  - 安卓 Chrome 支持设置页全屏开关
  - 昵称 + PIN 登录、跨设备云存档
  - 浏览器独立总排行榜，不再使用原小游戏排行榜
  - 6 位房间码/邀请链接的好友 1v1 塔防生存赛
  - 实时同步生命和波次，断线 30 秒内可重连
- **操作**:
  - 桌面端用鼠标点击
  - 触屏设备用触摸操作
- **技术栈**: LayaAir 3,微信小游戏浏览器垫片,Cloudflare Worker + D1 + Durable Objects/WebSocket

## 本地预览

首页和单文件小游戏可直接双击 `index.html` 预览;`赵云与阿斗` 需要通过 HTTP 服务器访问,因为浏览器不允许 `file://` 直接加载其资源:

```bash
python3 -m http.server 8000
# 另开终端启动赵云云服务
npm run dev:cloud-api
# 浏览器打开 http://localhost:8000
# 赵云与阿斗: http://localhost:8000/zhaoyun-adou/index.html
```

## 部署上线

纯静态站点,任意静态托管平台均可**零配置**部署。推荐 Vercel 或 Netlify:

### Vercel
1. 把项目推送到 GitHub
2. 登录 [vercel.com](https://vercel.com) → New Project → 导入该仓库
3. Framework Preset 选 **Other**,其余留空 → Deploy
4. 完成后获得 `xxx.vercel.app` 域名

命令行方式:
```bash
npm i -g vercel
vercel          # 预览部署
vercel --prod   # 发布到正式域名
```

### Netlify
- **拖拽部署**:登录 [app.netlify.com](https://app.netlify.com),把整个项目文件夹拖到页面部署区即可
- **Git 自动部署**:连接 GitHub 仓库,Build command 留空,Publish directory 填 `.`

> 两者均自动支持 `/tetris/` 这类干净 URL(省略 `.html`)。

## 开发规范

- 每个游戏独立文件夹,主文件命名为 `index.html`
- 原生小游戏优先单文件架构,CSS/JS 内联;引擎小游戏可保留必要静态资源
- 代码风格:简洁、可读、注释清晰
- 必须通过对抗式 bug 审查,确保无已知缺陷

## 许可

MIT License
