# Proposal: add-configurable-agent-web-search

## Why

Meetly has two different assistant workflows that can benefit from current
public information:

- Meeting Coach observes a live meeting and may proactively intervene after a
  meeting wake;
- Fn Voice Ask is a general desktop assistant started explicitly by the user.

Today, Fn Voice Ask ends after one LLM completion, so it cannot decide to use a
tool. Coach has an older Exa-backed `web_fetch` path, but search is implicit and
has no user-facing opt-in setting.

Web search sends a model-generated query to an external service, so it must be
an explicit capability rather than a hidden default. Users who do not enable
it must keep the existing non-search behavior. Adding the same capability to
both workflows must not merge their Agent instances or lifecycle policies.

## What

- Add one project-wide Web Search setting with `enabled=false` by default.
- Support Exa as the initial search provider.
- Store the Exa API key in the existing local credential store and never return
  it to React.
- Add Settings controls to enable search, save the Exa key, and test the
  connection.
- Expose a bounded `web_search` tool to the Meeting Coach Agent when search is
  enabled.
- Replace Fn Voice Ask's one-shot LLM call with an independent Fn General Agent
  loop, and expose the same optional `web_search` tool to that Agent.
- Keep the Meeting Coach Agent and Fn General Agent separate in context,
  prompt, session, runtime, tool registry, priority, cancellation, and output.
- Normalize Exa results to title, URL, and bounded snippet text.
- Treat search results as untrusted reference material and require source URLs
  in answers that use search.

## Non-goals

- Search is not enabled by default.
- No autonomous background browsing outside an Agent run.
- No second search provider in this change.
- No browser automation or authenticated-page access.
- No change to Fn/Fn+Space shortcut arbitration.
- No change to proactive Coach wake policy.
- No shared Agent instance, session, prompt, or cancellation policy between Fn
  and Meeting Coach.
- No change to the independent Fn+Space Dictation workflow.
- No multi-provider LLM runtime migration.
