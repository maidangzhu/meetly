# 语音转写

转写是术语卡的触发器。Meetly 不把会议音频流式推给一家固定的实时识别服务，而是在本地把系统音频或麦克风切成片段，再交给用户配置的批量 STT。

## 现在接上的提供方

两种，都在设置窗口里选择：

| 提供方 | 用途 | 默认端点示例 | 默认模型示例 |
|---|---|---|---|
| OpenAI-compatible | 批量转写 | `https://api.siliconflow.cn/v1/audio/transcriptions` | `FunAudioLLM/SenseVoiceSmall` |
| Xiaomi MiMo | 批量转写 | `https://api.xiaomimimo.com/v1/chat/completions` | `mimo-v2.5-asr` |

用户可以改 base URL 和模型。API Key 只存在本机。STT 和 LLM 的密钥互不影响。

送去转写的片段是 WAV。空文本不会发 `transcript_final`。转写失败会在悬浮窗上显示短的转写异常，不会假装已经听懂。

## 和术语卡的边界

STT 只产出文字。它不决定这句话里有没有行业术语，也不知道 CTA 在 CRO 里是临床试验助理。这个判断在 LLM 请求里，并且必须带上用户选中的行业。
