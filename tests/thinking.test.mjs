import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { thinkingInfo, readThinking, writeThinking, THINKING_FIELDS } from '../src/thinking.mjs';
import { optionsFromSchema, leaves } from '../src/spec.mjs';
import { normalizeModels, supportsOption } from '../src/models.mjs';
import { buildExtras } from '../src/extras.mjs';

const snapshot = JSON.parse(await readFile(new URL('../data/venice-chat-request.json', import.meta.url), 'utf8'));
const models = normalizeModels(JSON.parse(await readFile(new URL('./fixtures/venice-models.json', import.meta.url), 'utf8')), 'venice');
const options = leaves(optionsFromSchema(snapshot.schema));
const info = id => { const m = models.get(id); return thinkingInfo(options, m, o => supportsOption(o, m, 'venice')); };

test('model with effort levels incl. none: off goes through reasoning_effort', () => {
    const i = info('deepseek-v4-pro');
    assert.deepEqual(i.levels, ['low', 'medium', 'high']);
    assert.equal(i.offVia, 'reasoning_effort');
    assert.equal(i.default, 'low');
    assert.deepEqual(buildExtras(writeThinking({}, 'off', i)), { reasoning_effort: 'none' });
    assert.deepEqual(buildExtras(writeThinking({}, 'high', i)), { reasoning_effort: 'high' });
});

test('model that thinks but has no effort: off goes through Venice disable_thinking, no levels', () => {
    const i = info('gemini-4-carbon');
    assert.deepEqual(i.levels, []);
    assert.equal(i.offVia, 'venice_parameters.disable_thinking');
    assert.deepEqual(buildExtras(writeThinking({}, 'off', i)), { venice_parameters: { disable_thinking: true } });
});

test('writing a choice clears every other thinking field, so they never contradict', () => {
    const i = info('deepseek-v4-pro');
    const messy = { 'reasoning.enabled': false, 'venice_parameters.disable_thinking': true, 'reasoning.effort': 'low', top_k: 5 };
    assert.deepEqual(writeThinking(messy, 'high', i), { top_k: 5, reasoning_effort: 'high' });
    assert.deepEqual(writeThinking(messy, undefined, i), { top_k: 5 });
    for (const k of THINKING_FIELDS) assert.ok(!(k in writeThinking(messy, undefined, i)));
});

test('reading back the choice from any of the fields', () => {
    assert.equal(readThinking({}), undefined);
    assert.equal(readThinking({ reasoning_effort: 'none' }), 'off');
    assert.equal(readThinking({ 'venice_parameters.disable_thinking': true }), 'off');
    assert.equal(readThinking({ 'reasoning.enabled': false }), 'off');
    assert.equal(readThinking({ 'reasoning.effort': 'medium' }), 'medium');
});

test('no thinking fields at all: no Thinking control', () => {
    assert.equal(thinkingInfo([{ key: 'top_k', path: ['top_k'], kind: 'integer' }], null), null);
});

test('a level the model does not accept is not written', () => {
    const i = info('deepseek-v4-pro');
    assert.deepEqual(writeThinking({}, 'max', i), {});
});
