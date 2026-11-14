import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionKey, settingsKey, valuesFor, setValue, copyValues, SILLYTAVERN } from '../src/keys.mjs';

test('connection key: profile first, else source and address', () => {
    assert.equal(connectionKey({ profileId: 'p1', source: 'custom', url: 'x' }), 'profile:p1');
    assert.equal(connectionKey({ source: 'custom', url: 'https://API.venice.ai/api/v1/' }), 'custom@https://api.venice.ai/api/v1');
    assert.equal(connectionKey({ source: 'openrouter', url: 'ignored' }), 'openrouter');
});

test('callers keep separate values for the same connection and model', () => {
    const conn = connectionKey({ source: 'custom', url: 'https://api.venice.ai/api/v1' });
    const st = settingsKey(SILLYTAVERN, conn, 'm');
    const sl = settingsKey('storyloom', conn, 'm');
    let store = setValue({}, st, 'reasoning_effort', 'high');
    store = setValue(store, sl, 'reasoning_effort', 'low');
    assert.equal(valuesFor(store, st).reasoning_effort, 'high');
    assert.equal(valuesFor(store, sl).reasoning_effort, 'low');
});

test('clearing the last value removes the set; copy replaces', () => {
    let store = setValue({}, 'a', 'x', 1);
    store = setValue(store, 'a', 'x', undefined);
    assert.deepEqual(store, {});
    store = setValue(setValue({}, 'a', 'x', 1), 'b', 'y', 2);
    store = copyValues(store, 'a', 'b');
    assert.deepEqual(store.b, { x: 1 });
    store.a.x = 9;
    assert.equal(store.b.x, 1);
    assert.deepEqual(valuesFor(undefined, 'z'), {});
});
