/**
 * wx → 浏览器 垫片
 * 目标：让这个 LayaAir 微信小游戏打包体（game.js）以为自己在微信运行时里运行。
 *
 * 运行模型：游戏代码只依赖 Laya；Laya + weapp-adapter + laya.adapter-weixin
 * 通过 `wx` 与平台交互。本垫片把 `wx.*` 映射到浏览器 API，形成完整闭环。
 *
 * 注意：本文件必须在 game.js 之前加载，并先定义 window.GameGlobal = window。
 */
(function () {
    'use strict';

    var wx = {};
    window.wx = wx;

    // 捕获浏览器原生构造/方法。weapp-adapter（platform='devtools' 分支）会用
    // defineProperty 覆盖 document.createElement / window.Image / window.Audio 等
    // 为“调用 wx.*”的版本。若本垫片再用全局 `document.createElement('canvas')` 或
    // `new Image()`，会形成 adapter→wx.createCanvas→document.createElement('canvas')
    // 的无限递归。因此一律使用这里捕获的原生引用。
    var _real = {
        createElement: document.createElement.bind(document),
        createElementNS: document.createElementNS ? document.createElementNS.bind(document) : null,
        Image: window.Image,
        Audio: window.Audio,
        WebSocket: window.WebSocket,
        // weapp-adapter 后续会把 window.localStorage 替换成调用 wx.* 的假对象；这里先抓住真实存储。
        localStorage: window.localStorage,
        body: document.body,
        head: document.head
    };

    // 捕获 HTMLCanvasElement.prototype 的真实父原型链。
    // weapp-adapter 的 Canvas() 会执行 `canvas.__proto__.__proto__ = new HTMLElement('canvas')`，
    // 这会改写 HTMLCanvasElement.prototype.__proto__，把伪造的 HTMLElement 实例插进链中，
    // 导致 canvas.addEventListener 变成伪造版本（指向伪造 document 的 events 表），
    // Laya 在 canvas 上监听 mousedown/touchstart 永远收不到真实 DOM 事件，点击失效。
    // 这里先记下真实 HTMLElement.prototype，供拦截器在 Laya 初始化前恢复链。
    window._realCanvasGrandProto = Object.getPrototypeOf(HTMLCanvasElement.prototype);

    // 冻结 document 实例上的关键属性为“不可配置自有属性”，指向真实实现。
    // 原因：weapp-adapter 的 inject()（platform='devtools' 分支）会遍历伪造 document 的 key，
    // 用 defineProperty 覆盖真实 document 的 body/documentElement/createElement 等
    // （这些在 Document.prototype 上多为 configurable），导致 document.body 变成伪造 HTMLElement，
    // 其 appendChild 是 no-op，Laya 画布被插入伪造 body 后实际上不在真实 DOM 中（clientWidth=0/黑屏）。
    // 冻结后 adapter 检测到 configurable=false 会跳过，保留真实 document。
    (function freezeDoc() {
        var realBody = document.body;
        var realHead = document.head;
        var realDocEl = document.documentElement;
        var props = {
            body: realBody,
            head: realHead,
            documentElement: realDocEl,
            createElement: document.createElement.bind(document),
            createElementNS: document.createElementNS ? document.createElementNS.bind(document) : function(){return null;},
            createTextNode: document.createTextNode.bind(document),
            createEvent: document.createEvent ? document.createEvent.bind(document) : function(){return null;},
            getElementById: document.getElementById.bind(document),
            getElementsByTagName: document.getElementsByTagName.bind(document),
            getElementsByClassName: document.getElementsByClassName ? document.getElementsByClassName.bind(document) : function(){return [];},
            getElementsByName: document.getElementsByName ? document.getElementsByName.bind(document) : function(){return [];},
            querySelector: document.querySelector.bind(document),
            querySelectorAll: document.querySelectorAll.bind(document),
            addEventListener: document.addEventListener.bind(document),
            removeEventListener: document.removeEventListener.bind(document),
            dispatchEvent: document.dispatchEvent.bind(document),
            defaultView: window
        };
        for (var k in props) {
            try { Object.defineProperty(document, k, { value: props[k], configurable: false, writable: false }); }
            catch (e) { /* 某些属性可能本来不可配置，忽略 */ }
        }
    })();

    // ---- 系统信息 ----
    // 桌面端用 #phone-shell 的尺寸模拟手机竖屏视口；没有壳时回退到 window。
    function getPhoneViewport() {
        var shell = document.getElementById('phone-shell');
        if (shell) {
            var r = shell.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
                return { width: Math.round(r.width), height: Math.round(r.height) };
            }
        }
        return { width: window.innerWidth, height: window.innerHeight };
    }

    // 关键：platform 必须为 'devtools'。
    // weapp-adapter 的 inject() 对 platform==='devtools' 走安全分支（用 defineProperty
    // 且只覆盖 configurable 属性），保留浏览器真实的 window/document；否则走赋值分支，
    // 会因 window.document 是只读 getter 而抛错。devtools 分支下：
    //   - window.canvas = 主画布（由本垫片 wx.createCanvas 创建并插入 DOM）
    //   - window.document 保持真实 → Laya 用 mainCanvas.addEventListener 监听真实触摸/鼠标事件
    function getSystemInfoSync() {
        var vp = getPhoneViewport();
        return {
            platform: 'devtools',
            model: 'iPhone',
            // iOS Safari WebGL 性能：限制像素比避免 canvas 内部分辨率过高
            // iPhone 14 Pro 的 3x → 1179×2556 像素/帧，移动端 GPU 压力大
            pixelRatio: Math.min(window.devicePixelRatio || 2, 2),
            screenWidth: vp.width,
            screenHeight: vp.height,
            windowWidth: vp.width,
            windowHeight: vp.height,
            statusBarHeight: 0,
            language: 'zh_CN',
            version: '8.0.0',
            system: 'iOS 16.0',
            SDKVersion: '3.0.0',
            brand: 'iPhone',
            fontSizeSetting: 16,
            batteryLevel: 100,
            wifiEnabled: true,
            deviceOrientation: 'portrait'
        };
    }
    wx.getSystemInfoSync = getSystemInfoSync;
    wx.getSystemInfo = function (opts) {
        try { opts && opts.success && opts.success(getSystemInfoSync()); }
        finally { opts && opts.complete && opts.complete(); }
    };
    wx.getDeviceInfo = getSystemInfoSync;
    wx.getWindowInfo = getSystemInfoSync;
    wx.getAppBaseInfo = function () { return { language: 'zh_CN', version: '8.0.0' }; };
    wx.getSystemSetting = function () { return { deviceOrientation: 'portrait' }; };

    wx.env = { USER_DATA_PATH: '/layaUserData' };

    // ---- 画布 ----
    var _mainCanvasCreated = false;
    // 注入主画布样式：画布铺满 #phone-shell（桌面竖屏模拟壳）
    var _style = _real.createElement('style');
    _style.textContent = [
        'html,body{margin:0;padding:0;height:100%;width:100%;overflow:hidden;',
        'font-family:Arial,sans-serif;touch-action:none;-webkit-user-select:none;user-select:none;}',
        // Laya 会把主画布 id 改为 layaCanvas（注意大小写）；同时保留 layaMainCanvas 兼容。
        // absolute 相对 #phone-shell 铺满，而不是整页 100vw/100vh。
        '#layaMainCanvas,#layaCanvas{position:absolute!important;left:0!important;top:0!important;',
        'width:100%!important;height:100%!important;display:block!important;touch-action:none!important;outline:none!important;',
        // GPU 合成优化：强制 canvas 提升为独立合成层，避免 iOS Safari 每帧重绘
        'transform:translateZ(0)!important;-webkit-transform:translateZ(0)!important;',
        'will-change:transform!important;}',
        'canvas{touch-action:none;}'
    ].join('');
    _real.head.appendChild(_style);

    wx.createCanvas = function () {
        var canvas = _real.createElement('canvas');
        // weapp-adapter 会在主画布实例上覆写 addEventListener/removeEventListener 为伪造版本
        // （指向伪造 document 的 events 表），导致 Laya 在画布上监听 mousedown/touchstart 收不到真实事件。
        // 这里用 getter+空 setter 锁定成真实 EventTarget.prototype 上的方法：adapter 赋值时走空 setter（静默忽略），
        // 读取时永远返回真实方法。configurable=true 避免严格模式报错。
        try {
            var realAEL = EventTarget.prototype.addEventListener;
            var realREL = EventTarget.prototype.removeEventListener;
            Object.defineProperty(canvas, 'addEventListener', { configurable: true, get: function () { return realAEL; }, set: function () {} });
            Object.defineProperty(canvas, 'removeEventListener', { configurable: true, get: function () { return realREL; }, set: function () {} });
        } catch (e) { /* 忽略 */ }
        if (!_mainCanvasCreated) {
            _mainCanvasCreated = true;
            canvas.id = 'layaMainCanvas';
            var shell = document.getElementById('phone-shell');
            if (shell) shell.appendChild(canvas);
            else _real.body.appendChild(canvas);
            // 让 canvas 可获得焦点 / 接收事件
            canvas.tabIndex = 0;
        }
        return canvas;
    };

    // ---- 图像 ----
    wx.createImage = function () {
        return new _real.Image();
    };

    // ---- 触摸 / 鼠标 ----
    var _touchCbs = { touchstart: [], touchmove: [], touchend: [], touchcancel: [] };
    function _dispatchWxTouch(type, e) {
        var touches = [];
        var changed = [];
        var srcTouches = e.touches || [];
        var srcChanged = e.changedTouches || (srcTouches.length ? [srcTouches[0]] : []);
        function map(t) {
            return {
                identifier: t.identifier != null ? t.identifier : 0,
                id: t.identifier != null ? t.identifier : 0,
                clientX: t.clientX,
                clientY: t.clientY,
                pageX: t.pageX != null ? t.pageX : t.clientX,
                pageY: t.pageY != null ? t.pageY : t.clientY,
                x: t.clientX,
                y: t.clientY,
                force: t.force || 0,
                radiusX: t.radiusX || 0,
                radiusY: t.radiusY || 0,
                rotationAngle: t.rotationAngle || 0
            };
        }
        for (var i = 0; i < srcTouches.length; i++) touches.push(map(srcTouches[i]));
        for (var j = 0; j < srcChanged.length; j++) changed.push(map(srcChanged[j]));
        var ev = { touches: touches, changedTouches: changed, timeStamp: e.timeStamp || Date.now(), type: type };
        var arr = _touchCbs[type];
        for (var k = 0; k < arr.length; k++) {
            try { arr[k](ev); } catch (err) { console.error('[wx-shim] touch cb error', err); }
        }
    }

    function _ensureTouchListener(type) {
        if (_touchCbs['_bound_' + type]) return;
        _touchCbs['_bound_' + type] = true;
        var domType = type === 'touchcancel' ? 'touchcancel' : type;
        window.addEventListener(domType, function (e) {
            _dispatchWxTouch(type, e);
        }, { passive: false });
    }

    ['onTouchStart', 'onTouchMove', 'onTouchEnd', 'onTouchCancel'].forEach(function (fnName) {
        var type = fnName.replace(/^on/, '').replace(/^Touch/, 'touch').toLowerCase();
        // onTouchStart -> touchstart ; onTouchMove -> touchmove ; onTouchEnd -> touchend ; onTouchCancel -> touchcancel
        type = 'touch' + type.slice(5);
        wx[fnName] = function (cb) {
            if (cb) { _touchCbs[type].push(cb); _ensureTouchListener(type); }
        };
        wx['off' + fnName.slice(2)] = function (cb) {
            var arr = _touchCbs[type];
            var i = arr.indexOf(cb);
            if (i >= 0) arr.splice(i, 1);
        };
    });

    // 鼠标 -> 单点触摸（方便桌面端用鼠标玩）
    var _mouseDown = false;
    function _mouseToTouch(type, e) {
        var t = { identifier: 0, clientX: e.clientX, clientY: e.clientY, pageX: e.clientX, pageY: e.clientY, force: 1 };
        var ev = {
            touches: type === 'touchend' || type === 'touchcancel' ? [] : [t],
            changedTouches: [t],
            timeStamp: e.timeStamp || Date.now(),
            type: type,
            preventDefault: function () { e.preventDefault(); },
            stopPropagation: function () { e.stopPropagation(); }
        };
        var arr = _touchCbs[type];
        for (var k = 0; k < arr.length; k++) {
            try { arr[k](ev); } catch (err) { console.error('[wx-shim] mouse-touch cb error', err); }
        }
    }
    ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(function (type) { _ensureTouchListener(type); });
    window.addEventListener('mousedown', function (e) {
        var t = e.target;
        if (!t) return;
        if (t.id === 'layaMainCanvas' || t.id === 'layaCanvas' || t.id === 'phone-shell' || t === document.body) {
            _mouseDown = true; _mouseToTouch('touchstart', e);
        }
    });
    window.addEventListener('mousemove', function (e) {
        if (_mouseDown) _mouseToTouch('touchmove', e);
    });
    window.addEventListener('mouseup', function (e) {
        if (_mouseDown) { _mouseDown = false; _mouseToTouch('touchend', e); }
    });

    // ---- 存储 ----
    // 目标：本地进度完整保存；仅把广告/分享“每日次数/冷却”字段归零，保持无限领取。
    // 游戏主存档 key 是 playerData，里面包含金币、武器、体力、战绩等；不能整条丢弃。
    var _adCounterFields = [
        '_staminaAdCountToday',
        '_staminaShareCountToday',
        '_adPointShareCountToday',
        '_lastShareStaminaTime'
    ];
    function _looksLikePlayerSave(key, value) {
        key = String(key || '');
        if (key === 'playerData') return true;
        if (typeof value !== 'string') return false;
        return value.indexOf('_staminaAdCountToday') >= 0
            || value.indexOf('_staminaShareCountToday') >= 0
            || value.indexOf('_adPointShareCountToday') >= 0
            || value.indexOf('_lastShareStaminaTime') >= 0;
    }
    function _sanitizePlayerSaveValue(key, value) {
        if (value == null || !_looksLikePlayerSave(key, value)) return value;
        var wasString = typeof value === 'string';
        var obj = value;
        try {
            if (wasString) obj = JSON.parse(value);
            if (!obj || typeof obj !== 'object') return value;
            for (var i = 0; i < _adCounterFields.length; i++) {
                if (Object.prototype.hasOwnProperty.call(obj, _adCounterFields[i])) obj[_adCounterFields[i]] = 0;
            }
            // 直接解锁功能入口：原游戏会让道具/武器等待连续登录天数。
            // 在浏览器合集版中保留其它进度，只强制打开这些功能，兼容新老存档。
            obj._openProps = true;
            obj._weaponFree = true;
            if (typeof obj._consecutiveLoginDays !== 'number' || obj._consecutiveLoginDays < 7) obj._consecutiveLoginDays = 7;
            return wasString ? JSON.stringify(obj) : obj;
        } catch (e) {
            return value;
        }
    }
    function _shouldBlock(key) {
        // 只处理极少数“独立 key”形式的次数记录；不要匹配普通 stamina/time，避免破坏进度保存。
        return /staminaAd|staminaShare|adPointShare|videoCountToday|shareCountToday|adCountToday|lastShareStaminaTime|dailyAd|todayAd|lastAdTime/i.test(String(key || ''));
    }

    // Laya.LocalStorage 可能直接调用浏览器 localStorage，因此在 wx.* 存储外也做一次轻量清洗。
    var _nativeStorage = _real.localStorage;
    var _nativeGetItem = Storage.prototype.getItem;
    var _nativeSetItem = Storage.prototype.setItem;
    var _nativeRemoveItem = Storage.prototype.removeItem;
    var _nativeClear = Storage.prototype.clear;
    try {
        if (!Storage.prototype.__zySavePatch) {
            Object.defineProperty(Storage.prototype, '__zySavePatch', { value: true, configurable: true });
            Storage.prototype.getItem = function (key) {
                var v = _nativeGetItem.call(this, key);
                return _sanitizePlayerSaveValue(key, v);
            };
            Storage.prototype.setItem = function (key, value) {
                return _nativeSetItem.call(this, key, _sanitizePlayerSaveValue(key, value));
            };
        }
    } catch (e) { console.warn('[wx-shim] storage patch failed', e); }

    wx.getStorageSync = function (key) {
        if (_shouldBlock(key)) {
            console.log('[wx-shim] 拦截独立次数读取:', key, '-> 返回空');
            return '';
        }
        try { var v = _nativeGetItem.call(_nativeStorage, key); return v == null ? '' : _sanitizePlayerSaveValue(key, v); }
        catch (e) { return ''; }
    };
    wx.setStorageSync = function (key, data) {
        if (_shouldBlock(key)) {
            console.log('[wx-shim] 拦截独立次数写入:', key, '（丢弃）');
            return;
        }
        try {
            var v = typeof data === 'string' ? data : JSON.stringify(data);
            _nativeSetItem.call(_nativeStorage, key, _sanitizePlayerSaveValue(key, v));
        } catch (e) { console.warn('[wx-shim] setStorageSync failed', key, e); }
    };
    wx.removeStorageSync = function (key) { try { _nativeRemoveItem.call(_nativeStorage, key); } catch (e) { } };
    wx.clearStorageSync = function () { try { _nativeClear.call(_nativeStorage); } catch (e) { } };
    wx.getStorageInfoSync = function () {
        var keys = [];
        try { for (var i = 0; i < _nativeStorage.length; i++) keys.push(_nativeStorage.key(i)); } catch (e) { }
        return { keys: keys, currentSize: 0, limitSize: 10 * 1024 * 1024 };
    };
    wx.getStorage = function (opts) {
        var key = opts.key;
        if (_shouldBlock(key)) {
            console.log('[wx-shim] 拦截独立次数异步读取:', key, '-> 返回空');
            try { opts.success && opts.success({ data: '' }); } catch (e) {}
            try { opts.complete && opts.complete(); } catch (e) {}
            return;
        }
        try { var v = _nativeGetItem.call(_nativeStorage, key);
            opts.success && opts.success({ data: v == null ? '' : _sanitizePlayerSaveValue(key, v) }); }
        catch (e) { opts.fail && opts.fail(e); }
        finally { opts.complete && opts.complete(); }
    };
    wx.setStorage = function (opts) {
        var key = opts.key;
        if (_shouldBlock(key)) {
            console.log('[wx-shim] 拦截独立次数异步写入:', key, '（丢弃）');
            try { opts.success && opts.success(); } catch (e) {}
            try { opts.complete && opts.complete(); } catch (e) {}
            return;
        }
        try {
            var v = typeof opts.data === 'string' ? opts.data : JSON.stringify(opts.data);
            _nativeSetItem.call(_nativeStorage, key, _sanitizePlayerSaveValue(key, v));
            opts.success && opts.success(); }
        catch (e) { opts.fail && opts.fail(e); }
        finally { opts.complete && opts.complete(); }
    };
    ['getStorage', 'setStorage', 'removeStorage', 'clearStorage'].forEach(function (n) { if (!wx[n]) wx[n] = function () { }; });
    wx.removeStorage = function (opts) { try { _nativeRemoveItem.call(_nativeStorage, opts.key); opts.success && opts.success(); } catch (e) { opts.fail && opts.fail(e); } finally { opts.complete && opts.complete(); } };

    // ---- 网络：request / uploadFile / downloadFile ----
    wx.request = function (opts) {
        var url = opts.url;
        var method = (opts.method || 'GET').toUpperCase();
        var header = opts.header || {};
        var data = opts.data;
        var aborted = false;
        var controller = null;

        // 浏览器版使用独立的云排行榜，彻底阻止原小游戏总榜/省榜请求。
        if (window.ZhaoCloud && window.ZhaoCloud.isLegacyRankUrl(url)) {
            setTimeout(function () {
                var error = { errMsg: 'request:fail legacy rank disabled' };
                opts.fail && opts.fail(error);
                opts.complete && opts.complete(error);
            }, 0);
            return { abort: function () { aborted = true; } };
        }

        // 浏览器好友局不使用原游戏服务端结算，禁止发送开始/结束对局上报。
        // 返回兼容的成功响应，避免原游戏把主动禁用误报成网络异常。
        if (/^https?:\/\/api01\.mihuangame\.com\/api\/v2\/zyyad\/game\/(start|end)(?:[/?#]|$)/i.test(String(url || ''))) {
            setTimeout(function () {
                if (aborted) return;
                var response = { data: {}, statusCode: 200, header: {}, cookies: [] };
                opts.success && opts.success(response);
                opts.complete && opts.complete(response);
            }, 0);
            return { abort: function () { aborted = true; } };
        }
        try { controller = new AbortController(); } catch (e) { }

        var reqObj = {
            abort: function () { aborted = true; if (controller) controller.abort(); }
        };

        var init = { method: method, signal: controller ? controller.signal : undefined };
        if (header && Object.keys(header).length) init.headers = header;
        if (data !== undefined && data !== null && method !== 'GET' && method !== 'HEAD') {
            init.body = (typeof data === 'string' || (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer)) ? data : JSON.stringify(data);
        }
        if (opts.responseType === 'arraybuffer') init.headers = init.headers || {};

        fetch(url, init).then(function (resp) {
            if (aborted) return;
            var status = resp.status;
            var hdrs = {};
            resp.headers.forEach(function (v, k) { hdrs[k.toLowerCase()] = v; });
            var p;
            if (opts.responseType === 'arraybuffer') p = resp.arrayBuffer();
            else if (opts.dataType === 'json') p = resp.text().then(function (t) { try { return JSON.parse(t); } catch (e) { return t; } });
            else p = resp.text();
            return p.then(function (body) {
                if (aborted) return;
                opts.success && opts.success({ data: body, statusCode: status, header: hdrs, cookies: [] });
                opts.complete && opts.complete({ data: body, statusCode: status, header: hdrs });
            });
        }).catch(function (err) {
            if (aborted) return;
            opts.fail && opts.fail({ errMsg: 'request:fail ' + (err && err.message || err) });
            opts.complete && opts.complete();
        });

        return reqObj;
    };

    wx.uploadFile = function (opts) {
        // 简化：用 fetch，本地基本用不到
        return wx.request({
            url: opts.url, method: 'POST', header: opts.header || {}, data: opts.formData,
            success: opts.success, fail: opts.fail, complete: opts.complete
        });
    };

    wx.downloadFile = function (opts) {
        fetch(opts.url).then(function (r) {
            if (!r.ok) throw new Error('status ' + r.status);
            return r.blob();
        }).then(function (blob) {
            var url = URL.createObjectURL(blob);
            opts.success && opts.success({ tempFilePath: url, apFilePath: url, statusCode: 200, dataLength: blob.size });
            opts.complete && opts.complete({ tempFilePath: url, statusCode: 200 });
        }).catch(function (err) {
            opts.fail && opts.fail({ errMsg: 'downloadFile:fail ' + (err && err.message || err) });
            opts.complete && opts.complete();
        });
        return { onProgressUpdate: function () { }, abort: function () { } };
    };

    // ---- WebSocket ----
    wx.connectSocket = function (opts) {
        var ws = new _real.WebSocket(opts.url, opts.protocols);
        var task = {
            send: function (o) { ws.send(o && o.data !== undefined ? o.data : o); },
            close: function (o) { try { ws.close(o && o.code, o && o.reason); } catch (e) { ws.close(); } },
            onOpen: function (cb) { ws.onopen = cb; },
            onClose: function (cb) { ws.onclose = function (e) { cb && cb({ code: e.code, reason: e.reason }); }; },
            onError: function (cb) { ws.onerror = cb; },
            onMessage: function (cb) { ws.onmessage = function (e) { cb && cb({ data: e.data }); }; },
            offOpen: function () { ws.onopen = null; },
            offClose: function () { ws.onclose = null; },
            offError: function () { ws.onerror = null; },
            offMessage: function () { ws.onmessage = null; }
        };
        return task;
    };

    // ---- 文件系统（仅 readFile 经 HTTP 拉取本地资源；hasFS=false 以避开缓存管理器）----
    function _fetchFile(path, encoding, success, fail) {
        // 兼容 "http://..." 与相对路径
        fetch(path).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + path);
            if (encoding == null) return r.arrayBuffer();
            return r.text();
        }).then(function (data) {
            success({ data: data });
        }).catch(function (err) {
            fail && fail({ errMsg: 'readFile:fail ' + (err && err.message || err) });
        });
    }

    wx.getFileSystemManager = function () {
        return {
            // 注意：故意不提供 writeFile —— 让 PAL 判定 hasFS=false，跳过缓存管理器
            readFile: function (o) { _fetchFile(o.filePath, o.encoding, o.success, o.fail); },
            readFileSync: function (path, encoding) {
                // 同步读取本地文件在浏览器中不可行；Laya 走异步路径，这里兜底抛错
                throw new Error('readFileSync not supported in browser: ' + path);
            },
            access: function (o) {
                fetch(o.path || o.filePath, { method: 'HEAD' }).then(function (r) {
                    r.ok ? o.success && o.success() : o.fail && o.fail({ errMsg: 'access:fail' });
                }).catch(function () { o.fail && o.fail({ errMsg: 'access:fail' }); });
            },
            getFileInfo: function (o) {
                fetch(o.filePath, { method: 'HEAD' }).then(function (r) {
                    var size = parseInt(r.headers.get('content-length') || '0', 10);
                    o.success && o.success({ size: size, digest: '' });
                }).catch(function () { o.fail && o.fail({ errMsg: 'getFileInfo:fail' }); });
            },
            readdir: function (o) { o.success && o.success({ files: [] }); },
            mkdir: function (o) { o.success && o.success(); },
            mkdirSync: function () { },
            rmdir: function (o) { o.success && o.success(); },
            rmdirSync: function () { },
            unlink: function (o) { o.success && o.success(); },
            unlinkSync: function () { },
            copyFile: function (o) { o.success && o.success(); },
            copyFileSync: function () { },
            // 注意：故意不提供 writeFile —— 让 PAL 判定 hasFS=false，跳过缓存管理器。
            // （hasFS = hasAPI(getFileSystemManager) && hasAPI(fs, "writeFile")）
            unzip: function (o) { o.fail && o.fail({ errMsg: 'unzip:not supported' }); }
        };
    };

    // ---- 分包 ----
    wx.loadSubpackage = function (opts) {
        // 浏览器中无需加载分包代码；资源会由 Laya 直接经 HTTP 拉取
        setTimeout(function () {
            opts.success && opts.success();
            opts.complete && opts.complete();
        }, 0);
        return { onProgressUpdate: function () { }, offProgressUpdate: function () { } };
    };

    // ---- 音频 ----
    function _wrapAudio() {
        var a = new _real.Audio();
        a.crossOrigin = 'anonymous';
        var cbs = { play: [], pause: [], stop: [], ended: [], timeupdate: [], error: [], canplay: [], waiting: [], seeking: [], seeked: [] };
        function fire(name, arg) { var arr = cbs[name]; for (var i = 0; i < arr.length; i++) { try { arr[i](arg); } catch (e) { } } }
        a.addEventListener('play', function () { fire('play'); });
        a.addEventListener('pause', function () { fire('pause'); });
        a.addEventListener('ended', function () { fire('ended'); });
        a.addEventListener('timeupdate', function () { fire('timeupdate', { currentTime: a.currentTime, duration: a.duration }); });
        a.addEventListener('error', function (e) { fire('error', { errMsg: 'audio error', errCode: -1, err: e }); });
        a.addEventListener('canplay', function () { fire('canplay'); });
        a.addEventListener('waiting', function () { fire('waiting'); });
        a.addEventListener('seeking', function () { fire('seeking'); });
        a.addEventListener('seeked', function () { fire('seeked'); });
        var ctx = {
            src: '', startTime: 0, autoplay: false, loop: false, volume: 1, playbackRate: 1,
            obeyMuteSwitch: true, _a: a,
            get duration() { return a.duration || 0; },
            get currentTime() { return a.currentTime; },
            get buffered() { return a.buffered && a.buffered.length ? a.buffered.end(a.buffered.length - 1) : 0; },
            get paused() { return a.paused; },
            play: function () { var p = a.play(); if (p && p.catch) p.catch(function () { }); },
            pause: function () { a.pause(); },
            stop: function () { try { a.pause(); a.currentTime = 0; } catch (e) { } },
            seek: function (pos) { try { a.currentTime = pos; } catch (e) { } },
            destroy: function () { try { a.pause(); a.src = ''; } catch (e) { } for (var k in cbs) cbs[k].length = 0; },
            onCanplay: function (cb) { cbs.canplay.push(cb); }, offCanplay: function (cb) { _rm(cbs.canplay, cb); },
            onPlay: function (cb) { cbs.play.push(cb); }, offPlay: function (cb) { _rm(cbs.play, cb); },
            onPause: function (cb) { cbs.pause.push(cb); }, offPause: function (cb) { _rm(cbs.pause, cb); },
            onStop: function (cb) { cbs.stop.push(cb); }, offStop: function (cb) { _rm(cbs.stop, cb); },
            onEnded: function (cb) { cbs.ended.push(cb); }, offEnded: function (cb) { _rm(cbs.ended, cb); },
            onTimeUpdate: function (cb) { cbs.timeupdate.push(cb); }, offTimeUpdate: function (cb) { _rm(cbs.timeupdate, cb); },
            onError: function (cb) { cbs.error.push(cb); }, offError: function (cb) { _rm(cbs.error, cb); },
            onWaiting: function (cb) { cbs.waiting.push(cb); }, offWaiting: function (cb) { _rm(cbs.waiting, cb); },
            onSeeking: function (cb) { cbs.seeking.push(cb); }, offSeeking: function (cb) { _rm(cbs.seeking, cb); },
            onSeeked: function (cb) { cbs.seeked.push(cb); }, offSeeked: function (cb) { _rm(cbs.seeked, cb); }
        };
        function _rm(arr, cb) { var i = arr.indexOf(cb); if (i >= 0) arr.splice(i, 1); }
        Object.defineProperty(ctx, 'src', {
            get: function () { return a.src; },
            set: function (v) { a.src = v; a.load(); }
        });
        Object.defineProperty(ctx, 'loop', { get: function () { return a.loop; }, set: function (v) { a.loop = v; } });
        Object.defineProperty(ctx, 'volume', { get: function () { return a.volume; }, set: function (v) { a.volume = v; } });
        Object.defineProperty(ctx, 'playbackRate', { get: function () { return a.playbackRate; }, set: function (v) { a.playbackRate = v; } });
        Object.defineProperty(ctx, 'autoplay', { get: function () { return a.autoplay; }, set: function (v) { a.autoplay = v; } });
        return ctx;
    }
    wx.createInnerAudioContext = function () { return _wrapAudio(); };

    // WebAudio（短音效）—— 提供一个 AudioContext，缺失也无所谓
    wx.getAudioContext = function () {
        try { return new (window.AudioContext || window.webkitAudioContext)(); }
        catch (e) { return null; }
    };
    wx.createWebAudioContext = wx.getAudioContext;
    wx.setInnerAudioOption = function (o) { o && o.success && o.success(); };

    // ---- 视频 ----
    wx.createVideo = function (opts) {
        // 简化：用 video 元素
        var v = _real.createElement('video');
        v.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain;';
        document.body.appendChild(v);
        if (opts && opts.src) v.src = opts.src;
        return {
            src: '', _v: v,
            play: function () { v.play(); }, pause: function () { v.pause(); },
            stop: function () { v.pause(); v.currentTime = 0; },
            destroy: function () { v.remove(); },
            seek: function (t) { v.currentTime = t / 1000; },
            onEnded: function (cb) { v.onended = cb; },
            onError: function (cb) { v.onerror = cb; },
            set src(s) { v.src = s; }, get src() { return v.src; },
            set muted(m) { v.muted = m; }, get muted() { return v.muted; },
            set loop(l) { v.loop = l; }, get loop() { return v.loop; },
            set playbackRate(r) { v.playbackRate = r; }, get playbackRate() { return v.playbackRate; },
            set x(x) { v.style.left = x + 'px'; }, set y(y) { v.style.top = y + 'px'; },
            set width(w) { v.style.width = w + 'px'; }, set height(h) { v.style.height = h + 'px'; }
        };
    };

    // ---- 字体 ----
    wx.loadFont = function (src) {
        // 简化：直接返回 src 作为 family
        try {
            var name = 'layafont_' + Math.random().toString(36).slice(2);
            var f = new FontFace(name, "url('" + src + "')");
            document.fonts.add(f); f.load();
            return name;
        } catch (e) { return src; }
    };

    // ---- 设备传感器（基本用不到，留 stub）----
    wx.startAccelerometer = function (o) { o && o.success && o.success(); };
    wx.stopAccelerometer = function (o) { o && o.success && o.success(); };
    wx.onAccelerometerChange = function () { };
    wx.offAccelerometerChange = function () { };
    wx.startGyroscope = function (o) { o && o.success && o.success(); };
    wx.stopGyroscope = function (o) { o && o.success && o.success(); };
    wx.onGyroscopeChange = function () { };
    wx.offGyroscopeChange = function () { };

    // ---- 网络状态 ----
    wx.getNetworkType = function (o) { o && o.success && o.success({ networkType: 'wifi', signalStrength: 1 }); o && o.complete && o.complete(); };
    wx.onNetworkStatusChange = function (cb) { /* stub */ };
    wx.offNetworkStatusChange = function () { };

    // ---- 位置 ----
    wx.getLocation = function (o) { o && o.fail && o.fail({ errMsg: 'getLocation:fail not supported' }); o && o.complete && o.complete(); };

    // ---- 键盘（textInput PAL）----
    wx.showKeyboard = function (o) { var inp = window.prompt(o && o.value ? '' : '', o && o.value || ''); if (inp != null) { try { window.__layaKbInput && window.__layaKbInput(inp); } catch (e) { } } try { window.__layaKbConfirm && window.__layaKbConfirm(inp); } catch (e) { } try { window.__layaKbComplete && window.__layaKbComplete(); } catch (e) { } };
    wx.hideKeyboard = function () { };
    wx.onKeyboardInput = function (cb) { window.__layaKbInput = cb; };
    wx.offKeyboardInput = function () { window.__layaKbInput = null; };
    wx.onKeyboardConfirm = function (cb) { window.__layaKbConfirm = cb; };
    wx.offKeyboardConfirm = function () { window.__layaKbConfirm = null; };
    wx.onKeyboardComplete = function (cb) { window.__layaKbComplete = cb; };
    wx.offKeyboardComplete = function () { window.__layaKbComplete = null; };

    // ---- 广告 stub ----
    // 游戏启动期会 wx.createRewardedVideoAd({adUnitId}) 并立即 onLoad/onError/onClose，
    // 必须返回一个带这些方法的对象，否则 "Cannot read properties of undefined (reading 'onLoad')"。
    // 本地不真正播放广告：show() 异步触发 onClose({isEnded: true})，模拟看完广告并发放奖励。
    function _makeAdStub(extraMethods) {
        var handlers = {};
        function make(name) { return function (cb) { (handlers[name] = handlers[name] || []).push(cb); return this; }; }
        function makeOff(name) { return function (cb) { var a = handlers[name] || []; var i = a.indexOf(cb); if (i >= 0) a.splice(i, 1); return this; }; }
        function fire(name, arg) {
            var arr = handlers[name] || [];
            for (var i = 0; i < arr.length; i++) {
                try { arr[i](arg); } catch (e) { console.error('[wx-shim ad]', name, e); }
            }
        }
        var ad = {
            show: function () {
                var self = this;
                // 模拟看完广告：isEnded: true，游戏会发放奖励
                setTimeout(function () {
                    console.log('[wx-shim] 广告 show 被调用，模拟看完广告，触发 onClose(isEnded=true)');
                    fire('close', { isEnded: true });
                }, 50);
                return Promise.resolve();
            },
            load: function () {
                // 模拟加载成功，异步触发 onLoad
                var self = this;
                setTimeout(function () {
                    fire('load');
                }, 10);
                return Promise.resolve();
            },
            hide: function () {},
            destroy: function () {},
            onLoad: make('load'), offLoad: makeOff('load'),
            onError: make('error'), offError: makeOff('error'),
            onClose: make('close'), offClose: makeOff('close'),
            onShow: make('show'), offShow: makeOff('show'),
            onHide: make('hide'), offHide: makeOff('hide'),
            onClick: make('click'), offClick: makeOff('click')
        };
        return ad;
    }
    wx.createRewardedVideoAd = function (opts) { return _makeAdStub(); };
    wx.createBannerAd = function (opts) { return _makeAdStub(); };
    wx.createInterstitialAd = function (opts) { return _makeAdStub(); };
    wx.createGameBanner = function (opts) { return _makeAdStub(); };
    wx.createGamePortalAd = function (opts) { return _makeAdStub(); };
    wx.createGridAd = function (opts) { return _makeAdStub(); };

    // 用户信息授权按钮（游戏启动期可能调用）
    function _makeButtonStub() {
        var handlers = {};
        function make(name) { return function (cb) { (handlers[name] = handlers[name] || []).push(cb); return this; }; }
        return {
            show: function () {}, hide: function () {}, destroy: function () {},
            onTap: make('tap'), offTap: function () {},
            onShow: make('show'), onHide: make('hide'), onDestroy: make('destroy'),
            offShow: function(){}, offHide: function(){}, offDestroy: function(){}
        };
    }
    wx.createUserInfoButton = function (opts) { return _makeButtonStub(); };
    wx.createGameGuideButton = function (opts) { return _makeButtonStub(); };
    wx.createGameSubscribeButton = function (opts) { return _makeButtonStub(); };
    wx.createFollowOfficialAccountButton = function (opts) { return _makeButtonStub(); };
    wx.createOpenSettingButton = function (opts) { return _makeButtonStub(); };
    wx.createCamera3DButton = function (opts) { return _makeButtonStub(); };

    // ---- 其它 stub（避免 "wx.xxx is not a function" 中断）----
    var _noop = function (o) { if (o && o.success) o.success({}); if (o && o.complete) o.complete(); };

    // ---- 分享 API（单独处理以支持回调）----
    var _shareCallbacks = [];
    wx.shareAppMessage = function (opts) {
        console.log('[wx-shim] shareAppMessage 被调用，模拟分享成功');
        // 触发所有 onShareAppMessage 回调，获取分享内容
        for (var i = 0; i < _shareCallbacks.length; i++) {
            try {
                var ret = _shareCallbacks[i]();
                console.log('[wx-shim] onShareAppMessage 返回:', ret);
            } catch (e) {}
        }
        // 异步触发成功回调
        setTimeout(function () {
            if (opts && opts.success) opts.success({ errMsg: 'shareAppMessage:ok' });
            if (opts && opts.complete) opts.complete({ errMsg: 'shareAppMessage:ok' });
        }, 100);
    };
    wx.onShareAppMessage = function (cb) {
        console.log('[wx-shim] onShareAppMessage 已注册');
        if (cb && typeof cb === 'function') {
            _shareCallbacks.push(cb);
        }
    };
    wx.offShareAppMessage = function (cb) {
        var idx = _shareCallbacks.indexOf(cb);
        if (idx >= 0) _shareCallbacks.splice(idx, 1);
    };
    wx.updateShareMenu = function (opts) {
        setTimeout(function () {
            if (opts && opts.success) opts.success({ errMsg: 'updateShareMenu:ok' });
            if (opts && opts.complete) opts.complete({ errMsg: 'updateShareMenu:ok' });
        }, 10);
    };
    wx.showShareMenu = function (opts) {
        setTimeout(function () {
            if (opts && opts.success) opts.success({ errMsg: 'showShareMenu:ok' });
            if (opts && opts.complete) opts.complete({ errMsg: 'showShareMenu:ok' });
        }, 10);
    };
    wx.hideShareMenu = function (opts) {
        setTimeout(function () {
            if (opts && opts.success) opts.success({ errMsg: 'hideShareMenu:ok' });
            if (opts && opts.complete) opts.complete({ errMsg: 'hideShareMenu:ok' });
        }, 10);
    };

    [
        'vibrateShort', 'vibrateLong', 'setKeepScreenOn', 'getMenuButtonBoundingClientRect',
        'getLaunchOptionsSync', 'onShow', 'onHide', 'offShow', 'offHide', 'getApp', 'getAccountInfoSync',
        'getUserInfo', 'getSetting', 'openSetting', 'authorize', 'navigateToMiniProgram',
        'onMemoryWarning', 'onError', 'setStorageSync', 'getSkylineInfo', 'getMenuButton',
        'setUserCloudStorage', 'getUserCloudStorage', 'removeUserCloudStorage', 'getCloudStorageInfo',
        'onUserCaptureScreen', 'setEnableDebug', 'getLogManager', 'getRealtimeLogManager',
        'reportEvent', 'reportMonitor', 'reportPerformance', 'getEntriesByName',
        'createGameContainer', 'setVisualEffectOnCapture', 'setBackgroundColor', 'setBackgroundTextStyle',
        'showLoading', 'hideLoading', 'showToast', 'hideToast', 'showModal', 'showActionSheet',
        'enableDebug', 'setBackgroundColorTop', 'setBackgroundColorBottom'
    ].forEach(function (n) { if (!wx[n]) wx[n] = _noop; });

    // ---- Canvas frame / 性能 ----
    wx.setPreferredFramesPerSecond = function () { };
    wx.getPerformance = function () { return { createObserver: function () { }, measure: function () { }, measureEntry: function () { } }; };

    window.wx = wx;
})();
