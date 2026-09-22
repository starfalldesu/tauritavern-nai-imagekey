/*
 * NovelAI Image Key & Generator v2.0.0 - 自包含零依赖版
 * 绕过 TauriTavern 未实现的 NovelAI 生图后端，插件内直连 NovelAI 官方图片接口。
 * 功能：密钥管理 / 校验 / 完整生图（模型、尺寸、步数、引导、采样器、噪声表、种子）。
 * 网络通道按序尝试：Tauri 原生 HTTP → 自建反代（可选）→ 浏览器直连。
 */
(function () {
    'use strict';

    var KEY = 'api_key_novel';
    var LABEL = 'NovelAI（图像生成）';
    var API_IMAGE = 'https://image.novelai.net/ai/generate-image';
    var API_SUB = 'https://api.novelai.net/user/subscription';
    var hostModules = null;

    var MODELS = [
        { value: 'nai-diffusion-4-5-full', text: 'NAI Diffusion 4.5 Full（最新）' },
        { value: 'nai-diffusion-4-5-curated', text: 'NAI Diffusion 4.5 Curated' },
        { value: 'nai-diffusion-4-full', text: 'NAI Diffusion 4 Full' },
        { value: 'nai-diffusion-4-curated-preview', text: 'NAI Diffusion 4 Curated Preview' },
        { value: 'nai-diffusion-3', text: 'NAI Diffusion 3（旧版动漫）' },
        { value: 'nai-diffusion-furry-3', text: 'NAI Diffusion Furry 3' },
    ];
    var SIZES = [
        { value: '832x1216', text: '竖版 832×1216' },
        { value: '1216x832', text: '横版 1216×832' },
        { value: '1024x1024', text: '方形 1024×1024' },
    ];
    var SAMPLERS = ['k_euler_ancestral', 'k_euler', 'k_dpmpp_2s_ancestral', 'k_dpmpp_2m_sde', 'k_dpmpp_2m', 'k_dpmpp_sde', 'ddim'];
    var SCHEDULERS = ['karras', 'native', 'exponential', 'polyexponential'];

    function toast(kind, msg) {
        var t = window.toastr;
        if (t && typeof t[kind] === 'function') { t[kind](msg); return; }
        console.log('[NovelAI-Direct]', msg);
    }

    /* ---------- 宿主模块（动态、可降级） ---------- */

    function loadHostModules() {
        if (hostModules) return hostModules;
        hostModules = (async function () {
            var out = { secrets: null, script: null };
            try { out.secrets = await import('../../../secrets.js'); } catch (e) { console.warn('[NovelAI-Direct] secrets.js 不可用', e); }
            try { out.script = await import('../../../script.js'); } catch (e) { console.warn('[NovelAI-Direct] script.js 不可用', e); }
            return out;
        })();
        return hostModules;
    }

    async function hostApi(path, body) {
        var headers = { 'Content-Type': 'application/json' };
        try {
            var m = await loadHostModules();
            if (m.script && typeof m.script.getRequestHeaders === 'function') {
                var h = m.script.getRequestHeaders();
                for (var k in h) headers[k] = h[k];
            }
        } catch (e) { /* 忽略 */ }
        return fetch(path, { method: 'POST', headers: headers, body: body ? JSON.stringify(body) : undefined });
    }

    /* ---------- 密钥 ---------- */

    async function hasKey() {
        try {
            var m = await loadHostModules();
            if (m.secrets && m.secrets.secret_state) {
                var s = m.secrets.secret_state[KEY];
                return Array.isArray(s) && s.length > 0;
            }
        } catch (e) { /* 走 REST */ }
        try {
            var res = await hostApi('/api/secrets/read');
            if (res.ok) {
                var data = await res.json();
                var s2 = data && data[KEY];
                return Array.isArray(s2) && s2.length > 0;
            }
        } catch (e) { console.warn('[NovelAI-Direct] 读取密钥状态失败', e); }
        return false;
    }

    async function readKeyValue() {
        try {
            var m = await loadHostModules();
            if (m.secrets && typeof m.secrets.findSecret === 'function') {
                var v = await m.secrets.findSecret(KEY);
                if (v) return v;
            }
        } catch (e) { /* 走 REST */ }
        var res = await hostApi('/api/secrets/find', { key: KEY });
        if (!res.ok) return null;
        var data = await res.json();
        return data && data.value ? data.value : null;
    }

    async function saveKey(value) {
        var m = await loadHostModules();
        if (m.secrets && typeof m.secrets.writeSecret === 'function') {
            var id = await m.secrets.writeSecret(KEY, value, LABEL);
            return id !== null && id !== undefined;
        }
        var res = await hostApi('/api/secrets/write', { key: KEY, value: value, label: LABEL });
        return res.ok;
    }

    async function deleteKey() {
        var m = await loadHostModules();
        if (m.secrets && typeof m.secrets.deleteSecret === 'function') { await m.secrets.deleteSecret(KEY); return; }
        var res = await hostApi('/api/secrets/delete', { key: KEY });
        if (!res.ok) throw new Error('HTTP ' + res.status);
    }

    /* ---------- 网络通道 ---------- */

    function getRelay() {
        return (localStorage.getItem('nai_direct_relay') || '').trim().replace(/\/+$/, '');
    }

    function mapRelayUrl(url, relay) {
        // relay 约定：/image/* → image.novelai.net/*，/api/* → api.novelai.net/*
        if (url.indexOf('https://image.novelai.net/') === 0) return relay + '/image/' + url.slice('https://image.novelai.net/'.length);
        if (url.indexOf('https://api.novelai.net/') === 0) return relay + '/api/' + url.slice('https://api.novelai.net/'.length);
        return url;
    }

    /** 统一请求：返回 { ok, status, json()?, arrayBuffer()? }。rawHeaders 用于跨域带 Authorization。 */
    async function naiFetch(url, options) {
        var headers = options.headers || {};
        // 通道一：Tauri 原生 HTTP（无 CORS）
        try {
            var T = window.__TAURI__;
            if (T && T.http && typeof T.http.fetch === 'function') {
                return await T.http.fetch(url, { method: options.method || 'GET', headers: headers, body: options.body });
            }
        } catch (e) { console.warn('[NovelAI-Direct] Tauri HTTP 通道不可用', e); }
        // 通道二：自建反代
        var relay = getRelay();
        if (relay) {
            return fetch(mapRelayUrl(url, relay), { method: options.method || 'GET', headers: headers, body: options.body });
        }
        // 通道三：浏览器直连
        return fetch(url, { method: options.method || 'GET', headers: headers, body: options.body });
    }

    /* ---------- 校验 ---------- */

    function isFormatOk(key) { return /^pst-[A-Za-z0-9_\-]{16,}$/.test(key); }

    function parseSubscription(data) {
        if (!data || typeof data !== 'object') return '已连接（响应格式未识别）';
        var tierNames = { 0: '免费', 1: 'Tablet ($10)', 2: 'Scroll ($15)', 3: 'Opus ($25)' };
        var parts = ['订阅档位：' + (tierNames[data.tier] || ('tier ' + data.tier))];
        var unlimited = !!(data.perks && data.perks.unlimitedImageGeneration);
        parts.push('无限生图：' + (unlimited ? '是' : '否'));
        var anlas = data.trainingStepsLeft && data.trainingStepsLeft.fixedTrainingStepsLeft;
        if (typeof anlas === 'number') parts.push('Anlas 余额：' + anlas);
        return parts.join('　|　');
    }

    async function validateKey(keyFromInput) {
        if (keyFromInput) {
            var saved = await saveKey(keyFromInput);
            if (!saved) return { ok: false, msg: 'Key 保存失败，无法校验' };
        } else if (!(await hasKey())) {
            return { ok: false, msg: '请先输入或保存 Key' };
        }

        // 通道一（最可靠）：借道宿主已实现的 NovelAI 语音接口。
        // 同源请求、由 Rust 端出站、自动带已保存的 Key，不受浏览器 CORS 限制，且不消耗 Anlas。
        try {
            var res = await hostApi('/api/novelai/generate-voice', { text: 'a', voice: 'Ligeia' });
            if (res.ok) {
                var info = await tryFetchSubscription(keyFromInput);
                return { ok: true, msg: 'Key 有效（已通过 NovelAI 接口验证）' + (info ? '\n' + info : '') };
            }
            if (res.status === 401) return { ok: false, msg: 'Key 无效（NovelAI 返回 401 Unauthorized），请检查是否复制完整' };
            if (res.status === 403) return { ok: true, msg: 'Key 有效（NovelAI 已受理），但当前账号无语音接口权限——不影响生图' };
            if (res.status !== 404) {
                var t = ''; try { t = await res.text(); } catch (e) { /* 忽略 */ }
                return { ok: false, msg: '宿主通道返回 HTTP ' + res.status + ' ' + String(t).slice(0, 100) };
            }
            // 404 = 宿主未实现语音接口，继续走外部通道
        } catch (e) { console.warn('[NovelAI-Direct] 宿主校验通道不可用', e); }

        // 通道二：反代 / 直连订阅接口（可能被 CORS 或墙拦截）
        var key = keyFromInput || await readKeyValue();
        if (!key) return { ok: false, msg: '读取已保存的 Key 失败' };
        var res2 = await naiFetch(API_SUB, { headers: { 'Authorization': 'Bearer ' + key } });
        if (res2.status === 401) return { ok: false, msg: 'Key 无效（401 Unauthorized）' };
        if (!res2.ok) return { ok: false, msg: 'NovelAI 返回 HTTP ' + res2.status };
        var data = res2.data || (typeof res2.json === 'function' ? await res2.json() : null);
        return { ok: true, msg: parseSubscription(data) };
    }

    /** 尽力获取订阅信息（档位/Anlas），失败静默返回 null */
    async function tryFetchSubscription(keyFromInput) {
        try {
            var key = keyFromInput || await readKeyValue();
            if (!key) return null;
            var res = await naiFetch(API_SUB, { headers: { 'Authorization': 'Bearer ' + key } });
            if (!res.ok) return null;
            var data = res.data || (typeof res.json === 'function' ? await res.json() : null);
            return parseSubscription(data);
        } catch (e) { return null; }
    }

    /* ---------- ZIP 解包（NovelAI 返回 zip 包裹的 png） ---------- */

    async function unzipFirstImage(buf) {
        var bytes = new Uint8Array(buf);
        var view = new DataView(buf);
        // 从尾部找 EOCD (0x06054b50)
        var eocd = -1;
        for (var i = bytes.length - 22; i >= 0; i--) {
            if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error('返回内容不是有效的 zip');
        var count = view.getUint16(eocd + 10, true);
        var cdOffset = view.getUint32(eocd + 16, true);
        for (var e = 0; e < count; e++) {
            var p = cdOffset;
            if (view.getUint32(p, true) !== 0x02014b50) break;
            var method = view.getUint16(p + 10, true);
            var compSize = view.getUint32(p + 20, true);
            var nameLen = view.getUint16(p + 28, true);
            var extraLen = view.getUint16(p + 30, true);
            var commentLen = view.getUint16(p + 32, true);
            var localOffset = view.getUint32(p + 42, true);
            // 本地文件头
            var ln = view.getUint16(localOffset + 26, true);
            var le = view.getUint16(localOffset + 28, true);
            var dataStart = localOffset + 30 + ln + le;
            var comp = bytes.slice(dataStart, dataStart + compSize);
            var raw;
            if (method === 0) {
                raw = comp;
            } else if (method === 8) {
                var ds = new DecompressionStream('deflate-raw');
                var stream = new Blob([comp]).stream().pipeThrough(ds);
                raw = new Uint8Array(await new Response(stream).arrayBuffer());
            } else {
                throw new Error('不支持的 zip 压缩方式：' + method);
            }
            return new Blob([raw], { type: 'image/png' });
            // 只取第一个文件
        }
        throw new Error('zip 内没有文件');
    }

    /* ---------- 生图 ---------- */

    function buildPayload(o) {
        var isV4 = o.model.indexOf('nai-diffusion-4') === 0;
        var params = {
            params_version: 3,
            width: o.width,
            height: o.height,
            scale: o.scale,
            sampler: o.sampler,
            steps: o.steps,
            seed: o.seed,
            n_samples: 1,
            ucPreset: 0,
            qualityToggle: true,
            sm: false,
            sm_dyn: false,
            dynamic_thresholding: false,
            controlnet_strength: 1,
            legacy: false,
            add_original_image: true,
            negative_prompt: o.negative,
            noise_schedule: o.scheduler,
            legacy_v3_extend: false,
            skip_cfg_above_sigma: null,
            use_coords: false,
            characterPrompts: [],
            deliberate_euler_ancestral_bug: false,
            prefer_brownian: true,
        };
        if (isV4) {
            params.v4_prompt = { caption: { base_caption: o.prompt, char_captions: [] }, use_coords: false };
            params.v4_negative_prompt = { caption: { base_caption: o.negative, char_captions: [] }, use_coords: false };
        }
        return { input: o.prompt, model: o.model, action: 'generate', parameters: params };
    }

    async function generateImage(o, onProgress) {
        var key = await readKeyValue();
        if (!key) throw new Error('未保存 API Key，请先保存');
        onProgress('正在请求 NovelAI…');
        var res;
        try {
            res = await naiFetch(API_IMAGE, {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
                body: JSON.stringify(buildPayload(o)),
            });
        } catch (e) {
            if (e && (e.name === 'TypeError' || /failed to fetch|networkerror|cors/i.test(String(e.message)))) {
                throw new Error('请求被浏览器拦截（CORS 跨域限制）——VPN 解决不了这个问题。请在面板上方填写反代地址后重试（仓库 README 有 3 分钟部署教程），反代同时能绕开墙');
            }
            throw e;
        }
        if (res.status === 401) throw new Error('Key 无效（401）');
        if (res.status === 402) throw new Error('Anlas 余额不足或档位不支持（402）');
        if (!res.ok) {
            var errText = '';
            try { errText = await res.text(); } catch (e) { /* 忽略 */ }
            throw new Error('NovelAI 返回 HTTP ' + res.status + ' ' + String(errText).slice(0, 200));
        }
        onProgress('正在解包图片…');
        var buf = await res.arrayBuffer();
        return await unzipFirstImage(buf);
    }

    /* ---------- UI ---------- */

    function injectStyles() {
        if (document.getElementById('nai-imgkey-style')) return;
        var style = document.createElement('style');
        style.id = 'nai-imgkey-style';
        style.textContent =
            '.nai-direct{font-size:.95em;border:1px solid var(--SmartThemeBorderColor,#666);border-radius:8px;padding:.6em;margin:.4em 0}' +
            '.nai-direct textarea{width:100%;min-height:3.2em;resize:vertical;margin:.15em 0}' +
            '.nai-direct select,.nai-direct input[type=number],.nai-direct input[type=text]{max-width:100%}' +
            '.nai-direct-grid{display:grid;grid-template-columns:1fr 1fr;gap:.4em .8em;margin:.3em 0}' +
            '.nai-direct-grid label{display:flex;flex-direction:column;gap:.15em;font-size:.9em}' +
            '.nai-imgkey-row{display:flex;gap:.4em;margin:.4em 0;align-items:center;flex-wrap:wrap}' +
            '.nai-imgkey-row input{flex:1;min-width:12em;padding:.3em .5em}' +
            '.nai-btn{white-space:nowrap;cursor:pointer;padding:.35em .9em;border-radius:6px;border:1px solid var(--SmartThemeBorderColor,#666);background:var(--SmartThemeBlurTintColor,rgba(0,0,0,.35));user-select:none;display:inline-block}' +
            '.nai-btn:active{filter:brightness(1.3)}' +
            '.nai-btn-primary{background:var(--SmartThemeQuoteColor,#5a8acf);color:#fff;border-color:transparent}' +
            '.nai-imgkey-status{display:block;margin:.2em 0 .5em;opacity:.9;font-size:.9em;white-space:pre-wrap}' +
            '.nai-imgkey-status.saved{color:#6fcf6f}.nai-imgkey-status.missing{color:#e0a050}.nai-imgkey-status.error{color:#e06060}' +
            '.nai-result{margin-top:.5em;text-align:center}' +
            '.nai-result img{max-width:100%;border-radius:8px}' +
            '.nai-result .nai-btn{margin-top:.4em}';
        document.head.appendChild(style);
    }

    function setStatus(text, cls) {
        var nodes = document.querySelectorAll('.nai-imgkey-status');
        for (var i = 0; i < nodes.length; i++) {
            nodes[i].textContent = text;
            nodes[i].className = 'nai-imgkey-status ' + cls;
        }
    }

    async function refreshStatus() {
        var ok = await hasKey();
        setStatus(ok ? '✔ 已保存 NovelAI 密钥' : '✘ 未保存密钥，粘贴 Key 后点击保存', ok ? 'saved' : 'missing');
    }

    function optionsHtml(list) {
        return list.map(function (m) {
            return '<option value="' + (m.value || m) + '">' + (m.text || m) + '</option>';
        }).join('');
    }

    function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    function buildPanel(scope, withGenerator) {
        if (document.getElementById(scope + '_wrap')) return null;
        var wrap = document.createElement('div');
        wrap.id = scope + '_wrap';
        wrap.className = 'nai-direct';

        var html =
            '<div class="nai-imgkey-row">' +
            '<input id="' + scope + '_input" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="NovelAI API Key (pst-...)" />' +
            '<span id="' + scope + '_save" class="nai-btn">保存</span>' +
            '<span id="' + scope + '_validate" class="nai-btn">校验</span>' +
            '<span id="' + scope + '_delete" class="nai-btn">删除</span>' +
            '</div>' +
            '<small id="' + scope + '_status" class="nai-imgkey-status"></small>' +
            '<div class="nai-imgkey-row">' +
            '<input id="' + scope + '_relay" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="反代地址（可选，如 https://xxx.workers.dev）" />' +
            '<span id="' + scope + '_relay_save" class="nai-btn">保存反代</span>' +
            '</div>';

        if (withGenerator) {
            html +=
                '<hr style="opacity:.3" />' +
                '<b>NovelAI 直出生图</b><small style="opacity:.75">（插件直连官方接口，不依赖酒馆后端）</small>' +
                '<div style="margin-top:.4em"><label>提示词<textarea id="' + scope + '_prompt" placeholder="masterpiece, best quality, 1girl, ..."></textarea></label></div>' +
                '<div><label>负面提示词<textarea id="' + scope + '_negative" placeholder="lowres, bad anatomy, ..."></textarea></label></div>' +
                '<div class="nai-direct-grid">' +
                '<label>模型<select id="' + scope + '_model">' + optionsHtml(MODELS) + '</select></label>' +
                '<label>尺寸<select id="' + scope + '_size">' + optionsHtml(SIZES) + '</select></label>' +
                '<label>步数<input id="' + scope + '_steps" type="number" min="1" max="50" value="28" /></label>' +
                '<label>引导系数<input id="' + scope + '_scale" type="number" min="0" max="20" step="0.1" value="5" /></label>' +
                '<label>采样器<select id="' + scope + '_sampler">' + optionsHtml(SAMPLERS) + '</select></label>' +
                '<label>噪声表<select id="' + scope + '_scheduler">' + optionsHtml(SCHEDULERS) + '</select></label>' +
                '<label>种子（-1 随机）<input id="' + scope + '_seed" type="number" value="-1" /></label>' +
                '<label style="flex-direction:row;align-items:center;gap:.4em;margin-top:1.2em"><input id="' + scope + '_guard" type="checkbox" checked /> Anlas 守护（≤28步 ≤1024×1024）</label>' +
                '</div>' +
                '<div class="nai-imgkey-row"><span id="' + scope + '_gen" class="nai-btn nai-btn-primary">生成图片</span><small id="' + scope + '_progress"></small></div>' +
                '<div id="' + scope + '_result" class="nai-result"></div>';
        }

        wrap.innerHTML = html;

        /* 密钥三键 */
        wrap.querySelector('#' + scope + '_save').addEventListener('click', async function () {
            var input = document.getElementById(scope + '_input');
            var value = String(input.value || '').trim();
            if (!value) { toast('warning', '请先粘贴 NovelAI API Key'); return; }
            if (!isFormatOk(value)) toast('warning', 'Key 格式可疑：一般以 pst- 开头，请确认复制完整');
            try {
                if (await saveKey(value)) { input.value = ''; toast('success', 'NovelAI 密钥已保存'); }
                else toast('error', '密钥保存失败');
            } catch (e) { toast('error', '密钥保存失败：' + e.message); }
            refreshStatus();
        });

        wrap.querySelector('#' + scope + '_validate').addEventListener('click', async function () {
            var input = document.getElementById(scope + '_input');
            var value = String(input.value || '').trim();
            setStatus('正在校验，请稍候…（国内网络可能需要反代）', 'missing');
            try {
                var result = await validateKey(value);
                if (result.ok) {
                    if (value) input.value = '';
                    setStatus('✔ 校验通过\n' + result.msg, 'saved');
                } else {
                    setStatus('✘ ' + result.msg, 'error');
                }
            } catch (e) {
                setStatus('✘ 校验失败：' + e.message + '\n提示：国内网络直连 NovelAI 可能不通，可填写反代地址后重试', 'error');
            }
        });

        wrap.querySelector('#' + scope + '_delete').addEventListener('click', async function () {
            try {
                if (!(await hasKey())) { toast('info', '当前没有已保存的密钥'); refreshStatus(); return; }
                await deleteKey();
                toast('success', 'NovelAI 密钥已删除');
            } catch (e) { toast('error', '密钥删除失败：' + e.message); }
            refreshStatus();
        });

        /* 反代 */
        var relayInput = wrap.querySelector('#' + scope + '_relay');
        relayInput.value = getRelay();
        wrap.querySelector('#' + scope + '_relay_save').addEventListener('click', function () {
            localStorage.setItem('nai_direct_relay', String(relayInput.value || '').trim());
            toast('success', '反代地址已保存');
        });

        /* 生图 */
        if (withGenerator) {
            wrap.querySelector('#' + scope + '_gen').addEventListener('click', async function () {
                var progress = document.getElementById(scope + '_progress');
                var resultBox = document.getElementById(scope + '_result');
                var prompt = String(document.getElementById(scope + '_prompt').value || '').trim();
                if (!prompt) { toast('warning', '请先填写提示词'); return; }
                var sizeParts = String(document.getElementById(scope + '_size').value).split('x');
                var width = parseInt(sizeParts[0], 10), height = parseInt(sizeParts[1], 10);
                var steps = parseInt(document.getElementById(scope + '_steps').value, 10) || 28;
                var guard = document.getElementById(scope + '_guard').checked;
                if (guard) {
                    if (steps > 28) { steps = 28; toast('info', 'Anlas 守护：步数已限制为 28'); }
                    if (width * height > 1024 * 1024) { toast('warning', 'Anlas 守护：当前尺寸超过 1024×1024，非无限生图档位会扣 Anlas'); }
                }
                var seed = parseInt(document.getElementById(scope + '_seed').value, 10);
                if (isNaN(seed) || seed < 0) seed = Math.floor(Math.random() * 4294967295);
                resultBox.innerHTML = '';
                try {
                    var blob = await generateImage({
                        prompt: prompt,
                        negative: String(document.getElementById(scope + '_negative').value || ''),
                        model: document.getElementById(scope + '_model').value,
                        width: width, height: height, steps: steps,
                        scale: parseFloat(document.getElementById(scope + '_scale').value) || 5,
                        sampler: document.getElementById(scope + '_sampler').value,
                        scheduler: document.getElementById(scope + '_scheduler').value,
                        seed: seed,
                    }, function (t) { progress.textContent = t; });
                    var url = URL.createObjectURL(blob);
                    resultBox.innerHTML =
                        '<img src="' + url + '" alt="生成结果" />' +
                        '<div><a class="nai-btn" href="' + url + '" download="novelai-' + seed + '.png">下载图片</a></div>';
                    progress.textContent = '完成（种子 ' + seed + '）';
                } catch (e) {
                    console.error('[NovelAI-Direct] 生成失败', e);
                    progress.textContent = '';
                    resultBox.innerHTML = '<small class="nai-imgkey-status error">✘ ' + esc(e.message) + '\n若提示网络错误：国内直连 NovelAI 被墙，请配置反代地址；若 401：Key 无效；若 402：余额/档位不足。</small>';
                }
            });
        }

        return wrap;
    }

    function injectIntoImagePanel() {
        var block = document.querySelector('div[data-sd-source="novel"]');
        if (!block) return false;
        if (document.getElementById('nai_gen_wrap')) return true;
        var panel = buildPanel('nai_gen', true);
        if (panel) block.insertBefore(panel, block.firstChild);
        refreshStatus();
        return true;
    }

    function injectDrawer() {
        var container = document.getElementById('extensions_settings');
        if (!container) return;
        if (document.getElementById('nai_imgkey_drawer')) return;
        var drawer = document.createElement('div');
        drawer.id = 'nai_imgkey_drawer';
        drawer.className = 'inline-drawer';
        drawer.innerHTML =
            '<div class="inline-drawer-toggle inline-drawer-header">' +
            '<b>NovelAI 密钥与直出生图</b>' +
            '<div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>' +
            '</div>' +
            '<div class="inline-drawer-content">' +
            '<small>密钥与「API 连接 → NovelAI」共用。完整生图面板在「图像生成 → 来源选 NovelAI」里。</small>' +
            '</div>';
        var panel = buildPanel('nai_drawer', false);
        if (panel) drawer.querySelector('.inline-drawer-content').appendChild(panel);
        container.appendChild(drawer);
        refreshStatus();
    }

    injectStyles();
    injectDrawer();
    injectIntoImagePanel();

    var observer = new MutationObserver(function () {
        injectDrawer();
        if (injectIntoImagePanel() && document.getElementById('nai_imgkey_drawer')) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();
