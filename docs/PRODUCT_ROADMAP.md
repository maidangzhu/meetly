# Product Roadmap: Interview First, Office Agent Later

## 1. Current Product Thesis

Meetly should start as a real-time interview assistant, then expand into a meeting assistant, and eventually become a personal office agent.

The first useful product is not a generic agent. It is a narrow, reliable tool for high-pressure conversations:

- listen to the live conversation through the microphone;
- transcribe continuously;
- let the user ask for help at the right moment;
- produce a short answer the user can say out loud;
- keep enough session context to support follow-up questions.

This keeps the initial product sharp while leaving a clean path toward meetings, screen context, memory, and tools.

## 2. Product Positioning

### 2.1 Near Term

Near term positioning:

> A real-time interview assistant that listens continuously, understands the latest question, and helps the user answer clearly.

Primary scenarios:

- technical interviews;
- product interviews;
- behavioral interviews;
- mock interviews and practice;
- live high-pressure Q&A.

The product should avoid leading with "cheating" language. The practical value is helping users organize their thoughts under pressure, review interview performance, and improve future answers.

### 2.2 Mid Term

Mid term positioning:

> A conversation assistant for meetings, customer calls, and important discussions.

The same session engine can support:

- meeting notes;
- summaries;
- action items;
- customer objections;
- follow-up email drafts;
- context-aware suggestions during a call.

This direction is closer to Granola: the microphone is just the entry point for creating a session, not the whole product.

### 2.3 Long Term

Long term positioning:

> A personal office agent that understands the current work context and can help with research, screen content, local files, and next actions.

Long term capabilities:

- ask the current screen;
- combine screen context with conversation transcript;
- search the web when needed;
- read local user-provided documents;
- remember people, projects, preferences, and prior sessions;
- proactively suggest low-interruption actions.

## 3. Core Mental Model

The core object is a `Session`.

A microphone button does not mean "record one clip". It means:

> Start a live session.

During a session, Meetly collects context:

- audio chunks;
- transcript segments;
- user Ask actions;
- assistant answers;
- screenshots or screen summaries;
- manually typed user notes;
- retrieved memories;
- tool results.

Ask/Enter is only an action inside the current session. It should not stop, pause, or reset listening.

## 4. Stage Plan

### Stage 1: Interview Assist

Goal:

Make the real-time interview loop reliable and useful.

Must work:

- start interview session with microphone;
- continuously transcribe in small segments;
- keep transcript ordered by capture time, not STT return time;
- Ask/Enter flushes the current audio segment before asking;
- Ask prioritizes the latest question;
- answer is short, direct, and speakable;
- user can ask follow-up questions;
- local debug log makes failures easy to inspect.

Important behaviors:

- starting a new interview clears the previous session's transient transcript;
- Ask uses the most recent 30-60 seconds first;
- older context is background only;
- if no fresh transcript exists, show a clear message instead of reusing stale context.

### Stage 2: Interview Session Memory

Goal:

Turn each interview into a saved session that can be reviewed and reused.

Must work:

- save transcript segments;
- save Ask/answer pairs;
- generate post-interview summary;
- extract questions asked;
- extract weak points and follow-up practice items;
- remember user profile facts that help future interviews, with user control.

Example outputs:

- "Questions they asked";
- "Your strongest answers";
- "Answers to improve";
- "Topics to review";
- "Reusable answer material".

### Stage 3: Meeting / Customer Conversation Mode

Goal:

Reuse the same session engine for non-interview conversations.

Must work:

- meeting session start/end;
- notes and summary;
- action items;
- customer concerns;
- follow-up email drafts;
- optional Ask during the meeting.

This is where the product becomes more Granola-like:

- record;
- transcribe;
- summarize;
- create useful follow-up artifacts;
- preserve memory for later calls.

### Stage 4: Ask Screen

Goal:

Let the user ask about the current screen together with conversation context.

Must work:

- capture screen while hiding the island;
- send screenshot or OCR/vision summary to the model;
- combine screen context with recent transcript;
- answer questions like:
  - "What does this customer mean?"
  - "How should I reply?"
  - "What is risky in this clause?"
  - "Explain this dashboard."
  - "What should I ask next?"

Ask Screen should be a user-triggered action first. Do not make it proactive until the basic workflow is reliable.

### Stage 5: Tool-Using Agent

Goal:

The assistant can perform useful local and online actions after user confirmation.

Initial tools:

- web search;
- read user-selected files;
- summarize a webpage;
- draft email or message;
- create follow-up checklist;
- retrieve relevant memory.

The planner can stay simple:

- answer directly;
- ask for clarification;
- search web;
- use screen context;
- retrieve memory;
- draft follow-up.

### Stage 6: Proactive Agent

Goal:

Detect useful moments and offer low-interruption help.

Principles:

- default to silent;
- show small prompts, not full answers;
- require user action to expand;
- avoid interrupting active speech;
- always allow dismissing and disabling.

Example prompts:

- "Question detected";
- "Possible follow-up";
- "Relevant past note found";
- "This may need a quick search";
- "Draft follow-up email".

## 5. Memory Design

Memory is required for the agent direction, but it must be introduced carefully.

### 5.1 Short-Term Memory

Scope:

- current session only;
- recent transcript;
- Ask/answer history;
- current screen context;
- temporary tool results.

Storage:

- in memory during P0;
- persisted in SQLite when session save is introduced.

### 5.2 Session Memory

Scope:

- one interview;
- one meeting;
- one customer call;
- one screen troubleshooting flow.

Stored data:

- transcript segments;
- generated summary;
- key questions;
- action items;
- user asks;
- assistant answers;
- screenshots or screen summaries if user opts in.

### 5.3 Long-Term Memory

Scope:

- user profile;
- role and background;
- projects;
- customers;
- people;
- preferences;
- reusable answer material;
- known facts from prior sessions.

Rules:

- memory must be visible;
- memory must be editable;
- memory must be deletable;
- sensitive memories should require explicit user confirmation;
- never silently store secrets or credentials;
- memory retrieval should be logged enough to debug context mistakes.

### 5.4 Storage Direction

Recommended storage:

- SQLite for structured session data;
- vector index for semantic retrieval later;
- plain local files only for development diagnostics.

Initial tables:

- `sessions`;
- `transcript_segments`;
- `assistant_messages`;
- `session_summaries`;
- `memory_items`;
- `memory_sources`.

## 6. Near-Term Implementation Priorities

### P0: Stabilize Interview Assist

- microphone session start/end;
- reliable segment flush before Ask;
- transcript ordering by capture time;
- latest-question-first Ask prompt;
- local debug log;
- DeepSeek/OpenAI-compatible LLM config;
- simple interview answer output.

### P1: Interview Session Object

- create explicit `InterviewSession`;
- move transcript state out of loose React state;
- persist session locally;
- show session transcript and Ask history;
- end-session summary.

### P2: Follow-Up Conversation

- Ask panel becomes a small chat;
- user can ask "shorter", "more technical", "give an example";
- assistant uses the current session memory.

### P3: Memory Candidates

- after session ends, generate candidate memories;
- show them to the user;
- let user accept, edit, or reject.

### P4: Ask Screen

- add screen capture context;
- combine with recent transcript;
- support "how should I reply?" and "explain this" workflows.

## 7. Product Guardrails

- Do not optimize only for cheating. The broader product is conversation performance, review, and office assistance.
- Do not make the assistant verbose in live mode. Live suggestions must be short.
- Do not let stale context drive Ask. Always prioritize the newest transcript.
- Do not hide memory from the user. Memory must be inspectable and controllable.
- Do not start with a complex autonomous agent. Build from reliable user-triggered workflows.

