/**
 * 微信小游戏模块加载器（define / require）
 *
 * 解包后的 game.js 用微信运行时提供的 `define(name, factory)` / `require(name)`
 * 模块系统。浏览器中没有，这里提供一个最小化的同步 AMD/CommonJS 混合加载器。
 *
 * 约定：
 *   define(name, function(require, module, exports) { ... })
 *   require(name) -> module.exports
 * 所有 define 在文件顶层先注册，文件末尾 require("game.js") 触发执行。
 */
(function () {
    'use strict';
    var registry = {};

    window.define = function (name, factory) {
        // 若重复定义，保留首个（避免覆盖）
        if (!registry[name]) {
            registry[name] = { factory: factory, executed: false, exports: undefined };
        }
    };
    // 微信小游戏里 define.amd 之类不存在；保持极简。

    window.require = function (name) {
        var m = registry[name];
        if (!m) throw new Error("Module not found: " + name);
        if (!m.executed) {
            m.executed = true;
            var module = { exports: {} };
            try {
                m.factory(window.require, module, module.exports);
            } catch (e) {
                m.executed = false; // 允许重试？微信里不会重试；这里标记以便排障
                throw e;
            }
            m.exports = module.exports;
        }
        return m.exports;
    };

    // 兼容：部分代码可能用 require.ensure / require.async（异步分包加载）——本地忽略
    window.require.ensure = function (deps, cb) { try { cb(window.require); } catch (e) { console.error(e); } };
    window.require.async = function (name, cb) {
        try { var v = window.require(name); cb && cb(v); } catch (e) { console.error('require.async', name, e); }
    };
})();
