# Tasks: add-dual-channel-meeting-capture

## 1. Contract

- [x] Define remote and in-person meeting scenarios.
- [x] Define source/speaker identity and timestamped transcript merge.
- [x] Define independent channel readiness and degradation.

## 2. Native capture

- [x] Add a CPAL native microphone stream with a bounded lock-free callback.
- [x] Prefer a built-in microphone over Bluetooth input when available.
- [x] Run microphone samples through the existing VAD/WAV/STT pipeline.
- [x] Emit channel-specific levels, transcript identity, and failures.
- [x] Add dual-channel start/stop commands.

## 3. Product integration

- [x] Replace interview/meeting setup with remote/in-person meeting.
- [x] Remove the audio-source selector from the primary setup flow.
- [x] Start dual native capture for remote meetings and mic-only capture in person.
- [x] Keep timestamp sorting at the transcript/Coach layer.

## 4. Verification

- [x] Run Rust unit tests and `cargo check`.
- [x] Run frontend tests and production build.
- [x] Validate this OpenSpec change strictly.
- [ ] Live-test local speech plus remote playback while Feishu retains its microphone.
