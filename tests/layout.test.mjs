import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { planLayout, placeableStIds, GROUPS } from '../src/layout.mjs';
import { optionsFromSchema, leaves, providerNotes } from '../src/spec.mjs';
import { normalizeModels, supportsOption, defaultFor, allowedValues, capabilityList, modelDefaultForField } from '../src/models.mjs';
import { thinkingInfo, THINKING_FIELDS } from '../src/thinking.mjs';

const snapshot = JSON.parse(await readFile(new URL('../data/venice-chat-request.json', import.meta.url), 'utf8'));
const models = normalizeModels(JSON.parse(await readFile(new URL('./fixtures/venice-models.json', import.meta.url), 'utf8')), 'venice');
const options = leaves(optionsFromSchema(snapshot.schema));
const ALL_ST = new Set(placeableStIds());
const plan = (model, extra = {}) => { const supports = o => supportsOption(o, model, 'venice'); return planLayout({ options, supports, canSend: true, stPresent: ALL_ST, thinking: thinkingInfo(options, model, supports), ...extra }); };
const rowKey = r => r.type === 'st' ? `st:${r.id}` : r.type === 'thinking' ? 'thinking' : r.option.key;
const keysIn = (p, group) => p.groups.find(g => g.id === group)?.rows.map(rowKey) ?? [];

test('every setting appears once', () => {
    const p = plan(models.get('deepseek-v4-pro'));
    const all = p.groups.flatMap(g => g.rows.map(rowKey));
    assert.equal(all.length, new Set(all).size);
});

test('Custom/Venice: provider rows replace SillyTavern duplicates (reasoning effort, verbosity, web search)', () => {
    const p = plan(models.get('deepseek-v4-pro'));
    const rec = keysIn(p, 'recommended');
    assert.ok(rec.includes('thinking'));
    assert.ok(!rec.includes('st:openai_reasoning_effort'));
    assert.ok(rec.includes('venice_parameters.include_venice_system_prompt'), 'Venice system prompt is recommended');
    assert.ok(rec.includes('st:temp_openai'));
    assert.ok(p.hideSt.includes('openai_reasoning_effort'));
    assert.ok(p.hideSt.includes('openai_verbosity'));
    // the alternate spelling doesn't show up again elsewhere
    assert.ok(!p.groups.flatMap(g => g.rows).some(r => r.option?.key === 'reasoning.effort'));
    assert.ok(!p.groups.flatMap(g => g.rows).some(r => r.option?.key === 'text.verbosity'));
});

test('recommended group is on the Recommended tab, everything else on Experts', () => {
    const p = plan(models.get('deepseek-v4-pro'));
    for (const g of p.groups) assert.equal(g.tab, g.id === 'recommended' ? 'recommended' : 'experts');
});

test('thinking appears exactly once, as the Thinking control, never as raw fields', () => {
    for (const id of ['deepseek-v4-pro', 'gemini-4-carbon']) {
        const p = plan(models.get(id), { showUnsupported: true });
        const all = p.groups.flatMap(g => g.rows.map(rowKey));
        assert.equal(all.filter(k => k === 'thinking').length, 1, id);
        for (const f of THINKING_FIELDS) assert.ok(!all.includes(f), `${id}: ${f} shown separately`);
    }
});

test('unsupported options are hidden and counted, but shown once you set them', () => {
    const p = plan(models.get('gemini-4-carbon'));
    assert.ok(p.hiddenUnsupported > 0);
    assert.ok(!keysIn(p, 'web').includes('venice_parameters.enable_x_search'));
    const shown = plan(models.get('gemini-4-carbon'), { setKeys: new Set(['venice_parameters.enable_x_search']) });
    assert.ok(keysIn(shown, 'web').includes('venice_parameters.enable_x_search'));
});

test('cannot send (e.g. OpenRouter source): SillyTavern controls only, nothing hidden', () => {
    const p = planLayout({ options, canSend: false, stPresent: ALL_ST });
    assert.deepEqual(p.hideSt, []);
    assert.ok(keysIn(p, 'recommended').includes('st:openai_reasoning_effort'));
    assert.ok(p.groups.every(g => g.rows.every(r => r.type === 'st')));
});

test('leftover provider options land in More / Technical', () => {
    const p = plan(models.get('deepseek-v4-pro'));
    assert.ok(keysIn(p, 'technical').includes('user'));
    assert.ok(GROUPS.length >= 5);
});

test('defaults: model first, then spec, else none', () => {
    const pro = models.get('deepseek-v4-pro');
    const effort = options.find(o => o.key === 'reasoning_effort');
    assert.deepEqual(defaultFor(effort, pro), { value: 'low', from: 'model' });
    const sys = options.find(o => o.key === 'venice_parameters.include_venice_system_prompt');
    assert.deepEqual(defaultFor(sys, pro), { value: true, from: 'spec' });
    const topK = options.find(o => o.key === 'top_k');
    assert.equal(defaultFor(topK, pro), null);
    const minP = options.find(o => o.key === 'min_p');
    assert.equal(defaultFor(minP, models.get('qwen-3-7-plus')), null);
    assert.equal(modelDefaultForField(models.get('qwen-3-7-plus'), 'temperature'), 0.7);
    assert.equal(modelDefaultForField(pro, 'temperature'), null);
});

test('allowed values narrow to what the model accepts', () => {
    const effort = options.find(o => o.key === 'reasoning_effort');
    assert.deepEqual(allowedValues(effort, models.get('deepseek-v4-pro')), ['none', 'low', 'medium', 'high']);
    assert.deepEqual(allowedValues(effort, null), effort.enum);
});

test('capabilities in plain words, and model facts kept', () => {
    const pro = models.get('deepseek-v4-pro');
    const caps = Object.fromEntries(capabilityList(pro.caps));
    assert.equal(caps['Thinks before answering'], 'yes');
    assert.equal(caps['Thinking effort choices'], 'none, low, medium, high');
    assert.equal(pro.facts.privacy, 'private');
    assert.ok(pro.description.length > 0);
});

test('provider notes come from the spec, not the settings', () => {
    const titles = snapshot.notes.map(n => n.title);
    assert.ok(titles.includes('Provider guidance'));
    assert.ok(titles.includes('Chat requests'));
    assert.deepEqual(providerNotes({}), []);
});
