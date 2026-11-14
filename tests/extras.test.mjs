import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExtras, mergeUserWins, parseIncludeBody, applyExtras, withoutKeys } from '../src/extras.mjs';

// JSON is valid YAML; tests use a JSON-only parser to stay dependency-free.
const parseYaml = text => JSON.parse(text);

test('buildExtras nests dotted keys and skips unset', () => {
    assert.deepEqual(buildExtras({ 'venice_parameters.disable_thinking': true, 'venice_parameters.enable_web_search': 'off', reasoning_effort: 'low', top_k: '', x: null }),
        { venice_parameters: { disable_thinking: true, enable_web_search: 'off' }, reasoning_effort: 'low' });
});

test('user values win key by key; nested objects merge instead of replacing', () => {
    const user = { venice_parameters: { include_venice_system_prompt: false }, reasoning_effort: 'high' };
    const ours = { venice_parameters: { disable_thinking: true, include_venice_system_prompt: true }, reasoning_effort: 'low', top_k: 40 };
    const { merged, overridden } = mergeUserWins(user, ours);
    assert.deepEqual(merged, { venice_parameters: { include_venice_system_prompt: false, disable_thinking: true }, reasoning_effort: 'high', top_k: 40 });
    assert.deepEqual(overridden.sort(), ['reasoning_effort', 'venice_parameters.include_venice_system_prompt']);
    assert.deepEqual(withoutKeys(ours, overridden), { venice_parameters: { disable_thinking: true }, top_k: 40 });
});

test('parseIncludeBody mirrors the server: object, list of objects, empty, unreadable', () => {
    assert.deepEqual(parseIncludeBody('', parseYaml), { ok: true, value: {} });
    assert.deepEqual(parseIncludeBody('{"a":1}', parseYaml), { ok: true, value: { a: 1 } });
    assert.deepEqual(parseIncludeBody('[{"a":1},{"b":2},3]', parseYaml), { ok: true, value: { a: 1, b: 2 } });
    assert.equal(parseIncludeBody('{oops', parseYaml).ok, false);
    assert.equal(parseIncludeBody('"just a string"', parseYaml).ok, false);
});

test('Custom: merged into a copy of Include Body, usage requested when streaming', () => {
    const data = { chat_completion_source: 'custom', stream: true, custom_include_body: '{"venice_parameters":{"include_venice_system_prompt":false}}' };
    const r = applyExtras(data, { venice_parameters: { disable_thinking: true } }, { parseYaml });
    assert.deepEqual(JSON.parse(data.custom_include_body), { venice_parameters: { include_venice_system_prompt: false, disable_thinking: true }, stream_options: { include_usage: true } });
    assert.deepEqual(r.sent, { venice_parameters: { disable_thinking: true }, stream_options: { include_usage: true } });
    assert.equal(r.problem, null);
});

test('Custom: user\'s own stream_options win', () => {
    const data = { chat_completion_source: 'custom', stream: true, custom_include_body: '{"stream_options":{"include_usage":false}}' };
    const r = applyExtras(data, {}, { parseYaml });
    assert.deepEqual(JSON.parse(data.custom_include_body), { stream_options: { include_usage: false } });
    assert.deepEqual(r.overridden, ['stream_options.include_usage']);
});

test('Custom: nothing to add leaves the request untouched', () => {
    const data = { chat_completion_source: 'custom', stream: false, custom_include_body: 'a: 1' };
    applyExtras(data, {}, { parseYaml });
    assert.equal(data.custom_include_body, 'a: 1');
});

test('Custom: unreadable Include Body is left alone and reported', () => {
    const data = { chat_completion_source: 'custom', stream: true, custom_include_body: '{oops' };
    const r = applyExtras(data, { top_k: 1 }, { parseYaml });
    assert.equal(data.custom_include_body, '{oops');
    assert.match(r.problem, /could not be read/);
    assert.deepEqual(r.notSent.top_k, 1);
});

test('Other sources: nothing changes, everything reported as not sent', () => {
    const data = { chat_completion_source: 'openrouter', stream: true };
    const before = structuredClone(data);
    const r = applyExtras(data, { top_k: 1 }, { parseYaml });
    assert.deepEqual(data, before);
    assert.deepEqual(r.notSent, { top_k: 1 });
    assert.deepEqual(r.sent, {});
});
