## ADDED Requirements

### Requirement: User can request a suggestion based on recent transcript

The system SHALL let the user trigger an assistant suggestion for the
current mode, built from the most recent 90 seconds of transcript, and
SHALL return a short, structured suggestion.

#### Scenario: Ask with recent transcript available

- **WHEN** the user triggers Ask and at least one transcript segment exists
  within the last 90 seconds
- **THEN** the system SHALL send one chat completion request combining the
  mode's system prompt and the recent transcript text
- **AND** the system SHALL emit `assistant_done` with an `answer`, up to 3
  `bullets`, and an optional `clarifying_question`

#### Scenario: Ask with no recent transcript

- **WHEN** the user triggers Ask and no transcript segment exists within the
  last 90 seconds
- **THEN** the system SHALL NOT send a request to the LLM provider
- **AND** the system SHALL return a clear message indicating there is
  nothing recent to base a suggestion on

### Requirement: Suggestion output is a fixed short structure

The system SHALL constrain assistant output to a fixed JSON shape and SHALL
truncate bullet points to at most 3 items.

#### Scenario: Provider returns well-formed JSON

- **WHEN** the LLM provider's response content is valid JSON matching the
  `answer`/`bullets`/`clarifying_question` shape
- **THEN** the system SHALL parse it directly
- **AND** the system SHALL truncate `bullets` to at most 3 items if the
  provider returned more

#### Scenario: Provider returns plain text instead of JSON

- **WHEN** the LLM provider's response content is not valid JSON
- **THEN** the system SHALL fall back to treating the raw text as the
  `answer` field
- **AND** the system SHALL leave `bullets` empty and `clarifying_question`
  unset
- **AND** the system SHALL NOT surface a parse error to the user for this
  case

### Requirement: Ask requests do not overlap

The system SHALL prevent a new Ask request from being sent while a previous
one is still in flight.

#### Scenario: User clicks Ask while a request is pending

- **WHEN** the user triggers Ask again before a previous `ask_assistant`
  call has emitted `assistant_done` or `assistant_error`
- **THEN** the system SHALL ignore or disable the duplicate trigger until
  the in-flight request completes

### Requirement: LLM request failures are surfaced without leaking secrets

The system SHALL emit a clear error event when the LLM request fails and
SHALL NOT include the API key or full request Authorization header in the
error message.

#### Scenario: LLM provider returns an authentication error

- **WHEN** the configured API key is invalid and the provider responds with
  an auth error
- **THEN** the system SHALL emit `assistant_error` with a message derived
  from the provider's response
- **AND** the message SHALL NOT include the API key value
