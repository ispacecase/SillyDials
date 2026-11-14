# Dials

A SillyTavern extension that shows every option your AI provider supports, lets you set them per connection and model, and counts the tokens each reply really used.

- **Options from the provider.** Reads Venice's API spec and model list (then any OpenAI-compatible endpoint's spec, if it has one). Each model only shows the options it supports. Unset options are never sent.
- **Only the outgoing request changes.** On Custom (OpenAI-compatible) connections, options are merged into a copy of Include Body for that one request. Your preset, sliders and connection settings are never changed. If you typed the same field into Include Body yourself, your value wins.
- **Real token counts.** Each reply gets a line like *Prompt 18,400 · Thinking 2,100 · Reply 1,350*, read from the provider's own usage data, with a warning when a reply was cut off at the limit or spent everything on thinking. Totals per chat and per day; cost (list prices) if you turn it on.
- **Other extensions** can register as callers through `window.Dials` and get their own separate settings and usage. Dials works the same with or without them.

Requires SillyTavern 1.19.0 or later, Chat Completion API.

## Develop

```
npm test
```
