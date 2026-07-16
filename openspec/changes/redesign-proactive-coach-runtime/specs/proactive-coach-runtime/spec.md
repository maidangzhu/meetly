## ADDED Requirements

### Requirement: Meeting activity is journaled before wake evaluation

The system SHALL record accepted meeting activity as typed events before signal
detection or wake evaluation.

#### Scenario: Final transcript is accepted

- **WHEN** a final transcript segment passes transcript deduplication
- **THEN** the system SHALL append a `transcript.finalized` event
- **AND** the event SHALL identify the active session, audio source, segment, and occurrence time
- **AND** signal detection SHALL reference the event id
- **AND** the event SHALL exist even when no wake is produced

#### Scenario: Capture is not ready

- **WHEN** the selected audio source has not emitted `audio.capture.started`
- **AND** transcript-derived wake evaluation is requested
- **THEN** the wake policy SHALL return `capture_not_ready`
- **AND** the system SHALL NOT start a proactive Agent run

#### Scenario: Sensitive diagnostic data

- **WHEN** a Coach event or transition is written to local structured logs
- **THEN** it SHALL NOT include raw audio, API keys, Authorization headers, or provider secrets
- **AND** transcript evidence previews SHALL be bounded

### Requirement: Signal detection and wake policy are separate deterministic stages

The system SHALL derive typed semantic signals before the wake policy decides
whether the Agent should run.

#### Scenario: Meeting objection is detected

- **WHEN** recent meeting evidence contains a sufficiently strong objection
- **THEN** the detector SHALL return an `objection_raised` signal
- **AND** the signal SHALL include priority, evidence event ids, and a normalized evidence key
- **AND** the detector SHALL NOT call the Agent directly

#### Scenario: Ordinary transcript has no actionable signal

- **WHEN** new transcript evidence contains no configured P1 or P2 signal
- **AND** no low-priority observation is due
- **THEN** the wake policy SHALL return `no_new_evidence`
- **AND** the observed transcript event SHALL remain available in the journal

#### Scenario: Same input is replayed

- **WHEN** the same activity events, runtime snapshot, and clock are evaluated repeatedly
- **THEN** the signal and wake decisions SHALL be identical
- **AND** no network provider SHALL be required

### Requirement: Session lifecycle does not suppress early meeting evidence

Session lifecycle SHALL initialize and close runtime state without consuming
the cooldown for transcript-derived proactive signals.

#### Scenario: Session starts

- **WHEN** a meeting session starts
- **THEN** the system SHALL append `session.started`
- **AND** the runtime SHALL initialize context and epoch state
- **AND** the lifecycle event SHALL NOT automatically create a visible Coach message
- **AND** it SHALL NOT update transcript-signal spoken cooldown

#### Scenario: Important evidence arrives immediately after start

- **WHEN** a P1 question, objection, commitment, or decision signal arrives within ten seconds of session start
- **AND** capture is ready
- **THEN** the event SHALL be eligible to wake the Coach
- **AND** it SHALL NOT be ignored because of the session-start event

### Requirement: Cooldown is scoped to spoken evidence

The system SHALL apply cooldown by signal family and evidence rather than one
global last-message timestamp.

#### Scenario: Coach spoke for the same evidence

- **WHEN** a proactive message was visibly committed for an evidence key
- **AND** substantially duplicate evidence arrives inside its cooldown window
- **THEN** the wake policy SHALL return `duplicate_evidence` or `signal_cooldown`
- **AND** the system SHALL NOT add a duplicate visible message

#### Scenario: Previous run was silent or failed

- **WHEN** a previous proactive run ended `silent`, `failed`, or `superseded`
- **AND** materially new evidence arrives
- **THEN** the previous run SHALL NOT consume spoken cooldown for the new evidence

#### Scenario: User explicitly asks

- **WHEN** the user triggers Ask or Enter
- **THEN** proactive cooldown SHALL NOT block the user run

### Requirement: User intent preempts proactive work

The runtime SHALL give explicit user intent priority over queued, active, or
completing proactive work.

#### Scenario: User asks before proactive wake is claimed

- **WHEN** a proactive wake is pending but not running
- **AND** the user triggers Ask or Enter
- **THEN** the covered proactive wake SHALL be removed or marked `superseded_by_user`
- **AND** useful evidence from that wake SHALL remain available to the user request
- **AND** only the user run SHALL be allowed to produce the answer

#### Scenario: User asks while proactive run is active

- **WHEN** a proactive Agent run is active
- **AND** the user triggers Ask or Enter
- **THEN** the runtime SHALL increment the interaction epoch
- **AND** it SHALL abort the proactive transport
- **AND** it SHALL mark the proactive run `superseded_by_user`
- **AND** it SHALL start the user run without waiting for a late proactive completion

#### Scenario: Wake and Enter use the same transcript

- **WHEN** the same transcript evidence triggers a proactive wake and a user Ask
- **THEN** the user request SHALL own the response
- **AND** the UI SHALL NOT show a second proactive message for the same evidence

#### Scenario: Presentation-only action occurs

- **WHEN** the user opens a panel, closes a panel, or drags the island
- **THEN** the runtime SHALL NOT treat that action as user-answer intent
- **AND** it SHALL NOT supersede valid Coach work solely because of that action

### Requirement: Late results cannot mutate current state

Every asynchronous runtime callback SHALL pass a current-run commit guard
before mutating UI or session messages.

#### Scenario: Provider returns after abort

- **WHEN** a proactive provider call ignores cancellation and returns after a user run starts
- **THEN** its callback SHALL fail the session, epoch, or active-run commit guard
- **AND** its content SHALL NOT be added to Coach messages
- **AND** its content SHALL NOT replace the user answer
- **AND** the proactive run SHALL remain `superseded`

#### Scenario: User Ask and proactive completion occur together

- **WHEN** proactive completion and User Ask occur in the same scheduling window
- **THEN** the incremented interaction epoch SHALL make user intent authoritative
- **AND** at most one result SHALL be committed to the active answer surface

#### Scenario: Session ends during a run

- **WHEN** a session ends or is replaced while Agent work is pending or active
- **THEN** the runtime SHALL increment or invalidate the session epoch
- **AND** queued and active work for the old session SHALL be cancelled
- **AND** late callbacks for the old session SHALL NOT mutate the new session

### Requirement: Proactive runs may remain silent

The runtime SHALL distinguish a successful silent judgment from an error.

#### Scenario: Low-priority observation has no useful intervention

- **WHEN** a P3 proactive observation passes the wake gate
- **AND** the Coach determines there is no useful immediate intervention
- **THEN** the run MAY return `SILENT`
- **AND** the transition SHALL be recorded as `silent`
- **AND** the UI SHALL NOT add a Coach card
- **AND** the result SHALL NOT be shown as an error

#### Scenario: User run returns empty output

- **WHEN** a User Ask/Enter run returns no usable answer
- **THEN** the runtime SHALL return a user-readable failure
- **AND** it SHALL NOT treat the user request as a normal silent observation

#### Scenario: Proactive message is useful

- **WHEN** the Coach returns a useful intervention and its commit guard passes
- **THEN** the transition SHALL be recorded as `spoken`
- **AND** the UI SHALL display one concise action with optional directly usable wording
- **AND** internal signal or policy labels SHALL remain hidden

### Requirement: Pending proactive wakes preserve the most useful evidence

The runtime SHALL coalesce concurrent proactive wakes by priority, evidence,
and recency.

#### Scenario: Higher-priority wake arrives during a run

- **WHEN** a P3 proactive run is active
- **AND** a materially new P1 signal arrives
- **THEN** the pending P1 wake SHALL replace any lower-priority pending wake
- **AND** it SHALL remain eligible after the current run ends unless user intent supersedes it

#### Scenario: Duplicate wake arrives during a run

- **WHEN** a pending or active wake already covers an evidence key
- **AND** duplicate evidence produces another signal
- **THEN** the duplicate SHALL be ignored with a stable reason
- **AND** it SHALL NOT create another queued Agent run

### Requirement: Computer meetings use an explicit capture precondition

The meeting setup and runtime SHALL align the selected audio source with the
actual meeting environment.

#### Scenario: User selects meeting mode for a computer call

- **WHEN** the user selects meeting mode for Feishu, Zoom, or another computer meeting
- **THEN** system audio SHALL be the default source
- **AND** microphone SHALL remain available as an explicit alternative for in-room or speakerphone use

#### Scenario: System audio starts successfully

- **WHEN** native system audio capture is ready
- **THEN** the system SHALL append `audio.capture.started` with source `system`
- **AND** transcript-derived wake evaluation MAY begin

#### Scenario: System audio fails

- **WHEN** native system audio capture cannot start
- **THEN** the system SHALL append `audio.capture.failed`
- **AND** the user SHALL receive a source-specific actionable error
- **AND** the runtime SHALL NOT pretend the Coach is observing the meeting

### Requirement: Diagnostics replay the canonical runtime

The system SHALL provide offline replay and log diagnostics for the active
production event, signal, policy, and runtime protocol.

#### Scenario: Wake replay runs

- **WHEN** the canonical wake replay command is executed
- **THEN** it SHALL import the same activity projection, detector, and wake policy used by the app
- **AND** it SHALL report ignored, spoken, silent, failed, and superseded outcomes

#### Scenario: Historical implementation is no longer active

- **WHEN** a test exercises only an obsolete Coach policy or parses only obsolete log prefixes
- **THEN** that test SHALL NOT be treated as proof that the current runtime works
- **AND** it SHALL be migrated, retired, or explicitly labeled historical

#### Scenario: Race fixture is replayed

- **WHEN** a fixture schedules proactive wake and User Ask at the same boundary
- **THEN** the replay SHALL deterministically produce a user-priority outcome
- **AND** no stale proactive result SHALL be counted as visible output
