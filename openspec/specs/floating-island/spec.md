# Floating Island Spec

## Requirement: App starts with a Pluely-style island

### Scenario: Initial desktop launch

Given the user starts the desktop app
When the main window is created
Then a transparent frameless island window appears near the top center of the screen
And the island window is 600px wide and 54px high
And the main UI is a single compact horizontal card
And the card includes an audio button, a center ask/transcript area, a screenshot button, a status indicator, and a drag handle

## Requirement: Island can be dragged

### Scenario: User drags the handle

Given the island is visible
When the user presses and drags the right-side grip handle
Then the desktop window follows the pointer
And regular buttons and inputs outside the handle remain clickable

## Requirement: Island can expand and collapse

### Scenario: User opens the assistant panel

Given the island is visible and collapsed
When the user opens the assistant panel
Then the island window height changes to 600px
And the toolbar remains at the top
And the panel appears below the toolbar

### Scenario: User closes the assistant panel

Given the assistant panel is open
When the user closes the panel
Then the island window height returns to 54px
