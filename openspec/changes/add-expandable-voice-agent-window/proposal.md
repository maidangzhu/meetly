# Proposal: add-expandable-voice-agent-window

## Why

Fn Voice Ask already has an independent `voice-overlay` window and a multi-turn
Agent conversation, but the visible answer surface is fixed near the bottom of
one display. The user cannot move it to another display, give a longer
conversation more space, type a follow-up, or copy one specific Assistant turn.

The top island must remain a separate persistent surface. Expanding Fn should
not absorb, replace, resize, or hide that island. Instead, the existing Fn
window should grow from a lightweight answer panel into a complete conversation
window while preserving the same Fn Agent session.

## What

- Give the Fn `voice-overlay` three presentation modes: `hidden`, `compact`, and
  `expanded`.
- Make the Compact answer/conversation header a native drag region that can move
  the window between displays.
- Preserve manual placement when Compact content changes size and when the user
  expands or collapses the window.
- Add an Expanded conversation window with a draggable title bar, message
  history, text composer, voice status, collapse, close, and new-conversation
  controls.
- Keep Fn push-to-talk available in both Compact and Expanded modes.
- Serialize voice/text turns through the existing independent Fn General Agent.
- Render conversation content with React Markdown and add a copy action to
  every Assistant reply.
- Keep the top island and Fn+Space Dictation behavior independent.

## Non-goals

- No merge between the top island and the Fn window.
- No change to Meeting Coach state, wake policy, or UI.
- No replacement of Fn+Space Dictation with chatbot input.
- No persistent cross-restart chat history in the first iteration.
- No tabs, conversation library, account system, or cloud sync.
- No autonomous window movement after the user manually positions it.
