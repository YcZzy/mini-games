/**
 * GM 功能面板
 *
 * 分两层：
 * 1) 读拦截层（脚本加载时立即执行，早于 game.js）：
 *    拦截 wx.getStorageSync / wx.getStorage / Storage.prototype.getItem，
 *    每次游戏读取 playerData 时注入 GM 数值。这样即使游戏自身覆盖存档，
 *    GM 修改也会在每次读取时重新注入。
 * 2) UI 层（轮询 Laya.stage）：
 *    在设置窗口注入"GM 功能"入口，HTML 覆盖层配置各项数值。
 *
 * 功能：
 * - 金币、等级、章节、连胜等数值修改
 * - 武器碎片自动补全（40 种武器）
 * - 主动/被动技能配置（自动去重过滤）
 * - 头像框全解锁
 * - 体力值修改
 * - 注册时间修改（解锁连续登录天数）
 * - 安全模式 (只补不降) / 强制模式 (覆盖)
 */
(function () {
    'use strict';

    var SAVE_KEY = 'playerData';
    var CONFIG_KEY = 'zhaoyun.gm.config';

    // ---- 武器列表 (来自原脚本) ----
    var WeaponList = [
        [1,50],[2,50],[3,50],[4,50],[5,50],[6,50],[7,50],[8,50],[9,50],
        [11,50],[12,50],[13,50],[14,50],[15,50],[16,50],[17,50],[18,50],[19,50],[20,50],
        [22,50],[23,50],[24,50],[25,50],[26,50],[27,50],[28,50],[29,50],[30,50],
        [32,50],[33,50],[34,50],[35,50],[36,50],[37,50],[38,50],[39,50],[40,50],[41,50],[42,50],[43,50]
    ];

    // ---- 技能名称 ----
    var SkillName = {
        2:"毛笔", 3:"练兵符", 4:"神兵符", 5:"包子", 6:"御敌千里",
        7:"砚台", 8:"陷阱", 9:"地雷", 10:"速攻符", 11:"降妖符",
        12:"农民", 13:"招贤榜", 14:"攻速符(全体)", 15:"齐头并进",
        16:"续命丹", 17:"大补丸", 18:"泥潭", 19:"洛阳铲",
        20:"召唤陨石", 21:"垃圾桶", 22:"升职令", 24:"摸金校尉"
    };
    var BanSkill = [1, 23];

    // ---- 默认 GM 配置 ----
    function defaultConfig() {
        return {
            goldEnabled: true,
            gold: 9999999,
            levelEnabled: true,
            level: 999,
            weaponEnabled: true,
            weaponCount: 50,
            skillEnabled: true,
            activeSkills: [4, 10],
            passiveSkills: [11, 12, 13, 15, 19, 24],
            avatarEnabled: true,
            staminaEnabled: true,
            stamina: 30,
            registerEnabled: true,
            registerDays: 7,
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

    // ---- 数值修改 ----
    function setNumber(data, key, value, force) {
        if (force) {
            data[key] = value;
            return;
        }
        var old = Number(data[key]) || 0;
        if (old < value) {
            data[key] = value;
        }
    }

    // ---- GM 注入逻辑（应用 GM 配置到存档数据上）----
    function injectGM(data) {
        if (!data || typeof data !== 'object') return data;

        var config = loadConfig();
        var force = config.forceMode;
        var now = Date.now();

        try {
            // 金币
            if (config.goldEnabled) {
                setNumber(data, 'gd', config.gold, force);
            }

            // 等级
            if (config.levelEnabled) {
                setNumber(data, 'cs', config.level, force);
                setNumber(data, 'ga', config.level, force);
                setNumber(data, 'wn', config.level, force);
                setNumber(data, 'ws', config.level, force);
                setNumber(data, 'ls', config.level, force);
                setNumber(data, 'cld', Math.max(99, Math.ceil(config.level / 10)), force);
            }

            // 武器碎片
            if (config.weaponEnabled) {
                if (!Array.isArray(data.wf)) data.wf = [];
                var weaponMap = {};
                data.wf.forEach(function (item) {
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
                        data.wf.push([item[0], config.weaponCount]);
                    }
                });
            }

            // 技能
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
                }
            }

            // 头像框
            if (config.avatarEnabled) {
                if (!Array.isArray(data.aul)) {
                    data.aul = Array(16).fill(1);
                } else {
                    data.aul = data.aul.map(function () { return 1; });
                }
            }

            // 体力
            if (config.staminaEnabled) {
                setNumber(data, 'sm', config.stamina, force);
            }

            // 注册时间
            if (config.registerEnabled) {
                var target = now - config.registerDays * 86400000 - 300000;
                if (force || !data.rt || data.rt > target) {
                    data.rt = target;
                }
            }

            // 固定解锁
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

    // =====================================================
    // Part 1: 读路径拦截 (立即执行，在 game.js 加载前生效)
    // =====================================================

    function installReadInterceptor() {
        // --- 拦截 wx.getStorageSync ---
        if (window.wx && window.wx.getStorageSync) {
            var _origGetStorageSync = window.wx.getStorageSync;
            window.wx.getStorageSync = function (key) {
                var value = _origGetStorageSync.call(window.wx, key);
                if (String(key) === SAVE_KEY && value) {
                    try {
                        var obj = typeof value === 'string' ? JSON.parse(value) : value;
                        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
                            obj = injectGM(obj);
                            return typeof value === 'string' ? JSON.stringify(obj) : obj;
                        }
                    } catch (e) {}
                }
                return value;
            };
        }

        // --- 拦截 wx.getStorage (异步) ---
        if (window.wx && window.wx.getStorage) {
            var _origGetStorage = window.wx.getStorage;
            window.wx.getStorage = function (opts) {
                if (opts && String(opts.key) === SAVE_KEY) {
                    var origSuccess = opts.success;
                    opts.success = function (res) {
                        try {
                            if (res && res.data !== undefined && res.data !== null && res.data !== '') {
                                var obj = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
                                if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
                                    obj = injectGM(obj);
                                    res.data = typeof res.data === 'string' ? JSON.stringify(obj) : obj;
                                }
                            }
                        } catch (e) {}
                        if (origSuccess) origSuccess(res);
                    };
                    return _origGetStorage.call(window.wx, opts);
                }
                return _origGetStorage.call(window.wx, opts);
            };
        }

        // --- 拦截 Storage.prototype.getItem（兜底直接 localStorage 读取）---
        try {
            var _origGetItem = Storage.prototype.getItem;
            if (!_origGetItem.__gmPatched) {
                Storage.prototype.getItem = function (key) {
                    var value = _origGetItem.call(this, key);
                    if (String(key) === SAVE_KEY && value) {
                        try {
                            var obj = JSON.parse(value);
                            if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
                                obj = injectGM(obj);
                                return JSON.stringify(obj);
                            }
                        } catch (e) {}
                    }
                    return value;
                };
                Storage.prototype.getItem.__gmPatched = true;
            }
        } catch (e) {
            console.warn('[gm-panel] Storage.getItem patch failed:', e);
        }

        console.log('[gm-panel] 读拦截已安装');
    }

    // 立即安装读拦截器
    installReadInterceptor();

    // =====================================================
    // Part 2: UI 层 (轮询 Laya.stage，注入设置入口和面板)
    // =====================================================

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

            '  <fieldset class="gm-fieldset">',
            '    <legend>💰 金币</legend>',
            '    <label class="gm-toggle"><input type="checkbox" id="gm-gold-enabled"' + (config.goldEnabled ? ' checked' : '') + '> 启用</label>',
            '    <label class="gm-field">数量 <input type="number" id="gm-gold" value="' + config.gold + '" min="0" step="100000"></label>',
            '  </fieldset>',

            '  <fieldset class="gm-fieldset">',
            '    <legend>📈 等级</legend>',
            '    <label class="gm-toggle"><input type="checkbox" id="gm-level-enabled"' + (config.levelEnabled ? ' checked' : '') + '> 启用</label>',
            '    <label class="gm-field">等级 (含连胜/最高) <input type="number" id="gm-level" value="' + config.level + '" min="1" max="999"></label>',
            '  </fieldset>',

            '  <fieldset class="gm-fieldset">',
            '    <legend>🗡 武器碎片</legend>',
            '    <label class="gm-toggle"><input type="checkbox" id="gm-weapon-enabled"' + (config.weaponEnabled ? ' checked' : '') + '> 启用</label>',
            '    <label class="gm-field">碎片数量 <input type="number" id="gm-weapon-count" value="' + config.weaponCount + '" min="1" max="999"></label>',
            '    <p class="gm-hint">每次读档自动补全全部武器，已有武器保留较高碎片数</p>',
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
            '    <label class="gm-toggle"><input type="checkbox" id="gm-avatar-enabled"' + (config.avatarEnabled ? ' checked' : '') + '> 启用 (解锁全部)</label>',
            '  </fieldset>',

            '  <fieldset class="gm-fieldset">',
            '    <legend>⚡ 体力</legend>',
            '    <label class="gm-toggle"><input type="checkbox" id="gm-stamina-enabled"' + (config.staminaEnabled ? ' checked' : '') + '> 启用</label>',
            '    <label class="gm-field">体力值 <input type="number" id="gm-stamina" value="' + config.stamina + '" min="1" max="999"></label>',
            '  </fieldset>',

            '  <fieldset class="gm-fieldset">',
            '    <legend>📅 注册天数</legend>',
            '    <label class="gm-toggle"><input type="checkbox" id="gm-register-enabled"' + (config.registerEnabled ? ' checked' : '') + '> 启用</label>',
            '    <label class="gm-field">改为 N 天前注册 <input type="number" id="gm-register-days" value="' + config.registerDays + '" min="1" max="365"></label>',
            '    <p class="gm-hint">影响连续登录天数判定，建议 ≥7 天</p>',
            '  </fieldset>',

            '  <fieldset class="gm-fieldset">',
            '    <legend>🔧 修改模式</legend>',
            '    <label class="gm-toggle' + (config.forceMode ? ' is-warn' : '') + '"><input type="checkbox" id="gm-force-mode"' + (config.forceMode ? ' checked' : '') + '> 强制覆盖 (默认安全模式：只补不降)</label>',
            '  </fieldset>',

            '  <div class="gm-actions">',
            '    <button class="gm-btn-primary" id="gm-apply" type="button">保存并刷新</button>',
            '    <button class="gm-btn-secondary" id="gm-reload" type="button">仅刷新页面</button>',
            '    <button class="gm-btn-danger" id="gm-reset" type="button">重置存档</button>',
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

        // 关闭
        document.getElementById('gm-panel-close').addEventListener('click', function () {
            layer.remove();
        });

        // 技能 checkbox 限制
        function bindSkillGrid(gridId, maxCount) {
            var grid = document.getElementById(gridId);
            if (!grid) return;
            grid.addEventListener('change', function (e) {
                var target = e.target;
                if (target.type !== 'checkbox') return;
                var checkboxes = grid.querySelectorAll('input[type="checkbox"]');
                var checked = [];
                checkboxes.forEach(function (cb) { if (cb.checked) checked.push(cb); });
                if (checked.length > maxCount) {
                    target.checked = false;
                    showToast('最多选择 ' + maxCount + ' 个技能');
                    return;
                }
                checkboxes.forEach(function (cb) {
                    var label = cb.parentElement;
                    if (cb.checked) {
                        label.classList.add('is-on');
                        label.classList.remove('disabled');
                    } else {
                        label.classList.remove('is-on');
                        label.classList.add('disabled', checked.length >= maxCount ? 'disabled' : '');
                        if (checked.length < maxCount) label.classList.remove('disabled');
                    }
                });
            });
            // 初始化 disabled 状态
            (function () {
                var checkboxes = grid.querySelectorAll('input[type="checkbox"]');
                var checkedCount = 0;
                checkboxes.forEach(function (cb) { if (cb.checked) checkedCount++; });
                if (checkedCount >= maxCount) {
                    checkboxes.forEach(function (cb) {
                        if (!cb.checked) cb.parentElement.classList.add('disabled');
                    });
                }
            })();
        }
        bindSkillGrid('gm-active-skills', 2);
        bindSkillGrid('gm-passive-skills', 6);

        // 保存并刷新
        document.getElementById('gm-apply').addEventListener('click', function () {
            var c = config;
            var el;

            el = document.getElementById('gm-gold-enabled'); if (el) c.goldEnabled = el.checked;
            el = document.getElementById('gm-gold'); if (el) c.gold = parseInt(el.value, 10) || 0;
            el = document.getElementById('gm-level-enabled'); if (el) c.levelEnabled = el.checked;
            el = document.getElementById('gm-level'); if (el) c.level = parseInt(el.value, 10) || 1;
            el = document.getElementById('gm-weapon-enabled'); if (el) c.weaponEnabled = el.checked;
            el = document.getElementById('gm-weapon-count'); if (el) c.weaponCount = parseInt(el.value, 10) || 1;
            el = document.getElementById('gm-skill-enabled'); if (el) c.skillEnabled = el.checked;
            el = document.getElementById('gm-avatar-enabled'); if (el) c.avatarEnabled = el.checked;
            el = document.getElementById('gm-stamina-enabled'); if (el) c.staminaEnabled = el.checked;
            el = document.getElementById('gm-stamina'); if (el) c.stamina = parseInt(el.value, 10) || 1;
            el = document.getElementById('gm-register-enabled'); if (el) c.registerEnabled = el.checked;
            el = document.getElementById('gm-register-days'); if (el) c.registerDays = parseInt(el.value, 10) || 1;
            el = document.getElementById('gm-force-mode'); if (el) c.forceMode = el.checked;

            c.activeSkills = [];
            c.passiveSkills = [];
            document.querySelectorAll('#gm-active-skills input[type="checkbox"]').forEach(function (cb) {
                if (cb.checked) c.activeSkills.push(parseInt(cb.value, 10));
            });
            document.querySelectorAll('#gm-passive-skills input[type="checkbox"]').forEach(function (cb) {
                if (cb.checked) c.passiveSkills.push(parseInt(cb.value, 10));
            });

            saveConfig(c);
            showToast('GM 配置已保存，正在刷新…');
            setTimeout(function () { location.reload(); }, 400);
        });

        // 仅刷新
        document.getElementById('gm-reload').addEventListener('click', function () {
            location.reload();
        });

        // 重置存档
        document.getElementById('gm-reset').addEventListener('click', function () {
            if (confirm('确定要清除存档吗？此操作不可撤销！')) {
                localStorage.removeItem(SAVE_KEY);
                showToast('存档已清除，即将刷新…');
                setTimeout(function () { location.reload(); }, 500);
            }
        });
    }

    // ---- Laya 设置窗口注入 ----

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
