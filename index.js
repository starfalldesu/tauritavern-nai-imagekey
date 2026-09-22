/*
 * NovelAI Image Key - 自包含零依赖版
 * 在图像生成面板的 NovelAI 区块注入 API Key 输入框。
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
        if (!res.ok) throw new Error(path + ' -> HTTP ' + res.status);
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
            var data = await res.json();
            var s2 = data && data[KEY];
            return Array.isArray(s2) && s2.length > 0;
        } catch (e) {
            console.warn('[NovelAI-ImageKey] 读取密钥状态失败', e);
            return false;
        }
    }

    async function saveKey(value) {
        var m = await loadHostModules();
        if (m.secrets && typeof m.secrets.writeSecret === 'function') {
            var id = await m.secrets.writeSecret(KEY, value, LABEL);
            return id !== null && id !== undefined;
        }
        await apiFetch('/api/secrets/write', { key: KEY, value: value, label: LABEL });
        return true;
    }

    async function deleteKey() {
        var m = await loadHostModules();
        if (m.secrets && typeof m.secrets.deleteSecret === 'function') {
            await m.secrets.deleteSecret(KEY);
            return;
        }
        await apiFetch('/api/secrets/delete', { key: KEY });
    }

    function injectStyles() {
        if (document.getElementById('nai-imgkey-style')) return;
        var style = document.createElement('style');
        style.id = 'nai-imgkey-style';
        style.textContent =
            '.nai-imgkey-row{display:flex;gap:.4em;margin:.4em 0;align-items:center}' +
            '.nai-imgkey-row input{flex:1;min-width:0}' +
            '.nai-imgkey-row .nai-btn{white-space:nowrap;cursor:pointer;padding:.3em .8em;border-radius:6px;background:var(--SmartThemeBlurTintColor,rgba(0,0,0,.35));border:1px solid var(--SmartThemeBorderColor,#666);user-select:none}' +
            '.nai-imgkey-status{display:block;margin:.2em 0 .5em;opacity:.9;font-size:.9em}' +
            '.nai-imgkey-status.saved{color:#6fcf6f}' +
            '.nai-imgkey-status.missing{color:#e0a050}';
        document.head.appendChild(style);
    }

    function buildRow(scope) {
        if (document.getElementById(scope + '_row')) return;

        var wrap = document.createElement('div');
        wrap.innerHTML =
            '<div id="' + scope + '_row" class="nai-imgkey-row">' +
            '<input id="' + scope + '_input" type="password" autocomplete="off" placeholder="NovelAI API Key (pst-...)" />' +
            '<span id="' + scope + '_save" class="nai-btn">保存</span>' +
            '<span id="' + scope + '_delete" class="nai-btn">删除</span>' +
            '</div>' +
            '<small id="' + scope + '_status" class="nai-imgkey-status"></small>';

        wrap.querySelector('#' + scope + '_save').addEventListener('click', async function () {
            var input = document.getElementById(scope + '_input');
            var value = String(input.value || '').trim();
            if (!value) { toast('warning', '请先粘贴 NovelAI API Key'); return; }
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

        wrap.querySelector('#' + scope + '_delete').addEventListener('click', async function () {
            try {
                if (!(await hasKey())) { toast('info', '当前没有已保存的密钥'); return; }
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

    async function refreshStatus() {
        var ok = await hasKey();
        var nodes = document.querySelectorAll('.nai-imgkey-status');
        for (var i = 0; i < nodes.length; i++) {
            nodes[i].textContent = ok ? '✔ 已保存 NovelAI 密钥，可以直接生成图像' : '✘ 未保存密钥，粘贴 Key 后点击保存';
            nodes[i].className = 'nai-imgkey-status ' + (ok ? 'saved' : 'missing');
        }
    }

    function injectIntoImagePanel() {
        var block = document.querySelector('div[data-sd-source="novel"]');
        if (!block) return false;
        if (document.getElementById('nai_imgkey_row')) return true;
        var row = buildRow('nai_imgkey');
        if (!row) return true;
        block.insertBefore(row, block.firstChild);
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
            '<small>此密钥与「API 连接 → NovelAI」共用。保存后即可在图像生成中选择 NovelAI 出图。</small>' +
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
        if (injectIntoImagePanel()) {
            // 两个入口都注入完成后停止观察
            if (document.getElementById('nai_imgkey_drawer')) observer.disconnect();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();
