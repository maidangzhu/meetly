use anyhow::{anyhow, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, SampleFormat, Stream, SupportedStreamConfig};
use ringbuf::{
    traits::{Consumer, Producer, Split},
    HeapCons, HeapRb,
};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

const BUFFER_SAMPLES: usize = 48_000 * 8;

pub struct MicrophoneStream {
    consumer: HeapCons<f32>,
    _stream: Stream,
    sample_rate: u32,
    device_name: String,
}

impl MicrophoneStream {
    pub fn new() -> Result<Self> {
        let host = cpal::default_host();
        let device = select_safe_input_device(&host)?;
        let device_name = device
            .name()
            .unwrap_or_else(|_| "Default microphone".to_string());
        let config = pick_supported_config(&device)?;
        let sample_rate = config.sample_rate().0;
        let channels = config.channels() as usize;
        let ring = HeapRb::<f32>::new(BUFFER_SAMPLES);
        let (producer, consumer) = ring.split();
        let dropped = Arc::new(AtomicUsize::new(0));

        let stream = build_input_stream(&device, &config, producer, channels, dropped.clone())?;
        stream
            .play()
            .map_err(|error| anyhow!("Failed to start native microphone: {error}"))?;

        tracing::info!(
            device = %device_name,
            sample_rate,
            channels,
            "native microphone capture started"
        );

        Ok(Self {
            consumer,
            _stream: stream,
            sample_rate,
            device_name,
        })
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn device_name(&self) -> &str {
        &self.device_name
    }

    pub fn read_samples(&mut self, output: &mut [f32]) -> usize {
        self.consumer.pop_slice(output)
    }
}

fn select_safe_input_device(host: &cpal::Host) -> Result<Device> {
    let default = host
        .default_input_device()
        .ok_or_else(|| anyhow!("No microphone input device found"))?;
    let default_name = default.name().unwrap_or_default();

    if !is_bluetooth_device(&default_name) {
        return Ok(default);
    }

    if let Ok(devices) = host.input_devices() {
        for device in devices {
            let name = device.name().unwrap_or_default();
            if is_builtin_microphone(&name) {
                tracing::info!(
                    default_device = %default_name,
                    selected_device = %name,
                    "using built-in microphone to avoid Bluetooth headset profile"
                );
                return Ok(device);
            }
        }
    }

    Ok(default)
}

fn is_bluetooth_device(name: &str) -> bool {
    let name = name.to_lowercase();
    ["airpods", "bluetooth", "beats", "buds"]
        .iter()
        .any(|part| name.contains(part))
}

fn is_builtin_microphone(name: &str) -> bool {
    let name = name.to_lowercase();
    ["macbook", "built-in", "built in", "内建", "内置"]
        .iter()
        .any(|part| name.contains(part))
        && ["microphone", "麦克风"]
            .iter()
            .any(|part| name.contains(part))
}

fn pick_supported_config(device: &Device) -> Result<SupportedStreamConfig> {
    let default = device
        .default_input_config()
        .map_err(|error| anyhow!("Failed to read microphone format: {error}"))?;
    if matches!(
        default.sample_format(),
        SampleFormat::F32 | SampleFormat::I16 | SampleFormat::I32
    ) {
        return Ok(default);
    }

    let configs: Vec<_> = device
        .supported_input_configs()
        .map_err(|error| anyhow!("Failed to list microphone formats: {error}"))?
        .collect();

    for format in [SampleFormat::F32, SampleFormat::I16, SampleFormat::I32] {
        if let Some(range) = configs.iter().find(|range| range.sample_format() == format) {
            let rate = range
                .max_sample_rate()
                .0
                .min(48_000)
                .max(range.min_sample_rate().0);
            return Ok(range.clone().with_sample_rate(cpal::SampleRate(rate)));
        }
    }

    Err(anyhow!(
        "Microphone has no supported F32/I16/I32 input format"
    ))
}

fn build_input_stream(
    device: &Device,
    config: &SupportedStreamConfig,
    producer: ringbuf::HeapProd<f32>,
    channels: usize,
    dropped: Arc<AtomicUsize>,
) -> Result<Stream> {
    let stream_config = config.clone().into();
    let error_handler = |error| tracing::error!(%error, "native microphone stream error");

    macro_rules! input_stream {
        ($sample:ty, $convert:expr) => {{
            let mut producer = producer;
            let dropped = dropped;
            device.build_input_stream(
                &stream_config,
                move |data: &[$sample], _| {
                    for frame in data.chunks(channels.max(1)) {
                        let sample = $convert(frame[0]);
                        if producer.try_push(sample).is_err() {
                            dropped.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                },
                error_handler,
                None,
            )?
        }};
    }

    Ok(match config.sample_format() {
        SampleFormat::F32 => input_stream!(f32, |sample: f32| sample),
        SampleFormat::I16 => input_stream!(i16, |sample: i16| sample as f32 / i16::MAX as f32),
        SampleFormat::I32 => input_stream!(i32, |sample: i32| sample as f32 / i32::MAX as f32),
        format => return Err(anyhow!("Unsupported microphone format: {format:?}")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_bluetooth_inputs() {
        assert!(is_bluetooth_device("Jane's AirPods Pro"));
        assert!(is_bluetooth_device("Bluetooth Headset"));
        assert!(!is_bluetooth_device("MacBook Pro Microphone"));
    }

    #[test]
    fn recognizes_localized_builtin_microphones() {
        assert!(is_builtin_microphone("MacBook Pro Microphone"));
        assert!(is_builtin_microphone("MacBook Pro 麦克风"));
        assert!(is_builtin_microphone("内建麦克风"));
    }
}
