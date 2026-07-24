/**
 * GM 功能面板
 *
 * 双路径拦截：每次游戏读写 playerData 时注入 GM 数值。
 * 读时代入、写时烘焙，确保刷新后永久生效。
 */
(function () {
    'use strict';

    var SAVE_KEY = 'playerData';
    var CONFIG_KEY = 'zhaoyun.gm.config';

    // 用于判断数据是否看起来像游戏存档的特征字段
    var SAVE_FINGERPRINTS = [
        '_openProps', '_weaponFree', '_staminaAdCountToday',
        'gd', '_gold', 'wf', '_weaponFragments', 'ps', '_props',
        'cs', '_curStar', 'sm', 'aul', 'rt', 'hfb', 'pap', 'wfr', 'wdg'
    ];

    function looksLikePlayerSave(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
        for (var i = 0; i < SAVE_FINGERPRINTS.length; i++) {
            if (data[SAVE_FINGERPRINTS[i]] !== undefined) return true;
        }
        return false;
    }

    // ---- 武器列表 ----
    var WeaponList = [
        [1,50],[2,50],[3,50],[4,50],[5,50],[6,50],[7,50],[8,50],[9,50],
        [11,50],[12,50],[13,50],[14,50],[15,50],[16,50],[17,50],[18,50],[19,50],[20,50],
        [22,50],[23,50],[24,50],[25,50],[26,50],[27,50],[28,50],[29,50],[30,50],
        [32,50],[33,50],[34,50],[35,50],[36,50],[37,50],[38,50],[39,50],[40,50],[41,50],[42,50],[43,50]
    ];

    var SkillName = {
        2:"毛笔", 3:"练兵符", 4:"神兵符", 5:"包子", 6:"御敌千里",
        7:"砚台", 8:"陷阱", 9:"地雷", 10:"速攻符", 11:"降妖符",
        12:"农民", 13:"招贤榜", 14:"攻速符(全体)", 15:"齐头并进",
        16:"续命丹", 17:"大补丸", 18:"泥潭", 19:"洛阳铲",
        20:"召唤陨石", 21:"垃圾桶", 22:"升职令", 24:"摸金校尉"
    };
    var BanSkill = [1, 23];

    function defaultConfig() {
        return {
            goldEnabled: true, gold: 9999999,
            levelEnabled: true, level: 999,
            weaponEnabled: true, weaponCount: 50,
            skillEnabled: true, activeSkills: [4, 10], passiveSkills: [11, 12, 13, 15, 19, 24],
            avatarEnabled: true,
            staminaEnabled: true, stamina: 30,
            registerEnabled: true, registerDays: 7,
            forceMode: false
        };
    }

    function loadConfig() {
        try {
            var raw = localStorage.getItem(CONFIG_KEY);
            if (raw) {
                var parsed = JSON.parse(raw);
                var def = defaultConfig();
                Object.keys(def).forEach(function (k) {
                    if (!(k in parsed)) parsed[k] = def[k];
                });
                return parsed;
            }
        } catch (e) {}
        return defaultConfig();
    }

    // ============================================================
    // GM 注入核心：同时设置 API 格式和内部 _ 格式，覆盖两种路径
    // ============================================================
    function setNum(data, keys, value, force) {
        for (var i = 0; i < keys.length; i++) {
            if (force) {
                data[keys[i]] = value;
            } else {
                var old = Number(data[keys[i]]) || 0;
                if (old < value) data[keys[i]] = value;
            }
        }
    }

    function injectGM(data) {
        if (!data || typeof data !== 'object') return data;

        var config = loadConfig();
        var force = config.forceMode;
        var now = Date.now();

        try {
            // --- 金币: gd(API) + _gold(internal) ---
            if (config.goldEnabled) {
                setNum(data, ['gd', '_gold'], config.gold, force);
            }

            // --- 等级: cs(API) + _curStar(internal) ---
            if (config.levelEnabled) {
                setNum(data, ['cs', '_curStar', 'ga', 'wn', 'ws', 'ls'], config.level, force);
                setNum(data, ['cld'], Math.max(99, Math.ceil(config.level / 10)), force);
            }

            // --- 武器碎片: wf(API) + _weaponFragments(internal) ---
            if (config.weaponEnabled) {
                // API format
                var wfKey = data.wf !== undefined ? 'wf' : '_weaponFragments';
                if (!Array.isArray(data[wfKey])) data[wfKey] = [];
                var weaponMap = {};
                data[wfKey].forEach(function (item) {
                    if (Array.isArray(item) && item.length > 1) {
                        weaponMap[item[0]] = item;
                    }
                });
                WeaponList.forEach(function (item) {
                    if (weaponMap[item[0]]) {
                        weaponMap[item[0]][1] = force
                            ? config.weaponCount
                            : Math.max(Number(weaponMap[item[0]][1]) || 0, config.weaponCount);
                    } else {
                        data[wfKey].push([item[0], config.weaponCount]);
                    }
                });
                // Also set the other key
                var otherKey = wfKey === 'wf' ? '_weaponFragments' : 'wf';
                data[otherKey] = data[wfKey];
            }

            // --- 技能: ps(API) + _props(internal) ---
            if (config.skillEnabled) {
                var skillList = [];
                var skillUsed = {};
                function addSkill(id) {
                    id = Number(id);
                    if (!id || skillList.length >= 8 || BanSkill.indexOf(id) >= 0 || skillUsed[id]) return;
                    skillUsed[id] = true;
                    skillList.push([id, 1, now - (skillList.length + 1) * 300000]);
                }
                (config.activeSkills || []).slice(0, 2).forEach(addSkill);
                (config.passiveSkills || []).slice(0, 6).forEach(addSkill);
                if (skillList.length > 0) {
                    data.ps = skillList;
                    data._props = skillList;
                }
            }

            // --- 头像框: aul(API) ---
            if (config.avatarEnabled) {
                var arr = Array(16).fill(1);
                data.aul = arr;
                data._avatarUnlockList = arr;
            }

            // --- 体力: sm(API) + _stamina(internal) ---
            if (config.staminaEnabled) {
                setNum(data, ['sm', '_stamina'], config.stamina, force);
            }

            // --- 注册时间: rt(API) ---
            if (config.registerEnabled) {
                var target = now - config.registerDays * 86400000 - 300000;
                if (force || !data.rt || data.rt > target) {
                    data.rt = target;
                }
            }

            // --- 固定解锁项 (underscore format, the game reads these) ---
            data._openProps = true;
            data._weaponFree = true;
            data._weaponUnlocked = true;
            if (typeof data._consecutiveLoginDays !== 'number' || data._consecutiveLoginDays < 7) {
                data._consecutiveLoginDays = 7;
            }
            // API 格式的解锁项
            data.hfb = true;
            data.pap = true;
            data.wfr = true;
            data.wdg = true;
            data.afu = false;
        } catch (e) {
            console.warn('[gm-panel] injectGM error:', e);
        }

        return data;
    }

    // ============================================================
    // 字符串值处理：解析 → 注入 → 序列化
    // ============================================================
    function processValue(rawValue, key) {
        if (!rawValue || rawValue === '') return rawValue;
        try {
            var obj = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
            if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
                // 按内容特征识别（键名可能是 playerData 或其他）
                if (String(key) === SAVE_KEY || looksLikePlayerSave(obj)) {
                    obj = injectGM(obj);
                    return typeof rawValue === 'string' ? JSON.stringify(obj) : obj;
                }
            }
        } catch (e) {}
        return rawValue;
    }

    // ============================================================
    // 拦截层：包装所有读写路径
    // ============================================================

    function hookSyncRead(origFn, ctx) {
        return function (key) {
            var value = origFn.call(ctx, key);
            return processValue(value, key);
        };
    }

    function hookAsyncRead(origFn, ctx) {
        return function (opts) {
            if (opts && opts.key) {
                var origSuccess = opts.success;
                opts = Object.assign({}, opts);
                opts.success = function (res) {
                    if (res && res.data !== undefined && res.data !== null && res.data !== '') {
                        res = Object.assign({}, res);
                        res.data = processValue(res.data, opts.key);
                    }
                    if (origSuccess) origSuccess(res);
                };
            }
            return origFn.call(ctx, opts);
        };
    }

    function hookSyncWrite(origFn, ctx) {
        return function (key, data) {
            if (typeof data === 'string') {
                data = processValue(data, key);
            } else if (data && typeof data === 'object') {
                data = processValue(JSON.stringify(data), key);
                try { data = JSON.parse(data); } catch (e) {}
            }
            return origFn.call(ctx, key, data);
        };
    }

    function hookAsyncWrite(origFn, ctx) {
        return function (opts) {
            if (opts && opts.key && opts.data !== undefined) {
                opts = Object.assign({}, opts);
                if (typeof opts.data === 'string') {
                    opts.data = processValue(opts.data, opts.key);
                } else if (opts.data && typeof opts.data === 'object') {
                    opts.data = processValue(JSON.stringify(opts.data), opts.key);
                    try { opts.data = JSON.parse(opts.data); } catch (e) {}
                }
            }
            return origFn.call(ctx, opts);
        };
    }

    function installInterceptors() {
        // ---- wx.getStorageSync (读) ----
        if (window.wx && window.wx.getStorageSync && !window.wx.getStorageSync.__gmHooked) {
            window.wx.getStorageSync = hookSyncRead(window.wx.getStorageSync, window.wx);
            window.wx.getStorageSync.__gmHooked = true;
        }

        // ---- wx.getStorage (异步读) ----
        if (window.wx && window.wx.getStorage && !window.wx.getStorage.__gmHooked) {
            window.wx.getStorage = hookAsyncRead(window.wx.getStorage, window.wx);
            window.wx.getStorage.__gmHooked = true;
        }

        // ---- wx.setStorageSync (写) ----
        if (window.wx && window.wx.setStorageSync && !window.wx.setStorageSync.__gmHooked) {
            window.wx.setStorageSync = hookSyncWrite(window.wx.setStorageSync, window.wx);
            window.wx.setStorageSync.__gmHooked = true;
        }

        // ---- wx.setStorage (异步写) ----
        if (window.wx && window.wx.setStorage && !window.wx.setStorage.__gmHooked) {
            window.wx.setStorage = hookAsyncWrite(window.wx.setStorage, window.wx);
            window.wx.setStorage.__gmHooked = true;
        }

        // ---- Storage.prototype.getItem (localStorage 直接读) ----
        try {
            var origGetItem = Storage.prototype.getItem;
            if (!origGetItem.__gmHooked) {
                Storage.prototype.getItem = function (key) {
                    var value = origGetItem.call(this, key);
                    if (String(key) === SAVE_KEY) return processValue(value);
                    return value;
                };
                Storage.prototype.getItem.__gmHooked = true;
            }
        } catch (e) {}

        // ---- Storage.prototype.setItem (localStorage 直接写) ----
        try {
            var origSetItem = Storage.prototype.setItem;
            if (!origSetItem.__gmHooked) {
                Storage.prototype.setItem = function (key, value) {
                    if (String(key) === SAVE_KEY) {
                        value = processValue(value);
                    }
                    return origSetItem.call(this, key, value);
                };
                Storage.prototype.setItem.__gmHooked = true;
            }
        } catch (e) {}

        console.log('[gm-panel] 双路径拦截已安装（读 + 写）');
    }

    // 立即安装
    installInterceptors();

    // ============================================================
    // UI 层
    // ============================================================

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

    function shell() {
        return document.getElementById('phone-shell') || document.body;
    }

    function showToast(message) {
        var old = document.querySelector('.zhao-cloud-toast');
        if (old) old.remove();
        var toast = document.createElement('div');
        toast.className = 'zhao-cloud-toast';
        toast.style.zIndex = '9999';
        toast.textContent = message;
        shell().appendChild(toast);
        setTimeout(function () { toast.remove(); }, 2600);
    }

    function saveConfig(config) {
        try {
            localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
        } catch (e) {}
    }

    function buildPanel(config) {
        function skillCheckboxes(selected, max) {
            var allSkills = Object.keys(SkillName).map(Number).filter(function (id) {
                return BanSkill.indexOf(id) < 0;
            });
            var html = '';
            allSkills.forEach(function (id) {
                var checked = selected.indexOf(id) >= 0 ? ' checked' : '';
                var disabled = selected.length >= max && selected.indexOf(id) < 0 ? ' disabled' : '';
                html += '<label class="gm-skill-label' + (selected.indexOf(id) >= 0 ? ' is-on' : '') + disabled + '">';
                html += '<input type="checkbox" value="' + id + '"' + checked + disabled + '>';
                html += SkillName[id] || ('技能' + id);
                html += '</label>';
            });
            return html;
        }

        return [
            '<div class="gm-panel-card">',
            '  <button class="gm-panel-close" id="gm-panel-close" type="button" aria-label="关闭">×</button>',
            '  <h1>⚙ GM 功能面板</h1>',
            '  <p class="gm-hint" style="text-align:center;margin-bottom:10px">修改即时生效，刷新后仍保持</p>',

            '  <fieldset class="gm-fieldset">',
            '    <legend>💰 金币</legend>',
            '    <label class="gm-toggle"><input type="checkbox" id="gm-gold-enabled"' + (config.goldEnabled ? ' checked' : '') + '> 启用</label>',
            '    <label class="gm-field">数量 <input type="number" id="gm-gold" value="' + config.gold + '" min="0" step="100000"></label>',
            '  </fieldset>',

            '  <fieldset class="gm-fieldset">',
            '    <legend>📈 等级 / 星级</legend>',
            '    <label class="gm-toggle"><input type="checkbox" id="gm-level-enabled"' + (config.levelEnabled ? ' checked' : '') + '> 启用</label>',
            '    <label class="gm-field">等级 <input type="number" id="gm-level" value="' + config.level + '" min="1" max="999"></label>',
            '  </fieldset>',

            '  <fieldset class="gm-fieldset">',
            '    <legend>🗡 武器碎片</legend>',
            '    <label class="gm-toggle"><input type="checkbox" id="gm-weapon-enabled"' + (config.weaponEnabled ? ' checked' : '') + '> 启用</label>',
            '    <label class="gm-field">碎片数量 <input type="number" id="gm-weapon-count" value="' + config.weaponCount + '" min="1" max="999"></label>',
            '    <p class="gm-hint">40 种武器全补全，自动去重保留较高值</p>',
            '  </fieldset>',

            '  <fieldset class="gm-fieldset">',
            '    <legend>📜 技能</legend>',
            '    <label class="gm-toggle"><input type="checkbox" id="gm-skill-enabled"' + (config.skillEnabled ? ' checked' : '') + '> 启用</label>',
            '    <div class="gm-skill-section">',
            '      <p class="gm-skill-title">主动技能 (最多 2 个)</p>',
            '      <div class="gm-skill-grid" id="gm-active-skills">' + skillCheckboxes(config.activeSkills, 2) + '</div>',
            '    </div>',
            '    <div class="gm-skill-section">',
            '      <p class="gm-skill-title">被动技能 (最多 6 个)</p>',
            '      <div class="gm-skill-grid" id="gm-passive-skills">' + skillCheckboxes(config.passiveSkills, 6) + '</div>',
            '    </div>',
            '  </fieldset>',

            '  <fieldset class="gm-fieldset">',
            '    <legend>🖼 头像框</legend>',
            '    <label class="gm-toggle"><input type="checkbox" id="gm-avatar-enabled"' + (config.avatarEnabled ? ' checked' : '') + '> 启用 (16 个全解锁)</label>',
            '  </fieldset>',

            '  <fieldset class="gm-fieldset">',
            '    <legend>⚡ 体力</legend>',
            '    <label class="gm-toggle"><input type="checkbox" id="gm-stamina-enabled"' + (config.staminaEnabled ? ' checked' : '') + '> 启用</label>',
            '    <label class="gm-field">体力值 <input type="number" id="gm-stamina" value="' + config.stamina + '" min="1" max="999"></label>',
            '  </fieldset>',

            '  <fieldset class="gm-fieldset">',
            '    <legend>📅 注册时间</legend>',
            '    <label class="gm-toggle"><input type="checkbox" id="gm-register-enabled"' + (config.registerEnabled ? ' checked' : '') + '> 启用</label>',
            '    <label class="gm-field">改为 N 天前注册 <input type="number" id="gm-register-days" value="' + config.registerDays + '" min="1" max="365"></label>',
            '  </fieldset>',

            '  <fieldset class="gm-fieldset">',
            '    <legend>🔧 修改模式</legend>',
            '    <label class="gm-toggle' + (config.forceMode ? ' is-warn' : '') + '"><input type="checkbox" id="gm-force-mode"' + (config.forceMode ? ' checked' : '') + '> 强制覆盖 (默认安全：只补不降)</label>',
            '  </fieldset>',

            '  <div class="gm-actions">',
            '    <button class="gm-btn-primary" id="gm-apply" type="button">保存配置</button>',
            '    <button class="gm-btn-secondary" id="gm-reload" type="button">刷新页面</button>',
            '    <button class="gm-btn-danger" id="gm-reset" type="button">清除存档</button>',
            '  </div>',
            '  <p class="gm-status" id="gm-status"></p>',
            '</div>'
        ].join('');
    }

    function showPanel() {
        var existing = document.getElementById('gm-panel-layer');
        if (existing) { existing.remove(); return; }

        var config = loadConfig();
        var layer = document.createElement('div');
        layer.id = 'gm-panel-layer';
        layer.innerHTML = buildPanel(config);
        shell().appendChild(layer);

        document.getElementById('gm-panel-close').addEventListener('click', function () { layer.remove(); });

        // 技能限制
        function bindSkillGrid(gridId, maxCount) {
            var grid = document.getElementById(gridId);
            if (!grid) return;
            function refreshStates() {
                var cbs = grid.querySelectorAll('input[type="checkbox"]');
                var checkedCount = 0;
                cbs.forEach(function (cb) { if (cb.checked) checkedCount++; });
                var atLimit = checkedCount >= maxCount;
                cbs.forEach(function (cb) {
                    var lbl = cb.parentElement;
                    if (cb.checked) {
                        lbl.classList.add('is-on');
                        lbl.classList.remove('disabled');
                        cb.disabled = false;
                    } else {
                        lbl.classList.remove('is-on');
                        if (atLimit) {
                            lbl.classList.add('disabled');
                            cb.disabled = true;
                        } else {
                            lbl.classList.remove('disabled');
                            cb.disabled = false;
                        }
                    }
                });
            }
            grid.addEventListener('change', function (e) {
                var target = e.target;
                if (target.type !== 'checkbox') return;
                var cbs = grid.querySelectorAll('input[type="checkbox"]');
                var checkedCount = 0;
                cbs.forEach(function (cb) { if (cb.checked) checkedCount++; });
                if (checkedCount > maxCount) {
                    target.checked = false;
                    showToast('最多选择 ' + maxCount + ' 个技能');
                }
                refreshStates();
            });
            refreshStates();
        }
        bindSkillGrid('gm-active-skills', 2);
        bindSkillGrid('gm-passive-skills', 6);

        // 保存配置
        document.getElementById('gm-apply').addEventListener('click', function () {
            var c = config;
            function el(id) { return document.getElementById(id); }
            var e;
            e = el('gm-gold-enabled'); if (e) c.goldEnabled = e.checked;
            e = el('gm-gold'); if (e) c.gold = parseInt(e.value, 10) || 0;
            e = el('gm-level-enabled'); if (e) c.levelEnabled = e.checked;
            e = el('gm-level'); if (e) c.level = parseInt(e.value, 10) || 1;
            e = el('gm-weapon-enabled'); if (e) c.weaponEnabled = e.checked;
            e = el('gm-weapon-count'); if (e) c.weaponCount = parseInt(e.value, 10) || 1;
            e = el('gm-skill-enabled'); if (e) c.skillEnabled = e.checked;
            e = el('gm-avatar-enabled'); if (e) c.avatarEnabled = e.checked;
            e = el('gm-stamina-enabled'); if (e) c.staminaEnabled = e.checked;
            e = el('gm-stamina'); if (e) c.stamina = parseInt(e.value, 10) || 1;
            e = el('gm-register-enabled'); if (e) c.registerEnabled = e.checked;
            e = el('gm-register-days'); if (e) c.registerDays = parseInt(e.value, 10) || 1;
            e = el('gm-force-mode'); if (e) c.forceMode = e.checked;

            c.activeSkills = [];
            c.passiveSkills = [];
            document.querySelectorAll('#gm-active-skills input[type="checkbox"]').forEach(function (cb) {
                if (cb.checked) c.activeSkills.push(parseInt(cb.value, 10));
            });
            document.querySelectorAll('#gm-passive-skills input[type="checkbox"]').forEach(function (cb) {
                if (cb.checked) c.passiveSkills.push(parseInt(cb.value, 10));
            });

            saveConfig(c);
            showToast('GM 配置已保存，刷新后生效');
            var st = document.getElementById('gm-status');
            if (st) { st.textContent = '✓ 配置已保存。GM 值在每次读写时自动注入。'; st.style.color = '#28612d'; }
        });

        document.getElementById('gm-reload').addEventListener('click', function () { location.reload(); });
        document.getElementById('gm-reset').addEventListener('click', function () {
            if (confirm('确定要清除存档吗？此操作不可撤销！')) {
                localStorage.removeItem(SAVE_KEY);
                showToast('存档已清除，即将刷新…');
                setTimeout(function () { location.reload(); }, 500);
            }
        });
    }

    // ---- 设置窗口注入 ----
    function injectGmEntry() {
        var L = window.Laya;
        if (!L || !L.stage || !L.Box || !L.Image || !L.Label) return false;

        var settingWnd = findNode(L.stage, 'settingWnd');
        if (!settingWnd || settingWnd.__gmEntryAdded) return false;
        settingWnd.__gmEntryAdded = true;

        var CHECK_BORDER = 'resources/img/mainUI/setting/checkBoxBorder.png';

        var box = new L.Box();
        box.name = 'gmEntryBox';
        box.pos(271, 430);
        box.size(266, 45);
        box.anchorX = 0.5;
        box.anchorY = 0.5;
        box.mouseEnabled = true;
        box.zOrder = 10000;

        var border = new L.Image(CHECK_BORDER);
        border.name = 'gmEntryBorder';
        border.pos(28, 23);
        border.size(39, 38);
        border.anchorX = 0.5;
        border.anchorY = 0.5;
        border.centerY = 0;

        var icon = new L.Label('🔧');
        icon.name = 'gmEntryIcon';
        icon.pos(3, -2);
        icon.size(44, 31);
        icon.fontSize = 22;
        icon.color = '#8f2f20';
        icon.mouseEnabled = false;
        border.addChild(icon);

        var label = new L.Label('GM 功能');
        label.name = 'gmEntryLabel';
        label.pos(69, 23);
        label.size(186, 33);
        label.anchorY = 0.5;
        label.centerY = 0;
        label.fontSize = 31;
        label.color = '#8f2f20';
        label.mouseEnabled = false;

        box.addChild(border);
        box.addChild(label);
        settingWnd.addChild(box);

        box.on((L.Event && L.Event.CLICK) || 'click', null, function (e) {
            if (e && e.stopPropagation) e.stopPropagation();
            showPanel();
        });

        return true;
    }

    var injectTimer = setInterval(injectGmEntry, 200);
    setTimeout(function () { clearInterval(injectTimer); }, 30 * 60 * 1000);
})();
