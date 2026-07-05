## ADDED Requirements

### Requirement: Interview session starts and stops through the microphone control

The system SHALL treat the microphone control as an interview session
start/stop control, not as a one-off voice clip recorder.

#### Scenario: Start interview session

- **WHEN** the user clicks the microphone control while no interview session is active
- **THEN** the system SHALL create a new interview session
- **AND** the system SHALL clear transient transcript and suggestion state from any previous session
- **AND** the system SHALL begin continuous microphone capture

#### Scenario: Stop interview session

- **WHEN** the user clicks the microphone control while an interview session is active
- **THEN** the system SHALL stop microphone capture
- **AND** the system SHALL stop creating new transcript segments
- **AND** the system SHALL keep the completed session transcript available in the current UI until a new session starts

### Requirement: Ask flushes the current microphone segment

The system SHALL include the current in-progress microphone segment before
building the Ask prompt.

#### Scenario: Ask during an in-progress segment

- **WHEN** the user triggers Ask while the microphone recorder is currently recording
- **THEN** the system SHALL stop the current recorder segment
- **AND** the system SHALL wait for the segment's STT result or handled empty result
- **AND** the system SHALL build the Ask context only after that flush completes
- **AND** the system SHALL resume capture if the interview session remains active

#### Scenario: Ask with no transcript after flush

- **WHEN** the user triggers Ask and no transcript exists after flushing the current segment
- **THEN** the system SHALL NOT call the LLM
- **AND** the system SHALL display a clear message asking the user to wait for transcription

### Requirement: Transcript ordering follows capture time

The system SHALL order transcript segments by the time they were captured,
not by the time STT responses return.

#### Scenario: Older STT response returns after newer response

- **WHEN** segment A was captured before segment B
- **AND** the STT response for segment B returns before segment A
- **THEN** the transcript buffer SHALL still store A before B
- **AND** Ask context SHALL preserve chronological order

### Requirement: Ask context prioritizes the latest question

The system SHALL elevate the latest question or latest transcript segment
above older context when asking the LLM for help.

#### Scenario: Latest question is detected

- **WHEN** the transcript contains a recent question-like segment
- **THEN** the Ask prompt SHALL include that segment in a dedicated latest-question block
- **AND** the recent transcript SHALL be included as supporting context
- **AND** older session transcript MAY be included as background while budget permits

#### Scenario: No clear question is detected

- **WHEN** no question-like segment is detected
- **THEN** the Ask prompt SHALL use the latest transcript segment as the highest-priority block

### Requirement: Audio chunk boundaries are protected

The system SHALL reduce lost or broken transcript caused by fixed audio
chunk boundaries.

#### Scenario: Speech crosses a segment boundary

- **WHEN** a spoken question starts near the end of one audio segment and continues into the next
- **THEN** the system SHALL use overlap, shorter chunks, or equivalent mitigation to reduce boundary loss
- **AND** the system SHALL suppress obvious duplicate transcript caused by overlap

