## ADDED Requirements

### Requirement: User can save STT and LLM provider configuration

The system SHALL let the user save a base URL, model name, and API key for
both the STT provider and the LLM provider, and SHALL persist non-secret
fields locally and the API key in the macOS Keychain.

#### Scenario: User saves a valid STT config

- **WHEN** the user enters a base URL, model, and API key in the Settings
  window and submits the STT form
- **THEN** the system SHALL store `base_url` and `model` in the local
  provider config file
- **AND** the system SHALL store the API key in the macOS Keychain under a
  service scoped to the app identifier
- **AND** the system SHALL NOT write the API key to the local provider
  config file or to any log output

#### Scenario: User saves a valid LLM config

- **WHEN** the user enters a base URL, model, and API key in the Settings
  window and submits the LLM form
- **THEN** the system SHALL store `base_url` and `model` in the local
  provider config file
- **AND** the system SHALL store the API key in the macOS Keychain under a
  service scoped to the app identifier

### Requirement: API key is never exposed back to the frontend in plaintext

The system SHALL NOT return a saved API key value through any Tauri command
or event.

#### Scenario: Frontend requests current provider config

- **WHEN** the frontend calls `get_provider_config`
- **THEN** the response SHALL include `base_url` and `model` only
- **AND** the response SHALL NOT include the API key value

#### Scenario: Frontend checks whether a key is configured

- **WHEN** the frontend calls `has_api_key` for a provider kind
- **THEN** the system SHALL return a boolean indicating whether a key is
  stored, without revealing the key value

### Requirement: Default provider config points at an OpenAI-compatible endpoint

The system SHALL default to SiliconFlow's OpenAI-Whisper-compatible STT
endpoint and OpenAI-compatible chat completions endpoint when no config has
been saved, and SHALL allow the user to override `base_url` and `model` to
point at any other OpenAI-compatible provider.

#### Scenario: First launch with no saved config

- **WHEN** the app has never had a provider config saved
- **THEN** `get_provider_config` for `stt` SHALL return the SiliconFlow STT
  default `base_url` and `model`
- **AND** `get_provider_config` for `llm` SHALL return the SiliconFlow LLM
  default `base_url` and `model`
- **AND** `has_api_key` SHALL return `false` for both until the user saves a
  key

### Requirement: User can test provider connectivity from Settings

The system SHALL let the user trigger a connectivity test for the configured
STT and LLM providers and SHALL show a clear success or failure message.

#### Scenario: STT test succeeds

- **WHEN** the user clicks "Test connection" in the STT settings section
  with a valid `base_url`, `model`, and API key saved
- **THEN** the system SHALL send a minimal request to the configured STT
  endpoint
- **AND** the system SHALL show a success message if the endpoint responds
  with a 2xx status

#### Scenario: LLM test fails due to bad API key

- **WHEN** the user clicks "Test connection" in the LLM settings section
  with an invalid API key
- **THEN** the system SHALL show a failure message derived from the
  provider's error response
- **AND** the message SHALL NOT include the API key or the full
  `Authorization` header value
