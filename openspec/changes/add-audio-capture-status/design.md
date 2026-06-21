# Design: add-audio-capture-status

## Architecture

```text
React toolbar
  -> start_listening / stop_listening / get_audio_status
  -> Rust AudioState
  -> cpal host/default devices
  -> AudioStatus DTO
```

## State

Rust owns the source of truth:

- `idle`
- `listening`
- `setup_required`
- `error`

The frontend maps these states into existing island visuals.

## Device Detection

M2 only verifies device presence:

- default input device
- default output device
- current OS platform

Real system loopback capture remains M3.

## Failure Handling

If no default output device is available, `start_listening` returns a setup-required status instead of pretending to listen.

If device enumeration fails, the command returns an error status with a short diagnostic message.
