# STT Providers

> Historical note (2026-07-16): this document records the early Meeting
> realtime-STT provider direction. The shared ASR/LLM registry, provider
> profiles, capability discovery, normalized errors, and Dictation provider
> migration are now defined in
> [`PROVIDER_ARCHITECTURE.md`](./PROVIDER_ARCHITECTURE.md) and
> [`VOICE_DICTATION_RUNTIME_DESIGN.md`](./VOICE_DICTATION_RUNTIME_DESIGN.md).
> The first shared registry slice is now implemented with OpenAI-compatible
> batch ASR and Xiaomi MiMo batch ASR. Realtime provider work remains planned.

## 1. 结论

第一版只接一个国内实时 STT：阿里云百炼/Model Studio 实时语音识别。

不要第一版同时接五家。Provider 太多会把时间消耗在配置、签名、异常处理和 UI 上，而不是验证核心产品链路。

## 2. P0: 阿里云百炼 / Model Studio 实时语音识别

官方文档：

- User guide: https://www.alibabacloud.com/help/en/model-studio/real-time-speech-recognition-user-guide
- Paraformer API reference: https://help.aliyun.com/en/model-studio/paraformer-real-time-speech-recognition-api-reference/
- STT model list: https://www.alibabacloud.com/help/en/model-studio/asr-model

适合原因：

- WebSocket 实时协议。
- 支持中文普通话和部分方言。
- 文档明确说明适合 live captioning、meeting transcription 等实时场景。
- API Key 模型适合桌面端 MVP 配置。

技术形态：

```text
Audio Capture
  -> PCM frame
  -> VAD segment
  -> WebSocket send audio
  -> partial/final transcript
  -> UI ticker + context buffer
```

音频建议：

- PCM
- mono
- 16kHz
- 16-bit
- 小 chunk 流式发送

事件映射：

| Provider event | 内部事件 |
|---|---|
| task-started | connected |
| result-generated interim | Partial |
| result-generated final | Final |
| task-finished | SegmentClosed |
| task-failed | Error |

配置项：

```json
{
  "provider": "aliyun_modelstudio_realtime",
  "api_key": "stored_in_secure_storage",
  "model": "paraformer-realtime-v2",
  "sample_rate": 16000,
  "format": "pcm"
}
```

注意：

- 具体模型名要在实现当天按阿里云控制台和文档确认。代码里不要写死单一模型，设置页必须允许修改。
- STT Provider 的错误码必须原样保留到诊断页，便于用户判断是认证、欠费、限流还是参数错误。

## 3. P1: 腾讯云实时语音识别

官方文档：

- API description: https://www.tencentcloud.com/document/product/1118/53937
- API list: https://www.tencentcloud.com/document/product/1118/53936

适合原因：

- WebSocket 实时语音识别。
- 国内云服务，中文场景稳定。

不放 P0 的原因：

- 签名和鉴权配置相对更重。
- 第一版不需要多 Provider 分散注意力。

Provider 预留：

```rust
pub struct TencentRealtimeAsrProvider {
    app_id: String,
    secret_id: String,
    secret_key: SecretString,
}
```

## 4. P1/P2: 其他国内 Provider

可以后续加入：

- 火山引擎实时语音识别。
- 讯飞实时语音转写。
- 百度智能云实时语音识别。

加入条件：

- 有明确 WebSocket/streaming API。
- 支持 PCM 实时输入。
- 支持中间结果。
- 错误码可诊断。
- 成本可控。

## 5. P2: 本地 Whisper

第一版不做本地 Whisper。

原因：

- 模型下载和首次配置复杂。
- 包体增大。
- CPU 实时性不稳定。
- Apple Silicon 可优化，但要引入更多 native 推理工程。
- 用户第一版最需要的是“稳定实时可用”，不是完全离线。

后续实现路径：

- `whisper.cpp` 或 `faster-whisper`。
- macOS Apple Silicon 使用 Metal 加速。
- 提供 small/base/medium 模型选择。
- 设置页加入模型下载、磁盘占用、实时系数测试。

## 6. Provider 抽象

Rust trait：

```rust
#[async_trait::async_trait]
pub trait SttProvider: Send {
    async fn start(&mut self, config: SttConfig) -> anyhow::Result<()>;
    async fn push_audio(&mut self, chunk: AudioChunk) -> anyhow::Result<()>;
    async fn stop_segment(&mut self) -> anyhow::Result<()>;
    async fn shutdown(&mut self) -> anyhow::Result<()>;
    fn event_receiver(&mut self) -> SttEventReceiver;
}
```

内部数据结构：

```rust
pub struct AudioChunk {
    pub pcm: Vec<i16>,
    pub sample_rate: u32,
    pub channels: u16,
    pub timestamp_ms: u64,
}

pub enum SttEvent {
    Partial { text: String, timestamp_ms: u64 },
    Final { text: String, start_ms: u64, end_ms: u64 },
    Error { code: String, message: String },
}
```

前端只消费统一事件，不感知具体 Provider。

## 7. 成本控制

第一版策略：

- 静音不发送。
- 单段最长 15 秒。
- 长会议只保留最近上下文。
- 用户暂停监听时立即关闭 STT WebSocket。

后续策略：

- 本地 VAD 更精确。
- 会议结束后不自动转写全量。
- 对低价值片段不送 LLM。
