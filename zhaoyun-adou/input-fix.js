/**
 * 输入修复
 *
 * weapp-adapter 在主画布实例上挂了伪造的 addEventListener/removeEventListener，
 * Laya InputManager.__init__ 通过它注册 mousedown/touchstart 等监听时，监听进了
 * 伪造 document 的 events 表，收不到真实 DOM 事件 → 点击/触摸无响应。
 *
 * 本脚本在 InputManager 单例就绪后，用真实的 EventTarget.prototype.addEventListener
 * 在主画布上挂监听，手动调用 InputManager.inst.handleMouse / handleTouch，
 * 把真实鼠标与触摸事件送进 Laya。
 *
 * 同时修复：
 *  - adapter 伪造的 getBoundingClientRect（top/left 恒为 0）→ 桌面手机壳居中后点击错位
 *  - 画布必须铺满 #phone-shell，而不是整页 100vw/100vh
 *  - stage._canvasTransform.tx/ty 未计入手机壳偏移 → clientX 反变换后 stage.mouseX 偏出屏幕
 */
(function () {
    'use strict';
    var realAEL = EventTarget.prototype.addEventListener;
    var realGBCR = Element.prototype.getBoundingClientRect;
    var fixed = false;

    function restoreCanvasGeometry(cv) {
        if (!cv || cv.__geomRestored) return;
        cv.__geomRestored = true;
        try {
            // adapter 在实例上挂了伪造 getBoundingClientRect（left/top 恒 0）
            if (cv.hasOwnProperty('getBoundingClientRect')) {
                try { delete cv.getBoundingClientRect; } catch (e) {}
            }
            // 用真实原型方法锁定，防止后续再被改写
            Object.defineProperty(cv, 'getBoundingClientRect', {
                configurable: true,
                writable: true,
                value: function () { return realGBCR.call(this); }
            });
        } catch (e) {
            console.warn('[input-fix] restore getBoundingClientRect failed', e);
        }

        // 某些环境下 clientWidth/Height 读到 0（画布不在“可布局”路径上时），
        // 回退到 getBoundingClientRect，保证 Laya 能拿到正确 CSS 尺寸。
        try {
            var cwDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
                || Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
            var chDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
                || Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight');
            Object.defineProperty(cv, 'clientWidth', {
                configurable: true,
                get: function () {
                    var v = cwDesc && cwDesc.get ? cwDesc.get.call(this) : 0;
                    if (v) return v;
                    return Math.round(realGBCR.call(this).width) || 0;
                }
            });
            Object.defineProperty(cv, 'clientHeight', {
                configurable: true,
                get: function () {
                    var v = chDesc && chDesc.get ? chDesc.get.call(this) : 0;
                    if (v) return v;
                    return Math.round(realGBCR.call(this).height) || 0;
                }
            });
        } catch (e) {
            console.warn('[input-fix] restore clientWidth/Height failed', e);
        }
    }

    function syncCanvasTransform() {
        try {
            var L = window.Laya;
            var cv = window.canvas || document.querySelector('canvas');
            if (!L || !L.stage || !L.stage._canvasTransform || !cv) return;
            var rect = realGBCR.call(cv);
            var m = L.stage._canvasTransform;
            // Laya handleMouse: invertTransformPoint(clientX/clientY)
            // 矩阵默认只有 scale，没有画布在页面中的偏移；手机壳居中后必须补 tx/ty
            if (Math.abs(m.tx - rect.left) > 0.5 || Math.abs(m.ty - rect.top) > 0.5) {
                m.tx = rect.left;
                m.ty = rect.top;
            }
        } catch (e) {}
    }

    function forceInShell(cv) {
        try {
            // 相对 #phone-shell 铺满，而不是整页 100vw/100vh
            cv.setAttribute('style',
                'position:absolute!important;left:0!important;top:0!important;' +
                'width:100%!important;height:100%!important;display:block!important;' +
                'touch-action:none!important;outline:none!important;background:transparent'
            );
            var shell = document.getElementById('phone-shell');
            if (shell && cv.parentNode !== shell) shell.appendChild(cv);
            restoreCanvasGeometry(cv);
            syncCanvasTransform();
        } catch (e) {}
    }

    function attach() {
        var L = window.Laya;
        if (!L || !L.InputManager || !L.InputManager.inst || !window.canvas) return false;
        if (fixed) return true;
        fixed = true;
        var im = L.InputManager.inst;
        var canvas = window.canvas;
        var opts = { passive: false, capture: false };

        restoreCanvasGeometry(canvas);
        syncCanvasTransform();

        function wrapMouse(typeCode) {
            return function (ev) {
                try {
                    syncCanvasTransform();
                    if (ev.cancelable) ev.preventDefault();
                    im.handleMouse(ev, typeCode);
                } catch (e) {
                    if (typeCode === 0) console.error('[input-fix] mousedown', e);
                }
            };
        }
        function wrapTouch(typeCode) {
            return function (ev) {
                try {
                    syncCanvasTransform();
                    if (ev.cancelable) ev.preventDefault();
                    im.handleTouch(ev, typeCode);
                } catch (e) {}
            };
        }

        realAEL.call(canvas, 'mousedown', wrapMouse(0), opts);
        realAEL.call(canvas, 'mouseup', wrapMouse(1), opts);
        realAEL.call(canvas, 'mousemove', wrapMouse(2), opts);
        realAEL.call(canvas, 'mouseout', wrapMouse(3), opts);
        realAEL.call(canvas, 'touchstart', wrapTouch(0), opts);
        realAEL.call(canvas, 'touchend', wrapTouch(1), opts);
        realAEL.call(canvas, 'touchmove', wrapTouch(2), opts);
        realAEL.call(canvas, 'touchcancel', wrapTouch(3), opts);
        console.log('[input-fix] 真实鼠标/触摸监听已挂载到主画布（含手机壳坐标修正）');

        // 强制主画布铺满手机壳：weapp-adapter 把 canvas.style 换成了伪造对象，Laya 运行时写 style.width/height
        // 进了伪造对象，真实 CSS 尺寸变成 400x552 之类，导致画布下半部分超出命中区域、点不中按钮。
        // 这里用 setAttribute('style', ...) 直接写真实内联样式（带 !important 覆盖 Laya），并持续守护。
        try {
            var cv = window.canvas;
            forceInShell(cv);
            if (window.MutationObserver) {
                var mo = new MutationObserver(function () { forceInShell(cv); });
                mo.observe(cv, { attributes: true, attributeFilter: ['style'] });
            }
            setInterval(function () { forceInShell(cv); }, 500);
            window.addEventListener('resize', function () { forceInShell(cv); });
        } catch (e) { console.error('[input-fix] force canvas size error', e); }
        return true;
    }

    var iv = setInterval(function () { if (attach()) clearInterval(iv); }, 20);
    setTimeout(function () { clearInterval(iv); if (!fixed) console.warn('[input-fix] 15s 内 InputManager 未就绪，未挂载监听'); }, 15000);
})();
