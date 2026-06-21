# Design: add-floating-island-shell

## Architecture

```text
React App
  -> Island toolbar and placeholder panel
  -> Tauri invoke
  -> Rust window commands
  -> Tauri WebviewWindow
```

## Window

The main Tauri window is labeled `island` and starts as:

- width: 600
- height: 54
- transparent
- frameless
- always-on-top
- content protected
- skip taskbar
- no shadow

macOS converts the window to an NSPanel when available.

## UI

The UI follows the Pluely-style spec:

- compact horizontal card
- icon buttons
- center ask/transcript lane
- status indicator
- drag handle
- expanded panel below toolbar

## Risk

The first implementation only verifies the shell. Native audio, stealth behavior, and platform-specific quirks are intentionally deferred to their own changes.

