use super::BatchAsrRequest;
use anyhow::{anyhow, bail, Context, Result};
use std::io::Cursor;
use symphonia::core::audio::{SampleBuffer, SignalSpec};
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::{MediaSourceStream, MediaSourceStreamOptions};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

const TARGET_SAMPLE_RATE: u32 = 16_000;

pub fn normalize_to_wav_16k_mono(request: BatchAsrRequest) -> Result<Vec<u8>> {
    let (sample_rate, mono_samples) = decode_mono(request)?;
    let samples = resample_linear(&mono_samples, sample_rate, TARGET_SAMPLE_RATE)?;
    crate::audio::wav::encode_wav(TARGET_SAMPLE_RATE, &samples)
}

fn decode_mono(request: BatchAsrRequest) -> Result<(u32, Vec<f32>)> {
    if request.audio_bytes.is_empty() {
        bail!("Cannot normalize empty audio.");
    }

    let mut hint = Hint::new();
    if let Some(extension) = request.filename.rsplit('.').next() {
        hint.with_extension(extension);
    }
    if let Some(subtype) = request.mime_type.split('/').nth(1) {
        hint.with_extension(subtype.split(';').next().unwrap_or(subtype));
    }

    let source = MediaSourceStream::new(
        Box::new(Cursor::new(request.audio_bytes)),
        MediaSourceStreamOptions::default(),
    );
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            source,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .context("Unsupported or invalid audio container")?;
    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| anyhow!("Audio container has no decodable track"))?;
    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .context("Unsupported audio codec")?;
    let mut output = Vec::new();
    let mut source_rate = None;

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(error))
                if error.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break
            }
            Err(error) => return Err(error).context("Failed to read audio packet"),
        };
        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(error) => return Err(error).context("Failed to decode audio packet"),
        };
        let spec = *decoded.spec();
        if let Some(rate) = source_rate {
            if rate != spec.rate {
                bail!("Audio sample rate changed during the clip");
            }
        } else {
            source_rate = Some(spec.rate);
        }
        append_mono(&mut output, decoded, spec);
    }

    if output.is_empty() {
        bail!("Audio decoder returned no samples");
    }
    Ok((source_rate.unwrap_or(TARGET_SAMPLE_RATE), output))
}

fn append_mono(
    output: &mut Vec<f32>,
    decoded: symphonia::core::audio::AudioBufferRef<'_>,
    spec: SignalSpec,
) {
    let channels = spec.channels.count();
    let mut samples = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
    samples.copy_interleaved_ref(decoded);
    for frame in samples.samples().chunks(channels) {
        output.push(frame.iter().sum::<f32>() / channels as f32);
    }
}

fn resample_linear(samples: &[f32], source_rate: u32, target_rate: u32) -> Result<Vec<f32>> {
    if source_rate == 0 || target_rate == 0 {
        bail!("Audio sample rate must be non-zero");
    }
    if source_rate == target_rate {
        return Ok(samples.to_vec());
    }

    let output_len = ((samples.len() as u64 * target_rate as u64) / source_rate as u64) as usize;
    let mut output = Vec::with_capacity(output_len);
    for index in 0..output_len {
        let position = index as f64 * source_rate as f64 / target_rate as f64;
        let left = position.floor() as usize;
        let right = (left + 1).min(samples.len() - 1);
        let fraction = (position - left as f64) as f32;
        output.push(samples[left] * (1.0 - fraction) + samples[right] * fraction);
    }
    Ok(output)
}

pub fn silence_probe_wav() -> Vec<u8> {
    crate::audio::wav::encode_wav(TARGET_SAMPLE_RATE, &vec![0.0; 3_200])
        .expect("silence probe WAV must encode")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_wav_to_16k_mono() {
        let input = crate::audio::wav::encode_wav(48_000, &vec![0.25; 4_800]).unwrap();
        let normalized =
            normalize_to_wav_16k_mono(BatchAsrRequest::new(input, "input.wav", "audio/wav"))
                .unwrap();
        let reader = hound::WavReader::new(Cursor::new(normalized)).unwrap();
        assert_eq!(reader.spec().sample_rate, TARGET_SAMPLE_RATE);
        assert_eq!(reader.spec().channels, 1);
        assert_eq!(reader.duration(), 1_600);
    }

    #[test]
    fn three_minute_wav_fits_mimo_base64_limit() {
        let bytes = crate::audio::wav::encode_wav(
            TARGET_SAMPLE_RATE,
            &vec![0.0; TARGET_SAMPLE_RATE as usize * 180],
        )
        .unwrap();
        let encoded_size = "data:audio/wav;base64,".len() + bytes.len().div_ceil(3) * 4;
        assert!(encoded_size < 10_000_000);
    }

    #[test]
    #[ignore = "requires MEETLY_TEST_AUDIO_PATH"]
    fn normalizes_external_encoded_clip() {
        let path = std::env::var("MEETLY_TEST_AUDIO_PATH")
            .expect("MEETLY_TEST_AUDIO_PATH must point to a local audio fixture");
        let bytes = std::fs::read(&path).unwrap();
        let extension = std::path::Path::new(&path)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("mp4");
        let normalized = normalize_to_wav_16k_mono(BatchAsrRequest::new(
            bytes,
            &format!("fixture.{extension}"),
            &format!("audio/{extension}"),
        ))
        .unwrap();
        let reader = hound::WavReader::new(Cursor::new(normalized)).unwrap();
        assert_eq!(reader.spec().sample_rate, TARGET_SAMPLE_RATE);
        assert_eq!(reader.spec().channels, 1);
        assert!(reader.duration() > 0);
    }
}
