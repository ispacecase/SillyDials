import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BUILTIN_PRESETS, CONCEPTS, NEVER_SET, resolvePreset, allPresets, makeUserPreset } from '../src/presets.mjs';
import { optionsFromSchema, leaves } from '../src/spec.mjs';
import { normalizeModels, supportsOption } from '../src/models.mjs';

const snapshot = JSON.parse(await readFile(new URL('../data/venice-chat-request.json', import.meta.url), 'utf8'));
const venice = normalizeModels(JSON.parse(await readFile(new URL('./fixtures/venice-models.json', import.meta.url), 'utf8')), 'venice');
const options = leaves(optionsFromSchema(snapshot.schema));
const ST = new Set(['temp_openai', 'top_p_openai', 'openai_max_tokens', 'openai_show_thoughts']);
const preset = id => BUILTIN_PRESETS.find(p => p.id === id);

test('no preset ever sets a penalty', () => {
    for (const p of BUILTIN_PRESETS) {
        for (const concept of Object.keys(p.values)) {
            const def = CONCEPTS[concept];
            assert.ok(def, `${p.id}: unknown concept ${concept}`);
            for (const target of [...(def.fields ?? []), def.st?.id].filter(Boolean)) assert.ok(!NEVER_SET.includes(target), `${p.id} sets ${target}`);
            assert.doesNotMatch(concept, /penal/i);
        }
    }
});

test('Default sets nothing', () => {
    assert.deepEqual(resolvePreset(preset('default'), { options, stControls: ST }), { extras: {}, st: [], skipped: [] });
});

test('Roleplay on a Venice model with reasoning effort', () => {
    const model = venice.get('zai-org-glm-5-2');
    const r = resolvePreset(preset('roleplay'), { options, supports: o => supportsOption(o, model, 'venice'), stControls: ST, maxOutput: model.maxOutput });
    assert.deepEqual(r.extras, {
        min_p: 0.05,
        reasoning_effort: 'low',
        verbosity: 'medium',
        'venice_parameters.enable_web_search': 'off',
        'venice_parameters.include_venice_system_prompt': false,
        prompt_cache_retention: 'extended',
    });
    assert.deepEqual(r.st.map(x => [x.id, x.value]), [['temp_openai', 1], ['top_p_openai', 0.95], ['openai_max_tokens', 600], ['openai_show_thoughts', false]]);
    assert.deepEqual(r.skipped, []);
});

test('model without reasoning effort: thinking effort is skipped, not forced', () => {
    const model = venice.get('gemini-4-carbon');
    const r = resolvePreset(preset('novel'), { options, supports: o => supportsOption(o, model, 'venice'), stControls: ST, maxOutput: model.maxOutput });
    assert.ok(!('reasoning_effort' in r.extras));
    assert.ok(!('reasoning.effort' in r.extras));
    assert.ok(r.skipped.includes('thinkingEffort'));
});

test('max reply is clipped to the model cap', () => {
    const r = resolvePreset(preset('novel'), { options, stControls: ST, maxOutput: 1000 });
    assert.equal(r.st.find(x => x.id === 'openai_max_tokens').value, 1000);
});

test('a connection that cannot send extras only gets SillyTavern settings', () => {
    const r = resolvePreset(preset('roleplay'), { options, canSend: false, stControls: ST });
    assert.deepEqual(r.extras, {});
    assert.equal(r.st.length, 4);
    assert.ok(r.skipped.includes('minP'));
});

test('enum values the provider does not offer are skipped', () => {
    const opts = [{ key: 'reasoning_effort', path: ['reasoning_effort'], kind: 'enum', enum: ['high'] }];
    const r = resolvePreset(preset('roleplay'), { options: opts, stControls: new Set() });
    assert.deepEqual(r.extras, {});
    assert.ok(r.skipped.includes('thinkingEffort'));
});

test('user presets keep raw fields, drop penalties, and get a my: id', () => {
    const p = makeUserPreset('My RP!', { temperature: 0.8, minP: 0.1, junk: 1 }, { 'venice_parameters.disable_thinking': true, repetition_penalty: 1.2, top_k: '' });
    assert.equal(p.id, 'my:my-rp');
    assert.deepEqual(p.values, { temperature: 0.8 });
    assert.deepEqual(p.fields, { 'venice_parameters.disable_thinking': true });
    const r = resolvePreset(p, { options, stControls: ST });
    assert.deepEqual(r.extras, { 'venice_parameters.disable_thinking': true });
    assert.deepEqual(r.st.map(x => x.id), ['temp_openai']);
    assert.deepEqual(allPresets([p]).map(x => x.id).slice(-1), ['my:my-rp']);
    assert.equal(allPresets([]).length, BUILTIN_PRESETS.length);
});
