/**
 * 功能直解锁
 *
 * 原小游戏会按连续登录天数逐步开放“道具/武器”等功能。合集版要求开箱即玩，
 * 因此这里做两层处理：
 * 1) 存档层已在 wx-shim.js 中把 _openProps/_weaponFree/_consecutiveLoginDays 修正为已解锁；
 * 2) UI 层兜底：主界面按钮出现后，强制显示道具商店入口，并直接打开对应场景。
 */
(function () {
    'use strict';

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

    function openScene(url) {
        var L = window.Laya;
        if (!L || !L.Scene || !L.Scene.open) return;
        try { L.Scene.open(url); }
        catch (e) { console.warn('[unlock-features] open scene failed:', url, e); }
    }

    function patchButton(node, sceneUrl) {
        var L = window.Laya;
        if (!node || !L || node.__featureUnlockPatched) return;
        node.__featureUnlockPatched = true;
        node.visible = true;
        node.mouseEnabled = true;
        if ('disabled' in node) node.disabled = false;
        try { node.offAll && node.offAll((L.Event && L.Event.CLICK) || 'click'); } catch (e) {}
        node.on((L.Event && L.Event.CLICK) || 'click', null, function (ev) {
            if (ev && ev.stopPropagation) ev.stopPropagation();
            openScene(sceneUrl);
        });
    }

    function patchMainScene() {
        var L = window.Laya;
        if (!L || !L.stage) return;
        var weaponBtn = findNode(L.stage, 'weaponBtn');
        var shopBtn = findNode(L.stage, 'shopBtn');
        var shopWalk = findNode(L.stage, 'shopWalk');
        var weaponPanel = findNode(L.stage, 'weaponPanel');

        patchButton(weaponBtn, 'scene/WeaponScene.ls');
        patchButton(shopBtn, 'scene/ShopScene.ls');
        patchButton(shopWalk, 'scene/ShopScene.ls');

        // 武器场景由上面的直开入口进入，原返回事件缺少导航上下文；仅在该场景内兜底返回主界面。
        if (weaponPanel && weaponPanel.parent) {
            patchButton(findNode(weaponPanel.parent, 'xBtn'), 'scene/MainScene.ls');
        }

        // shopBtn/shopWalk 在原始场景中默认可能是 hidden，由脚本/登录天数再显示；这里直接开放。
        if (shopBtn) shopBtn.visible = true;
        if (shopWalk) shopWalk.visible = true;
    }

    var timer = setInterval(patchMainScene, 200);
    setTimeout(function () { clearInterval(timer); }, 30 * 60 * 1000);
})();
