## ADDED Requirements

### Requirement: System audio is segmented into speech phrases

The system SHALL detect discrete phrases of speech in the captured system
audio stream using energy-threshold voice activity detection, without
requiring a neural VAD model.

#### Scenario: A phrase is spoken then silence follows

- **WHEN** the system audio stream contains a burst of energy above the
  configured RMS/peak thresholds for at least the minimum speech duration,
  followed by at least 700ms of silence
- **THEN** the system SHALL treat the burst as one complete speech segment
- **AND** the system SHALL include up to 300ms of audio captured before the
  burst started (pre-roll) in the segment

#### Scenario: Speech continues without pausing past the max segment duration

- **WHEN** continuous speech-level energy is detected for 15 seconds without
  a qualifying silence gap
- **THEN** the system SHALL flush the buffered audio as a segment at the
  15-second mark
- **AND** the system SHALL continue detecting a new segment from that point

#### Scenario: Detected burst is shorter than the minimum speech duration

- **WHEN** a burst of energy above threshold lasts less than the minimum
  speech duration before silence resumes
- **THEN** the system SHALL discard the burst
- **AND** the system SHALL NOT emit a transcript event for it

### Requirement: Completed speech segments are transcribed via a one-shot HTTP request

The system SHALL encode each completed speech segment as a WAV file and
submit it to the configured STT provider as a single HTTP request, and
SHALL surface the returned text as a transcript event.

#### Scenario: STT request succeeds

- **WHEN** a speech segment completes and a valid STT provider config and
  API key are saved
- **THEN** the system SHALL POST the WAV-encoded segment to the configured
  STT `base_url`
- **AND** the system SHALL emit a `transcript_final` event containing the
  returned text, a segment id, and start/end timestamps

#### Scenario: STT returns an empty transcription

- **WHEN** the STT provider responds successfully but with empty or
  whitespace-only text
- **THEN** the system SHALL discard the result
- **AND** the system SHALL NOT emit a `transcript_final` event

#### Scenario: STT request fails

- **WHEN** the STT request fails due to a network error or a non-2xx
  response
- **THEN** the system SHALL emit a `transcript_error` event with a
  user-readable message
- **AND** the system SHALL NOT include the API key or full response body in
  the emitted message
- **AND** the system SHALL continue capturing and segmenting subsequent
  audio without interruption

#### Scenario: No STT provider is configured

- **WHEN** a speech segment completes and no API key has been saved for the
  STT provider
- **THEN** the system SHALL emit a `transcript_error` event indicating STT
  is not configured
- **AND** the system SHALL NOT attempt the HTTP request

### Requirement: Recent transcript segments are held in memory for later use

The system SHALL maintain a rolling in-memory buffer of the most recent 3
minutes of transcript segments, and SHALL NOT persist this buffer to disk by
default.

#### Scenario: Buffer eviction

- **WHEN** a new transcript segment is added and existing segments are older
  than 3 minutes relative to the newest segment
- **THEN** the system SHALL evict the segments older than 3 minutes from the
  in-memory buffer

#### Scenario: Reading recent context for a suggestion request

- **WHEN** another component requests the transcript from the last 90
  seconds
- **THEN** the system SHALL return only segments whose end time falls within
  that window, in chronological order
