# Design: dual-channel meeting capture

## Product model

The setup surface exposes two scenarios:

| Scenario | Capture channels | Transcript identity |
| --- | --- | --- |
| Remote meeting | CoreAudio system tap plus native microphone | system/interviewer plus microphone/user |
| In-person meeting | Native microphone only | microphone/user |

The existing internal session model may retain compatibility fields while the
UI migrates, but it must not expose interview as a separate scenario.

## Native capture

The existing CoreAudio process tap remains the system channel. A CPAL input
stream provides the microphone channel. The real-time callback only converts
and writes samples to a bounded lock-free ring buffer. VAD, level calculation,
WAV encoding, and STT execute outside the audio callback.

When possible, Meetly prefers the Mac built-in microphone over Bluetooth input.
This avoids switching Bluetooth output into its low-bandwidth headset profile
and follows the device-safety approach used by Natively.

## Lifecycle and degradation

`start_meeting_capture` starts the required channels independently and returns a
status for each channel. A remote meeting succeeds when at least one channel is
ready. The UI shows a channel-specific warning when only one channel starts.
`stop_meeting_capture` stops both channels idempotently.

## Transcript merge

Each completed VAD segment is transcribed independently and emitted through the
existing `transcript_final` event. System segments use `source=system` and
`speaker=interviewer`; microphone segments use `source=microphone` and
`speaker=user`. Both use milliseconds relative to the capture session. The
frontend performs a stable `endMs` sort before updating Coach context.
