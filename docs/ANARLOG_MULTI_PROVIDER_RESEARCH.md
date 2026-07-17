# Anarlog Multi-Provider Architecture Research

Date: 2026-07-17
Status: Research complete; implementation decision requires a bounded spike
Reference repository: `/Users/zhujianye/maidang/anarlog`

## 1. Executive Summary

Meetly should borrow Anarlog's multi-provider architecture. The part worth
borrowing is not only its use of Vercel AI SDK, but the complete separation of:

1. provider and model selection;
2. provider eligibility and configuration;
3. model discovery and capability filtering;
4. a normalized model execution interface;
5. hosted routing, retry, fallback, and observability.

The earlier conclusion that Meetly should not consider Vercel AI SDK because it
already depends on `pi-ai` was too narrow. Anarlog is evidence that Vercel AI
SDK works in a Tauri desktop application with direct BYOK providers, local
models, streaming generation, tool-capable models, and a hosted gateway.

However, copying its dependencies directly would not yet solve Meetly's main
architectural conflict. Meetly currently has two LLM execution paths:

- Rust `LlmProvider` for Voice Ask, reports, and Dictation Polish;
- TypeScript `pi-agent-core + pi-ai` for proactive Coach.

Adding AI SDK without first defining one canonical `LlmRuntime` boundary would
create a third execution model. The recommended decision is therefore:

> Adopt Anarlog's architecture now. Treat Vercel AI SDK as the preferred
> candidate for the normalized TypeScript model runtime, but require a small
> compatibility and security spike before replacing `pi-ai` in Coach.

This is a positive recommendation to learn from Anarlog, with an explicit
validation boundary rather than an unconditional dependency swap.

## 2. Project Evidence

At the time of research, the public repository `fastrepl/anarlog` had 8,828
GitHub stars and 671 forks, used the MIT license, and had been updated on
2026-07-17. Its README describes a local-first meeting notetaker with BYOK
support for OpenAI, Anthropic, Gemini, OpenRouter, Ollama, LM Studio, and
OpenAI-compatible providers.

The repository was inspected locally rather than inferred from its README. The
main evidence paths are:

- `apps/desktop/package.json`;
- `apps/desktop/src/ai/hooks/useLLMConnection.ts`;
- `apps/desktop/src/settings/ai/llm/shared.tsx`;
- `apps/desktop/src/settings/ai/llm/select.tsx`;
- `apps/desktop/src/settings/ai/shared/list-*.ts`;
- `apps/desktop/src/settings/ai/shared/model-capabilities.ts`;
- `packages/store/src/zod.ts`;
- `crates/llm-proxy/`;
- `crates/openrouter/`.

The Anarlog checkout contained unrelated untracked Bubble work during this
research. No files in that repository were changed.

## 3. How Anarlog Actually Works

### 3.1 Provider configuration is separate from active selection

Anarlog stores the active choices independently:

```text
current_llm_provider
current_llm_model
current_stt_provider
current_stt_model
```

Provider rows store type, base URL, and API key. The selected provider points
to one of these rows instead of embedding provider-specific fields into every
workflow.

This lets the settings UI change a provider or model without changing Chat,
Title, Enhance, or other task code.

### 3.2 The provider catalog is product-owned

`apps/desktop/src/settings/ai/llm/shared.tsx` declares the providers users can
select and their configuration requirements. It currently includes:

- Anarlog hosted service;
- LM Studio;
- Ollama;
- OpenRouter;
- OpenAI;
- Cloudflare Workers AI;
- Anthropic;
- Mistral;
- Azure OpenAI;
- Azure AI Foundry;
- Google Gemini;
- custom OpenAI-compatible endpoints.

The catalog owns display names, default endpoints, setup links, and eligibility
requirements. Vercel AI SDK does not own this product policy.

### 3.3 Model discovery is provider-specific

Anarlog does not use one generic `/models` parser for every provider. It has
dedicated discovery code for OpenAI, Anthropic, Google, OpenRouter, Azure,
Mistral, Cloudflare, Ollama, and LM Studio.

Each discovery adapter:

- sends the provider's required authentication and headers;
- validates the response schema;
- filters non-chat, obsolete, or unsupported models;
- sorts usable models;
- attaches capability metadata such as image input;
- returns an empty safe result on timeout or invalid responses.

Ollama receives additional handling: Anarlog queries installed and running
models and filters out models that lack completion or tool capabilities.

This is an important lesson: a multi-provider SDK normalizes generation calls,
but model catalogs and model eligibility remain application responsibilities.

### 3.4 Vercel AI SDK is the normalized client execution layer

`useLLMConnection.ts` resolves saved configuration into one connection object
and then maps it to one AI SDK `LanguageModel`.

The provider factory uses:

- `createOpenAI`;
- `createAnthropic`;
- `createGoogleGenerativeAI`;
- `createAzure`;
- `createOpenAICompatible`;
- `createOpenRouter`.

All upper workflows receive the same `LanguageModel` type. They call
`generateText` or `streamText` without branching on provider names.

AI SDK middleware also normalizes `<think>` and `<thinking>` output. The task
layer supplies task policy such as temperature, output schema, retry count,
maximum output tokens, cancellation, and validation fallback.

This boundary is the strongest part of the design:

```text
Provider config -> LanguageModel factory -> generateText / streamText -> task
```

### 3.5 Direct BYOK and hosted routing are different paths

Anarlog supports two materially different operating modes.

Direct BYOK:

```text
Desktop WebView
  -> AI SDK provider
  -> Tauri HTTP fetch
  -> OpenAI / Anthropic / Google / local server
```

Hosted Anarlog:

```text
Desktop WebView
  -> OpenRouter AI SDK provider pointed at /llm
  -> hosted Rust llm-proxy
  -> task/capability model resolver
  -> OpenRouter model list and provider routing
```

The Rust proxy does not implement every public provider. Its current provider
implementation is OpenRouter. It resolves a list of models based on task,
tool-calling needs, and audio input, then sends the ordered list to OpenRouter.
OpenRouter owns provider/model fallback within that list.

This is why Anarlog can offer both arbitrary BYOK and an operationally managed
hosted service without forcing the two paths to have identical internals.

### 3.6 Retry, fallback, and observability live at different layers

Anarlog does not treat all recovery as one generic retry switch.

- AI SDK tasks configure bounded request retries and cancellation.
- Some workflows perform semantic validation and retry with feedback.
- The Rust proxy retries connect and timeout failures with bounded exponential
  backoff.
- OpenRouter receives multiple candidate models and can route or fall back.
- The proxy records provider, requested and resolved model, streaming mode,
  message count, task, latency, token usage, generation ID, and cost.

This layered treatment is more mature than saying "the provider adapter should
retry". Transport retry, semantic retry, and provider fallback have different
correctness rules.

## 4. Why This Architecture Fits Anarlog

Anarlog's product and runtime make AI SDK a natural choice:

1. Most LLM workflows already live in TypeScript and React.
2. Its workloads are conventional text generation, structured generation,
   streaming summaries, titles, and chat.
3. A broad BYOK provider surface is a primary product promise.
4. Tauri HTTP bypasses browser CORS limitations for direct provider calls.
5. Hosted users can be routed through one OpenAI-compatible service boundary.
6. AI SDK supplies a well-supported common model interface and provider
   ecosystem, so Anarlog does not maintain every wire protocol itself.

Its popularity does not prove every decision is correct for Meetly, but it does
raise the evidence bar. We should not reject this design without testing the
specific incompatibilities.

## 5. Costs and Constraints in Anarlog's Design

### 5.1 API keys enter the frontend runtime

For direct BYOK, Anarlog's provider row contains `api_key`, and
`useLLMConnection.ts` passes it into an AI SDK provider inside the WebView.
This is a deliberate desktop architecture trade-off, but it conflicts with
Meetly's documented rule that API keys remain in the native credential
boundary and never return to React in plaintext.

Meetly should borrow the provider factory shape, not silently weaken its
credential boundary.

### 5.2 AI SDK does not replace the provider catalog

Anarlog still owns provider definitions, eligibility, model discovery,
filtering, local-model special cases, and model capability heuristics. The SDK
removes generation-protocol duplication; it does not remove product-specific
provider work.

### 5.3 Direct BYOK does not provide universal cross-provider fallback

AI SDK's request retries are not equivalent to selecting another provider and
credential set. Anarlog gets hosted fallback from its Rust proxy plus
OpenRouter, not from the direct BYOK provider switch.

### 5.4 Some capability detection remains heuristic

Image support for several model families is inferred from model IDs. That is a
reasonable fallback, but capability metadata can drift as providers add new
models. Meetly should prefer provider metadata where available and record the
source and confidence of inferred capabilities.

### 5.5 The hosted proxy is a service, not a local secret broker

Anarlog's `llm-proxy` protects the hosted OpenRouter credential and centralizes
model policy. It does not demonstrate a local Keychain-backed relay for direct
BYOK secrets. Meetly still needs to design that boundary if TypeScript owns
provider execution.

## 6. Meetly Comparison

| Concern | Anarlog | Meetly today | Implication |
|---|---|---|---|
| Product runtime | Most LLM tasks in TypeScript | Coach in TypeScript; Ask/report/polish in Rust | Meetly must first define one runtime boundary |
| Client abstraction | AI SDK `LanguageModel` | Coach uses `pi-ai Model`; Rust uses `LlmProvider` | A direct SDK install would add a third abstraction |
| Agent loop | AI SDK task workflows | `pi-agent-core` with tool streaming and persistent messages | AI SDK needs an event/tool adapter or Agent replacement |
| Provider catalog | Rich product-owned catalog | One LLM adapter ID plus MiMo for STT | Anarlog's catalog design is directly reusable |
| Model discovery | Per-provider dynamic listing | User enters a model string | Dynamic discovery would materially improve settings |
| Credentials | API key available in WebView for direct BYOK | Keychain exists, but Coach currently receives raw key over IPC | Meetly must close an existing security contradiction |
| Hosted routing | Rust proxy -> OpenRouter | None | Gateway mode is a strong optional addition |
| Fallback | Model lists through OpenRouter | Timeout retry in selected workflows | Provider fallback must be explicitly designed |
| Proactive concurrency | Conventional user-started tasks | Wake and user actions can race | Abort and run identity are correctness requirements |

## 7. What Meetly Should Borrow

### 7.1 Borrow directly

- Separate active provider/model selection from provider configuration.
- Maintain a product-owned provider catalog with typed requirements.
- Add per-provider model discovery and safe filtering.
- Return one normalized model/runtime object to application workflows.
- Keep task policy outside provider adapters.
- Separate transport retry, semantic retry, and provider fallback.
- Add task/model/provider/token/latency/cost observability.
- Offer a hosted or user-configured gateway as a separate provider profile.

### 7.2 Borrow with changes

- Use native secure storage and do not persist raw API keys in provider rows.
- Preserve Meetly's explicit ASR and LLM separation.
- Make capabilities typed and source-aware instead of relying primarily on
  model-name regular expressions.
- Bind every LLM attempt to `runId`, `triggerId`, and `AbortSignal`.
- Prevent gateway or retry logic from publishing a stale proactive response.

### 7.3 Do not copy blindly

- Do not expose Keychain secrets to React just to match Anarlog's direct BYOK
  implementation.
- Do not put provider switches inside Coach, Ask, or Dictation hooks.
- Do not assume AI SDK request retries provide provider fallback.
- Do not migrate Coach from `pi-ai` until tool-call and streaming event parity
  is tested.
- Do not force STT through an LLM-focused abstraction.

## 8. Dependency Decision

Three choices are viable, but they solve different problems.

| Option | Strength | Main cost | Recommended use |
|---|---|---|---|
| Vercel AI SDK | Broad ecosystem, structured output, middleware, familiar generation API | Requires adapting or replacing `pi-agent-core` stream events | Preferred candidate for a canonical TypeScript LLM runtime |
| Existing `pi-ai` | Native fit with `pi-agent-core`, model catalog, tool streaming, provider and gateway support | Smaller ecosystem and currently used only through a hard-coded OpenAI path | Baseline and fallback candidate for Coach |
| OpenRouter/Vercel AI Gateway | Operational routing and cross-provider fallback | External service dependency, routing cost and privacy policy | Gateway provider profile, not the app's only SDK |

The decision should not be "AI SDK versus gateway". A client SDK normalizes
protocols; a gateway performs operational routing. Meetly may use both.

## 9. Recommended Target Architecture

```text
                          ProviderProfileStore
                          NativeCredentialStore
                                   |
                                   v
                         ProviderCatalogService
                         /          |          \
                        v           v           v
                 ModelDiscovery  Eligibility  Diagnostics
                        \           |          /
                         v          v         v
                         Canonical LlmRuntime
                         /                  \
                        v                    v
             Direct provider adapter     Gateway adapter
             AI SDK or pi-ai             OpenRouter/Vercel
                        \                    /
                         v                  v
                      Application services
               Coach / Ask / Report / Dictation Polish
```

Product workflows continue to own prompts, context, timeouts, fallback meaning,
and UI. The runtime owns model protocol, streaming normalization, usage, and
provider error normalization.

For proactive Coach, the call contract must include:

```ts
type LlmRunContext = {
  runId: string;
  triggerId: string;
  priority: "user" | "wake";
  signal: AbortSignal;
};
```

When a user action and wake occur together:

1. the user run has priority;
2. the wake run is aborted or suppressed before publication;
3. retries and gateway fallbacks reuse the original run identity;
4. every delta verifies that the run is still current;
5. only one terminal result may update the Coach UI;
6. stale attempts remain observable in logs but invisible to the user.

Provider abstraction must preserve these rules rather than hiding concurrency
behind automatic retries.

## 10. Proposed Validation Spike

Before choosing AI SDK or keeping `pi-ai`, implement the same minimal Coach
turn behind two temporary `LlmRuntime` adapters. This is an architectural test,
not production dual-stack support.

The spike must prove:

1. text streaming produces identical UI deltas;
2. `read_file` and `web_fetch` tool calls round-trip correctly;
3. usage and finish reasons are normalized;
4. timeout and cancellation stop the actual network stream;
5. a simultaneous user action supersedes a wake attempt;
6. a fallback attempt cannot publish after supersession;
7. API keys remain outside React state and logs;
8. OpenAI-compatible, Anthropic, and one gateway model pass the same contract
   tests;
9. time to first token and total latency do not regress materially;
10. package size and cold-start impact are measured.

Acceptance rule:

- Choose AI SDK if it passes all correctness and credential-boundary tests and
  the `pi-agent-core` adapter remains small and mechanical.
- Keep `pi-ai` if AI SDK requires duplicating Agent message state, tool-loop
  semantics, or provider protocol parsing.
- In either case, adopt Anarlog's catalog, discovery, eligibility, gateway, and
  observability layers.

## 11. Proposed OpenSpec Scope

Suggested change name:

```text
adopt-multi-provider-llm-runtime
```

Suggested phases:

1. Define the canonical `LlmRuntime` and run/cancellation contract.
2. Add provider profiles, eligibility, and model discovery contracts.
3. Close the raw API-key IPC leak.
4. Run the AI SDK versus `pi-ai` compatibility spike.
5. Select and implement one runtime.
6. Add OpenRouter or Vercel AI Gateway as an explicit provider profile.
7. Migrate Coach first, then Ask/report/polish one workflow at a time.
8. Add observability and concurrent wake/user regression tests.

Each phase should stop at a tested boundary. The implementation should not
combine provider migration with changes to Coach wake policy or visible UI.

## 12. Final Recommendation

Anarlog is the right project to learn from, and Meetly should borrow more from
it than a list of provider packages.

The correct adoption is:

- yes to its provider catalog and model discovery structure;
- yes to its normalized language-model boundary;
- yes to separating direct BYOK from hosted gateway routing;
- yes to Vercel AI SDK as a serious, preferred candidate;
- no to copying its WebView credential trade-off;
- no to installing AI SDK before Meetly defines a canonical runtime;
- no to allowing provider retry/fallback to bypass wake/user arbitration.

The next engineering action should be the bounded compatibility spike, followed
by an ADR based on measured results. This gives Anarlog's proven design the
weight it deserves without importing an incompatible execution model by
assumption.
