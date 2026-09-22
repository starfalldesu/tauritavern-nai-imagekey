// Cloudflare Worker：NovelAI 反代（解决国内网络不通 + 浏览器 CORS）
// 部署：workers.cloudflare.com → 创建 Worker → 粘贴本文件 → 部署
// 路由约定：/image/* → https://image.novelai.net/*，/api/* → https://api.novelai.net/*
// 只转发这两个上游，Authorization 头原样透传，不记录任何内容。

export default {
    async fetch(request) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders() });
        }

        const url = new URL(request.url);
        let upstream;
        if (url.pathname.startsWith('/image/')) {
            upstream = 'https://image.novelai.net/' + url.pathname.slice('/image/'.length);
        } else if (url.pathname.startsWith('/api/')) {
            upstream = 'https://api.novelai.net/' + url.pathname.slice('/api/'.length);
        } else {
            return new Response('Not Found', { status: 404 });
        }
        upstream += url.search;

        const headers = new Headers();
        const auth = request.headers.get('Authorization');
        if (auth) headers.set('Authorization', auth);
        const ct = request.headers.get('Content-Type');
        if (ct) headers.set('Content-Type', ct);

        const resp = await fetch(upstream, {
            method: request.method,
            headers,
            body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        });

        const out = new Response(resp.body, { status: resp.status });
        const outCt = resp.headers.get('Content-Type');
        if (outCt) out.headers.set('Content-Type', outCt);
        for (const [k, v] of Object.entries(corsHeaders())) out.headers.set(k, v);
        return out;
    },
};

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    };
}
