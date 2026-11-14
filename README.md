# Dials

**Every setting your AI provider offers, explained in plain words, plus the real token count for every reply.**

Dials is a SillyTavern extension. It replaces SillyTavern's AI Response Configuration panel (the sliders button, top left) with a cleaner one:

- **All the settings, not just the common sliders.** Dials asks your provider which settings it accepts (Venice's live API spec, for example) and shows every one of them. Each model only shows what it supports.
- **Every setting explained.** A plain-language explanation under each one, plus the provider's own note. Settings you haven't touched are greyed out and show the model's real default (*"Not sent. The model uses its default: High"*), never "null".
- **Real token counts.** Each reply gets a line like *Prompt 18,400 · Thinking 2,100 · Reply 1,350*, read from the provider's own usage data. A bar above the chat box shows the last reply and the chat's total, and warns when a reply was cut off at the limit or spent everything on thinking.
- **Use-case presets.** Default, Roleplay, Novel, Assistant, Brainstorm, or your own. One click sets sensible values for the current model, with Undo. Presets never touch repetition/frequency/presence penalties.
- **Nothing hidden from you, nothing changed behind your back.** Dials only adds to the outgoing request. Your typed Include Body values always win, and turning Dials off puts SillyTavern's own panel back exactly as it was.

## Install

1. In SillyTavern, open **Extensions** (the boxes icon) → **Install extension**.
2. Paste `https://github.com/ispacecase/SillyDials` and install.
3. Click the **sliders button** (top left). You'll see Dials instead of SillyTavern's panel.

Requires SillyTavern **1.19.0** or later and a **Chat Completion** connection.

## Quick start

1. Connect as usual (for Venice: *Chat Completion → Custom (OpenAI-compatible)*, URL `https://api.venice.ai/api/v1`, your key, a model).
2. Open Dials (sliders button). The **Recommended** tab shows the model card and the settings most people touch: temperature, length, context size, Thinking, Show thinking, streaming, and the provider's own switches (e.g. Venice's system prompt, web search).
3. Pick a **Use case** at the top and click **Apply**, or set things by hand.
4. Chat. Watch the token line under each reply and the bar above the chat box.

More in the [user guide](docs/user-guide.md).

## Provider support

| Connection | Settings Dials can read | Settings Dials can send | Real token counts |
|---|---|---|---|
| **Venice** (Custom, `api.venice.ai`) | Full: live API spec + model list (capabilities, defaults, prices) | Yes | Yes |
| **Other OpenAI-compatible endpoints** (Custom) | The endpoint's own spec if it publishes one, otherwise common OpenAI extras | Yes | Yes, if the endpoint reports usage |
| **OpenRouter** (its own source) | Model list (description, prices, accepted settings) | No. SillyTavern only forwards a fixed list for this source; use a Custom connection to `https://openrouter.ai/api/v1` to send extras | Yes |
| **Other built-in sources** (OpenAI, Claude, Gemini…) | Whatever the model list returns (often little) | No (same reason) | Yes, where the provider reports usage |

Details and the reasons behind each limit: [how it works](docs/how-it-works.md).

## Privacy

- Dials only talks to **your own provider**, through SillyTavern's server (your key stays there). The one exception is Venice's public API spec, read from `docs.venice.ai`.
- It never sends your chats or keys anywhere else, and stores nothing outside SillyTavern's own settings and your chat files.

## Docs

- [User guide](docs/user-guide.md): the panel, presets, Thinking, the token counter, settings.
- [How it works](docs/how-it-works.md): what Dials changes in a request, provider details, limits.
- [For extension developers](docs/api.md): `window.Dials`, so another extension can use Dials' settings and token counts.
- [Changelog](CHANGELOG.md) · [Design decisions](DECISIONS.md)

## Development

```bash
npm test
```

The pure logic (spec reading, request building, usage reading, presets, layout) lives in `src/` and is covered by Node's built-in test runner. `tools/fake-provider.mjs` is a small fake OpenAI-compatible provider for browser testing; `tools/snapshot-venice.mjs` refreshes the bundled Venice spec copy in `data/`.
