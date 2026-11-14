import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { detectProvider, normalizeModels, supportsOption, canSendExtras } from '../src/models.mjs';

const venice = JSON.parse(await readFile(new URL('./fixtures/venice-models.json', import.meta.url), 'utf8'));
const opt = key => ({ key, path: key.split('.') });

test('detectProvider', () => {
    assert.equal(detectProvider({ source: 'custom', url: 'https://api.venice.ai/api/v1' }), 'venice');
    assert.equal(detectProvider({ source: 'openrouter' }), 'openrouter');
    assert.equal(detectProvider({ source: 'custom', url: 'https://openrouter.ai/api/v1' }), 'openrouter');
    assert.equal(detectProvider({ source: 'custom', url: 'http://localhost:5001/v1' }), 'generic');
    assert.equal(detectProvider({ source: 'custom', url: 'https://notvenice.ai.evil.com' }), 'generic');
});

test('Venice models: limits, prices, capabilities', () => {
    const models = normalizeModels(venice, 'venice');
    const glm = models.get('zai-org-glm-5-2');
    assert.equal(glm.maxOutput, 131072);
    assert.ok(glm.pricing.inputPerM > 0);
    assert.equal(glm.caps.supportsReasoning, true);
});

test('Venice capability filter', () => {
    const models = normalizeModels(venice, 'venice');
    const withEffort = models.get('zai-org-glm-5-2');
    const noEffort = models.get('gemini-4-carbon');
    assert.equal(supportsOption(opt('reasoning_effort'), withEffort, 'venice'), true);
    assert.equal(supportsOption(opt('reasoning_effort'), noEffort, 'venice'), false);
    assert.equal(supportsOption(opt('venice_parameters.disable_thinking'), noEffort, 'venice'), true);
    assert.equal(supportsOption(opt('reasoning.effort'), noEffort, 'venice'), false);
    assert.equal(supportsOption(opt('venice_parameters.enable_e2ee'), noEffort, 'venice'), false);
    assert.equal(supportsOption(opt('min_p'), noEffort, 'venice'), true);
    const plain = { id: 'x', caps: { supportsReasoning: false } };
    assert.equal(supportsOption(opt('venice_parameters.disable_thinking'), plain, 'venice'), false);
});

test('Venice-shaped model list is recognised behind any address', () => {
    const m = normalizeModels(venice, 'generic').get('gemini-4-carbon');
    assert.equal(supportsOption(opt('reasoning_effort'), m, 'generic'), false);
    assert.equal(m.maxOutput, 65536);
});

test('OpenRouter models: per-token prices become per-million; supported_parameters filter', () => {
    const models = normalizeModels({ data: [{ id: 'a/b', name: 'B', context_length: 1000, top_provider: { max_completion_tokens: 500 }, pricing: { prompt: '0.000001', completion: '0.000002' }, supported_parameters: ['reasoning', 'top_k'] }] }, 'openrouter');
    const m = models.get('a/b');
    assert.equal(m.maxOutput, 500);
    assert.equal(m.pricing.inputPerM, 1);
    assert.equal(m.pricing.outputPerM, 2);
    assert.equal(supportsOption(opt('reasoning.effort'), m, 'openrouter'), true);
    assert.equal(supportsOption(opt('min_p'), m, 'openrouter'), false);
});

test('generic models: unknown support; only Custom can send extras', () => {
    const m = normalizeModels({ data: [{ id: 'local' }, 'plain-string', { nope: 1 }] }, 'generic');
    assert.deepEqual([...m.keys()], ['local', 'plain-string']);
    assert.equal(supportsOption(opt('top_k'), m.get('local'), 'generic'), null);
    assert.equal(canSendExtras('custom'), true);
    assert.equal(canSendExtras('openrouter'), false);
});
