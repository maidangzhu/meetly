# Tasks: add-configurable-agent-web-search

## Step 1: Native configuration and Exa adapter

- [x] Add default-off `WebSearchConfig` and Exa provider ID.
- [x] Persist non-secret search configuration under the Tauri app data path.
- [x] Save Exa API keys through the existing local credential store.
- [x] Add get/save/test commands without returning the API key.
- [x] Reject enabled configuration when no Exa key is available.
- [x] Normalize bounded Exa results and validate query/result limits.
- [x] Keep the Rust command as a second capability check.

## Step 2: Settings UI

- [x] Add a Web Search settings section.
- [x] Add enable toggle, Exa provider field, masked key input, save, and test.
- [x] Keep the initial UI state disabled.
- [x] Verify the 480 x 560 settings layout without horizontal overflow.

## Step 3: Shared tool infrastructure

- [x] Define a bounded OpenAI-compatible `web_search` tool contract.
- [x] Treat search output as untrusted and ask the calling Agent to cite URLs.
- [x] Expose a reusable tool factory that creates workflow-owned tool
  registrations from the shared saved setting.
- [x] Ensure disabling search removes the tool from both Agent registries.

## Step 4: Meeting Coach Agent integration

- [x] Register `web_search` in the Meeting Coach tool registry only when the
  shared setting is enabled.
- [x] Keep Meeting Coach context, prompt, session, wake policy, cancellation,
  and UI publication owned by the meeting workflow.
- [x] Remove Fn-triggered wake suppression, Coach epoch invalidation, and
  Coach suspend/resume behavior.
- [ ] Verify Coach can search without an Fn action and can still return
  `SILENT` under the existing speaking policy.

## Step 5: Fn General Agent integration

- [x] Replace the one-shot Fn LLM completion with an independent bounded Agent
  loop.
- [x] Give the Fn Agent its own conversation, selected-text context, prompt,
  run identity, tool registry, and output path.
- [x] Register `web_search` in the Fn tool registry only when the shared setting
  is enabled.
- [x] Preserve existing Fn/Fn+Space arbitration inside the voice workflow.
- [x] Ensure Fn never routes through, cancels, suppresses, suspends, resumes, or
  publishes into Meeting Coach.

## Step 6: Verification

- [x] Add Rust tests for default-off config, wire serialization, Exa result
  normalization, tool schema, and argument bounds.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml --lib` for the
  completed configuration and adapter layer.
- [x] Run `pnpm build` against the current settings/configuration changes.
- [x] Enable search in the local Meetly profile and verify Exa connectivity.
- [x] Verify the configured LLM can issue `web_search` and complete a live
  three-step LLM -> Exa -> LLM loop with structured output and source URLs.
- [x] Add isolation tests proving simultaneous Fn and Coach runs do not cancel
  or suppress one another.
- [x] Add meeting-only race tests for Wake versus meeting Ask/Enter.
- [x] Run `pnpm test:voice-ask` after the independent Fn Agent is wired.
- [x] Run the Agent runtime regression suite after shared-Agent preemption is
  removed.
- [ ] Verify one live Meeting Coach turn that issues a search tool call.
- [ ] Verify one live Fn question that issues a search tool call.
