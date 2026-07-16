## ADDED Requirements

### Requirement: Rust owns the authoritative Dictation session lifecycle

The system SHALL coordinate each Voice Dictation run through one Rust-owned
session state machine.

#### Scenario: A Dictation run advances through processing

- **WHEN** the user starts and stops a valid Dictation recording
- **THEN** the Rust coordinator SHALL own the transitions through recording,
  transcription, optional polish, delivery, and terminal completion
- **AND** React SHALL render coordinator state without independently sequencing
  those backend stages

#### Scenario: An asynchronous result belongs to an old session

- **WHEN** a recorder, ASR, LLM, or delivery continuation returns with a session
  ID different from the active session
- **THEN** the coordinator SHALL discard that continuation
- **AND** it SHALL NOT update the current UI, clipboard, or target application

#### Scenario: Stop is requested while startup is pending

- **WHEN** stop is requested before recorder or provider startup completes
- **THEN** the coordinator SHALL preserve the stop edge
- **AND** it SHALL stop safely as soon as startup reaches a stoppable state
- **AND** it SHALL NOT leave microphone or provider resources active

### Requirement: ASR providers expose explicit capabilities

The system SHALL integrate ASR implementations through a provider contract
that declares supported execution modes and optional features.

#### Scenario: A batch-only provider is selected

- **WHEN** the selected ASR provider declares batch execution only
- **THEN** the coordinator SHALL submit a completed audio artifact after
  recording stops
- **AND** it SHALL NOT require partial-result or streaming methods to succeed

#### Scenario: A streaming provider is selected

- **WHEN** the selected ASR provider declares streaming execution
- **THEN** the coordinator SHALL be able to send canonical audio chunks during
  recording
- **AND** partial and final events SHALL use provider-independent internal types

#### Scenario: An optional ASR feature is unsupported

- **WHEN** hotwords, language hints, verbose segments, or another optional ASR
  feature is not declared by the selected provider
- **THEN** the coordinator SHALL omit that feature
- **AND** the provider SHALL NOT be selected or rejected based on provider-name
  conditionals outside the adapter/registry boundary

### Requirement: LLM providers expose plain-text and thinking capabilities

The system SHALL integrate Dictation polish through a shared LLM provider
contract with provider-specific transport and thinking controls.

#### Scenario: The provider supports thinking control

- **WHEN** Dictation polish requests no or low reasoning
- **AND** the selected provider declares a supported thinking-control mechanism
- **THEN** the provider adapter SHALL encode the correct provider-specific
  control

#### Scenario: The provider does not support streaming

- **WHEN** the selected LLM provider supports plain-text completion but not
  streaming
- **THEN** Dictation polish SHALL complete through the non-streaming path
- **AND** the coordinator state and fallback behavior SHALL remain unchanged

#### Scenario: A new LLM provider is added

- **WHEN** a provider adapter implements the LLM contract and is registered
- **THEN** Dictation SHALL be able to select it without changing the Dictation
  coordinator state machine or React phase vocabulary

### Requirement: Provider failures are normalized and diagnosable

The system SHALL normalize ASR and LLM failures into safe provider-independent
categories while preserving useful diagnostics.

#### Scenario: Authentication or rate limit fails

- **WHEN** a provider returns an authentication, permission, or rate-limit error
- **THEN** the failure SHALL identify the provider and normalized category
- **AND** it SHALL preserve a safe provider diagnostic code when available
- **AND** logs SHALL NOT contain API keys or Authorization headers

#### Scenario: A request times out

- **WHEN** an ASR or LLM request exceeds its configured budget
- **THEN** the failure SHALL be categorized as timeout
- **AND** automatic retry SHALL occur only when the stage-specific policy marks
  it safe and bounded

#### Scenario: The user cancels a provider request

- **WHEN** the user cancels during ASR or LLM processing
- **THEN** the in-flight operation SHALL be cancelled or abandoned
- **AND** the cancellation SHALL NOT be retried
- **AND** no partial or stale text SHALL be delivered

### Requirement: Successful transcription survives polish failure

The system SHALL treat AI polish as an optional transformation of a successful
transcript.

#### Scenario: Polish succeeds

- **WHEN** ASR returns non-empty text
- **AND** Dictation polish returns non-empty cleaned text
- **THEN** the cleaned text SHALL become the final delivery text

#### Scenario: Polish times out or fails

- **WHEN** ASR returns non-empty text
- **AND** polish times out, fails, is misconfigured, or returns empty text
- **THEN** the coordinator SHALL retain the raw transcript as final text
- **AND** it SHALL continue to delivery
- **AND** the terminal result SHALL NOT be labeled as transcription failure

#### Scenario: Dictated content contains instructions for the model

- **WHEN** the raw transcript contains text such as instructions to ignore the
  system prompt, answer a question, or change output format
- **THEN** the polish service SHALL treat that content as untrusted transcript
  data
- **AND** it SHALL continue to follow the Dictation polish contract

### Requirement: Delivery distinguishes pasted, copied, and failed outcomes

The system SHALL model automatic paste and clipboard preservation as distinct
delivery outcomes.

#### Scenario: Automatic paste succeeds

- **WHEN** final text is written to the clipboard and `Cmd+V` is safely posted
- **THEN** delivery SHALL complete as `pasted`
- **AND** the UI SHALL show a successful terminal state

#### Scenario: Automatic paste is enabled but cannot complete

- **WHEN** final text is successfully written to the clipboard
- **AND** the original target, permission, focus restoration, or key injection
  prevents safe automatic paste
- **THEN** delivery SHALL complete as `copied`
- **AND** the UI SHALL show recoverable success rather than a failed run

#### Scenario: Accessibility focused-element restoration is unavailable

- **WHEN** the original app can still safely receive app-level paste
- **AND** restoration of a captured Accessibility focused element fails
- **THEN** the delivery service SHALL be allowed to continue with app-level
  `Cmd+V`
- **AND** AX restoration failure alone SHALL NOT force copied fallback

#### Scenario: Clipboard write fails

- **WHEN** final text cannot be written to the clipboard
- **THEN** delivery SHALL complete as failed
- **AND** the failure SHALL indicate that no recoverable clipboard text exists

#### Scenario: The user retries delivery

- **WHEN** final text exists and the user retries a copied or failed paste
- **THEN** the system SHALL retry only the delivery stage
- **AND** it SHALL NOT rerun recording, ASR, or LLM polish

### Requirement: Dictation audio can migrate to a canonical native format

The system SHALL define a canonical native audio boundary for durable
Dictation recording while preserving an incremental migration path.

#### Scenario: The current WebView recorder remains during migration

- **WHEN** the Rust coordinator is introduced before native microphone capture
- **THEN** the existing encoded clip SHALL be represented as an audio artifact
  accepted by the selected batch provider
- **AND** the temporary bridge SHALL not expose WebView recording details to
  coordinator state or provider selection

#### Scenario: Native recording is enabled

- **WHEN** Dictation uses the native microphone recorder
- **THEN** provider-facing audio SHALL be normalized to 16 kHz mono signed
  16-bit PCM or encoded from that canonical representation
- **AND** audio-level and recorder-liveness events SHALL be session-ID safe

#### Scenario: ASR fails with a temporary archive available

- **WHEN** transcription fails and the run has a private temporary audio archive
- **THEN** the coordinator MAY perform a bounded automatic retranscription
- **AND** the archive SHALL be deleted after successful completion unless an
  explicit retention policy requires otherwise

