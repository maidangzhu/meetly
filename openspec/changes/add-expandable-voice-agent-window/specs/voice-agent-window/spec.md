## ADDED Requirements

### Requirement: Fn conversation window is independent from the top island

The system SHALL present Fn General Agent conversation in the existing
`voice-overlay` window without resizing, hiding, replacing, or absorbing the
top island.

#### Scenario: User expands an Fn answer

- **WHEN** the top island and Compact Fn answer are visible
- **AND** the user activates Expand on the Fn answer
- **THEN** only the `voice-overlay` window SHALL enter Expanded mode
- **AND** the island SHALL retain its current position, size, and content
- **AND** Meeting Coach state SHALL remain unchanged

### Requirement: Voice overlay has independent presentation and Agent state

The system SHALL model `hidden`, `compact`, and `expanded` presentation modes
separately from recording, transcription, generation, and error phases.

#### Scenario: Window expands during an Agent run

- **WHEN** an Fn Agent turn is recording, transcribing, or generating
- **AND** the user changes Compact to Expanded
- **THEN** the active run SHALL continue with the same run identity
- **AND** its result SHALL publish into the same conversation
- **AND** presentation change SHALL NOT create another Agent call

#### Scenario: Agent phase changes while Expanded

- **WHEN** an Expanded conversation moves from recording to transcribing to answered
- **THEN** the window SHALL remain Expanded
- **AND** content-size changes SHALL NOT force it back to Compact

### Requirement: Compact and Expanded title bars support native dragging

The Fn conversation window SHALL follow native pointer dragging initiated from
an explicit title-bar region.

#### Scenario: User drags Compact answer header

- **WHEN** the user presses the primary pointer button on an unoccupied part of the Compact header
- **AND** moves the pointer
- **THEN** the native `voice-overlay` window SHALL follow the pointer
- **AND** the conversation content SHALL NOT select text
- **AND** the top island SHALL NOT move

#### Scenario: User drags across displays

- **WHEN** the user drags the Fn window from one display to another
- **THEN** the window SHALL remain under the pointer across the display boundary
- **AND** subsequent content resize SHALL use the destination display bounds and scale
- **AND** the window SHALL NOT snap back to the source display

#### Scenario: User activates a header command

- **WHEN** the pointer starts on Expand, Collapse, Close, Copy, or New Conversation
- **THEN** the command SHALL activate normally
- **AND** native window dragging SHALL NOT start

### Requirement: Manual placement survives content and presentation changes

After the user manually moves the Fn window, the system SHALL preserve that
placement until the user moves it again or it must be clamped into a visible
display work area.

#### Scenario: Follow-up pill changes Compact height

- **WHEN** a manually positioned Compact conversation starts or finishes Fn recording
- **THEN** the window SHALL preserve its top edge and horizontal center
- **AND** it SHALL remain within the current display

#### Scenario: User expands a manually positioned window

- **WHEN** a manually positioned Compact window enters Expanded mode
- **THEN** native resize SHALL preserve the window anchor
- **AND** clamp only the portion that would otherwise leave the current display

### Requirement: Expanded mode behaves as a complete conversation application

Expanded mode SHALL provide a focusable, resizable conversation layout with a
title bar, scrollable history, and bottom composer.

#### Scenario: User enters Expanded mode

- **WHEN** the user activates Expand from a Compact answer
- **THEN** the window SHALL target 720 x 680 logical pixels
- **AND** it SHALL be no smaller than 560 x 480 when the display permits
- **AND** it SHALL accept keyboard focus
- **AND** it SHALL show the existing conversation without starting a new one

#### Scenario: User collapses Expanded mode

- **WHEN** the user activates Collapse
- **THEN** the window SHALL return to Compact mode
- **AND** it SHALL become non-resizable and non-activating
- **AND** all conversation turns SHALL remain available

### Requirement: Every conversation turn uses safe Markdown rendering

The system SHALL render User and Assistant conversation content through React
Markdown with GFM support and without raw HTML execution.

#### Scenario: Assistant answer contains Markdown

- **WHEN** an Assistant turn contains headings, lists, links, quotes, tables, or code
- **THEN** Expanded and Compact views SHALL render supported Markdown consistently
- **AND** raw HTML SHALL remain inert
- **AND** external links SHALL open outside the Meetly WebView

#### Scenario: User copies an Assistant reply

- **WHEN** the user activates Copy on one Assistant turn
- **THEN** the clipboard SHALL receive that turn's complete normalized Markdown
- **AND** the icon SHALL temporarily show successful copied feedback
- **AND** no other turn SHALL change

### Requirement: Expanded mode accepts text and Fn voice turns

The Expanded composer SHALL serialize text and voice input through the same Fn
General Agent conversation.

#### Scenario: User submits text

- **WHEN** the user enters a non-empty text draft and submits it
- **THEN** the system SHALL append one User turn
- **AND** call `complete_voice_ask` with current bounded Fn history
- **AND** append the resulting Assistant turn to the same conversation

#### Scenario: User holds Fn while Expanded

- **WHEN** Expanded mode is focused and the user holds Fn
- **THEN** native Fn capture SHALL start normally
- **AND** the composer SHALL show recording state
- **AND** any existing text draft SHALL remain stored
- **AND** releasing Fn SHALL transcribe and submit one Voice turn

#### Scenario: Input arrives during generation

- **WHEN** one Fn Agent turn is generating
- **AND** one additional text or voice turn completes
- **THEN** the additional turn SHALL be queued
- **AND** it SHALL run after the active turn finishes
- **AND** a second queued turn SHALL be rejected rather than run concurrently

### Requirement: Close, Collapse, and New Conversation have distinct effects

The system SHALL preserve conversation state across Collapse and Close while
requiring an explicit New Conversation action to clear it.

#### Scenario: User closes the Fn window

- **WHEN** no recording is active and the user activates Close
- **THEN** the window SHALL become Hidden
- **AND** the in-memory conversation SHALL remain available
- **AND** the next Fn action SHALL reopen that conversation

#### Scenario: User starts a new conversation

- **WHEN** no recording is active and the user activates New Conversation
- **THEN** Fn context, turns, errors, text draft, and queued input SHALL clear
- **AND** Meeting Coach and Dictation state SHALL remain unchanged
