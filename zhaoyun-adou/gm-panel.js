/**
 * GM 功能面板
 *
 * 在设置窗口中注入"GM 功能"入口，点击后打开 HTML 覆盖层，
 * 可直接修改 localStorage 中的 playerData 存档。
 *
 * 功能：
 * - 金币、等级、章节、连胜等数值修改
 * - 武器碎片自动补全
 * - 主动/被动技能配置
 * - 头像框全解锁
 * - 体力值修改
 * - 注册时间修改（解锁连续登录天数）
 * - 安全模式 (只补不降) / 强制模式 (覆盖)
 */
(function () {
    'use strict';

    var SAVE_KEY = 'playerData';

    // ---- 工具函数 ----

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

    function readSave() {
        try {
            var raw = localStorage.getItem(SAVE_KEY);
            if (!raw) return {};
            return JSON.parse(raw);
        } catch (e) {
            return {};
        }
    }

    function writeSave(data) {
        try {
            localStorage.setItem(SAVE_KEY, JSON.stringify(data));
            return true;
        } catch (e) {
            return false;
        }
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

    // ---- 数值修改 ----

    var ForceValue = false;

    function setNumber(data, key, value) {
        if (ForceValue) {
            data[key] = value;
            return;
        }
        var old = Number(data[key]) || 0;
        if (old < value) {
            data[key] = value;
        }
    }

    // ---- 武器列表 (来自原脚本) ----
    var WeaponList = [
        [1,50],[2,50],[3,50],[4,50],[5,50],[6,50],[7,50],[8,50],[9,50],
        [11,50],[12,50],[13,50],[14,50],[15,50],[16,50],[17,50],[18,50],[19,50],[20,50],
        [22,50],[23,50],[24,50],[25,50],[26,50],[27,50],[28,50],[29,50],[30,50],
        [32,50],[33,50],[34,50],[35,50],[36,50],[37,50],[38,50],[39,50],[40,50],[41,50],[42,50],[43,50]
    ];

    // ---- 技能名称映射 ----
    var SkillName = {
        2:"毛笔", 3:"练兵符", 4:"神兵符", 5:"包子", 6:"御敌千里",
        7:"砚台", 8:"陷阱", 9:"地雷", 10:"速攻符", 11:"降妖符",
        12:"农民", 13:"招贤榜", 14:"攻速符(全体)", 15:"齐头并进",
        16:"续命丹", 17:"大补丸", 18:"泥潭", 19:"洛阳铲",
        20:"召唤陨石", 21:"垃圾桶", 22:"升职令", 24:"摸金校尉"
    };

    var BanSkill = [1, 23]; // 推土车、行军丹

    // ---- GM 修改逻辑 ----

    function applyGM(data, config) {
        var current = Date.now();

        // 金币
        if (config.goldEnabled) {
            setNumber(data, 'gd', config.gold);
        }

        // 等级相关
        if (config.levelEnabled) {
            setNumber(data, 'cs', config.level);   // 等级
            setNumber(data, 'ga', config.level);   // 昨日等级
            setNumber(data, 'wn', config.level);   // 胜利次数
            setNumber(data, 'ws', config.level);   // 连胜次数
            setNumber(data, 'ls', config.level);   // 历史最高
            setNumber(data, 'cld', Math.max(99, Math.ceil(config.level / 10))); // 章节
        }

        // 武器
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
                    weaponMap[item[0]][1] = ForceValue ? config.weaponCount : Math.max(Number(weaponMap[item[0]][1]) || 0, config.weaponCount);
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
                skillList.push([id, 1, current - (skillList.length + 1) * 300000]);
            }
            (config.activeSkills || []).slice(0, 2).forEach(addSkill);
            (config.passiveSkills || []).slice(0, 6).forEach(addSkill);
            if (skillList.length > 0) {
                data.ps = skillList;
            }
        }

        // 头像
        if (config.avatarEnabled) {
            if (!Array.isArray(data.aul)) {
                data.aul = Array(16).fill(1);
            } else {
                data.aul = data.aul.map(function () { return 1; });
            }
        }

        // 体力
        if (config.staminaEnabled) {
            setNumber(data, 'sm', config.stamina);
        }

        // 注册时间
        if (config.registerEnabled) {
            var target = current - config.registerDays * 86400000 - 300000;
            if (ForceValue || !data.rt || data.rt > target) {
                data.rt = target;
            }
        }

        // 固定解锁项
        data.hfb = true;  // 新手引导
        data.pap = true;  // 隐私协议
        data.wfr = true;  // 武器功能
        data.wdg = true;  // 引导
        data.afu = false;
    }

    // ---- UI: HTML 覆盖层 ----

    var currentConfig = {};

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
            var saved = localStorage.getItem('zhaoyun.gm.config');
            if (saved) {
                var parsed = JSON.parse(saved);
                // 合并默认值，防止缺少新字段
                var def = defaultConfig();
                Object.keys(def).forEach(function (k) {
                    if (!(k in parsed)) parsed[k] = def[k];
                });
                return parsed;
            }
        } catch (e) {}
        return defaultConfig();
    }

    function saveConfig(config) {
        try {
            localStorage.setItem('zhaoyun.gm.config', JSON.stringify(config));
        } catch (e) {}
    }

    function buildPanel() {
        var config = currentConfig;

        // 技能 checkbox HTML
        function skillCheckboxes(selected, max) {
            var allSkills = Object.keys(SkillName).map(Number).filter(function (id) {
                return BanSkill.indexOf(id) < 0;
            });
            var html = '';
            allSkills.forEach(function (id) {
                var checked = selected.indexOf(id) >= 0 ? ' checked' : '';
                var disabled = '';
                // 如果已经选了 max 个且当前项未被选中，则禁用
                if (selected.length >= max && selected.indexOf(id) < 0) {
                    disabled = ' disabled';
                }
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

            // 金币
            '  <fieldset class="gm-fieldset">',
            '    <legend>💰 金币</legend>',
            '    <label class="gm-toggle"><input type="checkbox" id="gm-gold-enabled"' + (config.goldEnabled ? ' checked' : '') + '> 启用</label>',
            '    <label class="gm-field">数量 <input type="number" id="gm-gold" value="' + config.gold + '" min="0" step="100000"></label>',
            '  </fieldset>',

            // 等级
            '  <fieldset class="gm-fieldset">',
            '    <legend>📈 等级</legend>',
            '    <label class="gm-toggle"><input type="checkbox" id="gm-level-enabled"' + (config.levelEnabled ? ' checked' : '') + '> 启用</label>',
            '    <label class="gm-field">等级 (含连胜/最高) <input type="number" id="gm-level" value="' + config.level + '" min="1" max="999"></label>',
            '  </fieldset>',

            // 武器
            '  <fieldset class="gm-fieldset">',
            '    <legend>🗡 武器碎片</legend>',
            '    <label class="gm-toggle"><input type="checkbox" id="gm-weapon-enabled"' + (config.weaponEnabled ? ' checked' : '') + '> 启用</label>',
            '    <label class="gm-field">碎片数量 <input type="number" id="gm-weapon-count" value="' + config.weaponCount + '" min="1" max="999"></label>',
            '    <p class="gm-hint">自动补全全部武器，已有武器保留较高碎片数</p>',
            '  </fieldset>',

            // 技能
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

            // 头像
            '  <fieldset class="gm-fieldset">',
            '    <legend>🖼 头像框</legend>',
            '    <label class="gm-toggle"><input type="checkbox" id="gm-avatar-enabled"' + (config.avatarEnabled ? ' checked' : '') + '> 启用 (解锁全部)</label>',
            '  </fieldset>',

            // 体力
            '  <fieldset class="gm-fieldset">',
            '    <legend>⚡ 体力</legend>',
            '    <label class="gm-toggle"><input type="checkbox" id="gm-stamina-enabled"' + (config.staminaEnabled ? ' checked' : '') + '> 启用</label>',
            '    <label class="gm-field">体力值 <input type="number" id="gm-stamina" value="' + config.stamina + '" min="1" max="999"></label>',
            '  </fieldset>',

            // 注册时间
            '  <fieldset class="gm-fieldset">',
            '    <legend>📅 注册天数</legend>',
            '    <label class="gm-toggle"><input type="checkbox" id="gm-register-enabled"' + (config.registerEnabled ? ' checked' : '') + '> 启用</label>',
            '    <label class="gm-field">改为 N 天前注册 <input type="number" id="gm-register-days" value="' + config.registerDays + '" min="1" max="365"></label>',
            '    <p class="gm-hint">影响连续登录天数判定，建议 ≥7 天</p>',
            '  </fieldset>',

            // 模式
            '  <fieldset class="gm-fieldset">',
            '    <legend>🔧 修改模式</legend>',
            '    <label class="gm-toggle' + (config.forceMode ? ' is-warn' : '') + '"><input type="checkbox" id="gm-force-mode"' + (config.forceMode ? ' checked' : '') + '> 强制覆盖 (默认安全模式：只补不降)</label>',
            '  </fieldset>',

            // 操作按钮
            '  <div class="gm-actions">',
            '    <button class="gm-btn-primary" id="gm-apply" type="button">应用修改</button>',
            '    <button class="gm-btn-secondary" id="gm-reload" type="button">刷新页面生效</button>',
            '    <button class="gm-btn-danger" id="gm-reset" type="button">重置存档</button>',
            '  </div>',

            '  <p class="gm-status" id="gm-status"></p>',
            '</div>'
        ].join('');
    }

    function syncConfigFromDOM() {
        var c = currentConfig;
        var goldEnabled = document.getElementById('gm-gold-enabled');
        var gold = document.getElementById('gm-gold');
        var levelEnabled = document.getElementById('gm-level-enabled');
        var level = document.getElementById('gm-level');
        var weaponEnabled = document.getElementById('gm-weapon-enabled');
        var weaponCount = document.getElementById('gm-weapon-count');
        var skillEnabled = document.getElementById('gm-skill-enabled');
        var avatarEnabled = document.getElementById('gm-avatar-enabled');
        var staminaEnabled = document.getElementById('gm-stamina-enabled');
        var stamina = document.getElementById('gm-stamina');
        var registerEnabled = document.getElementById('gm-register-enabled');
        var registerDays = document.getElementById('gm-register-days');
        var forceMode = document.getElementById('gm-force-mode');

        if (goldEnabled) c.goldEnabled = goldEnabled.checked;
        if (gold) c.gold = parseInt(gold.value, 10) || 0;
        if (levelEnabled) c.levelEnabled = levelEnabled.checked;
        if (level) c.level = parseInt(level.value, 10) || 1;
        if (weaponEnabled) c.weaponEnabled = weaponEnabled.checked;
        if (weaponCount) c.weaponCount = parseInt(weaponCount.value, 10) || 1;
        if (skillEnabled) c.skillEnabled = skillEnabled.checked;
        if (avatarEnabled) c.avatarEnabled = avatarEnabled.checked;
        if (staminaEnabled) c.staminaEnabled = staminaEnabled.checked;
        if (stamina) c.stamina = parseInt(stamina.value, 10) || 1;
        if (registerEnabled) c.registerEnabled = registerEnabled.checked;
        if (registerDays) c.registerDays = parseInt(registerDays.value, 10) || 1;
        if (forceMode) c.forceMode = forceMode.checked;

        // 同步技能选择
        var activeCheckboxes = document.querySelectorAll('#gm-active-skills input[type="checkbox"]');
        var passiveCheckboxes = document.querySelectorAll('#gm-passive-skills input[type="checkbox"]');
        c.activeSkills = [];
        c.passiveSkills = [];
        activeCheckboxes.forEach(function (cb) {
            if (cb.checked) c.activeSkills.push(parseInt(cb.value, 10));
        });
        passiveCheckboxes.forEach(function (cb) {
            if (cb.checked) c.passiveSkills.push(parseInt(cb.value, 10));
        });
    }

    function showPanel() {
        // 移除已有面板
        var existing = document.getElementById('gm-panel-layer');
        if (existing) {
            existing.remove();
            return;
        }

        currentConfig = loadConfig();

        var layer = document.createElement('div');
        layer.id = 'gm-panel-layer';
        layer.innerHTML = buildPanel();
        shell().appendChild(layer);

        ForceValue = currentConfig.forceMode;

        // 绑定事件
        document.getElementById('gm-panel-close').addEventListener('click', function () {
            layer.remove();
        });

        // 强制模式切换时更新全局变量
        document.getElementById('gm-force-mode').addEventListener('change', function () {
            ForceValue = this.checked;
        });

        // 技能 checkbox 交互限制
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
                // 更新样式
                checkboxes.forEach(function (cb) {
                    var label = cb.parentElement;
                    if (cb.checked) {
                        label.classList.add('is-on');
                        label.classList.remove('disabled');
                    } else {
                        label.classList.remove('is-on');
                        if (checked.length >= maxCount) {
                            label.classList.add('disabled');
                        } else {
                            label.classList.remove('disabled');
                        }
                    }
                });
            });
        }
        bindSkillGrid('gm-active-skills', 2);
        bindSkillGrid('gm-passive-skills', 6);

        // 应用按钮
        document.getElementById('gm-apply').addEventListener('click', function () {
            syncConfigFromDOM();
            ForceValue = currentConfig.forceMode;
            saveConfig(currentConfig);

            var save = readSave();
            if (!save || typeof save !== 'object') {
                save = {};
            }

            // 确保基础结构
            if (typeof save._nick !== 'string') save._nick = '';

            applyGM(save, currentConfig);

            if (writeSave(save)) {
                var status = document.getElementById('gm-status');
                if (status) {
                    status.textContent = '✓ 修改已写入存档。部分数值需刷新页面后生效。';
                    status.style.color = '#28612d';
                }
                showToast('GM 修改已应用');
            } else {
                var statusEl = document.getElementById('gm-status');
                if (statusEl) {
                    statusEl.textContent = '✗ 写入失败，请重试';
                    statusEl.style.color = '#9a3024';
                }
                showToast('写入失败');
            }
        });

        // 刷新按钮
        document.getElementById('gm-reload').addEventListener('click', function () {
            syncConfigFromDOM();
            saveConfig(currentConfig);
            location.reload();
        });

        // 重置按钮
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

        // 使用简单的文字按钮，类似全屏开关的位置
        var CHECK_BORDER = 'resources/img/mainUI/setting/checkBoxBorder.png';
        var CHECK_OK = 'resources/img/mainUI/setting/checkOK.png';

        // 放在全屏开关下方
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

        // 用一个小图标标记 GM，而不是 checkbox 勾选标记
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
