# Tasks: add-expandable-voice-agent-window

## Step 1: Presentation foundation and Compact dragging

- [x] Add typed `hidden`, `compact`, and `expanded` presentation modes.
- [x] Extend native `VoiceOverlayState` with presentation and manual-position
  ownership.
- [x] Add a native presentation command that preserves a manually moved window
  instead of bottom-centering every content-size update.
- [x] Make answer and conversation headers explicit native drag regions.
- [x] Keep header buttons clickable and excluded from dragging.
- [x] Add geometry and presentation-transition tests.
- [ ] Verify Compact dragging does not resize or move the top island.

## Step 2: Expanded conversation shell

- [x] Add expand, collapse, close, and new-conversation commands with Lucide
  icons and tooltips.
- [x] Add the 720 x 680 Expanded application layout with responsive monitor
  clamping and a 560 x 480 minimum.
- [x] Switch native focus/resizable behavior between Compact and Expanded.
- [x] Preserve the Fn conversation and active Agent run across presentation
  changes.
- [x] Verify Expanded and Compact previews at desktop and small-monitor sizes.

## Step 3: Conversation rendering and copy

- [ ] Render alternating User and Assistant turns in Expanded mode.
- [ ] Normalize every Assistant turn to one Markdown payload.
- [ ] Render all conversation content with `ReactMarkdown` and `remark-gfm`
  without raw HTML.
- [ ] Add a stable copy/check action to every Assistant reply.
- [x] Preserve auto-scroll until the user scrolls away from the latest turn.

## Step 4: Text and Fn input

- [ ] Add a text composer that submits through the independent Fn General
  Agent conversation.
- [ ] Keep text draft state while Fn recording temporarily occupies the
  composer.
- [ ] Keep Fn push-to-talk operational in Compact and Expanded modes.
- [ ] Serialize one active turn plus at most one queued text/voice turn.
- [ ] Preserve existing Fn/Fn+Space native arbitration.

## Step 5: Close semantics and full verification

- [ ] Make collapse preserve the conversation and Close hide it without
  clearing in-memory turns.
- [ ] Add an explicit new-conversation reset.
- [ ] Run TypeScript, Voice Ask, Dictation, Rust, build, and OpenSpec checks.
- [ ] Manually drag Compact and Expanded windows across two displays.
- [ ] Manually verify text focus, Fn recording, copy feedback, and island
  independence.
