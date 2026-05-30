# 游戏合集

精致的 HTML5 单文件游戏合集,零依赖,开箱即用。

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

## 开发规范

- 每个游戏独立文件夹,主文件命名为 `index.html`
- 单文件架构,CSS/JS 内联,零外部依赖
- 代码风格:简洁、可读、注释清晰
- 必须通过对抗式 bug 审查,确保无已知缺陷

## 许可

MIT License
