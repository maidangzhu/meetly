# 技术设计

Meetly 是 Tauri v2 + Rust + React/TypeScript 应用，用 pnpm 和 Vite 构建。macOS 悬浮窗负责展示，Rust 负责采集声音、转写和术语请求。

## 运行时

```text
菜单栏设置窗口
  行业、STT、LLM、音频状态

悬浮岛
  未听：行业名，点击后选择行业和远程/现场
  在听且没有术语：正在听 + 行业名
  出现术语：大字术语卡 + 本场已解释列表
```

远程会议调用 `start_meeting_capture { remote: true }`，同时采集系统音频和麦克风。现场会议 `remote: false`，只采集麦克风。系统音频在本地做 VAD，切成片段后用已保存的 STT 配置做批量转写，再发出 `transcript_final`。

前端收到一句新转写后调用 `explain_transcript_terms`。请求带上这次选择的行业字符串和转写文本。Rust 用已保存的 LLM 配置发一次补全，系统提示要求只按该行业返回 JSON。解析失败、模型失败，或结果为空时，不展示卡片。缺 API Key 时只在悬浮窗上给一行短提示。

本场去重在前端完成：术语去掉空格和标点并转成小写后，相同的词只保留第一次解释。

行业选择存在本机 `~/.meetly/app_state.json` 的 `industry_preset_id` 和 `industry_custom_text`。预设 id 为 `cro`、`it`、`architecture`、`commerce`、`finance`、`healthcare`、`manufacturing`、`education`，自填为 `custom`。发给模型的是解析后的行业文字，不是 id，也不是一张写死的术语表。

## 术语 JSON

系统提示要求模型只返回：

```json
{ "terms": [{ "term": "CTA", "explanation": "一两句口语中文。" }] }
```

没有术语时返回 `{ "terms": [] }`。提示词写明：CRO / 临床研究里的 CTA 是临床试验助理；电商里的 CTA 可以是行动号召；其他行业不要套用这两个展开；两种意思都说得通就返回空列表。代码不会因为术语是 CTA 就改写模型的句子。

## 窗口

收起时悬浮岛大约 600×54。出现术语卡或打开开场选择时，高度超过 54，宽度变为大约 920。设置是另一个普通窗口，不嵌在会议界面里。

## 密钥

STT 和 LLM 分开配置。当前适配器是 OpenAI-compatible，STT 还可以选 Xiaomi MiMo。密钥不放进仓库。详见 [PROVIDER_ARCHITECTURE.md](./PROVIDER_ARCHITECTURE.md) 和 [STT_PROVIDERS.md](./STT_PROVIDERS.md)。
