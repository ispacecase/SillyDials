# How Dials works

## What Dials changes, and what it doesn't

- **Your settings**: Dials' own provider settings are saved per *caller* (SillyTavern's chat, or another extension) × *connection* (the connection profile if one is selected, otherwise the source and endpoint address) × *model*. They live in SillyTavern's extension settings.
- **SillyTavern's own controls** (temperature, max length, prompts…) are SillyTavern's real controls, moved into Dials' panel. Changing them changes SillyTavern's settings exactly as before. Turning Dials off moves them back.
- **The outgoing request**: just before SillyTavern sends a chat request (`CHAT_COMPLETION_SETTINGS_READY`), Dials adds the provider settings you set. Nothing else is changed.

### On Custom (OpenAI-compatible) connections
SillyTavern forwards extra fields through *Include Body*. Dials merges its fields into **a copy** of your Include Body for that one request:

- Your own Include Body values **win**, key by key, including inside nested objects such as `venice_parameters`. SillyTavern's server merges only one level deep, so Dials does the deep merge itself to avoid wiping your nested values.
- If your Include Body can't be read, Dials leaves the request alone and says so.
- For streamed replies Dials adds `stream_options: {include_usage: true}` so the provider reports token usage (can be turned off in Tokens → Preferences).
- Settings you haven't set are **never sent**.

### On other sources (OpenRouter, OpenAI, Claude, Gemini…)
SillyTavern's server builds those requests from a fixed list of fields and drops anything else. Dials can't change that from the browser, so it doesn't pretend: provider settings aren't offered for sending, and Dials says so in the panel. To send extras to OpenRouter, use a Custom connection pointed at `https://openrouter.ai/api/v1`. Token counting still works on all sources.

## Where the settings come from

| Provider | Settings | Model details |
|---|---|---|
| Venice | Live OpenAPI spec (`docs.venice.ai/swagger.yaml`); a copy ships with Dials as a fallback | `/models` via SillyTavern's server: capabilities, per-model defaults (e.g. default thinking effort, allowed levels), context, max output, prices, privacy |
| Other Custom endpoints | The endpoint's own spec, if found at a usual address (`/openapi.json`, `/swagger.yaml`, `/v1/…`); otherwise common OpenAI-compatible extras | Whatever `/models` returns |
| OpenRouter | Common extras (not sendable on the OpenRouter source) | `/models`: description, prices, `supported_parameters` |

**Defaults** come from the model first (e.g. Venice's `defaultReasoningEffort`, or `constraints` for temperature/top P), then the spec's documented default. When nobody publishes one, Dials says so instead of guessing.

**Thinking** is one control even though providers have several overlapping fields (`reasoning_effort`, `reasoning.effort`, `reasoning.enabled`, `venice_parameters.disable_thinking`). Dials writes only the field this model understands and clears the others, so they can't contradict each other.

## Token counting

SillyTavern doesn't keep the provider's `usage` data, so Dials reads a copy of the reply:

- Dials tags its requests, then reads a clone of the response from SillyTavern's generate call (streamed or not). The tag is removed before the request leaves the browser.
- It understands OpenAI-style usage (incl. `completion_tokens_details.reasoning_tokens`), Anthropic's two-part usage and Gemini's `usageMetadata`.
- *Reply* = completion tokens minus thinking tokens. *Thinking* is shown only when the provider reports it.
- Background ("quiet") requests count toward totals but don't get a line on a message.

## Other extensions

Other extensions can register as their own *caller* with separate settings and usage. Dials has no code for any particular extension and works the same without them. See [api.md](api.md).

## Known limits

- Provider settings can only be **sent** on Custom connections (see above).
- Providers that publish no spec show only common extras; use *Extra fields* for anything else.
- Prices and costs are list prices from the provider's model list.
- Some models ignore some values. Dials shows tested notes where known (e.g. a Venice model that ignores thinking "low").
