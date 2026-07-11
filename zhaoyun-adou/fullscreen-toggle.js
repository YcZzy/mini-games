/**
 * 设置页全屏开关
 *
 * 逻辑：
 * - 在 Laya 设置窗口(settingWnd)出现后，动态插入一个“全屏模式”复选项。
 * - 点击开关时进入/退出浏览器 Fullscreen，并保存偏好。
 * - 浏览器要求 Fullscreen 必须由用户手势触发；如果已开启偏好，后续触摸会继续尝试进入全屏。
 */
(function () {
    'use strict';

    var STORAGE_KEY = 'mini-games-zhaoyun-adou-fullscreen-enabled';
    var CHECK_BORDER = 'resources/img/mainUI/setting/checkBoxBorder.png';
    var CHECK_OK = 'resources/img/mainUI/setting/checkOK.png';

    function getPref() {
        try { return localStorage.getItem(STORAGE_KEY) === '1'; }
        catch (e) { return false; }
    }

    function setPref(on) {
        try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); }
        catch (e) {}
    }

    function fullscreenElement() {
        return document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || null;
    }

    function isFullscreen() {
        return !!fullscreenElement();
    }

    function requestFullscreen() {
        if (isFullscreen()) return Promise.resolve(true);
        var el = document.documentElement;
        var fn = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
        if (!fn) return Promise.resolve(false);
        try {
            var result = fn.call(el);
            return Promise.resolve(result).then(function () {
                if (window.__syncGameViewport) window.__syncGameViewport();
                return true;
            }, function () { return false; });
        } catch (e) {
            return Promise.resolve(false);
        }
    }

    function exitFullscreen() {
        if (!isFullscreen()) return Promise.resolve(true);
        var fn = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
        if (!fn) return Promise.resolve(false);
        try {
            var result = fn.call(document);
            return Promise.resolve(result).then(function () {
                if (window.__syncGameViewport) window.__syncGameViewport();
                return true;
            }, function () { return false; });
        } catch (e) {
            return Promise.resolve(false);
        }
    }

    function setEnabled(on) {
        setPref(on);
        return on ? requestFullscreen() : exitFullscreen();
    }

    function isEnabled() {
        return getPref() || isFullscreen();
    }

    window.__gameFullscreen = {
        isEnabled: isEnabled,
        setEnabled: setEnabled,
        request: requestFullscreen,
        exit: exitFullscreen,
        storageKey: STORAGE_KEY
    };

    function findNode(root, name) {
        if (!root) return null;
        if (root.name === name) return root;
        var children = root._children || root._childs || [];
        for (var i = 0; i < children.length; i++) {
            var found = findNode(children[i], name);
            if (found) return found;
        }
        return null;
    }

    function injectToggle() {
        var L = window.Laya;
        if (!L || !L.stage || !L.Box || !L.Image || !L.Label) return false;
        var settingWnd = findNode(L.stage, 'settingWnd');
        if (!settingWnd || settingWnd.__fullscreenToggleAdded) return false;
        settingWnd.__fullscreenToggleAdded = true;

        var box = new L.Box();
        box.name = 'fullscreenBox';
        box.pos(271, 382);
        box.size(266, 45);
        box.anchorX = 0.5;
        box.anchorY = 0.5;
        box.mouseEnabled = true;
        box.zOrder = 10000;

        var border = new L.Image(CHECK_BORDER);
        border.name = 'fullscreenCheckBoxBorder';
        border.pos(28, 23);
        border.size(39, 38);
        border.anchorX = 0.5;
        border.anchorY = 0.5;
        border.centerY = 0;

        var ok = new L.Image(CHECK_OK);
        ok.name = 'fullscreenCheckOK';
        ok.size(44, 31);
        border.addChild(ok);

        var label = new L.Label('全屏模式');
        label.name = 'fullscreenLabel';
        label.pos(69, 23);
        label.size(186, 33);
        label.anchorY = 0.5;
        label.centerY = 0;
        label.fontSize = 31;
        label.color = '#000000';
        label.mouseEnabled = false;

        box.addChild(border);
        box.addChild(label);
        settingWnd.addChild(box);

        function refresh() {
            ok.visible = isEnabled();
        }

        box.on((L.Event && L.Event.CLICK) || 'click', null, function (e) {
            if (e && e.stopPropagation) e.stopPropagation();
            var next = !isEnabled();
            setEnabled(next).then(refresh);
            refresh();
        });

        document.addEventListener('fullscreenchange', refresh);
        document.addEventListener('webkitfullscreenchange', refresh);
        refresh();
        window.__fullscreenToggleInjected = true;
        return true;
    }

    function tryAutoEnter() {
        if (getPref() && !isFullscreen()) requestFullscreen();
    }

    // 偏好已打开时，后续用户手势继续尝试进入全屏（满足浏览器的用户手势要求）。
    window.addEventListener('pointerup', tryAutoEnter, { passive: true });
    window.addEventListener('touchend', tryAutoEnter, { passive: true });

    var timer = setInterval(injectToggle, 200);
    window.addEventListener('fullscreenchange', function () {
        if (window.__syncGameViewport) window.__syncGameViewport();
    });
    window.addEventListener('webkitfullscreenchange', function () {
        if (window.__syncGameViewport) window.__syncGameViewport();
    });
    setTimeout(function () { clearInterval(timer); }, 30 * 60 * 1000);
})();
