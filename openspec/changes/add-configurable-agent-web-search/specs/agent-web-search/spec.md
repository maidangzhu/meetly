## ADDED Requirements

### Requirement: Web search is an explicit default-off capability

The system SHALL keep web search disabled until the user explicitly enables it
with a valid Exa credential.

#### Scenario: No web search configuration has been saved

- **WHEN** Meetly loads Web Search settings for the first time
- **THEN** the capability SHALL be disabled
- **AND** Exa SHALL be the initial supported provider
- **AND** neither Agent tool registry SHALL contain `web_search`
- **AND** no Agent run SHALL send a request to Exa

#### Scenario: User enables search without an Exa key

- **WHEN** the user attempts to enable Web Search without a stored or newly supplied Exa key
- **THEN** the save SHALL fail with an actionable message
- **AND** the capability SHALL remain disabled

#### Scenario: User disables configured search

- **WHEN** an Exa key remains stored but the user disables Web Search
- **THEN** both Agent workflows SHALL continue without `web_search`
- **AND** the stored credential SHALL NOT make search implicitly available

### Requirement: Web search configuration protects credentials

The system SHALL persist non-secret search settings separately from the Exa
credential and SHALL never expose the saved credential to React or logs.

#### Scenario: User saves a valid Exa configuration

- **WHEN** the user saves the enabled state, provider, and Exa API key
- **THEN** non-secret settings SHALL be stored in the Tauri app data directory
- **AND** the API key SHALL be stored through the existing owner-readable local credential store
- **AND** the API key SHALL NOT be written to the settings file

#### Scenario: Frontend loads search settings

- **WHEN** React requests the current Web Search configuration
- **THEN** the response SHALL include `enabled`, `provider`, and `hasApiKey`
- **AND** it SHALL NOT include the API key value

#### Scenario: User tests a stored key while search is disabled

- **WHEN** a stored Exa key exists and the user requests a connection test
- **THEN** the system MAY perform the diagnostic without enabling Agent search
- **AND** the result SHALL use a safe success or normalized failure message

### Requirement: Meeting Coach owns its Agent and optional search tool

The Meeting Coach SHALL execute proactive and meeting-manual interactions in a
meeting-owned Agent runtime.

#### Scenario: Enabled Coach run needs current public information

- **WHEN** Web Search is enabled
- **AND** a Meeting Coach run determines that current public information would materially improve its intervention
- **THEN** the Coach Agent MAY call its `web_search` tool
- **AND** the search result SHALL return to the same Coach run
- **AND** any visible result SHALL follow the Coach speaking and commit policy

#### Scenario: Coach search is disabled

- **WHEN** Web Search is disabled and the Coach Agent runs
- **THEN** the Coach tool registry SHALL NOT advertise `web_search`
- **AND** the Coach SHALL continue using meeting context and its non-search tools

#### Scenario: Meeting Ask and wake occur together

- **WHEN** a meeting Ask/Enter action and a proactive wake cover the same meeting evidence
- **THEN** the meeting runtime SHALL apply its user-priority wake-race policy
- **AND** it SHALL produce at most one meeting answer for that evidence

### Requirement: Fn Voice Ask uses an independent general Agent

Fn Voice Ask SHALL use an Agent runtime that is independent from Meeting Coach.

#### Scenario: Fn question needs no search

- **WHEN** the user completes an Fn voice question
- **AND** the Fn Agent can answer without search
- **THEN** the Fn Agent SHALL answer using its own conversation and selected-text context
- **AND** it SHALL publish only to the Fn voice overlay

#### Scenario: Enabled Fn run needs current public information

- **WHEN** Web Search is enabled
- **AND** the Fn Agent determines that current public information is needed
- **THEN** it MAY call its own `web_search` registration
- **AND** the tool result SHALL return to the same Fn run
- **AND** the answer SHALL include relevant source URLs

#### Scenario: Fn search is disabled

- **WHEN** Web Search is disabled and the user asks through Fn
- **THEN** the Fn Agent SHALL still run with its non-search capabilities
- **AND** its tool registry SHALL NOT advertise `web_search`
- **AND** it SHALL NOT fall back to the Meeting Coach Agent

### Requirement: Meeting Coach and Fn Agent lifecycles are isolated

The system SHALL NOT share Agent instances, sessions, prompts, context,
priority, cancellation, or publication state between Meeting Coach and Fn.

#### Scenario: Fn starts while Coach work is active

- **WHEN** an Fn run starts while a Coach run is queued or active
- **THEN** the Fn run SHALL NOT clear meeting wakes
- **AND** it SHALL NOT invalidate the Coach interaction epoch
- **AND** it SHALL NOT cancel, suspend, or suppress the Coach run
- **AND** both workflows MAY continue concurrently

#### Scenario: Meeting wake arrives while Fn is active

- **WHEN** a valid meeting wake arrives during an Fn run
- **THEN** the meeting runtime SHALL evaluate the wake normally
- **AND** it SHALL NOT wait for an Fn completion event
- **AND** the Fn run SHALL remain governed only by its own run identity

#### Scenario: One workflow completes late

- **WHEN** a late Agent or search result returns after its originating run became stale
- **THEN** only that workflow's commit guard SHALL reject the result
- **AND** the result SHALL NOT mutate the other workflow's UI or history

### Requirement: Fn+Space Dictation remains outside the Agent runtimes

The system SHALL keep Fn+Space Dictation as a separate recording,
transcription, optional-polish, and delivery workflow.

#### Scenario: User starts Fn+Space Dictation

- **WHEN** the Fn+Space shortcut wins native voice-shortcut arbitration
- **THEN** Dictation SHALL follow its existing session lifecycle
- **AND** it SHALL NOT start Meeting Coach or Fn General Agent
- **AND** it SHALL NOT receive a `web_search` tool

#### Scenario: Fn+Space supersedes Fn Voice Ask

- **WHEN** native shortcut arbitration supersedes an active Fn run with Fn+Space
- **THEN** only the Fn voice workflow SHALL reject the stale Fn result
- **AND** Meeting Coach state SHALL remain unchanged

### Requirement: Search inputs and results cross a bounded trust boundary

Both Agent workflows SHALL use the same bounded Exa adapter and treat returned
content as untrusted reference material.

#### Scenario: Agent calls web search

- **WHEN** an Agent invokes `web_search`
- **THEN** the query SHALL contain between 2 and 300 characters
- **AND** the requested result limit SHALL be between 1 and 5
- **AND** the adapter SHALL return only bounded title, HTTP(S) URL, and snippet fields
- **AND** the Agent SHALL treat result text as data rather than instructions

#### Scenario: Candidate query contains private context

- **WHEN** a model-generated query contains selected private text, private meeting transcript, credentials, personal identifiers, or a large verbatim passage
- **THEN** the query SHALL NOT be sent to Exa
- **AND** the calling Agent SHALL continue without claiming current search evidence

#### Scenario: Exa request fails

- **WHEN** Exa returns a transport, API, or invalid-response failure
- **THEN** the calling Agent SHALL receive a bounded tool error
- **AND** the other Agent workflow SHALL remain unaffected
- **AND** no answer SHALL claim that a fresh search succeeded
