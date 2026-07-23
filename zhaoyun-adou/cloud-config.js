(function () {
    'use strict';

    // 默认不配置云 API，游戏以单机模式运行（localStorage 存档）。
    // 如需启用云存档/排行榜/好友对战，部署云后端后在页面引入前设置：
    //   window.ZHAOYUN_CLOUD_CONFIG = { apiBaseUrl: 'https://your-api.example.com' };
    // 或在本地开发时使用 ?cloud=on 并配置本地 API 地址。
    var existing = window.ZHAOYUN_CLOUD_CONFIG || {};
    window.ZHAOYUN_CLOUD_CONFIG = {
        apiBaseUrl: existing.apiBaseUrl || '',
        requestTimeoutMs: existing.requestTimeoutMs || 15000
    };
})();
