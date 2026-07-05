//! WAV encoding for VAD-detected speech segments. Ports the shape of
//! pluely-master's `samples_to_wav_b64`
//! (src-tauri/src/speaker/commands.rs:421-459), minus the base64 step: we
//! send raw multipart bytes to the STT endpoint instead of a base64 Tauri
//! event payload.

use anyhow::{bail, Result};
use std::io::Cursor;

/// Encodes mono `f32` samples (range roughly [-1.0, 1.0]) as a 16-bit PCM
/// WAV file in memory.
pub fn encode_wav(sample_rate: u32, samples: &[f32]) -> Result<Vec<u8>> {
    if !(8_000..=96_000).contains(&sample_rate) {
        bail!("Invalid sample rate for WAV encoding: {sample_rate}");
    }
    if samples.is_empty() {
        bail!("Cannot encode an empty audio segment");
    }

    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = hound::WavWriter::new(&mut cursor, spec)?;
        for &sample in samples {
            let clamped = sample.clamp(-1.0, 1.0);
            let as_i16 = (clamped * i16::MAX as f32) as i16;
            writer.write_sample(as_i16)?;
        }
        writer.finalize()?;
    }

    Ok(cursor.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_segment() {
        let result = encode_wav(16_000, &[]);
        assert!(result.is_err());
    }

    #[test]
    fn rejects_invalid_sample_rate() {
        let result = encode_wav(1, &[0.1, 0.2]);
        assert!(result.is_err());
    }

    #[test]
    fn encodes_valid_segment() {
        let samples = vec![0.0, 0.5, -0.5, 1.0, -1.0];
        let bytes = encode_wav(16_000, &samples).expect("should encode");
        assert!(!bytes.is_empty());
        // WAV files start with the RIFF magic bytes.
        assert_eq!(&bytes[0..4], b"RIFF");
    }
}
