/**
 * Laya 拦截器 / 修补器
 *
 * 在 window.Laya 被赋值时（早于 js/index.js 的 Laya.init）做几件事：
 *  - 设 Laya.Browser.onWXMiniGame=true，让游戏选用微信(tO)管理器，把广告/授权按钮代理到 wx.*（由 wx-shim stub）。
 *  - 删除 weapp-adapter 挂在主画布实例上的自有 addEventListener/removeEventListener（wx-shim 已用 accessor 锁定，这里兜底）。
 *  - 恢复 HTMLCanvasElement.prototype 的真实原型链（adapter 把伪造 HTMLElement 插进了链）。
 *  - 包裹 Node._activeHierarchy 的 try/catch（排障用，定位启动期抛错位置）。
 *
 * window.Laya 的 setter 可能被 bundle 用 defineProperty(data) 覆盖，所以额外轮询兜底。
 * 鼠标/触摸输入的修复见 input-fix.js（需在 InputManager.inst 就绪后挂真实监听）。
 */
(function () {
    'use strict';
    var _Laya;
    var _patchedObj = null;

    function patch(L) {
        if (!L) return;
        try {
            if (L.Browser) { L.Browser.onWXMiniGame = true; L.Browser.onMiniGame = true; }
        } catch (e) {}

        try {
            var realGrand = window._realCanvasGrandProto;
            if (realGrand) Object.setPrototypeOf(HTMLCanvasElement.prototype, realGrand);
        } catch (e) {}

        try {
            var mc = window.canvas;
            if (mc && mc.hasOwnProperty('addEventListener')) {
                delete mc.addEventListener;
                delete mc.removeEventListener;
            }
            // adapter 伪造的 getBoundingClientRect 会把 left/top 写成 0，桌面手机壳居中后点击坐标会错位
            if (mc && mc.hasOwnProperty('getBoundingClientRect')) {
                delete mc.getBoundingClientRect;
            }
        } catch (e) {}

        if (_patchedObj === L) return;
        _patchedObj = L;

        try {
            var NP = L.Node && L.Node.prototype;
            if (NP && !NP.__intActive) {
                NP.__intActive = true;
                var origActive = NP._activeHierarchy;
                NP._activeHierarchy = function (e, t) {
                    try { return origActive.call(this, e, t); }
                    catch (err) {
                        console.error('[intercept] _activeHierarchy failed on node',
                            this && this.name, this && this.constructor && this.constructor.name, err);
                        throw err;
                    }
                };
            }
        } catch (e) {}
    }

    try {
        Object.defineProperty(window, 'Laya', {
            configurable: true,
            get: function () { return _Laya; },
            set: function (v) { _Laya = v; try { patch(v); } catch (e) { console.error('[intercept] patch on set error', e); } }
        });
    } catch (e) {}

    // 轮询兜底：bundle 可能用 defineProperty(data) 覆盖 window.Laya 的 accessor
    var iv = setInterval(function () {
        var L = window.Laya;
        if (L) { try { patch(L); } catch (ex) {} clearInterval(iv); }
    }, 5);
    setTimeout(function () { clearInterval(iv); }, 10000);
})();
