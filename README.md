# NovelAI Image Key

给 TauriTavern / SillyTavern 的图像生成面板补上 NovelAI API Key 输入框的插件。

## 原理

SillyTavern 的 NovelAI 生图走服务器端接口 `/api/novelai/generate-image`，密钥统一读取全局密钥 `api_key_novel`（原本只能在「API 连接 → NovelAI」聊天接口处填写）。本插件把这个密钥的输入框直接注入到「图像生成 → 来源选 NovelAI」的界面里，并在扩展设置里提供一个备用面板。密钥与聊天接口共用，互不影响。

## 功能

- 图像生成面板选中 NovelAI 时，顶部出现 API Key 输入框 + 保存 / 删除按钮
- 扩展设置里新增「NovelAI 图像生成密钥」抽屉面板
- 实时显示密钥状态（已保存 / 未保存）

## 安装

方式一（推荐，手机端可用）：
1. 把 `NovelAI-ImageKey` 文件夹上传到一个 GitHub / Gitee 仓库（仓库根目录直接放 manifest.json 等文件）。
2. 在 TauriTavern 里打开 扩展 → 下载扩展与资源 → 从 URL 安装，填入仓库地址。

方式二（能访问文件系统时）：
- 把整个文件夹复制到 SillyTavern 的 `public/scripts/extensions/third-party/NovelAI-ImageKey`，重启或刷新页面。

## 使用

1. 打开 扩展 → 图像生成，来源选择 NovelAI Diffusion。
2. 在顶部出现的输入框粘贴你的 NovelAI API Key（`pst-` 开头，获取方式：NovelAI 官网 → 设置 → Account → Get Persistent API Token）。
3. 点击保存，状态变为「已保存」后即可正常出图。
