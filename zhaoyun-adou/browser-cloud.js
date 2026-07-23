(function () {
    'use strict';

    var SAVE_KEY = 'playerData';
    var TOKEN_KEY = 'zhaoyun.cloud.token';
    var IDENTITY_KEY = 'zhaoyun.cloud.identity';
    var OWNER_KEY = 'zhaoyun.cloud.saveOwner';
    var config = window.ZHAOYUN_CLOUD_CONFIG || {};
    var apiBase = String(config.apiBaseUrl || '').replace(/\/+$/, '');
    var timeoutMs = Number(config.requestTimeoutMs) || 8000;
    var state = {
        enabled: true,
        online: false,
        token: localStorage.getItem(TOKEN_KEY) || '',
        player: null,
        hooksInstalled: false,
        applyingCloud: false,
        pendingSave: null,
        pendingVersion: 0,
        syncing: false,
        syncAgain: false,
        temporarySaveMode: false
    };
    var startPromise = null;
    var rankConfigPromise = null;
    var rankPatchTimer = 0;

    function parseJson(value) {
        if (!value || typeof value !== 'string') return null;
        try { return JSON.parse(value); }
        catch (error) { return null; }
    }

    function readLocalSave() {
        var save = parseJson(localStorage.getItem(SAVE_KEY));
        return save && typeof save === 'object' && !Array.isArray(save) ? save : null;
    }

    function cachedIdentity() {
        var identity = parseJson(localStorage.getItem(IDENTITY_KEY));
        if (!identity || typeof identity.id !== 'string' || typeof identity.nickname !== 'string') return null;
        return identity;
    }

    function normalizeSave(save) {
        if (!save || typeof save !== 'object' || Array.isArray(save)) return null;
        var normalized = Object.assign({}, save);
        if (state.player && state.player.nickname) normalized._nick = state.player.nickname;
        return normalized;
    }

    function saveScore(save) {
        if (!save) return { games: -1, time: -1 };
        var win = Number(save._win);
        var lose = Number(save._lose);
        var saveTime = Number(save._saveTime);
        return {
            games: Math.max(0, Number.isFinite(win) ? win : 0) + Math.max(0, Number.isFinite(lose) ? lose : 0),
            time: Number.isFinite(saveTime) ? saveTime : 0
        };
    }

    function localIsNewer(localSave, cloudSave) {
        if (!localSave) return false;
        if (!cloudSave) return true;
        var local = saveScore(localSave);
        var cloud = saveScore(cloudSave);
        if (local.games !== cloud.games) return local.games > cloud.games;
        return local.time > cloud.time;
    }

    function writeLocalSave(save) {
        var normalized = normalizeSave(save);
        if (!normalized) return;
        state.applyingCloud = true;
        try { localStorage.setItem(SAVE_KEY, JSON.stringify(normalized)); }
        finally { state.applyingCloud = false; }
    }

    function removeLocalSave() {
        state.applyingCloud = true;
        try { localStorage.removeItem(SAVE_KEY); }
        finally { state.applyingCloud = false; }
    }

    function makeApiError(message, status, code, details) {
        var error = new Error(message || '云服务请求失败');
        error.status = status || 0;
        error.code = code || 'request_failed';
        error.details = details || null;
        return error;
    }

    async function apiRequest(path, options) {
        options = options || {};
        if (!apiBase) throw makeApiError('云服务尚未配置', 0, 'api_not_configured');
        var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs) : 0;
        var headers = Object.assign({}, options.headers || {});
        if (state.token) headers.Authorization = 'Bearer ' + state.token;
        if (options.body !== undefined) headers['Content-Type'] = 'application/json';
        var response;
        try {
            response = await fetch(apiBase + path, {
                method: options.method || 'GET',
                headers: headers,
                body: options.body === undefined ? undefined : JSON.stringify(options.body),
                signal: controller ? controller.signal : undefined
            });
        } catch (error) {
            var code = error && error.name === 'AbortError' ? 'timeout' : 'network_error';
            throw makeApiError(code === 'timeout' ? '云服务响应超时' : '无法连接云服务', 0, code);
        } finally {
            if (timer) clearTimeout(timer);
        }

        var payload;
        try { payload = await response.json(); }
        catch (error) { throw makeApiError('云服务返回了无效数据', response.status, 'invalid_response'); }
        if (!response.ok || !payload || payload.ok !== true) {
            var apiError = payload && payload.error || {};
            throw makeApiError(apiError.message, response.status, apiError.code, apiError.details);
        }
        return payload.data;
    }

    function shell() {
        return document.getElementById('phone-shell') || document.body;
    }

    function ensureBootLayer() {
        var layer = document.getElementById('zhao-cloud-layer');
        if (!layer) {
            layer = document.createElement('div');
            layer.id = 'zhao-cloud-layer';
            shell().appendChild(layer);
        }
        return layer;
    }

    function showBoot(message) {
        var layer = ensureBootLayer();
        layer.innerHTML = '';
        var card = document.createElement('div');
        card.className = 'zhao-cloud-card zhao-cloud-loading';
        var spinner = document.createElement('div');
        spinner.className = 'zhao-cloud-spinner';
        var text = document.createElement('div');
        text.textContent = message || '正在连接云端…';
        card.appendChild(spinner);
        card.appendChild(text);
        layer.appendChild(card);
    }

    function removeBootLayer() {
        var layer = document.getElementById('zhao-cloud-layer');
        if (layer) layer.remove();
    }

    function showFatal(message) {
        var layer = ensureBootLayer();
        layer.innerHTML = '';
        var card = document.createElement('div');
        card.className = 'zhao-cloud-card';
        var title = document.createElement('h1');
        title.textContent = '无法启动游戏';
        var status = document.createElement('p');
        status.className = 'zhao-cloud-status';
        status.textContent = message || '请刷新页面重试';
        card.appendChild(title);
        card.appendChild(status);
        layer.appendChild(card);
    }

    function promptLogin() {
        return new Promise(function (resolve) {
            var layer = ensureBootLayer();
            layer.innerHTML = [
                '<div class="zhao-cloud-card">',
                '  <div class="zhao-cloud-brand">赵云与阿斗</div>',
                '  <h1>进入游戏</h1>',
                '  <form id="zhao-cloud-login-form">',
                '    <label class="zhao-cloud-field"><span>玩家昵称</span>',
                '      <input id="zhao-cloud-nickname" name="nickname" maxlength="16" autocomplete="username" required>',
                '    </label>',
                '    <label class="zhao-cloud-field"><span>云存档 PIN</span>',
                '      <input id="zhao-cloud-pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" autocomplete="current-password" required>',
                '    </label>',
                '    <button class="zhao-cloud-primary" type="submit">进入游戏</button>',
                '  </form>',
                '  <p class="zhao-cloud-hint">首次使用该昵称会自动创建玩家。请记住 4～6 位 PIN，用于换设备恢复进度。</p>',
                '  <p id="zhao-cloud-login-status" class="zhao-cloud-status" aria-live="polite"></p>',
                '</div>'
            ].join('');

            var form = document.getElementById('zhao-cloud-login-form');
            var nicknameInput = document.getElementById('zhao-cloud-nickname');
            var pinInput = document.getElementById('zhao-cloud-pin');
            var status = document.getElementById('zhao-cloud-login-status');
            var button = form.querySelector('button');
            var identity = cachedIdentity();
            var localSave = readLocalSave();
            nicknameInput.value = identity && identity.nickname || localSave && localSave._nick !== '无名' && localSave._nick || '';
            if (!apiBase) {
                status.textContent = '生产环境尚未填写 Worker API 地址';
                button.disabled = true;
            }

            form.addEventListener('submit', async function (event) {
                event.preventDefault();
                button.disabled = true;
                status.removeAttribute('data-kind');
                status.textContent = '正在验证并读取云存档…';
                try {
                    var data = await apiRequest('/v1/auth/enter', {
                        method: 'POST',
                        body: { nickname: nicknameInput.value, pin: pinInput.value }
                    });
                    state.token = data.token;
                    localStorage.setItem(TOKEN_KEY, state.token);
                    status.setAttribute('data-kind', 'ok');
                    status.textContent = data.created ? '玩家已创建，正在载入…' : '登录成功，正在载入…';
                    resolve(data);
                } catch (error) {
                    status.textContent = error.message || '登录失败，请重试';
                    pinInput.value = '';
                    pinInput.focus();
                    button.disabled = false;
                }
            });
            setTimeout(function () { (nicknameInput.value ? pinInput : nicknameInput).focus(); }, 0);
        });
    }

    function rememberPlayer(player) {
        state.player = { id: player.id, nickname: player.nickname };
        localStorage.setItem(IDENTITY_KEY, JSON.stringify(state.player));
    }

    function cloudPayload(authData) {
        return authData && authData.save && authData.save.save && typeof authData.save.save === 'object'
            ? authData.save.save
            : null;
    }

    async function mergeProgress(authData, previousOwnerId) {
        var localSave = readLocalSave();
        var cloudSave = cloudPayload(authData);
        var localBelongsToPlayer = !previousOwnerId || previousOwnerId === state.player.id;

        if (!localBelongsToPlayer) {
            if (cloudSave) writeLocalSave(cloudSave);
            else removeLocalSave();
        } else if (localIsNewer(localSave, cloudSave)) {
            var normalizedLocal = normalizeSave(localSave);
            writeLocalSave(normalizedLocal);
            try {
                var result = await apiRequest('/v1/save', { method: 'PUT', body: { save: normalizedLocal } });
                state.online = true;
                if (result && result.save && result.save.save) writeLocalSave(result.save.save);
            } catch (error) {
                if (error.status === 409 && error.details && error.details.cloudSave) {
                    writeLocalSave(error.details.cloudSave.save);
                } else {
                    state.online = false;
                }
            }
        } else if (cloudSave) {
            writeLocalSave(cloudSave);
        } else if (localSave) {
            writeLocalSave(localSave);
        }

        localStorage.setItem(OWNER_KEY, state.player.id);
    }

    function installStorageHooks() {
        if (state.hooksInstalled) return;
        state.hooksInstalled = true;

        var storageSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            if (String(key) === SAVE_KEY && state.player) {
                var parsed = typeof value === 'string' ? parseJson(value) : value;
                var normalized = normalizeSave(parsed);
                if (normalized) {
                    value = JSON.stringify(normalized);
                    var result = storageSetItem.call(this, key, value);
                    if (!state.applyingCloud && !state.temporarySaveMode) scheduleSync(normalized);
                    return result;
                }
            }
            return storageSetItem.call(this, key, value);
        };

        if (window.wx && typeof window.wx.setStorageSync === 'function') {
            var wxSetStorageSync = window.wx.setStorageSync;
            window.wx.setStorageSync = function (key, data) {
                if (String(key) === SAVE_KEY && state.player) {
                    var parsed = typeof data === 'string' ? parseJson(data) : data;
                    var normalized = normalizeSave(parsed);
                    if (normalized) {
                        data = typeof data === 'string' ? JSON.stringify(normalized) : normalized;
                        var result = wxSetStorageSync.call(window.wx, key, data);
                        if (!state.applyingCloud && !state.temporarySaveMode) scheduleSync(normalized);
                        return result;
                    }
                }
                return wxSetStorageSync.call(window.wx, key, data);
            };
        }

        if (window.wx && typeof window.wx.setStorage === 'function') {
            var wxSetStorage = window.wx.setStorage;
            window.wx.setStorage = function (options) {
                if (options && String(options.key) === SAVE_KEY && state.player) {
                    var parsed = typeof options.data === 'string' ? parseJson(options.data) : options.data;
                    var normalized = normalizeSave(parsed);
                    if (normalized) {
                        options = Object.assign({}, options, {
                            data: typeof options.data === 'string' ? JSON.stringify(normalized) : normalized
                        });
                        if (!state.applyingCloud && !state.temporarySaveMode) scheduleSync(normalized);
                    }
                }
                return wxSetStorage.call(window.wx, options);
            };
        }

        window.addEventListener('online', function () { syncNow().catch(function () {}); });
        window.addEventListener('pagehide', function () { syncNow().catch(function () {}); });
    }

    var syncTimer = 0;
    function scheduleSync(save) {
        if (!state.enabled || !state.token || state.temporarySaveMode) return;
        state.pendingSave = normalizeSave(save);
        state.pendingVersion += 1;
        clearTimeout(syncTimer);
        syncTimer = setTimeout(function () { syncNow().catch(function () {}); }, 1200);
    }

    async function syncNow() {
        if (!state.enabled || !state.token || state.temporarySaveMode) return null;
        if (state.syncing) {
            state.syncAgain = true;
            return null;
        }
        var save = state.pendingSave;
        if (!save) return null;
        var version = state.pendingVersion;
        state.syncing = true;
        try {
            var result = await apiRequest('/v1/save', { method: 'PUT', body: { save: save } });
            state.online = true;
            if (version === state.pendingVersion) state.pendingSave = null;
            return result;
        } catch (error) {
            if (error.status === 409 && error.details && error.details.cloudSave && error.details.cloudSave.save) {
                writeLocalSave(error.details.cloudSave.save);
                state.pendingSave = null;
                showToast('检测到另一台设备的新进度，正在重新载入');
                setTimeout(function () { location.reload(); }, 500);
                return error.details.cloudSave;
            }
            if (error.status === 401) {
                state.token = '';
                localStorage.removeItem(TOKEN_KEY);
                showToast('云登录已过期，刷新后请重新登录');
            }
            state.online = false;
            return null;
        } finally {
            state.syncing = false;
            if (state.syncAgain) {
                state.syncAgain = false;
                scheduleSync(state.pendingSave || readLocalSave());
            }
        }
    }

    function showToast(message) {
        var old = document.querySelector('.zhao-cloud-toast');
        if (old) old.remove();
        var toast = document.createElement('div');
        toast.className = 'zhao-cloud-toast';
        toast.textContent = message;
        shell().appendChild(toast);
        setTimeout(function () { toast.remove(); }, 2600);
    }

    async function start() {
        if (startPromise) return startPromise;
        startPromise = (async function () {
            var params = new URLSearchParams(location.search);
            if (params.get('cloud') === 'off') {
                state.enabled = false;
                var local = readLocalSave();
                state.player = { id: 'offline', nickname: local && local._nick || '离线玩家' };
                return;
            }

            var previousOwnerId = localStorage.getItem(OWNER_KEY) || '';
            var identity = cachedIdentity();
            var authData = null;
            showBoot('正在连接云端并检查存档…');

            if (state.token) {
                try {
                    authData = await apiRequest('/v1/auth/resume', { method: 'POST' });
                    state.online = true;
                } catch (error) {
                    if (error.status === 401) {
                        state.token = '';
                        localStorage.removeItem(TOKEN_KEY);
                    } else if (identity) {
                        rememberPlayer(identity);
                        state.online = false;
                        var offlineSave = normalizeSave(readLocalSave());
                        if (offlineSave) writeLocalSave(offlineSave);
                        installStorageHooks();
                        showBoot('云服务暂不可用，正在以离线模式进入…');
                        return;
                    }
                }
            }

            if (!authData) authData = await promptLogin();
            state.online = true;
            rememberPlayer(authData.player);
            await mergeProgress(authData, previousOwnerId);
            installStorageHooks();
            showBoot('云存档已就绪，正在进入游戏…');
        })();
        return startPromise;
    }

    function loadRankConfig() {
        if (!rankConfigPromise) {
            rankConfigPromise = fetch(new URL('data/rank.json', location.href).href)
                .then(function (response) {
                    if (!response.ok) throw new Error('rank config failed');
                    return response.json();
                })
                .catch(function () { return []; });
        }
        return rankConfigPromise;
    }

    function appendRankRow(list, entry, ranks) {
        var row = document.createElement('div');
        row.className = 'zhao-rank-row' + (entry.isCurrent ? ' is-current' : '');

        var position = document.createElement('div');
        position.className = 'zhao-rank-position';
        position.textContent = entry.position <= 3 ? ['🥇', '🥈', '🥉'][entry.position - 1] : String(entry.position);

        var player = document.createElement('div');
        player.className = 'zhao-rank-player';
        var name = document.createElement('div');
        name.className = 'zhao-rank-name';
        name.textContent = entry.nickname + (entry.isCurrent ? '（我）' : '');
        var record = document.createElement('div');
        record.className = 'zhao-rank-record';
        record.textContent = entry.wins + ' 胜 · ' + entry.losses + ' 负';
        player.appendChild(name);
        player.appendChild(record);

        var tierWrap = document.createElement('div');
        var tier = document.createElement('div');
        tier.className = 'zhao-rank-tier';
        tier.textContent = ranks[entry.rankId] && ranks[entry.rankId].rank || ('段位 ' + entry.rankId);
        var level = document.createElement('div');
        level.className = 'zhao-rank-level';
        level.textContent = entry.rankLevel + ' 星';
        tierWrap.appendChild(tier);
        tierWrap.appendChild(level);

        row.appendChild(position);
        row.appendChild(player);
        row.appendChild(tierWrap);
        list.appendChild(row);
    }

    async function showLeaderboard() {
        var existing = document.getElementById('zhao-rank-layer');
        if (existing) existing.remove();
        var layer = document.createElement('div');
        layer.id = 'zhao-rank-layer';
        layer.innerHTML = [
            '<div class="zhao-rank-card">',
            '  <button class="zhao-rank-close" type="button" aria-label="关闭">×</button>',
            '  <h1>总排行榜</h1>',
            '  <p class="zhao-rank-subtitle">按段位与星级排序</p>',
            '  <div class="zhao-rank-list"><div class="zhao-rank-empty">正在读取排行榜…</div></div>',
            '  <div class="zhao-rank-actions"><button class="zhao-cloud-secondary zhao-switch-player" type="button">切换玩家</button></div>',
            '</div>'
        ].join('');
        shell().appendChild(layer);
        layer.querySelector('.zhao-rank-close').addEventListener('click', function () { layer.remove(); });
        layer.querySelector('.zhao-switch-player').addEventListener('click', switchPlayer);
        var list = layer.querySelector('.zhao-rank-list');

        if (!state.enabled) {
            list.innerHTML = '<div class="zhao-rank-empty">当前为离线测试模式，云排行榜不可用。</div>';
            return;
        }
        if (!state.token) {
            list.innerHTML = '<div class="zhao-rank-empty">登录已过期，请切换玩家后重新登录。</div>';
            return;
        }

        try {
            var values = await Promise.all([apiRequest('/v1/leaderboard'), loadRankConfig()]);
            var entries = values[0].entries || [];
            var ranks = values[1] || [];
            list.innerHTML = '';
            if (!entries.length) {
                list.innerHTML = '<div class="zhao-rank-empty">还没有玩家上榜。</div>';
                return;
            }
            entries.forEach(function (entry) { appendRankRow(list, entry, ranks); });
        } catch (error) {
            list.innerHTML = '';
            var failed = document.createElement('div');
            failed.className = 'zhao-rank-empty';
            failed.textContent = error.message || '排行榜加载失败';
            list.appendChild(failed);
        }
    }

    async function switchPlayer() {
        try {
            if (state.token) await apiRequest('/v1/auth/logout', { method: 'POST' });
        } catch (error) {}
        state.token = '';
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(IDENTITY_KEY);
        location.reload();
    }

    function findNode(root, name) {
        if (!root) return null;
        if (root.name === name) return root;
        var children = root._children || root._childs || [];
        for (var index = 0; index < children.length; index += 1) {
            var found = findNode(children[index], name);
            if (found) return found;
        }
        return null;
    }

    function patchRankButton() {
        var Laya = window.Laya;
        if (!Laya || !Laya.stage) return false;
        var button = findNode(Laya.stage, 'rankBtn');
        if (!button || button.__browserCloudRankPatched) return false;
        button.__browserCloudRankPatched = true;
        try { button.offAll((Laya.Event && Laya.Event.CLICK) || 'click'); }
        catch (error) {}
        button.on((Laya.Event && Laya.Event.CLICK) || 'click', null, function (event) {
            if (event && event.stopPropagation) event.stopPropagation();
            showLeaderboard().catch(function (error) { showToast(error.message || '排行榜打开失败'); });
        });
        return true;
    }

    function onGameLoaded() {
        var attempts = 0;
        clearInterval(rankPatchTimer);
        rankPatchTimer = setInterval(function () {
            attempts += 1;
            if (patchRankButton()) removeBootLayer();
            if (attempts > 900) clearInterval(rankPatchTimer);
        }, 200);
        setTimeout(function () {
            if (window.Laya && window.Laya.stage) removeBootLayer();
        }, 3000);
    }

    function isLegacyRankUrl(url) {
        return /api01\.mihuangame\.com\/api\/v2\/zyyad\/game\/(country\/list|province\/detail\/list)/.test(String(url || ''));
    }

    window.ZhaoCloud = {
        start: start,
        onGameLoaded: onGameLoaded,
        showLeaderboard: showLeaderboard,
        showFatal: showFatal,
        syncNow: syncNow,
        switchPlayer: switchPlayer,
        isLegacyRankUrl: isLegacyRankUrl,
        request: apiRequest,
        getPlayer: function () { return state.player; },
        getLocalSave: readLocalSave,
        replaceLocalSave: writeLocalSave,
        setTemporarySaveMode: function (enabled) {
            state.temporarySaveMode = !!enabled;
            if (state.temporarySaveMode) {
                clearTimeout(syncTimer);
                state.pendingSave = null;
                state.syncAgain = false;
            }
        },
        getState: function () {
            return {
                enabled: state.enabled,
                online: state.online,
                player: state.player,
                hasToken: !!state.token,
                apiBaseUrl: apiBase,
                temporarySaveMode: state.temporarySaveMode
            };
        }
    };
})();
