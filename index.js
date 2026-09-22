/*
 * NovelAI Image Key v1.2.0 - 自包含零依赖版
 * 在图像生成面板的 NovelAI 区块注入 API Key 输入框（明文输入）+ 保存/校验/删除。
 * 不使用任何静态 import，宿主模块全部按需动态加载并带降级。
 */
(function () {
    'use strict';

    var KEY = 'api_key_novel';
    var LABEL = 'NovelAI（图像生成）';
    var hostModules = null;

    function toast(kind, msg) {
        var t = window.toastr;
        if (t && typeof t[kind] === 'function') {
            t[kind](msg);
        } else {
            console.log('[NovelAI-ImageKey]', msg);
        }
    }

    function loadHostModules() {
        if (hostModules) return hostModules;
        hostModules = (async function () {
            var out = { secrets: null, script: null };
            try { out.secrets = await import('../../../secrets.js'); } catch (e) { console.warn('[NovelAI-ImageKey] secrets.js 不可用，走 REST 降级', e); }
            try { out.script = await import('../../../script.js'); } catch (e) { console.warn('[NovelAI-ImageKey] script.js 不可用', e); }
            return out;
        })();
        return hostModules;
    }

    async function apiFetch(path, body) {
        var headers = { 'Content-Type': 'application/json' };
        try {
            var m = await loadHostModules();
            if (m.script && typeof m.script.getRequestHeaders === 'function') {
                var h = m.script.getRequestHeaders();
                for (var k in h) headers[k] = h[k];
            }
        } catch (e) { /* 忽略，直接发 */ }
        var res = await fetch(path, {
            method: 'POST',
            headers: headers,
            body: body ? JSON.stringify(body) : undefined,
        });
        return res;
    }

    async function hasKey() {
        try {
            var m = await loadHostModules();
            if (m.secrets && m.secrets.secret_state) {
                var s = m.secrets.secret_state[KEY];
                return Array.isArray(s) && s.length > 0;
            }
        } catch (e) { /* 走 REST */ }
        try {
            var res = await apiFetch('/api/secrets/read');
            if (res.ok) {
                var data = await res.json();
                var s2 = data && data[KEY];
                return Array.isArray(s2) && s2.length > 0;
            }
        } catch (e) {
            console.warn('[NovelAI-ImageKey] 读取密钥状态失败', e);
        }
        return false;
    }

    async function saveKey(value) {
        var m = await loadHostModules();
        if (m.secrets && typeof m.secrets.writeSecret === 'function') {
            var id = await m.secrets.writeSecret(KEY, value, LABEL);
            return id !== null && id !== undefined;
        }
        var res = await apiFetch('/api/secrets/write', { key: KEY, value: value, label: LABEL });
        return res.ok;
    }

    async function deleteKey() {
        var m = await loadHostModules();
        if (m.secrets && typeof m.secrets.deleteSecret === 'function') {
            await m.secrets.deleteSecret(KEY);
            return;
        }
        var res = await apiFetch('/api/secrets/delete', { key: KEY });
        if (!res.ok) throw new Error('HTTP ' + res.status);
    }

    /* ---------- 校验 ---------- */

    function parseSubscription(data) {
        var tier = data && data.tier !== undefined ? data.tier : '?';
        var tierNames = { 0: '免费', 1: 'Tablet ($10)', 2: 'Scroll ($15)', 3: 'Opus ($25)' };
        var tierText = tierNames[tier] || ('tier ' + tier);
        var anlas = data && data.trainingStepsLeft && data.trainingStepsLeft.fixedTrainingStepsLeft;
        var unlimited = !!(data && data.perks && data.perks.unlimitedImageGeneration);
        var parts = ['订阅档位：' + tierText];
        parts.push('无限生图：' + (unlimited ? '是' : '否'));
        if (typeof anlas === 'number') parts.push('Anlas 余额：' + anlas);
        return parts.join('　|　');
    }

    /** 通道一：宿主后端 /api/novelai/status（校验的是已保存的 key） */
    async function validateViaHost() {
        var res = await apiFetch('/api/novelai/status');
        if (res.status === 404) return { supported: false };
        if (!res.ok) {
            var text = await res.text().catch(function () { return ''; });
            return { supported: true, ok: false, msg: '宿主接口返回 HTTP ' + res.status + ' ' + String(text).slice(0, 120) };
        }
        var data = await res.json();
        return { supported: true, ok: true, msg: parseSubscription(data) };
    }

    /** 通道二：Tauri 原生 HTTP（无 CORS 限制），直接问 NovelAI */
    async function validateViaTauriHttp(key) {
        try {
            var T = window.__TAURI__;
            if (!T || !T.http || typeof T.http.fetch !== 'function') return { supported: false };
            var res = await T.http.fetch('https://api.novelai.net/user/subscription', {
                method: 'GET',
                headers: { 'Authorization': 'Bearer ' + key },
            });
            if (res.status === 401) return { supported: true, ok: false, msg: 'Key 无效（401 Unauthorized）' };
            if (!res.ok) return { supported: true, ok: false, msg: 'NovelAI 返回 HTTP ' + res.status };
            var data = res.data || (typeof res.json === 'function' ? await res.json() : null);
            return { supported: true, ok: true, msg: parseSubscription(data) };
        } catch (e) {
            return { supported: false };
        }
    }

    /** 通道三：浏览器直连（可能被 CORS 拦截） */
    async function validateViaDirect(key) {
        var res = await fetch('https://api.novelai.net/user/subscription', {
            method: 'GET',
            headers: { 'Authorization': 'Bearer ' + key },
        });
        if (res.status === 401) return { supported: true, ok: false, msg: 'Key 无效（401 Unauthorized）' };
        if (!res.ok) return { supported: true, ok: false, msg: 'NovelAI 返回 HTTP ' + res.status };
        var data = await res.json();
        return { supported: true, ok: true, msg: parseSubscription(data) };
    }

    async function validateKey(keyFromInput) {
        // 输入框里有新值就先保存，保证校验的就是将要使用的 key
        if (keyFromInput) {
            var saved = await saveKey(keyFromInput);
            if (!saved) return { ok: false, msg: 'Key 保存失败，无法校验' };
        } else if (!(await hasKey())) {
            return { ok: false, msg: '请先输入或保存 Key' };
        }

        // 依次尝试三条通道
        var viaHost = await validateViaHost().catch(function () { return { supported: false }; });
        if (viaHost.supported) return viaHost;

        if (keyFromInput) {
            var viaTauri = await validateViaTauriHttp(keyFromInput);
            if (viaTauri.supported) return viaTauri;
            try {
                return await validateViaDirect(keyFromInput);
            } catch (e) {
                return { ok: false, msg: '无法连接 NovelAI（浏览器跨域限制），但 Key 已保存。格式校验：' + (isFormatOk(keyFromInput) ? '通过' : '可疑') };
            }
        }
        return { ok: false, msg: '当前环境不支持在线校验（宿主未实现该接口，且无法直连 NovelAI）' };
    }

    function isFormatOk(key) {
        return /^pst-[A-Za-z0-9_\-]{16,}$/.test(key);
    }

    /* ---------- UI ---------- */

    function injectStyles() {
        if (document.getElementById('nai-imgkey-style')) return;
        var style = document.createElement('style');
        style.id = 'nai-imgkey-style';
        style.textContent =
            '.nai-imgkey-row{display:flex;gap:.4em;margin:.4em 0;align-items:center;flex-wrap:wrap}' +
            '.nai-imgkey-row input{flex:1;min-width:12em;padding:.3em .5em}' +
            '.nai-imgkey-row .nai-btn{white-space:nowrap;cursor:pointer;padding:.3em .8em;border-radius:6px;border:1px solid var(--SmartThemeBorderColor,#666);background:var(--SmartThemeBlurTintColor,rgba(0,0,0,.35));user-select:none}' +
            '.nai-imgkey-row .nai-btn:active{filter:brightness(1.3)}' +
            '.nai-imgkey-status{display:block;margin:.2em 0 .5em;opacity:.9;font-size:.9em;white-space:pre-wrap}' +
            '.nai-imgkey-status.saved{color:#6fcf6f}' +
            '.nai-imgkey-status.missing{color:#e0a050}' +
            '.nai-imgkey-status.error{color:#e06060}';
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

    function buildRow(scope) {
        if (document.getElementById(scope + '_row')) return null;

        var wrap = document.createElement('div');
        var esc = function (s) { return s; };
        wrap.innerHTML =
            '<div id="' + esc(scope) + '_row" class="nai-imgkey-row">' +
            '<input id="' + esc(scope) + '_input" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="NovelAI API Key (pst-...)" />' +
            '<span id="' + esc(scope) + '_save" class="nai-btn">保存</span>' +
            '<span id="' + esc(scope) + '_validate" class="nai-btn">校验</span>' +
            '<span id="' + esc(scope) + '_delete" class="nai-btn">删除</span>' +
            '</div>' +
            '<small id="' + esc(scope) + '_status" class="nai-imgkey-status"></small>';

        wrap.querySelector('#' + scope + '_save').addEventListener('click', async function () {
            var input = document.getElementById(scope + '_input');
            var value = String(input.value || '').trim();
            if (!value) { toast('warning', '请先粘贴 NovelAI API Key'); return; }
            if (!isFormatOk(value)) {
                toast('warning', 'Key 格式可疑：NovelAI Key 一般以 pst- 开头，请确认是否复制完整');
            }
            try {
                var ok = await saveKey(value);
                if (ok) {
                    input.value = '';
                    toast('success', 'NovelAI 密钥已保存');
                } else {
                    toast('error', '密钥保存失败，请查看控制台');
                }
            } catch (e) {
                console.error('[NovelAI-ImageKey] 保存失败', e);
                toast('error', '密钥保存失败：' + e.message);
            }
            refreshStatus();
        });

        wrap.querySelector('#' + scope + '_validate').addEventListener('click', async function () {
            var input = document.getElementById(scope + '_input');
            var value = String(input.value || '').trim();
            setStatus('正在校验，请稍候…', 'missing');
            try {
                var result = await validateKey(value);
                if (result.ok) {
                    if (value) input.value = '';
                    setStatus('✔ 校验通过\n' + result.msg, 'saved');
                    toast('success', 'NovelAI Key 校验通过');
                } else {
                    setStatus('✘ 校验未通过：' + result.msg, 'error');
                    toast('error', '校验未通过：' + result.msg);
                }
            } catch (e) {
                console.error('[NovelAI-ImageKey] 校验异常', e);
                setStatus('✘ 校验出错：' + e.message, 'error');
            }
        });

        wrap.querySelector('#' + scope + '_delete').addEventListener('click', async function () {
            try {
                if (!(await hasKey())) { toast('info', '当前没有已保存的密钥'); refreshStatus(); return; }
                await deleteKey();
                toast('success', 'NovelAI 密钥已删除');
            } catch (e) {
                console.error('[NovelAI-ImageKey] 删除失败', e);
                toast('error', '密钥删除失败：' + e.message);
            }
            refreshStatus();
        });

        return wrap;
    }

    function injectIntoImagePanel() {
        var block = document.querySelector('div[data-sd-source="novel"]');
        if (!block) return false;
        if (document.getElementById('nai_imgkey_row')) return true;
        var row = buildRow('nai_imgkey');
        if (row) block.insertBefore(row, block.firstChild);
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
            '<b>NovelAI 图像生成密钥</b>' +
            '<div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>' +
            '</div>' +
            '<div class="inline-drawer-content">' +
            '<small>此密钥与「API 连接 → NovelAI」共用。</small>' +
            '</div>';
        var row = buildRow('nai_drawer');
        if (row) drawer.querySelector('.inline-drawer-content').appendChild(row);
        container.appendChild(drawer);
        refreshStatus();
    }

    injectStyles();
    injectDrawer();
    injectIntoImagePanel();

    var observer = new MutationObserver(function () {
        injectDrawer();
        if (injectIntoImagePanel() && document.getElementById('nai_imgkey_drawer')) {
            observer.disconnect();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();
