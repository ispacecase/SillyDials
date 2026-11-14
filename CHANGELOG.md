# Changelog

## 0.2.2
- The Prompts tab now shows each prompt's token count as soon as you open it (worked out without sending anything).
- The in-app icon uses the no-glow logo.

## 0.2.1
- **One Thinking control** replaces the provider's overlapping thinking switches (`reasoning_effort`, `reasoning.effort`, `reasoning.enabled`, Venice `disable_thinking`). It offers *Off* plus only the levels the model accepts, and Dials writes only the field the model understands.
- SillyTavern's "Request model reasoning" now reads **Show thinking in chat**, with an explanation that it only hides the thinking.
- Clearer names: Thinking summary, Hide thinking from the reply (still thinks), Venice's own system prompt, Web search, Prompt caching.
- Proper README and docs (user guide, how it works, API).

## 0.2.0
- **Recommended / Experts only** tabs: every setting appears once. SillyTavern's own controls are placed into Dials' groups and duplicates hidden.
- **This model** card and **About this provider** notes, from the provider's API.
- Untouched settings are greyed out and show the model's real default (from the model, then the spec) instead of "null". Choices are narrowed to what the model accepts.
- Provider notes shown under every setting.
- `Dials.open(callerId)` and `registerCaller(..., { inheritsFrom })` for other extensions; tested model notes.
- Verified against real Venice.

## 0.1.0
- First version: provider settings read from Venice's spec / any OpenAI-compatible spec, sent through a copy of Include Body; real token counts per reply with limit warnings, totals and a bar above the chat box; takeover of SillyTavern's AI Response Configuration panel with plain explanations; use-case presets with Undo; `window.Dials` for other extensions.
