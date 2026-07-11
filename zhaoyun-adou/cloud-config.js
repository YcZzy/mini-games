(function () {
    'use strict';

    var localHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    var existing = window.ZHAOYUN_CLOUD_CONFIG || {};
    window.ZHAOYUN_CLOUD_CONFIG = {
        // 本地连接 wrangler dev；线上经美西优化线路中转，Cloudflare 自定义域名保留作备用。
        apiBaseUrl: existing.apiBaseUrl || (localHost
            ? 'http://127.0.0.1:8787'
            : 'https://relay.euv.pp.ua'),
        requestTimeoutMs: existing.requestTimeoutMs || 15000
    };
})();
