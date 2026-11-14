import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { explainField, explainSillyTavern, FIELD_EXPLANATIONS } from '../src/explain.mjs';
import { optionsFromSchema, leaves } from '../src/spec.mjs';

const snapshot = JSON.parse(await readFile(new URL('../data/venice-chat-request.json', import.meta.url), 'utf8'));

test('every Venice option has a plain explanation', () => {
    const all = leaves(optionsFromSchema(snapshot.schema, { skip: new Set() }));
    const missing = all.map(o => o.key).filter(k => !['messages', 'model', 'stream', 'prompt'].includes(k) && !k.startsWith('stream_options') && !explainField(k));
    assert.deepEqual(missing, []);
});

test('penalty explanations warn about garbled text', () => {
    for (const k of ['repetition_penalty', 'frequency_penalty', 'presence_penalty']) assert.match(FIELD_EXPLANATIONS[k], /garble/);
});

test('lookups fall back to null', () => {
    assert.equal(explainField('nope'), null);
    assert.match(explainSillyTavern('Context Size (tokens)'), /chat/);
    assert.equal(explainSillyTavern('nope'), null);
});
