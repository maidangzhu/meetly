#[cfg(not(target_os = "macos"))]
use anyhow::anyhow;
use anyhow::Result;
use futures_util::Stream;
use std::pin::Pin;

mod async_ring;
#[cfg(target_os = "macos")]
mod macos;
mod rt_ring;

const CHUNK_SIZE: usize = 256;
const BUFFER_SIZE: usize = CHUNK_SIZE * 256;

#[derive(Debug, Default)]
pub struct DeviceProbe {
    pub input_device: Option<String>,
    pub output_device: Option<String>,
    pub error: Option<String>,
}

pub fn probe_devices() -> DeviceProbe {
    #[cfg(target_os = "macos")]
    {
        return macos::probe_devices();
    }

    #[cfg(not(target_os = "macos"))]
    {
        DeviceProbe {
            error: Some("System audio capture is only implemented on macOS for M3.".to_string()),
            ..DeviceProbe::default()
        }
    }
}

pub struct SpeakerInput {
    #[cfg(target_os = "macos")]
    inner: macos::SpeakerInput,
}

impl SpeakerInput {
    pub fn new(device_id: Option<String>) -> Result<Self> {
        #[cfg(target_os = "macos")]
        {
            return Ok(Self {
                inner: macos::SpeakerInput::new(device_id)?,
            });
        }

        #[cfg(not(target_os = "macos"))]
        {
            let _ = device_id;
            Err(anyhow!(
                "System audio capture is only implemented on macOS for M3."
            ))
        }
    }

    pub fn stream(self) -> Result<SpeakerStream> {
        #[cfg(target_os = "macos")]
        {
            return Ok(SpeakerStream {
                inner: self.inner.stream()?,
            });
        }

        #[cfg(not(target_os = "macos"))]
        {
            Err(anyhow!(
                "System audio capture is only implemented on macOS for M3."
            ))
        }
    }
}

pub struct SpeakerStream {
    #[cfg(target_os = "macos")]
    inner: macos::SpeakerStream,
}

impl SpeakerStream {
    pub fn sample_rate(&self) -> u32 {
        #[cfg(target_os = "macos")]
        {
            return self.inner.sample_rate();
        }

        #[cfg(not(target_os = "macos"))]
        {
            0
        }
    }
}

impl Stream for SpeakerStream {
    type Item = f32;

    fn poll_next(
        mut self: Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        #[cfg(target_os = "macos")]
        {
            return Pin::new(&mut self.inner).poll_next(cx);
        }

        #[cfg(not(target_os = "macos"))]
        {
            let _ = cx;
            std::task::Poll::Ready(None)
        }
    }
}
