(function () {
    'use strict';

    var NativeWebSocket = window.WebSocket;
    var nativeCreateElementNS = document.createElementNS.bind(document);
    var nativeAppendChild = Node.prototype.appendChild;
    var nativeSetAttribute = Element.prototype.setAttribute;
    var SAVE_KEY = 'playerData';
    var ACTIVE_KEY = 'zhaoyun.pvp.active';
    var ORIGINAL_SAVE_KEY = 'zhaoyun.pvp.originalSave';
    var ROOM_PARAM = 'pvp';
    var BATTLE_RUNTIME = 'a1VsRozfQfKce35jblVR3w';
    var RECONNECT_MS = 30000;
    var state = {
        code: '',
        side: null,
        room: null,
        socket: null,
        socketIntentionalClose: false,
        reconnectUntil: 0,
        reconnectTimer: 0,
        reconnecting: false,
        started: false,
        loadingBattle: false,
        battleScene: null,
        battleData: null,
        applyingRemoteHp: false,
        progressTimer: 0,
        lastProgressKey: '',
        lastProgressSentAt: 0,
        startAt: 0,
        paused: false,
        finished: false,
        result: null,
        rankName: '军士.一',
        rankConfigPromise: null,
        peerConnection: null,
        dataChannel: null,
        localMediaStream: null,
        localOpponentSourceStream: null,
        remoteMediaStream: null,
        localOpponentCanvas: null,
        localOpponentSourceVideo: null,
        localOpponentFrame: 0,
        mediaVideo: null,
        mediaOverlay: null,
        mediaFrame: 0,
        boardSyncTimer: 0,
        lastBoardKey: '',
        peerUnitNodes: null,
        peerEnemyNodes: null,
        enemyRouteSides: null,
        frameAnimClass: null,
        remoteBattleStateReceived: false,
        opponentRenderMode: 'native-mirror',
        mediaStatus: '连接中',
        mediaTransport: '',
        mediaStarting: false,
        rtcNegotiating: false,
        rtcRetryTimer: 0,
        pendingRtcMessages: [],
        pendingIceCandidates: [],
        entryTimer: 0
    };

    function parseJson(value) {
        if (!value || typeof value !== 'string') return null;
        try { return JSON.parse(value); }
        catch (error) { return null; }
    }

    function shell() {
        return document.getElementById('phone-shell') || document.body;
    }

    function roomCodeFromUrl() {
        var value = new URLSearchParams(location.search).get(ROOM_PARAM) || '';
        return /^\d{6}$/.test(value) ? value : '';
    }

    function activeMembership() {
        var value = parseJson(localStorage.getItem(ACTIVE_KEY));
        if (!value || !/^\d{6}$/.test(String(value.code || ''))) return null;
        return value;
    }

    function writeRawSave(save) {
        if (save && typeof save === 'object' && !Array.isArray(save)) {
            localStorage.setItem(SAVE_KEY, JSON.stringify(save));
        }
    }

    function beforeCloudStart() {
        var code = roomCodeFromUrl();
        var original = parseJson(localStorage.getItem(ORIGINAL_SAVE_KEY));
        if (original) writeRawSave(original);
        if (!code) {
            localStorage.removeItem(ACTIVE_KEY);
            localStorage.removeItem(ORIGINAL_SAVE_KEY);
        }
    }

    function temporaryBattleSave(save) {
        var copy = parseJson(JSON.stringify(save || {})) || {};
        // 好友局复用普通存档中的段位、武器和道具，但所有消耗和战绩变化只写临时副本。
        copy._stamina = Math.max(30, Number(copy._stamina) || 0);
        copy._hasPlacedActivePropThisBattle = false;
        return copy;
    }

    function afterCloudStart() {
        var code = roomCodeFromUrl();
        if (!code) return;
        state.code = code;
        var mergedSave = window.ZhaoCloud.getLocalSave();
        if (mergedSave) localStorage.setItem(ORIGINAL_SAVE_KEY, JSON.stringify(mergedSave));
        window.ZhaoCloud.setTemporarySaveMode(true);
        window.ZhaoCloud.replaceLocalSave(temporaryBattleSave(mergedSave));
    }

    function api(path, options) {
        return window.ZhaoCloud.request(path, options || {});
    }

    function rankIdFromStar(value) {
        var star = Math.max(0, Math.trunc(Number(value) || 0));
        if (star <= 250) {
            if (star === 0) return 0;
            var rankId = Math.floor(star / 5);
            if (star - rankId * 5 === 0) rankId -= 1;
            return Math.min(49, Math.max(0, rankId));
        }
        var level = Math.max(1, star - 250);
        if (level <= 25) return 50;
        if (level <= 50) return 51;
        if (level <= 75) return 52;
        return 53;
    }

    function loadRankConfig() {
        if (!state.rankConfigPromise) {
            state.rankConfigPromise = fetch(new URL('data/rank.json', location.href).href)
                .then(function (response) { return response.ok ? response.json() : []; })
                .catch(function () { return []; });
        }
        return state.rankConfigPromise;
    }

    async function sendProfile() {
        var save = window.ZhaoCloud.getLocalSave() || {};
        var ranks = await loadRankConfig();
        var rankId = rankIdFromStar(save._curStar);
        state.rankName = ranks[rankId] && ranks[rankId].rank || ('段位 ' + rankId);
        if (state.room) {
            var me = selfPlayer(state.room);
            if (me) me.rankName = state.rankName;
        }
        send({ type: 'profile', rankName: state.rankName });
        if (!state.loadingBattle && !state.battleScene && state.room && state.room.phase === 'lobby') {
            renderRoom(state.room);
        }
        updateHud();
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

    function findSceneByUrl(root, part) {
        if (!root) return null;
        if (String(root.url || root._url || '').indexOf(part) >= 0) return root;
        var children = root._children || root._childs || [];
        for (var index = 0; index < children.length; index += 1) {
            var found = findSceneByUrl(children[index], part);
            if (found) return found;
        }
        return null;
    }

    function removeElement(id) {
        var element = document.getElementById(id);
        if (element) element.remove();
    }

    function showStatus(message, kind) {
        var status = document.getElementById('zhao-pvp-status');
        if (!status) return;
        status.textContent = message || '';
        if (kind) status.setAttribute('data-kind', kind);
        else status.removeAttribute('data-kind');
    }

    function showToast(message) {
        if (window.ZhaoCloud && typeof window.ZhaoCloud.showToast === 'function') {
            window.ZhaoCloud.showToast(message);
            return;
        }
        var old = document.querySelector('.zhao-pvp-toast');
        if (old) old.remove();
        var toast = document.createElement('div');
        toast.className = 'zhao-pvp-toast';
        toast.textContent = message;
        shell().appendChild(toast);
        setTimeout(function () { toast.remove(); }, 2600);
    }

    function isMainSceneVisible() {
        var Laya = window.Laya;
        return !!(Laya && Laya.stage && findSceneByUrl(Laya.stage, 'scene/MainScene.ls'));
    }

    function ensureEntryButton() {
        var button = document.getElementById('zhao-pvp-entry');
        if (!button) {
            button = document.createElement('button');
            button.id = 'zhao-pvp-entry';
            button.type = 'button';
            button.innerHTML = '<span>⚔</span> 好友对战';
            button.addEventListener('click', function () { showMenu(); });
            shell().appendChild(button);
        }
        var cloudState = window.ZhaoCloud.getState();
        button.hidden = !!roomCodeFromUrl() || !isMainSceneVisible() || !cloudState.hasToken;
    }

    function inviteUrl(code) {
        var url = new URL(location.href);
        url.searchParams.delete('cloud');
        url.searchParams.set(ROOM_PARAM, code);
        return url.href;
    }

    async function copyInvite(code) {
        var text = inviteUrl(code);
        try {
            await navigator.clipboard.writeText(text);
            showToast('邀请链接已复制');
        } catch (error) {
            var input = document.createElement('input');
            input.value = text;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            input.remove();
            showToast('邀请链接已复制');
        }
    }

    function showMenu(prefill) {
        removeElement('zhao-pvp-layer');
        var layer = document.createElement('div');
        layer.id = 'zhao-pvp-layer';
        layer.innerHTML = [
            '<div class="zhao-pvp-card">',
            '  <button class="zhao-pvp-close" type="button" aria-label="关闭">×</button>',
            '  <div class="zhao-pvp-brand">实时生存赛</div>',
            '  <h1>好友对战</h1>',
            '  <p class="zhao-pvp-copy">双方使用各自普通段位、武器和道具独立守城；实时观看好友布阵，先失去全部生命的一方失败。</p>',
            '  <button class="zhao-pvp-primary" id="zhao-pvp-create" type="button">创建好友房间</button>',
            '  <div class="zhao-pvp-divider"><span>或</span></div>',
            '  <form id="zhao-pvp-join-form">',
            '    <label class="zhao-pvp-field"><span>6 位房间码</span>',
            '      <input id="zhao-pvp-code" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" required>',
            '    </label>',
            '    <button class="zhao-pvp-secondary" type="submit">加入房间</button>',
            '  </form>',
            '  <div id="zhao-pvp-stats" class="zhao-pvp-stats">正在读取好友战绩…</div>',
            '  <p id="zhao-pvp-status" class="zhao-pvp-status" aria-live="polite"></p>',
            '</div>'
        ].join('');
        shell().appendChild(layer);
        var codeInput = layer.querySelector('#zhao-pvp-code');
        codeInput.value = /^\d{6}$/.test(String(prefill || '')) ? prefill : '';
        layer.querySelector('.zhao-pvp-close').addEventListener('click', function () { layer.remove(); });
        layer.querySelector('#zhao-pvp-create').addEventListener('click', createRoom);
        layer.querySelector('#zhao-pvp-join-form').addEventListener('submit', function (event) {
            event.preventDefault();
            joinRoom(codeInput.value);
        });
        api('/v1/pvp/stats').then(function (data) {
            var stats = data.stats || {};
            layer.querySelector('#zhao-pvp-stats').textContent = '好友战绩：' + (stats.wins || 0) + ' 胜 · ' + (stats.losses || 0) + ' 负';
        }).catch(function () {
            layer.querySelector('#zhao-pvp-stats').textContent = '好友战绩暂不可用';
        });
    }

    function setMenuBusy(busy) {
        var layer = document.getElementById('zhao-pvp-layer');
        if (!layer) return;
        Array.prototype.forEach.call(layer.querySelectorAll('button, input'), function (element) {
            if (!element.classList.contains('zhao-pvp-close')) element.disabled = !!busy;
        });
    }

    async function createRoom() {
        setMenuBusy(true);
        showStatus('正在创建房间…');
        try {
            var data = await api('/v1/pvp/rooms', { method: 'POST' });
            enterPvpMode(data.code, data.side);
        } catch (error) {
            showStatus(error.message || '房间创建失败');
            setMenuBusy(false);
        }
    }

    async function joinRoom(codeValue) {
        var code = String(codeValue || '').trim();
        if (!/^\d{6}$/.test(code)) {
            showStatus('请输入 6 位房间码');
            return;
        }
        setMenuBusy(true);
        showStatus('正在加入房间…');
        try {
            var data = await api('/v1/pvp/rooms/' + code + '/join', { method: 'POST' });
            enterPvpMode(data.code, data.side);
        } catch (error) {
            showStatus(error.message || '加入房间失败');
            setMenuBusy(false);
        }
    }

    function enterPvpMode(code, side) {
        var current = window.ZhaoCloud.getLocalSave();
        if (current) localStorage.setItem(ORIGINAL_SAVE_KEY, JSON.stringify(current));
        localStorage.setItem(ACTIVE_KEY, JSON.stringify({ code: code, side: side }));
        var url = new URL(location.href);
        url.searchParams.delete('cloud');
        url.searchParams.set(ROOM_PARAM, code);
        location.href = url.href;
    }

    function selfPlayer(room) {
        if (!room || state.side === null) return null;
        return (room.players || []).find(function (player) { return player.side === state.side; }) || null;
    }

    function opponentPlayer(room) {
        if (!room || state.side === null) return null;
        return (room.players || []).find(function (player) { return player.side !== state.side; }) || null;
    }

    function renderPlayer(player, isSelf) {
        if (!player) {
            return '<div class="zhao-pvp-player is-empty"><b>等待好友加入</b><span>把房间码或链接发给好友</span></div>';
        }
        var stateText = !player.connected ? '连接中' : player.loaded ? '战场已加载' : player.ready ? '已准备' : '未准备';
        stateText += ' · ' + (player.rankName || '读取段位中');
        return [
            '<div class="zhao-pvp-player' + (isSelf ? ' is-self' : '') + '">',
            '  <div class="zhao-pvp-avatar">' + (player.side === 0 ? '蓝' : '红') + '</div>',
            '  <div class="zhao-pvp-player-copy"><b>' + escapeHtml(player.nickname) + (isSelf ? '（我）' : '') + '</b><span>' + stateText + '</span></div>',
            '  <i class="' + (player.connected ? 'is-online' : '') + '"></i>',
            '</div>'
        ].join('');
    }

    function escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, function (character) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
        });
    }

    function ensureRoomLayer() {
        var layer = document.getElementById('zhao-pvp-room-layer');
        if (!layer) {
            layer = document.createElement('div');
            layer.id = 'zhao-pvp-room-layer';
            shell().appendChild(layer);
        }
        return layer;
    }

    function renderRoom(room, message) {
        state.room = room || state.room;
        room = state.room;
        if (!room) return;
        var me = selfPlayer(room);
        var opponent = opponentPlayer(room);
        var layer = ensureRoomLayer();
        layer.innerHTML = [
            '<div class="zhao-pvp-card zhao-pvp-room-card">',
            '  <div class="zhao-pvp-brand">好友房间</div>',
            '  <div class="zhao-pvp-room-code"><span>房间码</span><strong>' + room.code + '</strong></div>',
            '  <button id="zhao-pvp-copy" class="zhao-pvp-link-button" type="button">复制邀请链接</button>',
            '  <div class="zhao-pvp-player-list">',
                 renderPlayer((room.players || []).find(function (p) { return p.side === 0; }), me && me.side === 0),
                 renderPlayer((room.players || []).find(function (p) { return p.side === 1; }), me && me.side === 1),
            '  </div>',
            '  <p class="zhao-pvp-room-message">' + escapeHtml(message || roomPhaseText(room.phase)) + '</p>',
            '  <button id="zhao-pvp-ready" class="zhao-pvp-primary" type="button"' + (!opponent || room.phase !== 'lobby' ? ' disabled' : '') + '>' + (me && me.ready ? '取消准备' : '准备开战') + '</button>',
            '  <button id="zhao-pvp-leave" class="zhao-pvp-text-button" type="button">退出房间</button>',
            '</div>'
        ].join('');
        layer.querySelector('#zhao-pvp-copy').addEventListener('click', function () { copyInvite(room.code); });
        layer.querySelector('#zhao-pvp-ready').addEventListener('click', function () {
            send({ type: 'ready', ready: !(selfPlayer(state.room) || {}).ready });
        });
        layer.querySelector('#zhao-pvp-leave').addEventListener('click', leaveRoom);
    }

    function roomPhaseText(phase) {
        if (phase === 'loading') return '双方已准备，正在进入同一场塔防战斗…';
        if (phase === 'running') return '对战进行中';
        if (phase === 'finished') return '本局已经结束';
        return '双方准备后将同时进入战场';
    }

    function socketUrl(code, ticket) {
        var base = window.ZhaoCloud.getState().apiBaseUrl.replace(/^http/i, 'ws');
        return base + '/v1/pvp/rooms/' + code + '/socket?ticket=' + encodeURIComponent(ticket);
    }

    function openSocket(ticket) {
        return new Promise(function (resolve, reject) {
            state.socketIntentionalClose = false;
            var socket = new NativeWebSocket(socketUrl(state.code, ticket));
            state.socket = socket;
            var settled = false;
            socket.addEventListener('open', function () {
                settled = true;
                state.reconnecting = false;
                state.reconnectUntil = 0;
                sendProfile().catch(function () {});
                if (state.battleScene && state.peerConnection) {
                    send({ type: 'rtc_ready' });
                    if (state.side === 0) setTimeout(function () { createRtcOffer(true); }, 250);
                }
                resolve();
            });
            socket.addEventListener('message', function (event) {
                var message = parseJson(String(event.data));
                if (message) handleSocketMessage(message);
            });
            socket.addEventListener('error', function () {
                if (!settled) reject(new Error('实时连接失败'));
            });
            socket.addEventListener('close', function () {
                if (state.socket === socket) state.socket = null;
                if (!state.socketIntentionalClose && !state.finished) beginReconnect();
            });
        });
    }

    function send(message) {
        if (!state.socket || state.socket.readyState !== NativeWebSocket.OPEN) return false;
        state.socket.send(JSON.stringify(message));
        return true;
    }

    async function connectMembership() {
        var membership = activeMembership();
        var data;
        if (membership && membership.code === state.code) {
            data = await api('/v1/pvp/rooms/' + state.code + '/ticket', { method: 'POST' });
        } else {
            data = await api('/v1/pvp/rooms/' + state.code + '/join', { method: 'POST' });
            localStorage.setItem(ACTIVE_KEY, JSON.stringify({ code: state.code, side: data.side }));
        }
        state.side = data.side;
        state.room = data.room;
        renderRoom(data.room, '正在建立实时连接…');
        await openSocket(data.ticket);
    }

    function beginReconnect() {
        if (state.reconnecting || !state.code || state.finished) return;
        state.reconnecting = true;
        state.reconnectUntil = Date.now() + RECONNECT_MS;
        pauseBattle('实时连接中断，正在重连…');
        reconnectOnce();
    }

    async function reconnectOnce() {
        clearTimeout(state.reconnectTimer);
        if (!state.reconnecting || state.finished) return;
        if (Date.now() >= state.reconnectUntil) {
            showPause('重连超时，等待服务器判定结果…', 0);
            return;
        }
        try {
            var data = await api('/v1/pvp/rooms/' + state.code + '/ticket', { method: 'POST' });
            state.side = data.side;
            state.room = data.room;
            await openSocket(data.ticket);
            hidePause();
            if (data.room.phase === 'running') resumeBattle();
            return;
        } catch (error) {}
        showPause('实时连接中断，正在重连…', state.reconnectUntil);
        state.reconnectTimer = setTimeout(reconnectOnce, 1600);
    }

    function handleSocketMessage(message) {
        if (message.type === 'welcome' || message.type === 'room') {
            state.room = message.room;
            if (!state.loadingBattle && !state.battleScene && !state.started && message.room.phase === 'lobby') {
                renderRoom(message.room);
            }
            if (message.room.phase === 'running' && !state.battleScene) resumeRunningRoom(message.room);
            updateHud();
            return;
        }
        if (message.type === 'resume') {
            state.room = message.room;
            hidePause();
            if (message.room.phase === 'running') resumeBattle();
            else if (!state.loadingBattle) renderRoom(message.room, '好友已重新连接');
            return;
        }
        if (message.type === 'load') {
            state.room = message.room;
            startBattleLoading();
            return;
        }
        if (message.type === 'go') {
            state.room = message.room;
            state.startAt = Number(message.startAt) || Date.now();
            beginBattleAt(state.startAt);
            return;
        }
        if (message.type === 'rtc_ready' || message.type === 'rtc_offer' ||
            message.type === 'rtc_answer' || message.type === 'rtc_ice') {
            handleRtcSignal(message);
            return;
        }
        if (message.type === 'progress') {
            updateRoomProgress(message.side, message.hp, message.wave);
            if (message.side !== state.side) applyRemoteProgress(message.hp);
            updateHud();
            return;
        }
        if (message.type === 'peer_disconnected') {
            state.room = message.room;
            pauseBattle(message.side === state.side ? '连接中断，正在重连…' : '好友已断线，等待其重连…');
            showPause(message.side === state.side ? '连接中断，正在重连…' : '好友已断线，等待其重连…', message.deadline);
            return;
        }
        if (message.type === 'result') {
            state.room = message.room;
            finishBattle(message);
            return;
        }
        if (message.type === 'closed') {
            state.finished = true;
            closeBattleMedia();
            showResult(false, '房间已关闭', '本局没有记录胜负');
            return;
        }
        if (message.type === 'error') {
            showToast(message.error && message.error.message || '实时对战发生错误');
        }
    }

    function updateRoomProgress(side, hp, wave) {
        if (!state.room) return;
        var player = (state.room.players || []).find(function (item) { return item.side === side; });
        if (!player) return;
        player.hp = Number(hp);
        player.wave = Number(wave);
    }

    function showBattleLoading(message) {
        var layer = document.getElementById('zhao-pvp-battle-loading');
        if (!layer) {
            layer = document.createElement('div');
            layer.id = 'zhao-pvp-battle-loading';
            shell().appendChild(layer);
        }
        var me = selfPlayer(state.room);
        var opponent = opponentPlayer(state.room);
        layer.innerHTML = [
            '<div class="zhao-pvp-loading-box">',
            '<div class="zhao-cloud-spinner"></div>',
            '<b>' + escapeHtml(message || '正在载入战场…') + '</b>',
            '<div class="zhao-pvp-loading-ranks">',
            '<span><small>我</small>' + escapeHtml(me && me.rankName || state.rankName) + '</span>',
            '<i>VS</i>',
            '<span><small>好友</small>' + escapeHtml(opponent && opponent.rankName || '读取中') + '</span>',
            '</div>',
            '</div>'
        ].join('');
    }

    function startBattleLoading() {
        if (state.loadingBattle || state.battleScene) return;
        state.loadingBattle = true;
        removeElement('zhao-pvp-room-layer');
        showBattleLoading('正在载入普通配置的塔防战场…');
        var waitStartedAt = Date.now();
        (function launchWhenMainSceneReady() {
            var playButton = findNode(window.Laya && window.Laya.stage, 'playBtn');
            if (playButton) {
                playButton.event((window.Laya.Event && window.Laya.Event.CLICK) || 'click');
                waitForBattleScene();
                return;
            }
            if (Date.now() - waitStartedAt > 30000) {
                showResult(false, '无法进入战场', '主界面加载超时，请返回后重试');
                return;
            }
            setTimeout(launchWhenMainSceneReady, 100);
        })();
    }

    function resumeRunningRoom(room) {
        if (state.loadingBattle || state.battleScene) return;
        state.startAt = Number(room.startedAt) || Date.now();
        startBattleLoading();
    }

    function waitForBattleScene() {
        var startedAt = Date.now();
        var timer = setInterval(function () {
            var battle = findSceneByUrl(window.Laya && window.Laya.stage, 'scene/BattleScene.ls');
            if (battle) {
                clearInterval(timer);
                attachBattle(battle);
                return;
            }
            if (Date.now() - startedAt > 30000) {
                clearInterval(timer);
                showResult(false, '战场加载超时', '请检查网络后重试');
            }
        }, 80);
    }

    function attachBattle(scene) {
        state.battleScene = scene;
        state.battleData = scene.sw && scene.sw.wy || null;
        state.loadingBattle = false;
        pauseBattle('等待好友战场加载完成…');
        installBattleHpBridge();
        applyRemoteProgress((opponentPlayer(state.room) || {}).hp);
        ensureHud();
        updateHud();
        setupBattleMedia().catch(function () {
            state.mediaStatus = '仅状态';
            updateHud();
        });
        removeElement('zhao-pvp-battle-loading');
        if (state.room && state.room.phase === 'running') {
            beginBattleAt(state.startAt || state.room.startedAt || Date.now());
        } else {
            showBattleLoading('战场已就绪，等待好友…');
            send({ type: 'loaded' });
        }
    }

    function installBattleHpBridge() {
        var data = state.battleData;
        if (!data || data.__zhaoPvpHpBridge) return;
        var prototype = Object.getPrototypeOf(data);
        var playerDescriptor = Object.getOwnPropertyDescriptor(prototype, 'Zi');
        var opponentDescriptor = Object.getOwnPropertyDescriptor(prototype, 'Ki');
        if (!playerDescriptor || !opponentDescriptor) return;
        Object.defineProperty(data, '__zhaoPvpHpBridge', { value: true, configurable: true });
        Object.defineProperty(data, 'Zi', {
            configurable: true,
            get: function () { return playerDescriptor.get.call(this); },
            set: function (value) {
                playerDescriptor.set.call(this, value);
                onLocalHpChanged(Number(value));
            }
        });
        Object.defineProperty(data, 'Ki', {
            configurable: true,
            get: function () { return opponentDescriptor.get.call(this); },
            set: function (value) {
                if (!state.applyingRemoteHp && !state.finished) return;
                opponentDescriptor.set.call(this, value);
            }
        });
    }

    function onLocalHpChanged(hp) {
        if (!state.started || state.finished) return;
        sendProgress(true);
        if (hp <= 0) send({ type: 'progress', hp: 0, wave: currentWave(), elapsed: elapsedTime() });
    }

    function applyRemoteProgress(hpValue) {
        var hp = Number(hpValue);
        if (!state.battleData || !Number.isFinite(hp)) return;
        hp = Math.max(0, Math.min(3, Math.trunc(hp)));
        state.applyingRemoteHp = true;
        try { state.battleData.Ki = hp; }
        finally { state.applyingRemoteHp = false; }
    }

    function createNativeElement(tagName) {
        return nativeCreateElementNS('http://www.w3.org/1999/xhtml', tagName);
    }

    function appendNative(parent, child) {
        return nativeAppendChild.call(parent, child);
    }

    function setNativeStyle(element, cssText) {
        nativeSetAttribute.call(element, 'style', cssText);
    }

    function handleRtcSignal(message) {
        if (!state.peerConnection) {
            if (state.pendingRtcMessages.length < 100) state.pendingRtcMessages.push(message);
            return;
        }
        processRtcSignal(message).catch(function () {
            state.mediaStatus = '画面重连中';
            updateHud();
        });
    }

    async function flushIceCandidates() {
        var pc = state.peerConnection;
        if (!pc || !pc.remoteDescription) return;
        var candidates = state.pendingIceCandidates.splice(0);
        for (var index = 0; index < candidates.length; index += 1) {
            try { await pc.addIceCandidate(candidates[index]); }
            catch (error) {}
        }
    }

    async function processRtcSignal(message) {
        var pc = state.peerConnection;
        if (!pc || state.finished) return;
        if (message.type === 'rtc_ready') {
            if (state.side === 0) await createRtcOffer(pc.connectionState === 'failed');
            return;
        }
        if (message.type === 'rtc_offer') {
            if (state.side !== 1 || !message.sdp) return;
            await pc.setRemoteDescription(message.sdp);
            await flushIceCandidates();
            var answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            send({ type: 'rtc_answer', sdp: pc.localDescription });
            return;
        }
        if (message.type === 'rtc_answer') {
            if (state.side !== 0 || !message.sdp) return;
            await pc.setRemoteDescription(message.sdp);
            state.rtcNegotiating = false;
            await flushIceCandidates();
            return;
        }
        if (message.type === 'rtc_ice' && message.candidate) {
            if (pc.remoteDescription) {
                try { await pc.addIceCandidate(message.candidate); }
                catch (error) {}
            } else if (state.pendingIceCandidates.length < 100) {
                state.pendingIceCandidates.push(message.candidate);
            }
        }
    }

    async function createRtcOffer(restartIce) {
        var pc = state.peerConnection;
        if (state.side !== 0 || !pc || state.finished || state.rtcNegotiating) return;
        if (pc.signalingState !== 'stable') return;
        state.rtcNegotiating = true;
        try {
            var offer = await pc.createOffer({ iceRestart: !!restartIce });
            await pc.setLocalDescription(offer);
            if (!send({ type: 'rtc_offer', sdp: pc.localDescription })) {
                state.rtcNegotiating = false;
            }
        } catch (error) {
            state.rtcNegotiating = false;
            throw error;
        }
    }

    async function detectMediaTransport() {
        var pc = state.peerConnection;
        if (!pc || pc.connectionState !== 'connected') return;
        try {
            var reports = await pc.getStats();
            var selected = null;
            reports.forEach(function (report) {
                if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) {
                    selected = report;
                }
            });
            var local = selected && reports.get(selected.localCandidateId);
            var remote = selected && reports.get(selected.remoteCandidateId);
            state.mediaTransport = local && local.candidateType === 'relay' || remote && remote.candidateType === 'relay'
                ? '中继'
                : '直连';
            state.mediaStatus = state.mediaTransport;
        } catch (error) {
            state.mediaStatus = '已连接';
        }
        updateHud();
    }

    function cellSize() {
        var scene = state.battleScene;
        var map = scene && scene.sw && scene.sw.map;
        return Number(map && map.ye) || 80;
    }

    function isLocalUnitNode(node) {
        if (!node || !node.name) return false;
        return /^(soldier_|generalPart_)/.test(node.name) && !/^peer_/.test(node.name);
    }

    function isPeerUnitNode(node) {
        return !!(node && node.name && String(node.name).indexOf('peer_') === 0);
    }

    function unitGridPos(node) {
        var cell = cellSize();
        return {
            col: Math.max(0, Math.min(7, Math.round(Number(node.x) / cell))),
            row: Math.max(0, Math.min(9, Math.round(Number(node.y) / cell)))
        };
    }

    function mirrorGrid(col, row) {
        return { col: 7 - col, row: 9 - row };
    }

    function imageState(node) {
        if (!node) return null;
        return {
            skin: node.skin || node._skin || '',
            x: Number(node.x) || 0,
            y: Number(node.y) || 0,
            width: Number(node.width) || 0,
            height: Number(node.height) || 0,
            pivotX: Number(node.pivotX) || 0,
            pivotY: Number(node.pivotY) || 0,
            scaleX: Number(node.scaleX) || 1,
            scaleY: Number(node.scaleY) || 1,
            rotation: Number(node.rotation) || 0,
            alpha: node.alpha == null ? 1 : Number(node.alpha),
            visible: node.visible !== false
        };
    }

    function enemyRouteSide(node) {
        if (!node || !node.name) return '';
        if (!state.enemyRouteSides) state.enemyRouteSides = Object.create(null);
        var id = String(node.name);
        if (state.enemyRouteSides[id]) return state.enemyRouteSides[id];
        if (id.indexOf('enemy_sync_') === 0) {
            state.enemyRouteSides[id] = 'local';
            return 'local';
        }
        // 新敌兵分别从左下和右上出生；记录出生侧后，即使经过中线也不重新分类。
        var x = Number(node.x) || 0;
        var y = Number(node.y) || 0;
        var localDistance = Math.pow(x - 40, 2) + Math.pow(y - 720, 2);
        var remoteDistance = Math.pow(x - 600, 2) + Math.pow(y - 80, 2);
        state.enemyRouteSides[id] = localDistance <= remoteDistance ? 'local' : 'remote';
        return state.enemyRouteSides[id];
    }

    function describeLocalEnemy(node) {
        var hpBg = node.getChildByName && node.getChildByName('hpBgImg');
        var hp1 = hpBg && hpBg.getChildByName && hpBg.getChildByName('hpImg1');
        var hp2 = hpBg && hpBg.getChildByName && hpBg.getChildByName('hpImg2');
        return {
            id: String(node.name),
            x: Number(node.x) || 0,
            y: Number(node.y) || 0,
            width: Number(node.width) || 80,
            height: Number(node.height) || 80,
            pivotX: Number(node.pivotX) || 0,
            pivotY: Number(node.pivotY) || 0,
            scaleX: Number(node.scaleX) || 1,
            scaleY: Number(node.scaleY) || 1,
            rotation: Number(node.rotation) || 0,
            alpha: node.alpha == null ? 1 : Number(node.alpha),
            visible: node.visible !== false,
            shadow: imageState(node.getChildByName && node.getChildByName('shadow')),
            body: imageState(node.getChildByName && node.getChildByName('sp')),
            stun: imageState(node.getChildByName && node.getChildByName('stun')),
            hp: hpBg ? {
                background: imageState(hpBg),
                primary: imageState(hp1),
                secondary: imageState(hp2)
            } : null
        };
    }

    function describeLocalBoard() {
        var scene = state.battleScene;
        if (!scene || !scene.gameObjectBox) return { units: [], enemies: [], hp: localHp(), wave: currentWave() };
        var units = [];
        var enemies = [];
        var children = scene.gameObjectBox._children || [];
        for (var index = 0; index < children.length; index += 1) {
            var node = children[index];
            if (/^enemy_/.test(String(node && node.name || ''))) {
                if (enemyRouteSide(node) === 'local' && node.visible !== false && Number(node.alpha) > 0) {
                    enemies.push(describeLocalEnemy(node));
                }
                continue;
            }
            if (!isLocalUnitNode(node) || Number(node.y) < 400) continue;
            var grid = unitGridPos(node);
            var sp = node.getChildByName && node.getChildByName('sp');
            var img = node.getChildByName && node.getChildByName('img');
            var lvl = node.getChildByName && node.getChildByName('lvl');
            var weapon = null;
            var nested = node._children || [];
            for (var childIndex = 0; childIndex < nested.length; childIndex += 1) {
                var child = nested[childIndex];
                if (!child || !child.skin) continue;
                if (/\/soldier\/(bow|knife|pike|cavalry|sword|gun|dao|hoe)/.test(String(child.skin))) {
                    weapon = {
                        skin: child.skin,
                        x: Number(child.x) || 0,
                        y: Number(child.y) || 0,
                        width: Number(child.width) || 0,
                        height: Number(child.height) || 0,
                        pivotX: Number(child.pivotX) || 0,
                        pivotY: Number(child.pivotY) || 0,
                        rotation: Number(child.rotation) || 0,
                        scaleX: Number(child.scaleX) || 1,
                        scaleY: Number(child.scaleY) || 1,
                        alpha: Number(child.alpha) || 1
                    };
                    break;
                }
            }
            units.push({
                id: String(node.name),
                kind: String(node.name).indexOf('generalPart_') === 0 ? 'general' : 'soldier',
                col: grid.col,
                row: grid.row,
                animId: sp && sp.animId || null,
                animState: sp && sp.Od || 'zhan',
                body: sp ? {
                    x: Number(sp.x) || 0,
                    y: Number(sp.y) || 0,
                    width: Number(sp.width) || 80,
                    height: Number(sp.height) || 80,
                    pivotX: Number(sp.pivotX) || 0,
                    pivotY: Number(sp.pivotY) || 0,
                    scaleX: Number(sp.scaleX) || 1,
                    scaleY: Number(sp.scaleY) || 1,
                    rotation: Number(sp.rotation) || 0,
                    alpha: Number(sp.alpha) || 1,
                    visible: sp.visible !== false,
                    loop: sp.loop !== false,
                    frameIndex: Number(sp.frameIndex) || 0
                } : null,
                img: img && img.skin || null,
                lvlSkin: lvl && lvl.skin || null,
                lvlValue: lvl && (lvl.value != null ? lvl.value : lvl.text) || null,
                weapon: weapon
            });
        }
        units.sort(function (left, right) {
            return left.col - right.col || left.row - right.row || (left.id < right.id ? -1 : 1);
        });
        enemies.sort(function (left, right) {
            return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
        });
        return { units: units, enemies: enemies, hp: localHp(), wave: currentWave() };
    }

    function resolveFrameAnimClass() {
        if (state.frameAnimClass) return state.frameAnimClass;
        var scene = state.battleScene;
        if (!scene || !scene.gameObjectBox) return null;
        var children = scene.gameObjectBox._children || [];
        for (var index = 0; index < children.length; index += 1) {
            var node = children[index];
            var sp = node && node.getChildByName && node.getChildByName('sp');
            if (sp && sp.constructor) {
                state.frameAnimClass = sp.constructor;
                return state.frameAnimClass;
            }
        }
        return null;
    }

    function hideLocalAiUnits() {
        var scene = state.battleScene;
        if (!scene || !scene.gameObjectBox) return;
        var children = scene.gameObjectBox._children || [];
        for (var index = 0; index < children.length; index += 1) {
            var node = children[index];
            if (!node || isPeerUnitNode(node)) continue;
            // 本地 AI/原生对手单位都在上半场；好友镜像只保留 peer_ 节点。
            if (isLocalUnitNode(node) && Number(node.y) < 400) {
                try {
                    node.visible = false;
                    node.alpha = 0;
                    node.mouseEnabled = false;
                    // 游戏 update 可能重新 visible，额外挪出视野。
                    if (Number(node.y) > -9000) node.y = -9999;
                } catch (error) {}
            } else if (/^enemy_/.test(String(node.name || '')) && enemyRouteSide(node) === 'remote') {
                // 本机 AI 敌兵可能经过中线；按出生路径隐藏，不能按当前 y 判断。
                try {
                    node.visible = false;
                    node.alpha = 0;
                    node.mouseEnabled = false;
                } catch (error) {}
            }
        }
        // 尽量停掉本地 AI 对手逻辑，避免继续往上半场刷兵。
        try {
            var enemy = scene.sw && scene.sw.enemy;
            if (enemy && typeof enemy.gameOver === 'function' && !enemy.__zhaoPvpStopped) {
                enemy.gameOver();
                Object.defineProperty(enemy, '__zhaoPvpStopped', { value: true, configurable: true });
            }
        } catch (error) {}
    }

    function clearPeerUnits() {
        var scene = state.battleScene;
        if (!scene || !scene.gameObjectBox) {
            state.peerUnitNodes = Object.create(null);
            state.peerEnemyNodes = Object.create(null);
            return;
        }
        var children = (scene.gameObjectBox._children || []).slice();
        for (var index = 0; index < children.length; index += 1) {
            var node = children[index];
            if (!isPeerUnitNode(node)) continue;
            try {
                if (node.destroy) node.destroy(true);
                else if (node.removeSelf) node.removeSelf();
            } catch (error) {}
        }
        state.peerUnitNodes = Object.create(null);
        state.peerEnemyNodes = Object.create(null);
    }

    function copyImageChild(parent, skin, x, y, width, height, pivotX, pivotY, extras) {
        if (!skin || !window.Laya || !window.Laya.Image) return null;
        var image = new window.Laya.Image();
        image.skin = skin;
        image.pos(x || 0, y || 0);
        if (width || height) image.size(width || 0, height || 0);
        if (pivotX != null || pivotY != null) image.pivot(pivotX || 0, pivotY || 0);
        if (extras) {
            if (extras.rotation != null) image.rotation = extras.rotation;
            if (extras.scaleX != null || extras.scaleY != null) image.scale(extras.scaleX || 1, extras.scaleY || 1);
            if (extras.alpha != null) image.alpha = extras.alpha;
            if (extras.visible != null) image.visible = extras.visible;
            if (extras.name) image.name = extras.name;
        }
        parent.addChild(image);
        return image;
    }

    function buildPeerUnitNode(unit) {
        var Laya = window.Laya;
        if (!Laya || !Laya.Sprite) return null;
        var root = new Laya.Sprite();
        root.name = 'peer_' + unit.id;
        root.size(80, 80);
        root.mouseEnabled = false;
        copyImageChild(root, 'resources/img/gameObject/soldier/shadow2.png', 39, 65, 44, 22, 22, 22, {
            name: 'shadow',
            alpha: 0.5
        });
        if (unit.kind === 'general' && unit.img) {
            copyImageChild(root, unit.img, 40, 80, 80, 80, 40, 80, { name: 'img' });
        } else if (unit.animId) {
            var FrameAnim = resolveFrameAnimClass();
            if (FrameAnim) {
                try {
                    var body = new FrameAnim(unit.animId);
                    var bodyState = unit.body || {};
                    body.name = 'sp';
                    body.pos(bodyState.x == null ? 40 : bodyState.x, bodyState.y == null ? 40 : bodyState.y);
                    body.size(bodyState.width || 80, bodyState.height || 80);
                    body.pivot(bodyState.pivotX == null ? 40 : bodyState.pivotX, bodyState.pivotY == null ? 40 : bodyState.pivotY);
                    body.scale(bodyState.scaleX || 1, bodyState.scaleY || 1);
                    body.rotation = bodyState.rotation || 0;
                    body.alpha = bodyState.alpha == null ? 1 : bodyState.alpha;
                    body.visible = bodyState.visible !== false;
                    try { body.play(unit.animState || 'zhan', bodyState.loop !== false); }
                    catch (error) {
                        try { body.play(unit.animState || 'zhan'); }
                        catch (ignored) {}
                    }
                    try {
                        if (typeof body.setFrame === 'function' && Number.isFinite(Number(bodyState.frameIndex))) {
                            body.setFrame(Number(bodyState.frameIndex));
                        }
                    } catch (error) {}
                    body.__zhaoAnimState = unit.animState || 'zhan';
                    body.__zhaoAnimLoop = bodyState.loop !== false;
                    root.addChild(body);
                } catch (error) {}
            }
        }
        if (unit.weapon && unit.weapon.skin) {
            copyImageChild(
                root,
                unit.weapon.skin,
                unit.weapon.x,
                unit.weapon.y,
                unit.weapon.width,
                unit.weapon.height,
                unit.weapon.pivotX,
                unit.weapon.pivotY,
                {
                    name: 'weapon',
                    rotation: unit.weapon.rotation,
                    scaleX: unit.weapon.scaleX,
                    scaleY: unit.weapon.scaleY,
                    alpha: unit.weapon.alpha
                }
            );
        }
        if (unit.lvlSkin && Laya.Clip) {
            try {
                var level = new Laya.Clip(unit.lvlSkin, 5, 1);
                level.name = 'lvl';
                level.pos(60, 0);
                level.size(20, 20);
                level.sheet = '12345';
                level.value = String(unit.lvlValue == null ? '1' : unit.lvlValue);
                root.addChild(level);
            } catch (error) {}
        }
        return root;
    }

    function applyImageState(node, visual) {
        if (!node || !visual) return;
        if (visual.skin && node.skin !== visual.skin) node.skin = visual.skin;
        node.pos(Number(visual.x) || 0, Number(visual.y) || 0);
        if (visual.width || visual.height) node.size(Number(visual.width) || 0, Number(visual.height) || 0);
        node.pivot(Number(visual.pivotX) || 0, Number(visual.pivotY) || 0);
        node.scale(Number(visual.scaleX) || 1, Number(visual.scaleY) || 1);
        node.rotation = Number(visual.rotation) || 0;
        node.alpha = visual.alpha == null ? 1 : Math.max(0, Math.min(1, Number(visual.alpha) || 0));
        node.visible = visual.visible !== false;
    }

    function buildPeerEnemyNode(enemy) {
        var Laya = window.Laya;
        if (!Laya || !Laya.Sprite) return null;
        var root = new Laya.Sprite();
        root.name = 'peer_' + enemy.id;
        root.mouseEnabled = false;
        root.size(Number(enemy.width) || 80, Number(enemy.height) || 80);
        var shadow = copyImageChild(root, enemy.shadow && enemy.shadow.skin, 0, 0, 0, 0, 0, 0, { name: 'shadow' });
        if (shadow) applyImageState(shadow, enemy.shadow);
        if (enemy.hp && enemy.hp.background) {
            var hp = copyImageChild(root, enemy.hp.background.skin, 0, 0, 0, 0, 0, 0, { name: 'hpBgImg' });
            if (hp) {
                applyImageState(hp, enemy.hp.background);
                var hp1 = copyImageChild(hp, enemy.hp.primary && enemy.hp.primary.skin, 0, 0, 0, 0, 0, 0, { name: 'hpImg1' });
                if (hp1) applyImageState(hp1, enemy.hp.primary);
                var hp2 = copyImageChild(hp, enemy.hp.secondary && enemy.hp.secondary.skin, 0, 0, 0, 0, 0, 0, { name: 'hpImg2' });
                if (hp2) applyImageState(hp2, enemy.hp.secondary);
            }
        }
        var stun = copyImageChild(root, enemy.stun && enemy.stun.skin, 0, 0, 0, 0, 0, 0, { name: 'stun' });
        if (stun) applyImageState(stun, enemy.stun);
        var body = copyImageChild(root, enemy.body && enemy.body.skin, 0, 0, 0, 0, 0, 0, { name: 'sp' });
        if (body) {
            applyImageState(body, enemy.body);
            // 原 sp 是动画容器，内部帧以 (40,80) 为脚底锚点；普通 Image 需显式恢复。
            body.pivot((Number(body.width) || 80) / 2, Number(body.height) || 80);
        }
        return root;
    }

    function enemyVisualKey(enemy) {
        return [
            enemy && enemy.body && enemy.body.skin || '',
            enemy && enemy.shadow && enemy.shadow.skin || '',
            enemy && enemy.hp && enemy.hp.background && enemy.hp.background.skin || '',
            enemy && enemy.stun && enemy.stun.skin || ''
        ].join('|');
    }

    function mirrorEnemyPosition(enemy) {
        var x = Number(enemy && enemy.x) || 0;
        var y = Number(enemy && enemy.y) || 0;
        if (x >= 39 && x <= 41 && y >= 719) {
            // 出生引导段：左下敌兵纵向移动 40px 时，右上对应动画移动 120px。
            return {
                x: 640 - x,
                y: Math.max(40, Math.min(160, 40 + (760 - y) * 3))
            };
        }
        // 正式路径以棋盘中心对称。敌兵真实帧使用脚底锚点 (40,80)，
        // 因此根坐标就是字形所在格子的左上角；最终夹在中线之上。
        return { x: 560 - x, y: Math.min(320, 720 - y) };
    }

    function updatePeerEnemyNode(node, enemy) {
        if (!node || !enemy) return;
        node.size(Number(enemy.width) || 80, Number(enemy.height) || 80);
        node.pivot(Number(enemy.pivotX) || 0, Number(enemy.pivotY) || 0);
        var position = mirrorEnemyPosition(enemy);
        node.pos(position.x, position.y);
        node.scale(Number(enemy.scaleX) || 1, Number(enemy.scaleY) || 1);
        node.rotation = Number(enemy.rotation) || 0;
        node.alpha = enemy.alpha == null ? 1 : Math.max(0, Math.min(1, Number(enemy.alpha) || 0));
        node.visible = enemy.visible !== false;
        applyImageState(node.getChildByName && node.getChildByName('shadow'), enemy.shadow);
        var body = node.getChildByName && node.getChildByName('sp');
        applyImageState(body, enemy.body);
        if (body) body.pivot((Number(body.width) || 80) / 2, Number(body.height) || 80);
        applyImageState(node.getChildByName && node.getChildByName('stun'), enemy.stun);
        var hp = node.getChildByName && node.getChildByName('hpBgImg');
        if (hp && enemy.hp) {
            applyImageState(hp, enemy.hp.background);
            applyImageState(hp.getChildByName && hp.getChildByName('hpImg1'), enemy.hp.primary);
            applyImageState(hp.getChildByName && hp.getChildByName('hpImg2'), enemy.hp.secondary);
        }
    }

    function applyRemoteEnemies(enemies) {
        var scene = state.battleScene;
        if (!scene || !scene.gameObjectBox) return;
        if (!state.peerEnemyNodes) state.peerEnemyNodes = Object.create(null);
        var nextIds = Object.create(null);
        var list = Array.isArray(enemies) ? enemies.slice(0, 100) : [];
        for (var index = 0; index < list.length; index += 1) {
            var enemy = list[index];
            if (!enemy || !enemy.id) continue;
            var id = String(enemy.id);
            nextIds[id] = true;
            var existing = state.peerEnemyNodes[id];
            var key = enemyVisualKey(enemy);
            if (!existing || existing.__zhaoEnemyKey !== key) {
                if (existing) {
                    try { existing.destroy(true); }
                    catch (error) {}
                }
                existing = buildPeerEnemyNode(enemy);
                if (!existing) continue;
                existing.__zhaoEnemyKey = key;
                scene.gameObjectBox.addChild(existing);
                state.peerEnemyNodes[id] = existing;
            }
            updatePeerEnemyNode(existing, enemy);
        }
        Object.keys(state.peerEnemyNodes).forEach(function (id) {
            if (nextIds[id]) return;
            var stale = state.peerEnemyNodes[id];
            try {
                if (stale && stale.destroy) stale.destroy(true);
                else if (stale && stale.removeSelf) stale.removeSelf();
            } catch (error) {}
            delete state.peerEnemyNodes[id];
        });
    }

    function updatePeerUnitNode(node, unit, mirrored) {
        if (!node || !unit || !mirrored) return;
        var cell = cellSize();
        node.pos(mirrored.col * cell, mirrored.row * cell);
        var body = node.getChildByName && node.getChildByName('sp');
        var bodyState = unit.body || {};
        if (body) {
            body.pos(bodyState.x == null ? 40 : bodyState.x, bodyState.y == null ? 40 : bodyState.y);
            body.size(bodyState.width || 80, bodyState.height || 80);
            body.pivot(bodyState.pivotX == null ? 40 : bodyState.pivotX, bodyState.pivotY == null ? 40 : bodyState.pivotY);
            body.scale(bodyState.scaleX || 1, bodyState.scaleY || 1);
            body.rotation = bodyState.rotation || 0;
            body.alpha = bodyState.alpha == null ? 1 : bodyState.alpha;
            body.visible = bodyState.visible !== false;
            var animState = unit.animState || 'zhan';
            var animLoop = bodyState.loop !== false;
            if (body.__zhaoAnimState !== animState || body.__zhaoAnimLoop !== animLoop) {
                try { body.play(animState, animLoop); }
                catch (error) {
                    try { body.play(animState); }
                    catch (ignored) {}
                }
                body.__zhaoAnimState = animState;
                body.__zhaoAnimLoop = animLoop;
            }
        }
        if (unit.weapon) applyImageState(node.getChildByName && node.getChildByName('weapon'), unit.weapon);
        var level = node.getChildByName && node.getChildByName('lvl');
        if (level && unit.lvlValue != null) {
            try { level.value = String(unit.lvlValue); }
            catch (error) {}
        }
    }

    function applyRemoteBoard(board) {
        var scene = state.battleScene;
        if (!scene || !board || !Array.isArray(board.units)) return;
        hideLocalAiUnits();
        if (!state.peerUnitNodes) state.peerUnitNodes = Object.create(null);
        var nextIds = Object.create(null);
        var units = board.units.slice(0, 40);
        for (var index = 0; index < units.length; index += 1) {
            var unit = units[index];
            if (!unit || unit.col == null || unit.row == null) continue;
            var id = String(unit.id || (unit.kind + ':' + unit.col + ':' + unit.row + ':' + index));
            var mirrored = mirrorGrid(Number(unit.col) || 0, Number(unit.row) || 0);
            nextIds[id] = true;
            var existing = state.peerUnitNodes[id];
            var needsRebuild = !existing || existing.__zhaoBoardKey !== boardUnitKey(unit);
            if (needsRebuild) {
                if (existing) {
                    try {
                        if (existing.destroy) existing.destroy(true);
                        else if (existing.removeSelf) existing.removeSelf();
                    } catch (error) {}
                }
                var node = buildPeerUnitNode(Object.assign({}, unit, { id: id }));
                if (!node) continue;
                node.__zhaoBoardKey = boardUnitKey(unit);
                if (typeof scene.c$ === 'function') scene.c$(node, mirrored.col, mirrored.row);
                else {
                    var cell = cellSize();
                    node.pos(mirrored.col * cell, mirrored.row * cell);
                    scene.gameObjectBox.addChild(node);
                }
                state.peerUnitNodes[id] = node;
                updatePeerUnitNode(node, unit, mirrored);
            } else if (existing) {
                updatePeerUnitNode(existing, unit, mirrored);
            }
        }
        Object.keys(state.peerUnitNodes).forEach(function (id) {
            if (nextIds[id]) return;
            var stale = state.peerUnitNodes[id];
            try {
                if (stale && stale.destroy) stale.destroy(true);
                else if (stale && stale.removeSelf) stale.removeSelf();
            } catch (error) {}
            delete state.peerUnitNodes[id];
        });
        applyRemoteEnemies(board.enemies);
        if (Number.isFinite(Number(board.hp))) {
            var hp = Math.max(0, Math.min(3, Math.trunc(Number(board.hp))));
            updateRoomProgress(state.side === 0 ? 1 : 0, hp, Number(board.wave) || 1);
            applyRemoteProgress(hp);
        }
        state.remoteBattleStateReceived = true;
        state.mediaStatus = state.mediaTransport || '已连接';
        updateHud();
    }

    function boardUnitKey(unit) {
        return [
            unit.kind || '',
            unit.animId || '',
            unit.img || '',
            unit.lvlSkin || '',
            unit.lvlValue == null ? '' : unit.lvlValue,
            unit.weapon && unit.weapon.skin || ''
        ].join('|');
    }

    function boardSnapshotKey(board) {
        var units = (board.units || []).map(function (unit) {
            return unit.id + '@' + unit.col + ',' + unit.row + '@' + boardUnitKey(unit) + '@' + [
                unit.animState || '',
                unit.body && unit.body.loop === false ? '0' : '1',
                unit.body && unit.body.visible === false ? '0' : '1',
                unit.weapon && [unit.weapon.x, unit.weapon.y, unit.weapon.rotation].join(',') || ''
            ].join(':');
        }).join(';');
        var enemies = (board.enemies || []).map(function (enemy) {
            return enemy.id + '@' + JSON.stringify(enemy);
        }).join(';');
        return [board.hp, board.wave, units, enemies].join('#');
    }

    function sendBoardState(force) {
        if (!state.battleScene || state.finished) return;
        var board = describeLocalBoard();
        var key = boardSnapshotKey(board);
        if (!force && key === state.lastBoardKey) return;
        state.lastBoardKey = key;
        var payload = JSON.stringify({ type: 'board', board: board });
        if (state.dataChannel && state.dataChannel.readyState === 'open') {
            try { state.dataChannel.send(payload); }
            catch (error) {}
            return;
        }
        // Fallback while data channel is not ready: keep HUD alive, but native mirror needs the channel.
    }

    function handleDataChannelMessage(event) {
        var message = parseJson(String(event.data || ''));
        if (!message) return;
        if (message.type === 'board') {
            applyRemoteBoard(message.board || { units: [] });
            return;
        }
        if (message.type === 'board_hello') {
            sendBoardState(true);
        }
    }

    function attachDataChannel(channel) {
        if (!channel || state.finished) return;
        state.dataChannel = channel;
        channel.binaryType = 'arraybuffer';
        channel.addEventListener('open', function () {
            state.mediaStatus = '同步中';
            updateHud();
            try { channel.send(JSON.stringify({ type: 'board_hello' })); }
            catch (error) {}
            sendBoardState(true);
            startBoardSync();
        });
        channel.addEventListener('message', handleDataChannelMessage);
        channel.addEventListener('close', function () {
            if (state.dataChannel === channel) state.dataChannel = null;
            if (!state.finished) {
                state.mediaStatus = '画面重连中';
                updateHud();
            }
        });
        channel.addEventListener('error', function () {
            if (!state.finished) {
                state.mediaStatus = '画面重连中';
                updateHud();
            }
        });
        if (channel.readyState === 'open') {
            sendBoardState(true);
            startBoardSync();
        }
    }

    function startBoardSync() {
        clearInterval(state.boardSyncTimer);
        hideLocalAiUnits();
        state.boardSyncTimer = setInterval(function () {
            if (state.finished || state.paused) return;
            hideLocalAiUnits();
            sendBoardState(false);
        }, 100);
        sendBoardState(true);
    }

    async function setupBattleMedia() {
        if (state.mediaStarting || state.peerConnection || state.finished) return;
        if (!window.RTCPeerConnection) {
            state.mediaStatus = '仅状态';
            updateHud();
            return;
        }
        state.mediaStarting = true;
        state.mediaStatus = '画面连接中';
        state.opponentRenderMode = 'native-mirror';
        state.peerUnitNodes = Object.create(null);
        state.peerEnemyNodes = Object.create(null);
        state.enemyRouteSides = Object.create(null);
        updateHud();
        var iceServers;
        try {
            var ice = await api('/v1/pvp/ice');
            iceServers = ice.iceServers;
        } catch (error) {
            iceServers = [{ urls: ['stun:turn.euv.pp.ua:3478'] }];
        }
        if (state.finished) return;
        var connection = new window.RTCPeerConnection({
            iceServers: iceServers,
            iceTransportPolicy: window.ZHAOYUN_PVP_FORCE_RELAY ? 'relay' : 'all',
            bundlePolicy: 'max-bundle'
        });
        state.peerConnection = connection;
        hideLocalAiUnits();
        if (state.side === 0) {
            attachDataChannel(connection.createDataChannel('zhao-board', { ordered: true }));
        } else {
            connection.addEventListener('datachannel', function (event) {
                if (event.channel) attachDataChannel(event.channel);
            });
        }
        // Keep a tiny dummy track so existing ICE/TURN negotiation path remains stable across browsers.
        try {
            var dummy = createNativeElement('canvas');
            dummy.width = 16;
            dummy.height = 16;
            var dummyContext = dummy.getContext('2d');
            if (dummyContext) {
                dummyContext.fillStyle = '#000';
                dummyContext.fillRect(0, 0, 16, 16);
            }
            if (typeof dummy.captureStream === 'function') {
                var dummyStream = dummy.captureStream(1);
                state.localMediaStream = dummyStream;
                var track = dummyStream.getVideoTracks()[0];
                if (track) connection.addTrack(track, dummyStream);
            }
        } catch (error) {}
        connection.addEventListener('icecandidate', function (event) {
            if (!event.candidate) return;
            send({
                type: 'rtc_ice',
                candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate
            });
        });
        connection.addEventListener('connectionstatechange', function () {
            if (connection.connectionState === 'connected') {
                state.mediaStatus = state.dataChannel && state.dataChannel.readyState === 'open'
                    ? (state.mediaTransport || '已连接')
                    : '同步中';
                detectMediaTransport();
                startBoardSync();
            } else if (connection.connectionState === 'failed' || connection.connectionState === 'disconnected') {
                state.mediaStatus = '画面重连中';
                updateHud();
                if (state.side === 0) {
                    clearTimeout(state.rtcRetryTimer);
                    state.rtcRetryTimer = setTimeout(function () {
                        state.rtcNegotiating = false;
                        createRtcOffer(true).catch(function () {});
                    }, 1600);
                }
            }
        });
        state.mediaStarting = false;
        var queued = state.pendingRtcMessages.splice(0);
        for (var index = 0; index < queued.length; index += 1) handleRtcSignal(queued[index]);
        send({ type: 'rtc_ready' });
        if (state.side === 0) setTimeout(function () { createRtcOffer(false).catch(function () {}); }, 500);
    }

    function closeBattleMedia() {
        clearTimeout(state.rtcRetryTimer);
        clearTimeout(state.localOpponentFrame);
        clearTimeout(state.mediaFrame);
        clearInterval(state.boardSyncTimer);
        state.localOpponentFrame = 0;
        state.mediaFrame = 0;
        state.boardSyncTimer = 0;
        state.lastBoardKey = '';
        clearPeerUnits();
        if (state.dataChannel) {
            try { state.dataChannel.close(); }
            catch (error) {}
        }
        if (state.peerConnection) {
            try { state.peerConnection.close(); }
            catch (error) {}
        }
        if (state.localMediaStream) {
            state.localMediaStream.getTracks().forEach(function (track) { track.stop(); });
        }
        if (state.localOpponentSourceStream) {
            state.localOpponentSourceStream.getTracks().forEach(function (track) { track.stop(); });
        }
        if (state.remoteMediaStream) {
            state.remoteMediaStream.getTracks().forEach(function (track) { track.stop(); });
        }
        [state.localOpponentCanvas, state.localOpponentSourceVideo, state.mediaVideo, state.mediaOverlay].forEach(function (element) {
            if (!element) return;
            try {
                if (element.parentNode) Node.prototype.removeChild.call(element.parentNode, element);
            } catch (error) {}
        });
        state.peerConnection = null;
        state.dataChannel = null;
        state.localMediaStream = null;
        state.localOpponentSourceStream = null;
        state.remoteMediaStream = null;
        state.localOpponentCanvas = null;
        state.localOpponentSourceVideo = null;
        state.mediaVideo = null;
        state.mediaOverlay = null;
        state.frameAnimClass = null;
        state.peerUnitNodes = null;
        state.peerEnemyNodes = null;
        state.enemyRouteSides = null;
        state.remoteBattleStateReceived = false;
        state.mediaStarting = false;
        state.rtcNegotiating = false;
        state.pendingRtcMessages = [];
        state.pendingIceCandidates = [];
    }

    function beginBattleAt(startAt) {
        clearTimeout(state.beginTimer);
        showBattleLoading('双方战场已就绪，即将开始…');
        var delay = Math.max(0, Number(startAt) - Date.now());
        state.beginTimer = setTimeout(function () {
            state.started = true;
            state.finished = false;
            removeElement('zhao-pvp-room-layer');
            removeElement('zhao-pvp-battle-loading');
            resumeBattle();
            hideLocalAiUnits();
            startBoardSync();
            startProgressReporting();
        }, delay);
    }

    function setGameScale(value) {
        try {
            if (window.Laya && window.Laya.timer) window.Laya.timer.scale = value;
        } catch (error) {}
    }

    function pauseBattle(message) {
        state.paused = true;
        setGameScale(0);
        if (message && state.battleScene) showPause(message, 0);
    }

    function resumeBattle() {
        if (state.finished) return;
        state.paused = false;
        setGameScale(1);
        hidePause();
    }

    function showPause(message, deadline) {
        var layer = document.getElementById('zhao-pvp-pause');
        if (!layer) {
            layer = document.createElement('div');
            layer.id = 'zhao-pvp-pause';
            shell().appendChild(layer);
        }
        function render() {
            var seconds = deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : 0;
            layer.innerHTML = '<div><div class="zhao-cloud-spinner"></div><b>' + escapeHtml(message) + '</b>' + (deadline ? '<span>剩余 ' + seconds + ' 秒</span>' : '') + '</div>';
            if (deadline && seconds > 0) setTimeout(render, 250);
        }
        render();
    }

    function hidePause() {
        removeElement('zhao-pvp-pause');
    }

    function currentWave() {
        var text = state.battleScene && state.battleScene.round && state.battleScene.round.text || '';
        var match = String(text).match(/\d+/);
        return match ? Math.max(1, Number(match[0])) : 1;
    }

    function localHp() {
        if (!state.battleData) return 3;
        var hp = Number(state.battleData.Zi);
        return Number.isFinite(hp) ? Math.max(0, Math.min(3, Math.trunc(hp))) : 3;
    }

    function elapsedTime() {
        var startedAt = state.startAt || state.room && state.room.startedAt || Date.now();
        return Math.max(0, Date.now() - Number(startedAt));
    }

    function startProgressReporting() {
        clearInterval(state.progressTimer);
        state.progressTimer = setInterval(function () {
            sendProgress(false);
            updateHud();
        }, 250);
        sendProgress(true);
    }

    function sendProgress(force) {
        if (!state.started || state.finished || state.paused) return;
        var hp = localHp();
        var wave = currentWave();
        var key = hp + ':' + wave;
        if (!force && key === state.lastProgressKey && Date.now() - state.lastProgressSentAt < 1000) return;
        if (send({ type: 'progress', hp: hp, wave: wave, elapsed: elapsedTime() })) {
            state.lastProgressKey = key;
            state.lastProgressSentAt = Date.now();
            updateRoomProgress(state.side, hp, wave);
        }
    }

    function ensureHud() {
        var hud = document.getElementById('zhao-pvp-hud');
        if (!hud) {
            hud = document.createElement('div');
            hud.id = 'zhao-pvp-hud';
            shell().appendChild(hud);
        }
        return hud;
    }

    function hearts(hp) {
        var count = Math.max(0, Math.min(3, Number(hp) || 0));
        var text = '';
        for (var index = 0; index < 3; index += 1) text += index < count ? '♥' : '♡';
        return text;
    }

    function updateHud() {
        if (!state.battleScene || !state.room) return;
        var me = selfPlayer(state.room);
        var opponent = opponentPlayer(state.room);
        var hud = ensureHud();
        hud.innerHTML = [
            '<div class="zhao-pvp-hud-row is-opponent">',
            '<span class="zhao-pvp-peer-name"><b>' + escapeHtml(opponent && opponent.nickname || '等待好友') + '</b><small>' + escapeHtml(opponent && opponent.rankName || '读取段位中') + '</small></span>',
            '<span class="zhao-pvp-hearts">' + hearts(opponent && opponent.hp) + '</span>',
            '<span class="zhao-pvp-peer-meta"><em>第 ' + (opponent && opponent.wave || 1) + ' 波</em><i>' + escapeHtml(state.mediaStatus) + '</i></span>',
            '</div>',
            '<div class="zhao-pvp-hud-row is-self"><b>' + escapeHtml(me && me.nickname || '我') + '</b><span class="zhao-pvp-hearts">' + hearts(localHp()) + '</span><em>第 ' + currentWave() + ' 波</em></div>'
        ].join('');
    }

    function finishBattle(message) {
        if (state.finished) return;
        state.finished = true;
        removeElement('zhao-pvp-room-layer');
        removeElement('zhao-pvp-battle-loading');
        state.result = message;
        clearInterval(state.progressTimer);
        hidePause();
        var won = Number(message.winnerSide) === Number(state.side);
        if (state.battleData) {
            if (won) applyRemoteProgress(0);
            else {
                try { state.battleData.Zi = 0; }
                catch (error) {}
            }
        }
        setTimeout(function () {
            closeBattleMedia();
            var reason = message.reason === 'disconnect' ? '好友断线超过 30 秒' : message.reason === 'forfeit' ? '一方认输退出' : '基地生命归零';
            showResult(won, won ? '好友对战胜利' : '好友对战失败', reason);
        }, 700);
    }

    function showResult(won, title, detail) {
        removeElement('zhao-pvp-result');
        var layer = document.createElement('div');
        layer.id = 'zhao-pvp-result';
        layer.innerHTML = [
            '<div class="zhao-pvp-card zhao-pvp-result-card ' + (won ? 'is-win' : 'is-lose') + '">',
            '  <div class="zhao-pvp-result-mark">' + (won ? '胜' : '败') + '</div>',
            '  <h1>' + escapeHtml(title) + '</h1>',
            '  <p>' + escapeHtml(detail || '') + '</p>',
            '  <button id="zhao-pvp-return" class="zhao-pvp-primary" type="button">返回主界面</button>',
            '</div>'
        ].join('');
        shell().appendChild(layer);
        layer.querySelector('#zhao-pvp-return').addEventListener('click', returnToMain);
    }

    function leaveRoom() {
        if (state.room && (state.room.phase === 'running' || state.room.phase === 'loading')) {
            if (!window.confirm('退出将被判负，确定退出吗？')) return;
            send({ type: 'forfeit' });
            return;
        }
        send({ type: 'leave' });
        returnToMain();
    }

    function returnToMain() {
        state.socketIntentionalClose = true;
        clearTimeout(state.reconnectTimer);
        clearInterval(state.progressTimer);
        clearInterval(state.entryTimer);
        if (state.socket) {
            try { state.socket.close(1000, 'return to main'); }
            catch (error) {}
        }
        setGameScale(1);
        closeBattleMedia();
        var original = parseJson(localStorage.getItem(ORIGINAL_SAVE_KEY));
        if (original) window.ZhaoCloud.replaceLocalSave(original);
        window.ZhaoCloud.setTemporarySaveMode(false);
        localStorage.removeItem(ORIGINAL_SAVE_KEY);
        localStorage.removeItem(ACTIVE_KEY);
        var url = new URL(location.href);
        url.searchParams.delete(ROOM_PARAM);
        location.href = url.href;
    }

    async function activateRoomMode() {
        state.code = roomCodeFromUrl();
        if (!state.code) return;
        removeElement('zhao-pvp-entry');
        renderRoom({ code: state.code, phase: 'lobby', seed: 0, players: [] }, '正在加入好友房间…');
        try {
            await connectMembership();
        } catch (error) {
            removeElement('zhao-pvp-room-layer');
            showResult(false, '无法进入好友房间', error.message || '请确认房间码是否有效');
        }
    }

    function onGameLoaded() {
        clearInterval(state.entryTimer);
        state.entryTimer = setInterval(ensureEntryButton, 250);
        ensureEntryButton();
        if (roomCodeFromUrl()) activateRoomMode();
    }

    window.ZhaoPvp = {
        beforeCloudStart: beforeCloudStart,
        afterCloudStart: afterCloudStart,
        onGameLoaded: onGameLoaded,
        showMenu: showMenu,
        isActive: function () { return !!state.code && !state.finished; },
        getState: function () {
            return {
                code: state.code,
                side: state.side,
                room: state.room,
                connected: !!(state.socket && state.socket.readyState === NativeWebSocket.OPEN),
                battleLoaded: !!state.battleScene,
                started: state.started,
                paused: state.paused,
                finished: state.finished,
                rankName: state.rankName,
                mediaConnected: !!(state.peerConnection && state.peerConnection.connectionState === 'connected' && (
                    (state.dataChannel && state.dataChannel.readyState === 'open') || state.remoteBattleStateReceived
                )),
                opponentRenderMode: state.opponentRenderMode,
                remoteBattleStateReceived: state.remoteBattleStateReceived,
                mediaStatus: state.mediaStatus,
                mediaTransport: state.mediaTransport,
                mediaConnectionState: state.peerConnection && state.peerConnection.connectionState || '',
                mediaIceState: state.peerConnection && state.peerConnection.iceConnectionState || ''
            };
        }
    };
})();
