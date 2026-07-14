# Voice Dictation Research: Typeless / Wispr Flow Style Input

Date: 2026-07-12

## 1. Conclusion

Meetly can add this capability without disrupting the existing meeting assistant, and it is a good next step toward a personal office assistant.

The intended flow is:

```text
global shortcut down
  -> remember the focused app/input
  -> record microphone audio
global shortcut up (or second press in toggle mode)
  -> transcribe
  -> AI cleanup
  -> copy final text
  -> paste into the original focused input
```

The feature should be a separate `Dictation` workflow, not another branch inside Ask or Coach. It may reuse the saved STT/LLM provider configuration, but it needs its own state machine, prompt, shortcut, microphone session, output history, and error handling.

Recommended interaction:

- Primary mode: push to talk. Hold the configured shortcut, speak, release to process and paste.
- Optional mode: press once to start and press again to stop.
- Default shortcut: `Fn + Space` on macOS if the native event monitor is available; offer a normal combination such as `Option + Space` as a fallback.
- Escape cancels an active recording or processing run.
- Automatic paste targets the input that was focused when recording started. Meetly should not search for and guess a different input box.

This is a medium-sized feature, not a rewrite. The smallest credible version can reuse the current browser `MediaRecorder` microphone capture and `transcribe_audio` command. The durable version should move microphone recording and shortcut lifecycle into a native dictation service after the product loop is proven.

## 2. Reference Projects

The repositories below were verified through the GitHub API on 2026-07-12 and shallow-cloned into `~/maidang/references`.

| Project | Stars | Stack | License | Local revision | Why it matters |
| --- | ---: | --- | --- | --- | --- |
| [Handy](https://github.com/cjpais/Handy) | 26,298 | Tauri, Rust, React | MIT | `38825767` | Closest architecture to Meetly: configurable press/release shortcuts, VAD/local STT, optional LLM post-processing, clipboard paste, and clipboard restoration. |
| [FluidVoice](https://github.com/altic-dev/FluidVoice) | 7,452 | Swift | GPL-3.0 | `58ed8df4` | Strong macOS implementation of shortcut capture, focused-element tracking, AI cleanup, and reliable text insertion. Architectural reference only because of GPL. |
| [VoiceInk](https://github.com/Beingpax/VoiceInk) | 5,499 | Swift | Custom / GitHub reports `NOASSERTION` | `cf0c3669` | Useful separation of shortcut monitor, transcription pipeline, enhancement service, delivery, clipboard manager, and cursor paste. Do not copy code without reviewing its license. |
| [OpenWhispr](https://github.com/OpenWhispr/openwhispr) | 4,452 | Electron, TypeScript | MIT | `5cac496d` | Most complete failure/fallback reference: Fn/Globe listener, streaming or batch STT, optional cleanup, auto-paste, clipboard-only fallback, and conditional clipboard restoration. |

Local paths:

```text
~/maidang/references/Handy
~/maidang/references/FluidVoice
~/maidang/references/VoiceInk
~/maidang/references/openwhispr
```

### 2.1 Handy

Handy's high-value pattern is the end-to-end boundary, not its local model stack:

- `src-tauri/src/shortcut/handler.rs` normalizes press/release events and supports push-to-talk separately from toggle mode.
- `src-tauri/src/transcription_coordinator.rs` serializes lifecycle transitions so repeated shortcut events cannot start overlapping jobs.
- `src-tauri/src/actions.rs` keeps raw transcription usable if optional post-processing is unavailable or fails.
- `src-tauri/src/clipboard.rs` saves the original clipboard, writes the result, sends the paste keystroke, then restores the previous clipboard after a configurable delay.
- `src-tauri/src/settings.rs` models normal transcription and transcription-with-post-processing as separate shortcut bindings.

The useful Meetly lesson is to coordinate the full run as one state machine and treat AI cleanup as optional enrichment. A model outage must not discard a valid transcript.

### 2.2 FluidVoice

FluidVoice demonstrates the macOS-specific reliability work hidden behind the phrase "paste into the input":

- `Sources/Fluid/Services/GlobalHotkeyManager.swift` owns hotkey activation rather than coupling it to a view.
- `Sources/Fluid/Services/TypingService.swift` captures the focused accessibility element and PID before showing overlays, restores that focus if needed, and resolves the paste key against the current keyboard layout.
- `Sources/Fluid/Services/ClipboardService.swift` and `TypingService.swift` separate clipboard storage from actual key injection.
- `Sources/Fluid/Services/DictationPostProcessingService.swift` uses a dedicated low-temperature text-cleanup request and returns plain text.
- `Sources/Fluid/Services/DictationAIPostProcessingGate.swift` fails closed when provider configuration is stale or incomplete.

Meetly already uses a non-activating `NSPanel`, which reduces focus loss, but it should still record the target PID/focused element at shortcut-down time. This is necessary for Launchers, terminals, Electron apps, and cases where the settings window becomes active during processing.

### 2.3 VoiceInk

VoiceInk has the cleanest workflow decomposition:

- `Shortcuts/ShortcutMonitor.swift`: native `CGEvent` tap for `keyDown`, `keyUp`, and `flagsChanged`, including the function modifier.
- `Shortcuts/RecordingShortcutManager.swift`: toggle, push-to-talk, and hybrid activation modes.
- `Transcription/Engine/TranscriptionPipeline.swift`: transcription and enhancement pipeline.
- `Transcription/Engine/TranscriptionDelivery.swift`: output delivery policy, independent from recognition.
- `Paste/ClipboardManager.swift` and `Paste/CursorPaster.swift`: clipboard/paste responsibilities.
- `Services/RecordingContextSnapshot.swift`: captures app context once at recording start instead of reading a potentially different app later.

This confirms that `Fn + Space` should be implemented as a native keyboard event monitor on macOS. It is not just a normal Tauri accelerator: the Fn state arrives through macOS modifier flags and needs `flagsChanged` handling, release tracking, event suppression, and Accessibility permission.

### 2.4 OpenWhispr

OpenWhispr is useful for production fallback behavior:

- `resources/macos-globe-listener.swift` observes Fn/Globe down and up separately.
- `src/helpers/hotkeyManager.js` routes normal accelerators through Electron but reserves Fn/Globe and modifier-only input for a native listener.
- `src/hooks/useAudioRecording.js` has explicit recording, streaming, processing, completion, and error states.
- `src/helpers/audioManager.js` falls back to raw transcription when cleanup/reasoning fails.
- `src/helpers/clipboard.js` leaves the result copied when Accessibility permission or automatic paste fails, and restores the prior clipboard only when appropriate.

Its core UX rule is worth adopting: successful STT is already a successful run. Cleanup and auto-paste improve the result, but failures in either stage must leave recoverable text in the clipboard and history.

## 3. Meetly's Current Starting Point

Meetly already has about half of the required pipeline:

| Need | Current state | Reuse decision |
| --- | --- | --- |
| Microphone recording | `src/useMicAsk.ts` uses `getUserMedia` and `MediaRecorder` | Reuse for the first vertical slice, but give Dictation its own hook/session. |
| Batch STT | `transcribe_audio` accepts browser-recorded WebM/Ogg and uses saved STT credentials | Reuse directly. |
| LLM provider | Saved OpenAI-compatible LLM config exists | Reuse credentials and HTTP adapter, but add a plain-text dictation method instead of parsing an `AssistantSuggestion`. |
| Floating status UI | Non-activating macOS island already exists | Add a compact dictation state; do not open/focus a large panel. |
| System audio | Rust Core Audio Process Tap for meetings | Do not reuse. Dictation records the user's microphone, not system output. |
| Global shortcut | Described in design docs but not implemented in Cargo/app setup | Add a native macOS shortcut service with a standard-combo fallback. |
| Clipboard/paste | Not implemented | Add native clipboard and Accessibility-backed paste service. |
| Dictation state/history | Not implemented | Add a separate bounded state machine and lightweight history. |

Important boundary: meeting listening and dictation are different audio modes.

- Meeting mode captures system output and labels it as the other participant.
- Dictation captures the user's microphone on demand and produces text for the active application.
- Dictation must never write into the meeting transcript or wake Coach.
- For the first release, reject or explicitly gate dictation while a meeting session is active. The previous browser microphone path interfered with live meeting microphone behavior, so concurrent Feishu/Zoom use must be proven with real device tests before it is enabled.

## 4. Proposed Architecture

```text
macOS shortcut monitor
  keyDown ------------------------------------------------------+
    | capture target PID / focused AX element                   |
    | emit dictation://start                                    |
    v                                                           |
React useDictation -> MediaRecorder -> complete WebM/Ogg blob   |
    ^                                                           |
    | emit dictation://stop                                     |
  keyUp --------------------------------------------------------+
    |
    v
transcribe_audio (existing STT adapter)
    |
    +-- STT failed -> show error, do not paste
    v
polish_dictation (new plain-text LLM path)
    |
    +-- LLM failed/timeout -> use raw transcript
    v
native output service
  save current clipboard -> write final text -> restore target focus -> Cmd+V
    |
    +-- no Accessibility / paste failed -> keep final text in clipboard
    v
dictation history + compact success state
```

### 4.1 Ownership

Rust should own OS-level capabilities:

- shortcut registration and native event monitoring;
- focused PID/accessibility element snapshot;
- paste key injection and clipboard policy;
- permission diagnostics;
- one active dictation lease, cancellation token, and target metadata.

TypeScript should own the first vertical slice's media/UI orchestration:

- `MediaRecorder` microphone clip;
- island state and audio visualization;
- calling STT, polish, and paste commands in order;
- user-visible fallback/error state.

Provider adapters remain shared infrastructure. Ask/Coach and Dictation call them through separate application services and prompts.

After the flow is validated, move microphone capture from the WebView into Rust (`cpal` or the existing native audio stack). That makes shortcut-to-audio latency and background reliability independent of WebView lifecycle, but it is not required to prove the product experience.

### 4.2 State Machine

Use an explicit state instead of reusing `IslandState` loosely:

```text
idle
  -> recording
  -> transcribing
  -> polishing
  -> pasting
  -> completed

any active state -> cancelled
any stage -> failed(stage, recoverableText?)
```

Rules:

- Only one run may be active.
- Duplicate key-down and key-repeat events are ignored.
- Key-up received while start is still opening the microphone is deferred, not lost.
- A quick accidental tap below a configurable minimum duration is cancelled.
- Escape cancels recording/processing and never pastes partial output.
- LLM failure is not a terminal failure if raw STT text exists.
- Paste failure is recoverable success: keep final text in the clipboard and show a small copied state.

### 4.3 AI Cleanup Contract

Add a dedicated plain-text method rather than passing dictation through `AssistantSuggestion`.

System behavior:

- preserve the user's language and intent;
- remove filler words, false starts, and obvious repetitions;
- correct punctuation, grammar, and spoken formatting;
- preserve names, numbers, URLs, code, and domain terms;
- do not add facts, arguments, or an answer the user did not say;
- return only the final text, with no explanation or Markdown fence.

The request should use low temperature, a short timeout, and no reasoning mode where the provider allows it. The raw transcript must always be retained for fallback and debugging.

Application-aware tone (email, Slack, document, code editor) should be a later step. The first version should not read arbitrary surrounding text or screen contents. A safe second version may pass only the target app bundle ID and a small user-approved cursor context snapshot.

### 4.4 Clipboard and Paste Policy

"Find the input and paste" should mean "return to the input that owned the cursor when dictation began."

Recommended policy:

1. At shortcut-down, capture frontmost PID and focused `AXUIElement` if Accessibility is available.
2. At output time, verify that the captured process still exists.
3. Write final text to the general pasteboard.
4. Restore/raise the captured app and focused element only if focus changed.
5. Send layout-aware `Cmd + V`.
6. If paste succeeds, optionally restore the previous clipboard after a delay.
7. If target validation or paste fails, do not guess another target; keep final text in the clipboard.

Settings should expose:

- `Auto paste` (default on);
- `Keep dictated text in clipboard` (default on for the first release, safer for recovery);
- later: `Restore previous clipboard after successful paste`.

Never auto-submit Enter. Dictation inserts text; sending a message or submitting a form is a separate, higher-risk action.

## 5. Proposed File Boundaries

First vertical slice:

```text
src/
  app/dictation/
    types.ts
    useDictation.ts
    dictationPrompt.ts
  components/
    DictationStatus.tsx

src-tauri/src/
  dictation/
    mod.rs                 # state and commands
    shortcut.rs            # macOS key down/up monitor
    focus.rs               # target PID / AX element snapshot
    output.rs              # clipboard and paste
    polish.rs              # plain-text LLM application service
```

Existing files that need narrow integration changes:

- `src-tauri/src/lib.rs`: manage dictation state and register commands/events.
- `src-tauri/Cargo.toml`: shortcut/clipboard/input dependencies or native bindings.
- `src-tauri/capabilities/default.json`: plugin permissions if Tauri plugins are used.
- `src-tauri/Info.plist`: change the microphone copy from a meeting-only description to user-triggered voice input plus Ask.
- `src-tauri/Entitlements.plist`: retain audio input entitlement.
- `src/SettingsApp.tsx`: shortcut, activation mode, AI cleanup, auto-paste, and permission diagnostics.
- `src/App.tsx`: compact dictation status only; do not mix Dictation output with the meeting transcript.

Do not put this logic into `useMicMeeting.ts`, `useMicAsk.ts`, `useAutoAssist.ts`, or Coach policy files.

## 6. Delivery Plan

### Step 1: Output Spike

Prove the highest-risk OS behavior before building the full pipeline:

- capture the focused target;
- invoke a debug command with fixed text;
- paste into TextEdit, Safari/Chrome, Slack/Feishu, VS Code, and Terminal;
- verify clipboard fallback and Accessibility onboarding;
- verify the island never becomes the paste target.

Exit condition: fixed text reliably reaches the original cursor without auto-submitting.

### Step 2: Dictation Vertical Slice

- Use a configurable standard shortcut first (`Option + Space` is a safe fallback).
- Reuse `MediaRecorder` and `transcribe_audio`.
- Copy raw STT output and auto-paste it.
- Add the independent state machine and cancellation.

Exit condition: shortcut -> record -> STT -> paste works without Ask/Coach or meeting transcript side effects.

### Step 3: AI Cleanup

- Add `polish_dictation` with a plain-text response contract.
- Add raw-text fallback on timeout/provider error.
- Store raw and polished text in a small local history.
- Add prompt presets only after the default cleanup is stable.

Exit condition: AI failure never loses a successful transcript.

### Step 4: Native `Fn + Space`

- Add the macOS `CGEvent` monitor for `keyDown`, `keyUp`, and `flagsChanged`.
- Suppress the chosen combination so Space is not inserted into the target field.
- Support push-to-talk and toggle modes.
- Detect conflicts with macOS Dictation/Input Source shortcuts and offer fallback registration.

Exit condition: press/release semantics remain correct under key repeat, quick tap, cancellation, and app switching.

### Step 5: Native Microphone Capture

- Move microphone capture from the WebView to a Rust/native recorder.
- Add input-device selection, level events, optional VAD, and WAV encoding.
- Test coexistence with AirPods, built-in microphone, external USB microphones, Feishu, Zoom, and browser calls.

Exit condition: background dictation is reliable and does not disrupt an active call's microphone path.

## 7. Acceptance and Risk Checklist

Functional:

- Push-to-talk starts on key-down and ends on key-up.
- Toggle mode cannot create overlapping recordings.
- Chinese, English, and mixed technical terms survive cleanup.
- STT success + LLM failure pastes raw text.
- Paste failure leaves final text in the clipboard.
- Escape never pastes cancelled text.
- The focused target is captured before any overlay/UI work.

macOS permissions:

- Microphone permission has a clear purpose string and recovery path.
- Accessibility permission is requested only for shortcut suppression/focus/paste.
- Without Accessibility permission, recording and clipboard copy still work.
- Shortcut conflict and registration failure are visible in Settings.

Regression:

- Starting Dictation does not call `start_listening` or modify meeting transcript state.
- Dictation completion does not trigger Ask, Coach, prefetch, or report generation.
- Meeting system-audio capture remains the default meeting path.
- Concurrent meeting + dictation behavior remains disabled until hands-on call testing passes.

Reliability targets for the cloud-provider MVP:

- shortcut-to-recording feedback: under 150 ms;
- stop-to-STT result: provider-dependent, target under 2 seconds for a short utterance;
- AI cleanup: target under 1.5 seconds, hard timeout with raw fallback;
- clipboard write and paste: under 250 ms after final text is ready.

## 8. Recommendation

Proceed, but implement it as a new Dictation capability with a narrow first vertical slice.

The best first engineering step is the output spike, not audio or AI. Focus restoration, Accessibility permission, and reliable paste are the parts Meetly does not already have and the parts most likely to make an otherwise successful transcription feel broken. Once fixed-text paste is proven, the existing microphone STT path can produce a working end-to-end version quickly.

For the long-term office-assistant direction, keep these product primitives separate:

- `Meeting Session`: system audio, transcript, Ask, Coach, reports.
- `Dictation Run`: microphone, cleanup, focused target, paste.
- `Context Snapshot`: explicit app/screen/file context with user control.
- `Action`: paste, draft, search, read, or later execute with confirmation.

That separation lets Meetly grow beyond meetings without turning every voice interaction into the same hidden agent workflow.
