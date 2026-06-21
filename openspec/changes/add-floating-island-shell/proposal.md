# Proposal: add-floating-island-shell

## Why

The project needs a runnable Tauri + React foundation before native audio, STT, LLM, or stealth features can be implemented safely.

## What

- Add a minimal Tauri v2 + React + TypeScript app.
- Create the Pluely-style floating island window.
- Configure a transparent, frameless, always-on-top Tauri window.
- Add a compact horizontal island toolbar.
- Add a simple expandable assistant panel.
- Add Rust commands for setting island height and visibility.

## Non-goals

- No system audio capture.
- No STT.
- No LLM.
- No BYOK settings.
- No stealth capture guard.
- No packaging/signing.

