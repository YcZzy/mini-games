# 游戏合集

精致的 HTML5 单文件游戏合集,零依赖,开箱即用。

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
  - 霓虹风现代化 UI,等级主题色流动
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
  - 霓虹风现代化 UI,主题色随等级流动
  - 触屏方向键支持
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

## 本地预览

直接双击 `index.html` 即可运行;如需模拟线上环境(干净 URL),在项目根目录启动静态服务器:

```bash
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
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
- 单文件架构,CSS/JS 内联,零外部依赖
- 代码风格:简洁、可读、注释清晰
- 必须通过对抗式 bug 审查,确保无已知缺陷

## 许可

MIT License
