# 模型与转写配置

Meetly 有两种 BYOK 配置：语音转写（STT）和语言模型（LLM）。它们各自保存 base URL、模型和 API Key。产品只有一条链路：会议音频变成转写，转写按所选行业变成术语卡。

```text
设置窗口
  -> STT 配置 + LLM 配置
  -> 本机密钥存储

会议音频
  -> STT 适配器
  -> transcript_final

行业 + 新转写
  -> LLM 适配器
  -> { terms: [...] }
```

适配器只负责请求格式、鉴权和错误。它不知道悬浮窗，也不保存术语。行业和「没有术语就安静」是术语请求自己的提示词，不是 provider 层的策略。

当前 LLM 适配器是 OpenAI-compatible Chat Completions。默认示例是硅基流动上的 `Qwen/Qwen3-32B`，用户可以改 base URL 和模型。

当前 STT 适配器：

- OpenAI-compatible 批量转写。默认示例是硅基流动上的 `FunAudioLLM/SenseVoiceSmall`。
- Xiaomi MiMo 批量转写，模型示例 `mimo-v2.5-asr`。只用于 STT。

设置页可以分别测试 STT 和 LLM 是否连通。测试 LLM 只确认端点有响应，不会生成术语卡。

没有网页搜索，也没有第二套给提问或听写使用的模型配置。
