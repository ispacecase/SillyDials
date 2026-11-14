import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deref, chatRequestSchema, optionsFromSchema, leaves, coerceValue, humanize, specCandidates, SILLYTAVERN_FIELDS } from '../src/spec.mjs';

const snapshot = JSON.parse(await readFile(new URL('../data/venice-chat-request.json', import.meta.url), 'utf8'));

test('Venice snapshot: SillyTavern-managed fields are hidden, Venice extras are listed', () => {
    const opts = optionsFromSchema(snapshot.schema);
    const keys = opts.map(o => o.key);
    for (const f of ['messages', 'model', 'temperature', 'max_tokens', 'stream', 'stream_options']) assert.ok(!keys.includes(f), f);
    for (const f of ['reasoning_effort', 'venice_parameters', 'min_p', 'top_k', 'repetition_penalty']) assert.ok(keys.includes(f), f);
});

test('Venice snapshot: venice_parameters is a group with the right kinds', () => {
    const vp = optionsFromSchema(snapshot.schema).find(o => o.key === 'venice_parameters');
    assert.equal(vp.kind, 'group');
    const byKey = Object.fromEntries(vp.children.map(c => [c.key, c]));
    assert.equal(byKey['venice_parameters.disable_thinking'].kind, 'boolean');
    assert.equal(byKey['venice_parameters.include_venice_system_prompt'].default, true);
    // YAML 1.2 keeps "on"/"off" as strings (YAML 1.1 parsers would turn them into booleans)
    assert.deepEqual(byKey['venice_parameters.enable_web_search'].enum, ['auto', 'off', 'on']);
});

test('reasoning_effort is an enum and numbers carry their limits', () => {
    const all = leaves(optionsFromSchema(snapshot.schema));
    const effort = all.find(o => o.key === 'reasoning_effort');
    assert.equal(effort.kind, 'enum');
    assert.ok(effort.enum.includes('low'));
    const minP = all.find(o => o.key === 'min_p');
    assert.equal(minP.kind, 'number');
    assert.equal(minP.min, 0);
    assert.equal(minP.max, 1);
});

test('deref resolves refs, folds allOf, survives recursion', () => {
    const spec = { components: { schemas: {
        A: { type: 'object', properties: { b: { $ref: '#/components/schemas/B' } } },
        B: { allOf: [{ type: 'object', properties: { x: { type: 'string' } } }, { properties: { y: { type: 'integer' } } }] },
        Loop: { type: 'object', properties: { self: { $ref: '#/components/schemas/Loop' } } },
    } } };
    const a = deref(spec, { $ref: '#/components/schemas/A' });
    assert.deepEqual(Object.keys(a.properties.b.properties), ['x', 'y']);
    const loop = deref(spec, { $ref: '#/components/schemas/Loop' });
    assert.equal(loop.properties.self.recursive, true);
});

test('chatRequestSchema finds /v1/chat/completions and fails clearly without it', () => {
    const spec = { paths: { '/v1/chat/completions': { post: { requestBody: { content: { 'application/json': { schema: { $ref: '#/c/S' } } } } } } }, c: { S: { type: 'object', properties: { foo: { type: 'boolean' } } } } };
    assert.equal(chatRequestSchema(spec).properties.foo.type, 'boolean');
    assert.throws(() => chatRequestSchema({ paths: {} }), /no chat-completions/);
});

test('nullable anyOf unwraps; arrays and free objects become json', () => {
    const opts = optionsFromSchema({ properties: {
        a: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }], description: 'd' },
        b: { type: 'array', items: { type: 'string' } },
        c: { type: 'object', additionalProperties: true },
        d: { type: 'string', deprecated: true },
    } }, { skip: new Set() });
    assert.deepEqual(opts.map(o => [o.key, o.kind]), [['a', 'integer'], ['b', 'json'], ['c', 'json']]);
    assert.equal(opts[0].min, 1);
    assert.equal(opts[0].description, 'd');
});

test('coerceValue: empty is unset, ranges and types are checked', () => {
    const num = { kind: 'number', min: 0, max: 1 };
    assert.deepEqual(coerceValue(num, ''), { ok: true, value: undefined });
    assert.deepEqual(coerceValue(num, '0.5'), { ok: true, value: 0.5 });
    assert.equal(coerceValue(num, '2').ok, false);
    assert.equal(coerceValue({ kind: 'integer' }, '1.5').ok, false);
    assert.deepEqual(coerceValue({ kind: 'boolean' }, 'false'), { ok: true, value: false });
    assert.deepEqual(coerceValue({ kind: 'enum', enum: ['auto', 'on'] }, 'on'), { ok: true, value: 'on' });
    assert.equal(coerceValue({ kind: 'enum', enum: ['auto'] }, 'x').ok, false);
    assert.deepEqual(coerceValue({ kind: 'json' }, '[1,2]'), { ok: true, value: [1, 2] });
    assert.equal(coerceValue({ kind: 'json' }, '[1,').ok, false);
});

test('humanize and spec addresses', () => {
    assert.equal(humanize('disable_thinking'), 'Disable thinking');
    assert.equal(humanize('supportsWebSearch'), 'Supports web search');
    const c = specCandidates('https://api.example.com/v1/');
    assert.ok(c.includes('https://api.example.com/v1/openapi.json'));
    assert.ok(c.includes('https://api.example.com/swagger.yaml'));
    assert.deepEqual(specCandidates('not a url'), []);
    assert.ok(SILLYTAVERN_FIELDS.has('messages'));
});
