// 移动端调试辅助脚本
// 在 Chrome DevTools Console 中运行此脚本

console.log('%c🎮 俄罗斯方块移动端调试工具', 'font-size:20px;color:#7c5cff;font-weight:bold');

// 1. 监控触摸事件
window.debugTouch = function() {
  console.log('%c📱 开始监控触摸事件...', 'color:#4ade80');

  ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(event => {
    document.addEventListener(event, (e) => {
      console.log(`${event}:`, {
        target: e.target.className || e.target.tagName,
        touches: e.touches.length,
        changedTouches: e.changedTouches.length,
        defaultPrevented: e.defaultPrevented
      });
    }, {passive: true});
  });

  console.log('✅ 触摸事件监控已启动');
};

// 2. 检查虚拟按键状态
window.checkButtons = function() {
  console.log('%c🎯 虚拟按键状态检查', 'color:#22d3ee');

  const buttons = {
    'Hold': document.getElementById('vHold'),
    'Left': document.getElementById('vLeft'),
    'Right': document.getElementById('vRight'),
    'Down': document.getElementById('vDown'),
    'Rotate': document.getElementById('vRotate'),
    'Drop': document.getElementById('vDrop'),
    'Pause': document.getElementById('vPause')
  };

  Object.entries(buttons).forEach(([name, btn]) => {
    const disabled = btn.classList.contains('disabled');
    const pressed = btn.classList.contains('pressed');
    console.log(`${name}: ${disabled ? '🔒 禁用' : '✅ 启用'} ${pressed ? '👆 按下' : ''}`);
  });
};

// 3. 显示当前游戏状态
window.showGameState = function() {
  console.log('%c🎲 游戏状态', 'color:#fb923c');
  console.log('状态:', window.state || '未知');
  console.log('分数:', document.getElementById('score')?.textContent || '0');
  console.log('等级:', document.getElementById('level')?.textContent || '1');
  console.log('行数:', document.getElementById('lines')?.textContent || '0');
};

// 4. 测试虚拟按键响应
window.testButton = function(buttonId) {
  const btn = document.getElementById(buttonId);
  if (!btn) {
    console.error('❌ 按钮不存在:', buttonId);
    return;
  }

  console.log(`🧪 测试按钮: ${buttonId}`);

  // 模拟触摸
  const touch = new Touch({
    identifier: Date.now(),
    target: btn,
    clientX: 100,
    clientY: 100,
    radiusX: 2.5,
    radiusY: 2.5,
    rotationAngle: 0,
    force: 1
  });

  const touchStart = new TouchEvent('touchstart', {
    cancelable: true,
    bubbles: true,
    touches: [touch],
    targetTouches: [touch],
    changedTouches: [touch]
  });

  const touchEnd = new TouchEvent('touchend', {
    cancelable: true,
    bubbles: true,
    touches: [],
    targetTouches: [],
    changedTouches: [touch]
  });

  btn.dispatchEvent(touchStart);
  console.log('✅ touchstart 已触发');

  setTimeout(() => {
    btn.dispatchEvent(touchEnd);
    console.log('✅ touchend 已触发');
  }, 100);
};

// 5. 性能监控
window.startPerformanceMonitor = function() {
  console.log('%c⚡ 性能监控启动', 'color:#fde047');

  let frameCount = 0;
  let lastTime = performance.now();

  function measureFPS() {
    frameCount++;
    const now = performance.now();

    if (now >= lastTime + 1000) {
      const fps = Math.round((frameCount * 1000) / (now - lastTime));
      console.log(`FPS: ${fps} ${fps < 50 ? '⚠️' : '✅'}`);
      frameCount = 0;
      lastTime = now;
    }

    requestAnimationFrame(measureFPS);
  }

  measureFPS();
  console.log('✅ FPS 监控已启动（每秒输出一次）');
};

// 6. 检查移动端适配
window.checkMobileAdaptation = function() {
  console.log('%c📐 移动端适配检查', 'color:#c084fc');

  const width = window.innerWidth;
  const height = window.innerHeight;
  const isMobile = width <= 720;
  const dpr = window.devicePixelRatio;

  console.log('屏幕宽度:', width);
  console.log('屏幕高度:', height);
  console.log('设备像素比:', dpr);
  console.log('移动端模式:', isMobile ? '✅ 是' : '❌ 否');

  const vpad = document.querySelector('.vpad');
  const vpadDisplay = window.getComputedStyle(vpad).display;
  console.log('虚拟按键显示:', vpadDisplay !== 'none' ? '✅ 显示' : '❌ 隐藏');

  const stage = document.querySelector('.stage');
  const stageHeight = stage.scrollHeight;
  const stageVisible = stage.clientHeight;
  console.log('Stage 总高度:', stageHeight);
  console.log('Stage 可见高度:', stageVisible);
  console.log('是否需要滚动:', stageHeight > stageVisible ? '⚠️ 是' : '✅ 否');
};

// 7. 快速测试套件
window.runQuickTest = function() {
  console.clear();
  console.log('%c🚀 快速测试套件', 'font-size:16px;color:#7c5cff;font-weight:bold');
  console.log('');

  checkMobileAdaptation();
  console.log('');

  showGameState();
  console.log('');

  checkButtons();
  console.log('');

  console.log('%c💡 提示', 'color:#fde047');
  console.log('- 使用 debugTouch() 监控触摸事件');
  console.log('- 使用 testButton("vLeft") 测试特定按钮');
  console.log('- 使用 startPerformanceMonitor() 监控 FPS');
};

// 显示帮助信息
console.log('\n%c可用命令:', 'color:#22d3ee;font-weight:bold');
console.log('  debugTouch()              - 监控触摸事件');
console.log('  checkButtons()            - 检查虚拟按键状态');
console.log('  showGameState()           - 显示游戏状态');
console.log('  testButton(id)            - 测试特定按钮（如 "vLeft"）');
console.log('  startPerformanceMonitor() - 启动 FPS 监控');
console.log('  checkMobileAdaptation()   - 检查移动端适配');
console.log('  runQuickTest()            - 运行快速测试套件');
console.log('\n%c快速开始: runQuickTest()', 'color:#4ade80;font-weight:bold');
