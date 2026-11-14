# `window.Dials`: for extension developers

Dials exposes a small API so another extension can give its own AI calls their own Dials settings and get real token counts. **Always check `window.Dials` at call time and keep working without it**; Dials is optional.

```js
const dials = window.Dials; // undefined when Dials isn't installed
```

## `version`
String, e.g. `"0.2.3"`.

## `registerCaller(id, { label, getConnection, inheritsFrom? })`
Registers your extension as a caller. Its settings are kept separately from SillyTavern's chat, and a **Settings for** picker appears in Dials.

- `id`: string, not `"sillytavern"`.
- `label`: shown in the picker.
- `getConnection()`: returns the connection your extension is using **right now**: `{ profileId?, source, url?, model, statusPayload? }`. `source` is SillyTavern's `chat_completion_source` (`'custom'` for Venice and other OpenAI-compatible endpoints), `url` the Custom endpoint URL. `statusPayload` (optional) is the body Dials posts to `/api/backends/chat-completions/status` to read the model list.
- `inheritsFrom()` (optional): return another caller's id (usually `'sillytavern'`) if your extension builds on that caller's settings. Dials then shows *"… is using SillyTavern chat's settings, plus the ones set here"* and the combined result. Dials doesn't merge for you; use `getOptions` (below).

Calling it again with the same id replaces the registration.

## `prepare(callerId, payload, conn?)` → `{ tag, sent, notSent, overridden, problem, usage }`
Call it on your chat-completions payload just before sending it to `/api/backends/chat-completions/generate`.

- Dials merges your caller's settings into `payload.custom_include_body` (the user's own values win) and adds a `dials_tag` field, which it strips again before the request leaves the browser.
- `payload` should already contain `chat_completion_source`, `model`, `stream` and, for Custom, `custom_url`. `custom_include_body` must already hold the connection's own Include Body text, because Dials merges into it.
- `conn` defaults to your `getConnection()`.
- Returns:
  - `sent`: the fields actually added.
  - `notSent`: fields that couldn't be sent (non-Custom sources).
  - `overridden`: keys the user's Include Body already set.
  - `problem`: a message, or `null`.
  - `usage`: a Promise that resolves with a usage entry (below) when the reply finishes, or `null` if it failed.

## `getOptions(callerId, conn?)` → object
The nested provider fields a caller would send for a connection, without making a request, e.g. `{ reasoning_effort: 'none', venice_parameters: { include_venice_system_prompt: false } }`.

## `open(callerId?)` → boolean
Opens the Dials panel with **Settings for** set to that caller (unknown ids fall back to SillyTavern's chat). If the user had switched Dials' panel off, this switches it back on. Returns `false` only if the panel couldn't be built.

```js
window.Dials?.open?.('my-extension');
```

## `lastUsage()` → entry | null
## `onUsage(fn)` → unsubscribe function
Called with every usage entry (all callers). Dials also dispatches `document` event `dials:usage` with the entry as `detail`.

### Usage entry
```js
{
  caller: 'sillytavern',            // or your id
  model: 'deepseek-v4-pro',
  usage: { prompt, cached, thinking, reply, output, total },  // thinking is null if not reported; null if no usage
  estimated: false,
  finishReason: 'stop' | 'length' | 'tool_calls' | null,
  limit: { level: 'ok' | 'near' | 'cut' | 'unknown', limit, ratio, thinkingOnly },
  cost: 0.0008 | null,              // list price, USD
  at: 1794647000000,
}
```

## Stability
These names and shapes are stable. Changes will be listed in the [changelog](../CHANGELOG.md) before they ship.
