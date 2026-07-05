## ADDED Requirements

### Requirement: Interview questions are detected from live transcript

The system SHALL analyze final transcript segments during an active interview
session and identify likely interviewer questions or prompts.

#### Scenario: Clear interview question

- **WHEN** a final transcript segment contains a clear question or interview prompt
- **THEN** the system SHALL create a question candidate with text, confidence, kind, and reason
- **AND** the system SHALL store the candidate in the active session

#### Scenario: Filler transcript

- **WHEN** a final transcript segment contains only filler or backchannel speech
- **THEN** the system SHALL NOT create a question candidate
- **AND** the system SHALL NOT show an auto-assist hint

### Requirement: Auto assist is low-distraction by default

The system SHALL show a compact hint for detected questions instead of
automatically expanding a full answer.

#### Scenario: Medium-confidence question candidate

- **WHEN** a medium-confidence question candidate is detected
- **THEN** the island SHALL show a compact hint such as `Question detected · Press Enter`
- **AND** the assistant panel SHALL NOT automatically expand

#### Scenario: Hint expires

- **WHEN** a hint has been visible longer than the configured expiry duration
- **THEN** the system SHALL remove the hint unless it has been accepted

### Requirement: High-confidence candidates can be prefetched

The system SHALL be able to pre-generate an answer for high-confidence
question candidates without showing the full answer automatically.

#### Scenario: High-confidence candidate with prefetch enabled

- **WHEN** a high-confidence question candidate is detected
- **AND** no conflicting prefetch is in flight
- **THEN** the system MAY start a background LLM request using the current interview context
- **AND** the visible UI SHALL remain a compact hint unless the user accepts it

#### Scenario: User presses Enter after prefetch completes

- **WHEN** a prefetched answer exists for the active candidate
- **AND** the user triggers Ask/Enter before the cache expires
- **THEN** the system SHALL display the cached answer without sending a duplicate LLM request

#### Scenario: Prefetch cache is stale

- **WHEN** the user triggers Ask/Enter after the prefetched answer has expired
- **THEN** the system SHALL ignore the cached answer
- **AND** the system SHALL perform the normal Ask flow

### Requirement: Automatic hints are throttled and deduplicated

The system SHALL avoid spamming the user with repeated automatic hints.

#### Scenario: Similar question repeats within cooldown

- **WHEN** a new question candidate is substantially similar to a recent candidate
- **AND** the recent candidate is still within the dedupe window
- **THEN** the system SHALL NOT show a duplicate hint

#### Scenario: Different question arrives during cooldown

- **WHEN** a different question candidate arrives during cooldown
- **AND** its confidence is not significantly higher than the active candidate
- **THEN** the system SHALL keep the current hint or remain silent

