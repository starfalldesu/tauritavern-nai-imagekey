import { eventSource, event_types } from '../../../script.js';
import { SECRET_KEYS, secret_state, writeSecret, deleteSecret, readSecretState } from '../../../secrets.js';

const KEY = SECRET_KEYS.NOVEL;
const ROW_ID = 'nai_imgkey_row';
const DRAWER_ID = 'nai_imgkey_drawer';

function hasKey() {
    const s = secret_state[KEY];
    return Array.isArray(s) && s.length > 0;
}

function buildRowHtml() {
    return `
    <div id="${ROW_ID}" class="flex-container marginTopBot5 flexGap5">
        <input id="${ROW_ID}_input" class="text_pole flex1" type="password" autocomplete="off"
            placeholder="NovelAI API Key (pst-...)" />
        <div id="${ROW_ID}_save" class="menu_button" title="保存密钥">
            <i class="fa-solid fa-floppy-disk"></i>保存
        </div>
        <div id="${ROW_ID}_delete" class="menu_button" title="删除已保存的密钥">
            <i class="fa-solid fa-trash-can"></i>删除
        </div>
    </div>
    <small id="${ROW_ID}_status" class="nai-imgkey-status"></small>`;
}

function updateStatus() {
    const status = $(`#${ROW_ID}_status, #${DRAWER_ID}_status`);
    if (hasKey()) {
        status.text('✔ 已保存 NovelAI 密钥，可以直接生成图像').removeClass('missing').addClass('saved');
    } else {
        status.text('✘ 未保存密钥，粘贴 Key 后点击保存').removeClass('saved').addClass('missing');
    }
}

async function onSaveClick() {
    const input = $(`#${ROW_ID}_input, #${DRAWER_ID}_input`).filter((_, el) => $(el).is(':visible')).first();
    const value = String(input.val() || '').trim();
    if (!value) {
        toastr.warning('请先粘贴 NovelAI API Key');
        return;
    }
    const id = await writeSecret(KEY, value, 'NovelAI（图像生成）');
    if (id !== null) {
        input.val('');
        toastr.success('NovelAI 密钥已保存');
    } else {
        toastr.error('密钥保存失败，请查看控制台');
    }
    updateStatus();
}

async function onDeleteClick() {
    if (!hasKey()) {
        toastr.info('当前没有已保存的密钥');
        return;
    }
    await deleteSecret(KEY);
    await readSecretState();
    toastr.success('NovelAI 密钥已删除');
    updateStatus();
}

function bindEvents(scope) {
    scope.find(`#${ROW_ID}_save, #${DRAWER_ID}_save`).off('click').on('click', onSaveClick);
    scope.find(`#${ROW_ID}_delete, #${DRAWER_ID}_delete`).off('click').on('click', onDeleteClick);
}

/** 在图像生成面板的 NovelAI 区块里注入密钥输入行 */
function injectIntoImagePanel() {
    if ($(`#${ROW_ID}`).length) {
        return true;
    }
    const novelBlock = $('div[data-sd-source="novel"]').first();
    if (!novelBlock.length) {
        return false;
    }
    novelBlock.prepend(buildRowHtml());
    bindEvents(novelBlock);
    updateStatus();
    return true;
}

/** 在扩展设置里添加一个抽屉面板作为备用入口 */
function injectDrawer() {
    if ($(`#${DRAWER_ID}`).length) {
        return;
    }
    const container = $('#extensions_settings');
    if (!container.length) {
        return;
    }
    const html = `
    <div id="${DRAWER_ID}" class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>NovelAI 图像生成密钥</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <small>此密钥与「API 连接 → NovelAI」共用。保存后即可在图像生成中选择 NovelAI 出图。</small>
            ${buildRowHtml().replaceAll(ROW_ID, DRAWER_ID)}
        </div>
    </div>`;
    container.append(html);
    bindEvents(container);
    updateStatus();
}

jQuery(async () => {
    injectDrawer();
    injectIntoImagePanel();

    // 图像生成面板可能尚未渲染，监听 DOM 变化直到注入成功
    const observer = new MutationObserver(() => {
        if (injectIntoImagePanel()) {
            observer.disconnect();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    eventSource.on(event_types.SECRET_WRITTEN, (key) => key === KEY && updateStatus());
    eventSource.on(event_types.SECRET_DELETED, (key) => key === KEY && updateStatus());
});
