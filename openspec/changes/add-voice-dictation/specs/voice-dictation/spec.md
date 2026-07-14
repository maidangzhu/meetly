## ADDED Requirements

### Requirement: Dictation is an independent user workflow

The system SHALL treat voice Dictation as a workflow separate from Meeting,
Ask, Coach, prefetch, and report generation.

#### Scenario: Dictation completes successfully

- **WHEN** the user completes a Dictation run
- **THEN** the resulting text SHALL be delivered to the captured external target
- **AND** the text SHALL NOT be added to the Meeting transcript
- **AND** the system SHALL NOT trigger Ask, Coach, prefetch, or report generation

#### Scenario: Meeting session is active

- **WHEN** system-audio Meeting listening is active
- **AND** the user triggers the Dictation shortcut
- **THEN** the system SHALL NOT open a microphone recording for Dictation
- **AND** the system SHALL emit a non-blocking `meeting_active` blocked state

### Requirement: The global shortcut supports press and release semantics

The system SHALL provide a configurable macOS global shortcut for Dictation
with push-to-talk as the default activation mode.

#### Scenario: Push-to-talk shortcut

- **WHEN** the configured shortcut is pressed
- **THEN** the system SHALL create one Dictation run and begin microphone capture
- **WHEN** the same shortcut is released
- **THEN** the system SHALL stop microphone capture and begin processing that run

#### Scenario: Duplicate key-down or key repeat

- **WHEN** a shortcut key-down is repeated while its Dictation run is active
- **THEN** the system SHALL NOT create another run
- **AND** the system SHALL NOT restart microphone capture

#### Scenario: Toggle activation mode

- **WHEN** activation mode is `toggle`
- **AND** the user presses the shortcut while idle
- **THEN** the system SHALL start one Dictation run
- **WHEN** the user presses the shortcut again while recording
- **THEN** the system SHALL stop and process that run

#### Scenario: Fn plus Space is configured

- **WHEN** the native macOS shortcut backend has Accessibility permission
- **AND** `Fn + Space` is configured
- **THEN** the system SHALL recognize function-modifier press/release semantics
- **AND** the matched Space event SHALL NOT insert a stray space into the target input

#### Scenario: Native shortcut backend is unavailable

- **WHEN** the native backend cannot register because of permission or conflict
- **THEN** the system SHALL expose the registration failure in Settings
- **AND** the system SHALL allow the configured standard fallback shortcut

### Requirement: Dictation processing is run-id safe

The system SHALL associate all shortcut, microphone, STT, AI, and output
events with one active run id.

#### Scenario: Async result belongs to an old run

- **WHEN** an STT, AI, or output result arrives for a run id that is no longer active
- **THEN** the system SHALL discard the result
- **AND** the result SHALL NOT be pasted or displayed as current output

#### Scenario: Shortcut release arrives before microphone startup completes

- **WHEN** shortcut release arrives while microphone permission or recorder startup is still pending
- **THEN** the system SHALL remember the pending release
- **AND** it SHALL safely stop as soon as recorder startup resolves
- **AND** it SHALL NOT leave the microphone active

#### Scenario: User cancels with Escape

- **WHEN** the user presses Escape during an active Dictation run
- **THEN** the system SHALL stop microphone resources and cancel remaining processing
- **AND** it SHALL NOT paste partial or stale text

### Requirement: Dictation uses complete microphone clips for STT

The system SHALL record the user's microphone on demand and submit one
complete audio clip to the existing STT provider after recording stops.

#### Scenario: Valid speech clip

- **WHEN** a Dictation recording stops with a non-empty audio clip
- **THEN** the system SHALL call the existing `transcribe_audio` provider path
- **AND** it SHALL proceed only with non-empty returned text

#### Scenario: Empty or too-short recording

- **WHEN** the run contains no usable audio or is below the configured minimum duration
- **THEN** the system SHALL cancel the run without calling AI or paste

#### Scenario: STT fails

- **WHEN** the STT request fails or returns empty text
- **THEN** the system SHALL show a recoverable transcription error
- **AND** it SHALL NOT invoke AI polish or paste
- **AND** it SHALL release all microphone resources

### Requirement: AI polish preserves successful transcription

The system SHALL optionally polish Dictation text using a dedicated
plain-text LLM contract without changing the user's intended meaning.

#### Scenario: AI polish succeeds

- **WHEN** STT returns non-empty text
- **AND** AI polish is enabled and returns non-empty text
- **THEN** the system SHALL use the polished text as final output

#### Scenario: AI polish fails

- **WHEN** STT returns non-empty text
- **AND** AI polish times out, is misconfigured, fails, or returns empty text
- **THEN** the system SHALL use the raw STT text as final output
- **AND** the run SHALL continue to clipboard/paste delivery

#### Scenario: AI receives spoken text

- **WHEN** the system sends raw STT text for polish
- **THEN** the prompt SHALL require preservation of language, meaning, names, numbers, URLs, code, and domain terms
- **AND** the prompt SHALL forbid answering, expanding, or adding facts
- **AND** the response SHALL contain only final text

### Requirement: Output returns to the captured target safely

The system SHALL capture the target application/focus before Dictation UI
work and SHALL output only to that captured target.

#### Scenario: Captured target remains valid

- **WHEN** final text is ready
- **AND** the captured target process and focus context remain valid
- **AND** Accessibility permission is available
- **THEN** the system SHALL write final text to the clipboard
- **AND** it SHALL restore the captured target if needed
- **AND** it SHALL send `Cmd + V` without sending Enter

#### Scenario: Captured target is invalid

- **WHEN** the captured app exits or its target can no longer be validated
- **THEN** the system SHALL NOT paste into whichever app is currently frontmost
- **AND** it SHALL keep final text in the clipboard
- **AND** it SHALL report `copied`

#### Scenario: Accessibility permission is unavailable

- **WHEN** final text is ready
- **AND** Accessibility permission is unavailable
- **THEN** the system SHALL copy final text to the clipboard
- **AND** it SHALL NOT attempt unsafe automatic paste
- **AND** it SHALL report `copied`

#### Scenario: Automatic paste fails

- **WHEN** clipboard write succeeds but target restoration or key injection fails
- **THEN** the system SHALL keep final text in the clipboard
- **AND** it SHALL report `copied` instead of losing the result

### Requirement: Dictation gives compact non-activating feedback

The system SHALL show Dictation progress in the floating island without
stealing focus from the target application.

#### Scenario: Run changes phase

- **WHEN** a run enters recording, transcribing, polishing, pasting, completed, copied, or error
- **THEN** the island SHALL show a compact phase-appropriate state
- **AND** it SHALL NOT automatically open or focus the expanded panel

#### Scenario: Run finishes

- **WHEN** a run completes, is copied, is cancelled, or fails
- **THEN** the island SHALL return to idle after a short bounded delay
- **AND** all microphone resources and the Rust run lease SHALL be released

### Requirement: Dictation stores no complete audio by default

The system SHALL keep Dictation audio only for the lifetime required to
transcribe the active run.

#### Scenario: Run reaches a terminal state

- **WHEN** a Dictation run completes, is cancelled, or fails
- **THEN** the system SHALL release the MediaStream tracks
- **AND** it SHALL clear in-memory audio chunks
- **AND** it SHALL NOT persist the complete audio clip by default
