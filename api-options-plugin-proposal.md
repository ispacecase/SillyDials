# Proposal: API Options + Token Counter, a separate SillyTavern extension

**Status:** approved as a separate plugin (2026-11-14). Not started.
**Origin:** came out of Storyloom work. Storyloom is at `/home/cody/projects/silly/Storyloom` (GitHub `ispacecase/Storyloom`), currently 0.13.1.

## Why

1. **SillyTavern hides most of what an API can do.** The connection panel only shows the common sliders. Providers like Venice have many more settings: turning thinking off, hiding thinking, web search, Venice's own system prompt, per-model extras. Today the only way to use them is typing YAML into *Additional Parameters → Include Body Parameters*.
2. **SillyTavern quietly drops some of its own settings.** On a **Custom (OpenAI-compatible)** connection, which is how Venice is used, SillyTavern sends *Reasoning Effort* only when the model is one of OpenAI's own or a koboldcpp model. For deepseek on Venice, "Low" never reached the provider, so the model thought for 8,000+ words and sometimes wrote nothing.
   - Where in the code: `src/endpoints/backends/chat-completions.js`, the block that starts *"A few of OpenAIs reasoning models support reasoning effort"* (about line 2600 in the current release). The Custom branch (about line 2394) forwards extra fields only through `custom_include_body`.
   - Storyloom 0.13.1 already works around this one setting. See *Storyloom integration* below.
3. **You can't see where the tokens go.** A reply that stopped mid-sentence was blamed on the token limit, but no number showed what was used. The thinking tokens in particular are invisible.

## What the extension does

### 1. Options read from the provider, not hard-coded
- **Venice:** read the OpenAPI spec (`https://api.venice.ai/doc/api/swagger.yaml`, mirrored at `https://docs.venice.ai/swagger.yaml`). The chat-completions request schema lists every accepted field, including `venice_parameters`, with descriptions, types, enums and defaults.
  - Read `GET /models?type=text` (`model_spec.capabilities`, e.g. `supportsReasoning`, `supportsWebSearch`, `supportsFunctionCalling`) so each model shows only the options it supports.
  - Pricing is in `model_spec.pricing`, for the token counter's cost line.
- **OpenRouter:** read `GET /models`. Each model has `supported_parameters` and pricing.
- **Any other OpenAI-compatible endpoint:** try the usual spec addresses (`/openapi.json`, `/openapi.yaml`, `/swagger.json`, `/swagger.yaml`, `/doc/api/swagger.yaml`, plus `/v1/` variants). If there isn't one, fall back to the standard OpenAI chat-completions fields, plus a free-form "extra field" row.
- Cache the spec and model list per endpoint, with a **Refresh** button. Requests go through SillyTavern's server (or the browser with the user's own key), never to anything other than the provider the user already uses.

### 2. Panel
- A drawer in the Extensions menu, plus a small button near the connection settings.
- One control per option, generated from the schema:
  - booleans → checkbox
  - enums → dropdown
  - numbers → number field with min/max
  - strings → text
  - nested objects (e.g. `venice_parameters`) → grouped
- Each option shows its description from the spec and starts **unset**. Unset options are never sent, so nothing changes until the user picks something.
- Saved **per connection profile and model**, so each provider/model keeps its own settings.
- A "what will be sent" preview showing the exact extra JSON.

### 3. Sending
- Hook `event_types.CHAT_COMPLETION_SETTINGS_READY`, which runs just before SillyTavern posts to `/api/backends/chat-completions/generate`, and merge the chosen options into the request:
  - **Custom source:** into `custom_include_body` (YAML/JSON). The server merges that into the provider request.
  - **Other sources:** check per source which fields the server forwards. Where it drops one, explain that in the panel instead of pretending it was sent.
- Never override a value the user typed into Include Body themselves.
- Never change the user's preset, sliders or connection settings. The extension only changes the outgoing request.

### 4. Token counter
- **Real usage from the provider:**
  - Add `stream_options: {include_usage: true}` for streamed requests.
  - Read the final `usage` from the reply: `prompt_tokens`, `completion_tokens`, `completion_tokens_details.reasoning_tokens` where present.
  - Read it by teeing the response of SillyTavern's generate fetch, since SillyTavern doesn't keep `usage` on the message.
- **Shown per reply:** a small line on each message, e.g. *Prompt 18,400 · Thinking 2,100 · Reply 1,350*, stored in `message.extra` so it survives reloads.
- **Against the limit:** warn when thinking + reply comes near Max Response Length, or the provider's own output cap (Venice lists caps per model). This would have caught both the cut-off chapter and the all-thinking, no-answer replies.
- **Totals:** per chat and per day, plus cost when the provider publishes prices.
- **Before sending (optional):** prompt size and what's using it (lorebook, history, extension prompts), from SillyTavern's own counter, labelled *estimate*.
- If a provider reports no usage, fall back to SillyTavern's tokenizer and label it as an estimate.

### 5. For other extensions
Expose the chosen options and the last usage, e.g. `window.ApiOptions = {get(profile, model), lastUsage()}` or an event, so **Storyloom** can:
- apply the same options to its own calls (it makes its own requests through `ChatCompletionService.processRequest` / `ConnectionManagerRequestService.sendRequest`, which don't run that event);
- replace its token *estimate* in the "reply stopped mid-sentence" warning with real numbers.

## Storyloom integration (already in place)
- 0.13.0: Storyloom's own calls send `reasoning_effort: low` (setting *Keep Storyloom's own thinking short*). On Custom endpoints this goes through `custom_include_body` via `withIncludeBody()` in `generation.mjs`.
- 0.13.1: for the story chat, Storyloom hooks `CHAT_COMPLETION_SETTINGS_READY` and adds SillyTavern's own Reasoning Effort to `custom_include_body` (setting *Send SillyTavern's Reasoning Effort to Custom endpoints*).
- Once the new extension exists, Storyloom should **step aside** when it's installed (no double handling) and read options and usage from it.

## Ground rules from the owner (carry these over)
- **Never touch the owner's own SillyTavern data, backups, keys or sliders.** Build and test on a separate test install.
  - The existing one is at `/home/cody/projects/silly/st-test` (app in `st-test/app`, data in `st-test/data`, port **8030**, launch config "storyloom-test-st" in `/home/cody/projects/silly/.claude/launch.json`).
  - Stay out of port 8994. Don't start servers on the owner's ports, and don't leave background servers running.
- Never copy API keys or secrets anywhere.
- The owner decides design: propose, then wait for a yes. Never quietly reverse a recorded decision.
- Anything the extension changes outside its own data gets a backup first. It should change nothing outside the outgoing request, so this should rarely come up.

## Open questions for the owner
1. Name and repo, e.g. `ispacecase/ApiOptions`?
2. Which providers first? Suggest Venice, then OpenRouter, then generic.
3. Should the token counter show cost by default, or only when switched on?
4. Should options be saved per profile + model (proposed), or per preset?

## Sources
- [Venice OpenAPI spec](https://docs.venice.ai/swagger.yaml) · [Venice API spec page](https://docs.venice.ai/api-reference/api-spec.md) · [Venice API reference](https://docs.venice.ai/api-reference)
- [Venice chat completions](https://docs.venice.ai/api-reference/endpoint/chat/completions.md) · [Venice models list](https://docs.venice.ai/api-reference/endpoint/models/list.md) · [Venice model traits](https://docs.venice.ai/api-reference/endpoint/models/traits.md)
- [Venice model feature suffixes](https://docs.venice.ai/api-reference/endpoint/chat/model_feature_suffix)
- [Venice DeepSeek V4 Flash model page](https://venice.ai/models/deepseek-v4-flash) (output caps per variant)
- [Venice models skill (skills.sh)](https://skills.sh/veniceai/skills/venice-models) · [Venice chat skill (skills.sh)](https://skills.sh/veniceai/skills/venice-chat)
