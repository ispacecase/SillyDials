Paste this into the Storyloom session:

```text
There's a new separate extension called Dials, at /home/cody/projects/silly/SillyDials (read its README.md and DECISIONS.md; the API is at the bottom of index.js, "public API for other extensions"). Dials adds provider options (read from the provider's spec) to outgoing requests and counts real token usage. I want Storyloom to use it when it's installed, with its own settings separate from SillyTavern's chat.

Rules:
- Storyloom must keep working exactly as now when Dials isn't installed. Check `window.Dials` at call time, never import from Dials.
- Dials must not need any Storyloom code; all the work is on Storyloom's side.
- Propose the change and wait for my yes before writing code. Don't touch SillyDials.

What Storyloom should do when `window.Dials` exists:
1. Register once at startup:
   window.Dials.registerCaller('storyloom', { label: 'Storyloom', getConnection: () => ({ profileId, source, url, model }) })
   getConnection returns the connection Storyloom is using right now, in whichever of its three modes is active (SillyTavern's current connection, a saved connection profile, or its own provider/key/model). source is the chat_completion_source ('custom' for Venice), url is the Custom endpoint URL. Dials then shows a "Settings for: Storyloom" picker with Storyloom's own options.
2. Before each of Storyloom's own AI calls, build the request payload as now, then call:
   const d = window.Dials.prepare('storyloom', payload)
   Dials changes only two things: it merges its options into payload.custom_include_body (the user's own values win), and it adds a dials_tag field that Dials strips again before the request leaves the browser. For this to work, payload must already have chat_completion_source, model, stream and (for Custom) custom_url, and custom_include_body must already hold the connection's own Include Body text, because Dials merges into it rather than replacing it. Check how the profile path (ConnectionManagerRequestService.sendRequest) builds the body, so the merged custom_include_body really reaches the request and doesn't get overwritten.
   d.usage is a Promise that resolves with the real token usage: {usage: {prompt, thinking, reply, output}, finishReason, limit: {level, limit, thinkingOnly}, ...}. Use it in place of Storyloom's token estimate in the "reply stopped mid-sentence" warning.
3. Step aside where Dials covers the same thing: when Dials is present, skip Storyloom's own "Keep Storyloom's own thinking short" reasoning_effort injection and the "Send SillyTavern's Reasoning Effort to Custom endpoints" hook on CHAT_COMPLETION_SETTINGS_READY. Dials handles both, and doing both would send the setting twice.

Testing: only on the test install. Copy Dials into that install's data/default-user/extensions/SillyDials (leave out .git, .claude, tests, tools), and test both with and without Dials installed. Tell me what you verified and what you didn't.
```
