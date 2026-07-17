## ADDED Requirements

### Requirement: Scenario-based capture

Meetly SHALL expose remote meeting and in-person meeting as the primary session
scenarios.

#### Scenario: Remote meeting starts two independent channels

- **WHEN** the user starts a remote meeting
- **THEN** Meetly SHALL start system-audio capture for remote participants
- **AND** Meetly SHALL start native microphone capture for the local user
- **AND** one channel failing SHALL NOT stop a ready channel

#### Scenario: In-person meeting starts the microphone channel

- **WHEN** the user starts an in-person meeting
- **THEN** Meetly SHALL start native microphone capture
- **AND** Meetly SHALL NOT require system-audio capture

### Requirement: Transcript source identity

Meetly SHALL preserve channel identity through transcription and Coach context.

#### Scenario: Two speakers are merged chronologically

- **WHEN** system and microphone speech segments are transcribed
- **THEN** system segments SHALL be identified as `system/interviewer`
- **AND** microphone segments SHALL be identified as `microphone/user`
- **AND** the frontend SHALL merge segments by timestamp
- **AND** Meetly SHALL NOT mix the channels as raw PCM

### Requirement: Meeting-app microphone compatibility

Meetly SHALL use native shared microphone capture for meeting sessions.

#### Scenario: Meetly runs alongside a meeting application

- **WHEN** Feishu or another meeting application is using the microphone
- **THEN** Meetly SHALL NOT start the browser MediaRecorder meeting path
- **AND** Meetly SHOULD prefer a built-in microphone when Bluetooth input would
  force the output device into a headset profile
