use super::async_ring::RingbufAsyncReader;
use super::{rt_ring, DeviceProbe, BUFFER_SIZE, CHUNK_SIZE};
use anyhow::Result;
use ca::aggregate_device_keys as agg_keys;
use cidre::{arc, av, cat, cf, core_audio as ca, ns, os};
use futures_util::task::AtomicWaker;
use futures_util::Stream;
use ringbuf::{traits::Split, HeapCons, HeapProd, HeapRb};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::task::Poll;

pub fn probe_devices() -> DeviceProbe {
    let input_device = ca::System::default_input_device()
        .ok()
        .and_then(|device| device.name().ok())
        .map(|name| name.to_string());
    let output_device = ca::System::default_output_device()
        .ok()
        .and_then(|device| device.name().ok())
        .map(|name| name.to_string());

    DeviceProbe {
        input_device,
        output_device,
        error: None,
    }
}

pub struct SpeakerInput {
    tap: ca::TapGuard,
    aggregate_description: arc::Retained<cf::DictionaryOf<cf::String, cf::Type>>,
}

pub struct SpeakerStream {
    reader: RingbufAsyncReader<HeapCons<f32>>,
    _device: ca::hardware::StartedDevice<ca::AggregateDevice>,
    _context: Box<CaptureContext>,
    _tap: ca::TapGuard,
    current_sample_rate: u32,
    sample_rate_probe_counter: u32,
    buffer_rate: u32,
}

impl SpeakerStream {
    pub fn sample_rate(&self) -> u32 {
        self.buffer_rate
    }
}

struct CaptureContext {
    common_format: av::audio::CommonFormat,
    producer: HeapProd<f32>,
    waker: Arc<AtomicWaker>,
    wake_pending: Arc<AtomicBool>,
    dropped_samples: Arc<AtomicUsize>,
    conversion_buffer: Vec<f32>,
}

impl SpeakerInput {
    pub fn new(_device_id: Option<String>) -> Result<Self> {
        // The aggregate device below must include the real default output
        // device as a sub-device (and as `main_sub_device`, its clock
        // source) — a tap-only aggregate with no real hardware sub-device
        // has no clock source, so `AudioDeviceStart` on it does not
        // reliably drive the IOProc callback and macOS does not show the
        // system-audio-recording privacy indicator. This mirrors
        // pluely-master's `SpeakerInput::new`
        // (src-tauri/src/speaker/macos.rs), which is the reference
        // implementation this project already decided to follow (see
        // docs/TECHNICAL_DESIGN.md section 4.3, "Core Audio Process Tap +
        // Aggregate Device").
        let output_device = ca::System::default_output_device()?;
        let output_uid = output_device.uid()?;

        let sub_device = cf::DictionaryOf::with_keys_values(
            &[ca::sub_device_keys::uid()],
            &[output_uid.as_type_ref()],
        );

        let tap_description =
            ca::TapDesc::with_mono_global_tap_excluding_processes(&ns::Array::new());
        let tap = tap_description.create_process_tap()?;

        let sub_tap = cf::DictionaryOf::with_keys_values(
            &[ca::sub_device_keys::uid()],
            &[tap.uid()?.as_type_ref()],
        );

        let aggregate_description = cf::DictionaryOf::with_keys_values(
            &[
                agg_keys::is_private(),
                agg_keys::is_stacked(),
                agg_keys::tap_auto_start(),
                agg_keys::name(),
                agg_keys::main_sub_device(),
                agg_keys::uid(),
                agg_keys::sub_device_list(),
                agg_keys::tap_list(),
            ],
            &[
                cf::Boolean::value_true().as_type_ref(),
                cf::Boolean::value_false(),
                cf::Boolean::value_true(),
                cf::str!(c"meetly-system-audio-tap"),
                &output_uid,
                &cf::Uuid::new().to_cf_string(),
                &cf::ArrayOf::from_slice(&[sub_device.as_ref()]),
                &cf::ArrayOf::from_slice(&[sub_tap.as_ref()]),
            ],
        );

        Ok(Self {
            tap,
            aggregate_description,
        })
    }

    pub fn stream(self) -> Result<SpeakerStream> {
        let asbd = self.tap.asbd()?;
        let format = av::AudioFormat::with_asbd(&asbd).unwrap();
        let common_format = format.common_format();
        let ring_buffer = HeapRb::<f32>::new(BUFFER_SIZE);
        let (producer, consumer) = ring_buffer.split();

        let waker = Arc::new(AtomicWaker::new());
        let wake_pending = Arc::new(AtomicBool::new(false));
        let current_sample_rate = asbd.sample_rate as u32;
        let dropped_samples = Arc::new(AtomicUsize::new(0));

        let mut context = Box::new(CaptureContext {
            common_format,
            producer,
            waker: waker.clone(),
            wake_pending: wake_pending.clone(),
            dropped_samples: dropped_samples.clone(),
            conversion_buffer: vec![0.0; rt_ring::DEFAULT_SCRATCH_LEN],
        });

        let device = self.start_device(&mut context)?;

        Ok(SpeakerStream {
            reader: RingbufAsyncReader::new(consumer, waker, wake_pending, vec![0.0; CHUNK_SIZE])
                .with_dropped_samples(dropped_samples),
            _device: device,
            _context: context,
            _tap: self.tap,
            current_sample_rate,
            sample_rate_probe_counter: 0,
            buffer_rate: current_sample_rate,
        })
    }

    fn start_device(
        &self,
        context: &mut Box<CaptureContext>,
    ) -> Result<ca::hardware::StartedDevice<ca::AggregateDevice>> {
        extern "C" fn proc(
            _device: ca::Device,
            _now: &cat::AudioTimeStamp,
            input_data: &cat::AudioBufList<1>,
            _input_time: &cat::AudioTimeStamp,
            _output_data: &mut cat::AudioBufList<1>,
            _output_time: &cat::AudioTimeStamp,
            context: Option<&mut CaptureContext>,
        ) -> os::Status {
            let Some(context) = context else {
                return os::Status::NO_ERR;
            };

            let first_buffer = &input_data.buffers[0];

            if first_buffer.data_bytes_size == 0 || first_buffer.data.is_null() {
                return os::Status::NO_ERR;
            }

            match context.common_format {
                av::audio::CommonFormat::PcmF32 => {
                    if let Some(samples) = read_samples::<f32>(first_buffer) {
                        process_audio_data_rt_safe(context, samples);
                    }
                }
                av::audio::CommonFormat::PcmF64 => {
                    process_samples_rt_safe::<f64>(context, first_buffer, |sample| sample as f32);
                }
                av::audio::CommonFormat::PcmI32 => {
                    process_samples_rt_safe::<i32>(context, first_buffer, |sample| {
                        sample as f32 / i32::MAX as f32
                    });
                }
                av::audio::CommonFormat::PcmI16 => {
                    process_samples_rt_safe::<i16>(context, first_buffer, |sample| {
                        sample as f32 / i16::MAX as f32
                    });
                }
                _ => {}
            }

            os::Status::NO_ERR
        }

        let aggregate_device = ca::AggregateDevice::with_desc(&self.aggregate_description)?;
        let proc_id = aggregate_device.create_io_proc_id(proc, Some(context))?;
        Ok(ca::device_start(aggregate_device, Some(proc_id))?)
    }
}

fn read_samples<T: Copy>(buffer: &cat::AudioBuf) -> Option<&[T]> {
    let byte_count = buffer.data_bytes_size as usize;

    if byte_count == 0 || buffer.data.is_null() {
        return None;
    }

    let data = buffer.data as *const T;
    if !(data as usize).is_multiple_of(std::mem::align_of::<T>()) {
        return None;
    }

    let sample_count = byte_count / std::mem::size_of::<T>();
    if sample_count == 0 {
        return None;
    }

    Some(unsafe { std::slice::from_raw_parts(data, sample_count) })
}

fn process_samples_rt_safe<T>(
    context: &mut CaptureContext,
    buffer: &cat::AudioBuf,
    convert: impl FnMut(T) -> f32,
) where
    T: Copy + 'static,
{
    let Some(samples) = read_samples::<T>(buffer) else {
        return;
    };

    let stats = rt_ring::convert_and_push_to_ringbuf(
        samples,
        &mut context.conversion_buffer,
        &mut context.producer,
        convert,
    );

    after_push(context, stats);
}

fn process_audio_data_rt_safe(context: &mut CaptureContext, data: &[f32]) {
    let stats = rt_ring::push_f32_to_ringbuf(data, &mut context.producer);
    after_push(context, stats);
}

fn after_push(context: &mut CaptureContext, stats: rt_ring::PushStats) {
    if stats.dropped > 0 {
        context
            .dropped_samples
            .fetch_add(stats.dropped, Ordering::Relaxed);
    }

    if stats.pushed > 0 && context.wake_pending.load(Ordering::Acquire) {
        context.wake_pending.store(false, Ordering::Release);
        context.waker.wake();
    }
}

impl Stream for SpeakerStream {
    type Item = f32;

    fn poll_next(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> Poll<Option<Self::Item>> {
        let this = &mut *self;

        if !this.reader.has_buffered_samples() {
            const SAMPLE_RATE_PROBE_INTERVAL: u32 = 128;
            this.sample_rate_probe_counter = this.sample_rate_probe_counter.wrapping_add(1);

            if this
                .sample_rate_probe_counter
                .is_multiple_of(SAMPLE_RATE_PROBE_INTERVAL)
            {
                let after = this._tap.asbd().unwrap().sample_rate as u32;
                if this.current_sample_rate != after {
                    this.current_sample_rate = after;
                }
            }
        }

        let result = this.reader.poll_next_sample(cx);
        if result.did_pop_chunk {
            this.buffer_rate = this.current_sample_rate;
        }

        result.poll
    }
}

impl Drop for SpeakerStream {
    fn drop(&mut self) {
        tracing::debug!("SpeakerStream dropping");
    }
}
