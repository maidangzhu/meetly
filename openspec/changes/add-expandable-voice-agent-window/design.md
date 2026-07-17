# Design: add-expandable-voice-agent-window

## 1. Product Boundary

The top island and Fn window remain separate Tauri windows:

```text
island window                         voice-overlay window
-------------                         --------------------
meeting controls                      Fn General Agent
always remains visible                hidden / compact / expanded
not resized by Fn                     owns Fn conversation UI
```

Expanding Fn changes only `voice-overlay`. It does not create a second Agent,
move conversation state to the island, or affect Meeting Coach.

## 2. Orthogonal State Machines

Presentation and Agent execution are independent:

```ts
type VoiceOverlayPresentationMode = "hidden" | "compact" | "expanded";

type VoiceAskActivePhase =
  | "opening_microphone"
  | "recording"
  | "transcribing"
  | "thinking";
```

Expanding, collapsing, moving, resizing, or hiding the window does not cancel
an Agent run. Agent phase changes do not implicitly force an Expanded window
back to Compact.

## 3. Window Modes

### Hidden

- The native window is not visible.
- In-memory conversation may remain available.
- A new Fn action reopens the window in its last non-hidden mode, defaulting to
  Compact.

### Compact

- Recording/processing remains a small voice surface.
- An answer or conversation uses the current 480 x 300 panel shape.
- The 48px answer header is draggable except for its command buttons.
- The existing follow-up recording pill remains separate below the answer.
- The window is non-resizable and does not take keyboard focus by default.

### Expanded

- Default logical size is 720 x 680.
- Minimum logical size is 560 x 480.
- Actual size is clamped to the current monitor work area with a 24px margin.
- The title bar is draggable and contains new conversation, collapse, and close
  commands.
- The content area contains scrollable alternating User and Assistant turns.
- The bottom composer accepts text and presents Fn recording/transcription
  status without replacing the conversation.
- The native window becomes focusable and resizable while Expanded.

Collapsing restores the non-activating Compact window without changing the Fn
conversation.

## 4. Dragging and Multi-display Placement

React starts native dragging with `getCurrentWindow().startDragging()` on
primary-button pointer down in an explicit title-bar region. Buttons and inputs
stop pointer propagation and never start window dragging.

Native `VoiceOverlayState` tracks:

- current presentation mode;
- whether the user manually positioned the window;
- current physical position and monitor bounds;
- the last non-hidden mode.

Before the first manual drag, Fn opens near the bottom center of the display
under the pointer. After a manual drag, content-size changes and presentation
changes preserve the window's top edge and horizontal center, then clamp the
result to the current display. Dragging across displays updates the current
monitor and scale instead of snapping back to the original monitor.

## 5. Conversation Layout

Compact keeps the current dense reading surface. Expanded uses an application
layout rather than nested decorative cards:

```text
draggable title bar       [new] [collapse] [close]
--------------------------------------------------
scrolling conversation
  User turn
  Assistant Markdown                         [copy]
  User turn
  Assistant Markdown                         [copy]
--------------------------------------------------
text draft / Fn waveform / queued status   [send]
```

Assistant and User content use `ReactMarkdown` with `remark-gfm`. Raw HTML is
not enabled. External links open outside the WebView. Each Assistant turn owns
one normalized Markdown payload for rendering and copying; copy feedback swaps
the copy icon to a check icon without changing layout dimensions.

## 6. Text and Fn Input

Both input methods call one Fn conversation action:

```ts
sendTurn({ source: "text" | "voice", question: string })
```

- Text submission creates a frontend run identity and calls the same
  `complete_voice_ask` command with the current bounded turn history.
- Holding Fn starts microphone capture in either presentation mode.
- In Expanded mode, the composer temporarily displays the waveform while the
  existing text draft remains stored.
- Releasing Fn transcribes and submits one Voice turn.
- If an Agent turn is already generating, one completed voice/text turn may be
  queued and is submitted after the active turn finishes.
- A second queued turn is rejected with visible local feedback rather than
  creating concurrent calls in one Fn conversation.
- Fn+Space continues to use native shortcut arbitration and the independent
  Dictation lifecycle.

## 7. Close, Collapse, and New Conversation

- Collapse changes Expanded to Compact and preserves the conversation.
- Close hides the window and preserves the in-memory conversation.
- New conversation clears context, turns, errors, draft, and queued input only
  after no active recording exists; it does not affect Meeting Coach.
- App restart may clear the conversation in this iteration.

## 8. Native Focus Boundary

Compact remains a non-activating floating panel so an Fn answer does not steal
focus from the user's current app. Expanded must accept keyboard focus for its
composer. A native presentation command therefore owns size, resizability,
focusability, and macOS panel activation behavior; React must not approximate
Expanded mode with CSS inside a permanently non-activating 480px window.

## 9. Verification Strategy

- Reducer tests cover presentation transitions, close/collapse semantics,
  active run preservation, draft preservation, and one-turn queueing.
- Rust geometry tests cover resize around the current anchor, monitor clamping,
  negative monitor origins, and mixed scale factors.
- Source-level shortcut tests continue to prove Fn versus Fn+Space arbitration.
- Browser previews cover Compact, Expanded, long Markdown, copied feedback,
  recording, queued input, and errors.
- Manual desktop checks cover real cross-display dragging, text focus,
  Expanded Fn recording, and no movement of the top island.
