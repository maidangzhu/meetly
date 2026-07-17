# Design: add-configurable-agent-web-search

## 1. Behavior Contract

Meetly has one configurable Web Search capability that can be installed into
two independent Agent runtimes:

```text
                          WebSearchConfig
                    enabled=false by default
                                 |
                       Exa adapter + secret
                         /               \
                        v                 v
          Meeting Coach tool        Fn Agent tool
               registry               registry
                    |                     |
          Meeting Coach Agent       Fn General Agent
```

When search is disabled, neither Agent receives `web_search` and neither sends
queries to Exa. Both Agents continue to work with their own non-search behavior.
Enabling search changes tool availability only; it does not combine the two
runtimes.

The third voice workflow remains separate:

```text
Fn+Space -> record -> STT -> optional polish -> paste
```

Dictation does not become an Agent and does not receive `web_search`.

## 2. Storage and Commands

Non-secret configuration is stored under the Tauri app data directory:

```json
{
  "enabled": false,
  "provider": "exa"
}
```

The Exa API key uses the existing local credential store entry `exa_api_key`.
The credential file remains owner-readable only (`0600`) and the key is never
returned through the Web Search settings commands.

Commands:

```text
get_web_search_config() -> { enabled, provider, hasApiKey }
save_web_search_config(enabled, provider, apiKey) -> settings
test_web_search_config() -> DiagnosticResult
web_fetch(query, limit) -> WebFetchResult
```

An empty key on save keeps the existing secret. Enabling without a configured
key fails. `test_web_search_config` may test a stored key while the capability
is disabled, so a user can validate configuration before opting in.

The saved setting, credential, Exa transport, normalized result type, argument
schema, and safety rules are shared infrastructure. Agent state is not shared.

## 3. Meeting Coach Agent

```text
meeting audio
  -> STT / meeting event journal
  -> semantic wake policy
  -> Meeting Coach Agent
       context = meeting transcript + goal + meeting documents
       prompt = Coach behavior contract
       tools = Coach tool registry
         search disabled -> no web_search
         search enabled  -> optional web_search
  -> Coach speaking policy
  -> Coach UI
```

The Coach owns proactive meeting behavior. It may call `web_search` when fresh
public information would materially improve a meeting intervention. A meeting
wake is not caused by Fn, and Fn state is not part of the Coach wake gate.

Manual Ask/Enter inside the meeting remains a Meeting Coach interaction. Its
priority and wake-race behavior are defined in
`docs/PROACTIVE_COACH_BEHAVIOR.md`.

## 4. Fn General Agent

```text
Fn press/release
  -> microphone clip
  -> STT question
  -> Fn General Agent
       context = Fn conversation + selected desktop text
       prompt = general desktop-assistant behavior
       tools = Fn tool registry
         search disabled -> no web_search
         search enabled  -> required for explicit/current requests
  -> current Fn run check
  -> voice overlay answer
```

This replaces the existing one-shot Fn LLM completion with a bounded Agent
loop. The initial loop has at most three model steps and at most one successful
search attempt. A second search request receives a tool error instructing the
model to answer from the existing result.

The first model step uses a required `web_search` tool choice when the latest
spoken request explicitly asks to search or clearly asks for current/recent
information. Current-information searches use a bounded publication-date
window and expose normalized `publishedDate` values to the model. Tool calls,
bounded results, and final response previews are correlated by the Fn run ID in
the local debug log; credentials and rejected private queries are never logged.

The tool schema accepts:

```json
{
  "query": "2-300 characters of public concepts",
  "limit": 3
}
```

The first implementation uses the current OpenAI-compatible LLM adapter
contract. Other native LLM protocols must prove tool-call compatibility before
the tool is advertised for them.

Fn conversation state, selected-text context, prompt, run identity, tool
registry, cancellation, and UI publication belong only to the Fn Agent. They
must not be stored in or routed through the Meeting Coach Agent.

## 5. Runtime Isolation

The two Agents may use the same provider profile and the same tool factory, but
they are separate application services:

| Concern | Meeting Coach Agent | Fn General Agent |
|---|---|---|
| Trigger | Meeting STT and wake policy; meeting Ask/Enter | Native Fn voice action |
| Context | Meeting transcript, goal, meeting documents | Fn conversation and selected desktop text |
| Prompt | Proactive meeting coaching | General desktop assistance |
| Session | Meeting session | Fn conversation/run |
| Priority | Meeting wake priority | Fn run priority only |
| Cancellation | Meeting session/epoch rules | Fn/Fn+Space run rules |
| Output | Coach panel/cards | Voice overlay |

The following behaviors are forbidden:

- routing Fn through a `user.manual_ask` trigger on the Coach Agent;
- sharing one Agent instance or conversation between the workflows;
- clearing Coach wakes when Fn starts;
- invalidating a Coach publication epoch because Fn starts;
- ignoring meeting wakes while Fn is active;
- suspending or resuming Coach around an Fn run;
- publishing either Agent's result into the other workflow's UI or history.

Fn and Coach may run concurrently. Each validates only its own run/session
identity before publishing.

## 6. Privacy and Prompt-Injection Boundary

- Search queries may contain public concepts only.
- Selected private text, private meeting transcript, personal identifiers,
  credentials, and large verbatim passages must not be sent to Exa.
- Search results are untrusted data, never system instructions.
- Exa responses are reduced to title, HTTP(S) URL, and bounded snippet text.
- Logs record query length, limit, stage, result count, and calling workflow,
  not API keys or the full query.
- Answers using search should synthesize the result and include relevant source
  URLs instead of dumping a raw result list.

## 7. Cancellation and Race Boundaries

This change does not alter native Fn/Fn+Space transition rules:

- `Fn+Space` may supersede an active Fn Agent run;
- a cancelled or superseded Fn run cannot publish an answer;
- the Fn workflow checks its current `runId` after STT, tool calls, and LLM
  completion;
- search completion does not revive a stale Fn run.

Meeting wake races remain entirely inside the meeting workflow:

- a manual meeting Ask/Enter may supersede a proactive Coach wake;
- simultaneous meeting Wake and Ask/Enter produce one meeting answer;
- a stopped or replaced meeting session rejects late Coach callbacks.

An Fn action does not participate in those meeting races. Simultaneous Fn and
Coach work is allowed and neither workflow cancels, queues, suppresses, or
resumes the other.

The current Tauri invoke cannot abort every in-flight Rust HTTP request. Each
workflow must therefore reject stale publication independently even if its own
provider request finishes after cancellation.

## 8. Failure Behavior

- Disabled search: the tool is absent from both registries; no Exa request is
  possible.
- Missing key while enabling: Settings save fails with an actionable message.
- Exa transport/API failure: the calling Agent receives a tool error and may
  answer without claiming fresh search evidence.
- Invalid tool arguments: a bounded validation error is returned to the
  calling Agent.
- Fn Agent exceeds the step budget: Voice Ask returns a normal failure and the
  overlay remains retryable through the existing flow.
- Coach search fails or times out: Coach applies its own failure/speaking policy
  without affecting Fn.
