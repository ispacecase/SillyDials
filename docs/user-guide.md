# Dials user guide

## Opening Dials

Click the **sliders button** at the top left of SillyTavern. With Dials on, that drawer shows Dials instead of SillyTavern's own AI Response Configuration panel. Everything from SillyTavern's panel is still there, inside Dials.

To switch back to SillyTavern's own panel: **Extensions → Dials → untick "Dials replaces the AI Response Configuration panel"**. Every control goes back exactly where it was.

## The top of the panel

- **Connection line**: the provider and model you're using (e.g. *Venice · DeepSeek V4 Pro*). It follows your connection by itself: switch models, sources or profiles and Dials updates straight away. **Re-download** fetches the provider's settings and model list again (Dials keeps them for 24 hours); you only need it if the provider added something new today.
- **Settings for**: only appears when another extension (such as Storyloom) uses Dials. Each one has its own separate settings.
- **Use case**: presets (see below), with **Apply**, **Undo** and **Save as mine**.

## The tabs

### Recommended
The settings you'd normally touch, each shown once:

- **This model** card: description, context size, longest reply, prices, privacy, and "What this model can do" (thinking, web search, images, and so on) in plain words. All of it comes from the provider's own model list.
- Temperature, Top P, Max Response Length, Context Size (SillyTavern's own controls).
- **Thinking** and **Show thinking in chat** (see below).
- Streaming.
- The provider's own switches, when it has them. On Venice: **Venice's own system prompt** and **Web search**.

### Experts only
Everything else, in folded groups: Thinking extras, Word choice (Min P, Top K, penalties…), Length and stopping, Web and search, Privacy/caching/characters, More from the provider, Technical. At the top, **About this provider** shows the provider's own notes from its API. At the bottom:

- **Extra fields**: add any field by name if the provider accepts something Dials doesn't list.
- **What will be added to the request**: the exact extra JSON Dials sends.
- **Other SillyTavern settings**: the rest of SillyTavern's panel (its presets, proxy, prompt handling, settings for other connection types).

Settings this model doesn't list as supported are hidden; a checkbox at the bottom shows them.

### Prompts
SillyTavern's prompt list (Main Prompt, Character Description, Chat History…). It's the same prompt manager, just moved here.

### Tokens
Totals for this chat, today, and per caller, the last reply, and preferences.

## Reading a setting

Each provider setting shows:

- **The control.** Untouched settings are greyed out and show the model's default, e.g. *"Default: High (not sent)"*.
- **A status line.** Either *"Not sent. The model uses its default: High (Venice lists this for this model)"*, *"Not sent. The model decides (Venice doesn't publish a default for this)"*, or *"Set by you, sent with every request."*
- **A plain explanation** written for Dials.
- **The provider's own note**, word for word.
- Sometimes a **tested note** about a specific model, e.g. that a model ignores a value.

The reset button next to a setting you've set puts it back to the default (not sent).

## Thinking

Many models think privately before answering. That costs tokens and time, and on some models it can use up the whole reply budget so you get no answer at all.

- **Thinking**: *Off*, or a level the model accepts (only that model's own levels are listed). Dials sends whatever field this model understands for your choice, so *Off* always means off.
- **Show thinking in chat**: whether you *see* the thinking, folded above the reply. Turning this off only hides it; the model still thinks (and you still pay for it).
- Under Experts → Thinking: **Hide thinking from the reply (still thinks)** and **Thinking summary**.

## Presets (Use case)

| Preset | What it's for |
|---|---|
| **Default** | Sets nothing. The provider's defaults everywhere. |
| **Roleplay** | Lively, in-character replies of a few paragraphs. |
| **Novel** | Long, careful prose. |
| **Assistant** | Accurate, focused answers; may search the web. |
| **Brainstorm** | Wild, varied ideas. |

- **Apply** sets the preset's values on the current model. It changes SillyTavern's real sliders, so Dials saves your previous values first; **Undo** restores them.
- Presets are written by meaning ("thinking: low", "provider system prompt: off") and Dials maps each one to whatever this provider and model actually have. Anything a model doesn't support is skipped and listed.
- **A model Dials hasn't seen before** starts on the selected use case automatically, with Undo.
- **Save as mine** saves your current settings as your own preset.
- Presets **never** set repetition, frequency or presence penalties. Even small values can garble text.

| Setting | Roleplay | Novel | Assistant | Brainstorm |
|---|---|---|---|---|
| Temperature | 1.0 | 0.9 | 0.4 | 1.2 |
| Top P | 0.95 | 0.95 | 1.0 | 0.98 |
| Min P | 0.05 | 0.05 | default | 0.05 |
| Max reply length | 600 | 4,000 | 2,000 | 1,500 |
| Thinking | low | medium | medium | low |
| Show thinking | off | off | default | off |
| Verbosity | medium | high | medium | medium |
| Web search | off | off | auto | off |
| Provider's system prompt | off | off | default | off |
| Prompt caching | extended | extended | default | default |

Max reply length is capped at the model's own limit.

## The token counter

- **Under each reply**: *Prompt · Thinking · Reply*, from the provider's own usage report. It's stored with the message, so it survives reloads and swipes.
- **Warnings**: *Stopped at the limit*, *Near the limit (92% of 600)*, or *All thinking, no reply*. The limit is the lower of your Max Response Length and the model's own cap.
- **The bar above the chat box**: the last reply, this chat's total, and any warning. Click it for the Tokens tab.
- If the provider reports no usage, Dials falls back to SillyTavern's tokenizer and labels the line **Estimate**.
- **Cost**: off by default. Turn on *Show cost* in the Tokens tab. Prices are the provider's list prices and may not match your bill.
- Daily totals are kept for 90 days.

## Preferences (Tokens tab)

- **Show cost**: adds list-price cost to lines and totals.
- **Ask Custom endpoints to report token usage on streamed replies**: adds `stream_options.include_usage` so streamed replies get real counts. On by default.
