## ADDED Requirements

### Requirement: Coach heartbeat uses a wake policy before calling PI

The system SHALL run a deterministic wake policy before invoking the PI
observer from the periodic heartbeat.

#### Scenario: Heartbeat with empty transcript

- **WHEN** an interview session is active
- **AND** no transcript segment has been captured yet
- **AND** the heartbeat timer fires
- **THEN** the system SHALL NOT call the PI observer
- **AND** the system SHALL log `reason=no_transcript`

#### Scenario: Heartbeat with existing transcript

- **WHEN** an interview session is active
- **AND** at least one transcript segment exists
- **AND** the PI observer is not already running
- **AND** the heartbeat timer fires
- **THEN** the wake policy MAY return `shouldWake=true`
- **AND** the signal SHALL be `fresh_context`
- **AND** the PI observer SHALL decide whether to output a visible hint or `SILENT`

#### Scenario: Heartbeat while coach is in flight

- **WHEN** the PI observer is already running
- **AND** the heartbeat timer fires
- **THEN** the system SHALL NOT start another PI observer call
- **AND** the system SHALL log `reason=in_flight`

### Requirement: New interview questions can wake the coach

The system SHALL wake the PI observer when a non-duplicate interview question
is detected with sufficient confidence.

#### Scenario: Clear new question

- **WHEN** a final transcript segment contains a clear interview question
- **AND** the detected candidate is not a duplicate of a recent candidate
- **THEN** the wake policy SHALL return `shouldWake=true`
- **AND** the signal SHALL be `new_question`

#### Scenario: Duplicate question

- **WHEN** a new question candidate is substantially similar to a recent candidate
- **AND** the recent candidate is still inside the dedupe window
- **THEN** the wake policy SHALL return `shouldWake=false`
- **AND** the reason SHALL explain the duplicate suppression

### Requirement: Silence after a question can wake the coach

The system SHALL be able to wake the PI observer when the interviewer has
asked a question and the user remains silent long enough to need help.

#### Scenario: User is silent after question

- **WHEN** a question candidate was detected
- **AND** no user answer has been transcribed for the configured silence window
- **AND** the coach is not in flight
- **THEN** the wake policy SHALL return `shouldWake=true`
- **AND** the signal SHALL be `silence_after_question`

#### Scenario: User has started answering

- **WHEN** a question candidate was detected
- **AND** user speech has been transcribed after the question
- **THEN** the silence rule SHALL NOT wake the coach for that question

### Requirement: Long answers can wake the coach conservatively

The system SHALL be able to detect overly long answers and wake the coach with
a conservative signal.

#### Scenario: User answer continues too long

- **WHEN** the user has been answering after a question for longer than the configured long-answer window
- **AND** the coach is not already in flight
- **THEN** the wake policy MAY return `shouldWake=true`
- **AND** the signal SHALL be `long_answer`

### Requirement: SILENT still marks context as observed

The system SHALL record which context the PI observer saw when PI returns
`SILENT`.

#### Scenario: PI returns SILENT

- **WHEN** the PI observer is invoked for a transcript range
- **AND** the PI observer returns `SILENT`
- **THEN** the system SHALL mark that transcript range as observed
- **AND** the system SHALL NOT display a coach message
- **AND** a later heartbeat MAY still invoke PI as a low-priority `fresh_context` observation

### Requirement: Coach output behaves like a field coach

The PI observer SHALL behave like a quiet interview or meeting coach rather
than a status reporter.

#### Scenario: PI has useful help

- **WHEN** the PI observer decides the user may be stuck, drifting, missing a key point, or needing a natural close
- **THEN** the visible output SHALL be one to three short sentences
- **AND** the output SHOULD contain directly usable wording, an answer skeleton, or a concise correction

#### Scenario: PI has no useful help

- **WHEN** the current context does not contain a useful intervention
- **THEN** the PI observer SHALL return `SILENT`
- **AND** the UI SHALL NOT add a new coach message

#### Scenario: Internal labels are not user-facing

- **WHEN** the PI observer receives internal wake signals such as `new_question`, `long_answer`, or `fresh_context`
- **THEN** the visible output SHALL NOT expose those internal labels
- **AND** the app SHALL NOT inject hardcoded fallback phrases such as "detected question" or "pay attention to conclusion"

### Requirement: Wake policy is replay-testable

The system SHALL provide an offline replay test harness that can evaluate the
wake policy without STT or network providers.

#### Scenario: Replay fixture matches expected wake

- **WHEN** a replay fixture contains a transcript event annotated as an expected wake
- **THEN** the replay harness SHALL report whether the wake happened within the expected time range
- **AND** the report SHALL include missed wake and false wake counts

#### Scenario: Replay fixture is deterministic

- **WHEN** the same replay fixture is executed multiple times
- **THEN** the wake and skip decisions SHALL be identical
- **AND** no external network provider SHALL be required
