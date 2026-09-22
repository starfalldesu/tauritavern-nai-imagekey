# NovelAI Image Key & Generator

给 TauriTavern / SillyTavern 用的 NovelAI 插件：密钥管理 + 校验 + **完整直出生图**。

## 为什么需要它

TauriTavern 目前（v2.3.0）只在前端保留了 NovelAI 生图入口，但 Rust 后端**没有实现** `/api/novelai/generate-image` 和 `/api/novelai/status`，选 NovelAI 出图会 404。本插件完全绕过酒馆后端，从浏览器/WebView 直连 NovelAI 官方图片接口（`image.novelai.net`），自己完成请求、解包和展示。

## 功能

- 图像生成面板选中 NovelAI 时，注入完整面板：
  - API Key 输入（明文）+ 保存 / 校验 / 删除
  - 校验：调 NovelAI 订阅接口，显示档位 / 是否无限生图 / Anlas 余额
  - 直出生图：提示词、负面词、模型（4.5 Full / 4.5 Curated / 4 / 3 / Furry 3）、尺寸、步数、引导系数、采样器、噪声表、种子、Anlas 守护
  - 结果预览 + 下载（自动解包 NovelAI 返回的 zip）
- 扩展设置抽屉：密钥管理 + 反代地址配置
- 密钥与「API 连接 → NovelAI」聊天接口共用同一把 `api_key_novel`，互不影响
- 注意：TauriTavern 默认禁止前端读回密钥值，所以插件在保存时会额外存一份本地副本（localStorage）供直连生图使用；**必须在插件面板里粘贴保存一次**才能生图

## 对话中生图

TauriTavern 原生的对话内生成（/sd、图片按钮）走的是后端 NovelAI 接口，但该实现有 bug（NovelAI 返回 zip，后端按 base64 解码导致 `Invalid symbol` 报错）。本插件提供两条替代通道：

1. **面板生成后点「发送到聊天」**：图片保存到酒馆图库并作为一条带图消息插入当前聊天
2. **斜杠命令 `/nai`**：在对话输入框直接输入 `/nai 提示词`，生成后自动发送到聊天（模型、尺寸等参数沿用图像生成面板里的当前设置）
3. **对话总结生图**（图像生成面板底部）：
   - 「总结为提示词」：用当前连接的聊天 AI 把最近 N 条对话总结成 NovelAI 英文 tag 提示词，写入提示词框供你编辑
   - 「总结并直接生成」：总结后立刻生成
   - 可设置取最近多少条消息（默认 15）、附加风格词（如 `masterpiece, best quality`），两者会自动记住
   - 总结用的是你聊天时连接的模型（聊天接口），生图走的是插件直连 NovelAI，全程不经过酒馆坏掉的生图后端

## 网络说明（重要）

**校验 Key 无需代理**：校验会借道 TauriTavern 已实现的 NovelAI 语音接口（同源请求、Rust 端出站、不消耗 Anlas），任何网络环境下都能用。

**生图**：NovelAI 在国内被墙，且其接口不允许浏览器跨域调用（带 Authorization 的请求会被预检拦截，**VPN 也解决不了 CORS**）。插件按以下顺序自动尝试：

1. Tauri 原生 HTTP（如环境支持，无 CORS）
2. **自建反代**（在面板里填反代地址后优先生效，同时绕开墙和 CORS）
3. 浏览器直连（仅在 NovelAI 放开 CORS 且网络可达时可用）

结论：国内用户生图基本必须配置反代。

### 自建反代（Cloudflare Worker，免费）

1. 打开 workers.cloudflare.com，注册并创建一个 Worker
2. 把本仓库 `worker.js` 的内容完整粘贴进去，部署
3. 得到形如 `https://xxx.your-name.workers.dev` 的地址
4. 在插件面板的「反代地址」里填入该地址，点保存

Worker 只转发 `image.novelai.net` 和 `api.novelai.net` 两个上游，Authorization 头原样透传，不记录任何内容。

## 安装

1. 在 TauriTavern 里打开 扩展 → 下载扩展与资源 → 从 URL 安装，填入仓库地址
   （国内 GitHub 不通时可用代理前缀：`https://gh-proxy.com/https://github.com/<你的仓库>`）
2. 装好后刷新页面

## 使用

1. 打开 扩展 → 图像生成，来源选择 NovelAI Diffusion
2. 在顶部面板粘贴 API Key（`pst-` 开头，NovelAI 官网 → 设置 → Account → Get Persistent API Token），点保存
3. 点「校验」确认 Key 可用（可选）
4. 填提示词，点「生成图片」

## 注意

- 生图消耗 Anlas（除非订阅档位支持无限生图）。「Anlas 守护」会把步数限制在 28 并提示超大尺寸
- 生成的图片只存在内存中，记得点「下载图片」保存
