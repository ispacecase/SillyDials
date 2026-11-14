import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsage, readJsonReply, createStreamReader, limitStatus, costOf, addToTotals, pruneDays, usageLine, formatCost, dayOf } from '../src/usage.mjs';

test('OpenAI-style usage splits thinking from reply', () => {
    const u = normalizeUsage({ prompt_tokens: 18400, completion_tokens: 3450, completion_tokens_details: { reasoning_tokens: 2100 }, prompt_tokens_details: { cached_tokens: 100 } });
    assert.deepEqual(u, { prompt: 18400, cached: 100, thinking: 2100, reply: 1350, output: 3450, total: 21850 });
    assert.equal(normalizeUsage({ prompt_tokens: 5, completion_tokens: 7 }).thinking, null);
    assert.equal(normalizeUsage({}), null);
    assert.equal(normalizeUsage(null), null);
});

test('Gemini and Anthropic usage', () => {
    assert.deepEqual(normalizeUsage({ promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 20 }), { prompt: 10, cached: 0, thinking: 20, reply: 5, output: 25, total: 35 });
    assert.deepEqual(normalizeUsage({ input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 7 }), { prompt: 100, cached: 90, thinking: null, reply: 7, output: 7, total: 107 });
});

test('whole JSON reply', () => {
    const r = readJsonReply({ choices: [{ finish_reason: 'length', message: { content: 'x' } }], usage: { prompt_tokens: 1, completion_tokens: 2 } });
    assert.equal(r.finishReason, 'length');
    assert.equal(r.usage.output, 2);
    assert.deepEqual(readJsonReply({ choices: [] }), { usage: null, finishReason: null });
});

test('OpenAI stream with usage in the last chunk, split across pushes', () => {
    const r = createStreamReader();
    const text = [
        'data: {"choices":[{"delta":{"content":"Hi"}}]}',
        '',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        '',
        'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":30,"completion_tokens_details":{"reasoning_tokens":25}}}',
        '',
        'data: [DONE]',
        '',
    ].join('\r\n');
    for (let i = 0; i < text.length; i += 7) r.push(text.slice(i, i + 7));
    const out = r.finish();
    assert.equal(out.finishReason, 'stop');
    assert.deepEqual(out.usage, { prompt: 12, cached: 0, thinking: 25, reply: 5, output: 30, total: 42 });
});

test('stream without a trailing newline and with junk lines', () => {
    const r = createStreamReader();
    r.push(': keep-alive\nevent: x\ndata: not json\ndata: {"usage":{"prompt_tokens":1,"completion_tokens":1}}');
    assert.equal(r.finish().usage.total, 2);
});

test('Anthropic stream: usage comes in two parts', () => {
    const r = createStreamReader();
    r.push('data: {"type":"message_start","message":{"usage":{"input_tokens":50,"output_tokens":1}}}\n');
    r.push('data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":400}}\n');
    const out = r.finish();
    assert.equal(out.finishReason, 'length');
    assert.deepEqual(out.usage, { prompt: 50, cached: 0, thinking: null, reply: 400, output: 400, total: 450 });
});

test('Gemini stream: finish reason and usage metadata', () => {
    const r = createStreamReader();
    r.push('data: {"candidates":[{"finishReason":"MAX_TOKENS"}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":4,"thoughtsTokenCount":5}}\n');
    const out = r.finish();
    assert.equal(out.finishReason, 'length');
    assert.equal(out.usage.thinking, 5);
});

test('limit status: cut, near, ok, unknown, all thinking', () => {
    const u = (thinking, reply) => ({ prompt: 1, cached: 0, thinking, reply, output: thinking + reply, total: 0 });
    assert.equal(limitStatus({ usage: u(100, 10), finishReason: 'length' }, { maxTokens: 1000 }).level, 'cut');
    assert.equal(limitStatus({ usage: u(800, 150), finishReason: 'stop' }, { maxTokens: 1000 }).level, 'near');
    assert.equal(limitStatus({ usage: u(100, 100), finishReason: 'stop' }, { maxTokens: 1000, providerCap: 210 }).level, 'near');
    assert.equal(limitStatus({ usage: u(100, 100), finishReason: 'stop' }, { maxTokens: 1000 }).level, 'ok');
    assert.equal(limitStatus({ usage: null, finishReason: null }, { maxTokens: 1000 }).level, 'unknown');
    assert.equal(limitStatus({ usage: u(8000, 0), finishReason: 'length' }, { maxTokens: 8000 }).thinkingOnly, true);
});

test('cost: cached prompt price used when given; missing prices give null', () => {
    const usage = { prompt: 1_000_000, cached: 500_000, output: 1_000_000 };
    assert.equal(costOf(usage, { inputPerM: 2, outputPerM: 10, cachedPerM: 0.5 }), 1 + 0.25 + 10);
    assert.equal(costOf(usage, { inputPerM: 2, outputPerM: 10, cachedPerM: null }), 2 + 10);
    assert.equal(costOf(usage, null), null);
    assert.equal(formatCost(0.004), '$0.0040');
    assert.equal(formatCost(1.234), '$1.23');
    assert.equal(formatCost(null), '');
});

test('totals per chat, day and caller; unknown cost is flagged', () => {
    const usage = { prompt: 10, thinking: 5, reply: 3, output: 8 };
    const date = new Date(2026, 10, 14, 12).getTime();
    let t = addToTotals({}, { usage, cost: 0.01, chatId: 'c1', date });
    t = addToTotals(t, { usage: { ...usage, thinking: null }, cost: null, chatId: 'c1', caller: 'storyloom', date });
    assert.equal(t.chats.c1.count, 2);
    assert.equal(t.chats.c1.thinking, 5);
    assert.equal(t.chats.c1.costKnown, false);
    assert.equal(t.days['2026-11-14'].prompt, 20);
    assert.equal(t.callers.sillytavern.count, 1);
    assert.equal(t.callers.storyloom.count, 1);
    assert.deepEqual(addToTotals(t, { usage: null }), t);
});

test('pruneDays keeps the newest days', () => {
    const t = { days: { '2026-01-01': {}, '2026-01-02': {}, '2026-01-03': {} } };
    assert.deepEqual(Object.keys(pruneDays(t, 2).days), ['2026-01-02', '2026-01-03']);
});

test('usage line and day format', () => {
    assert.equal(usageLine({ prompt: 18400, thinking: 2100, reply: 1350 }), 'Prompt 18,400 · Thinking 2,100 · Reply 1,350');
    assert.equal(usageLine({ prompt: 1, thinking: null, reply: 2 }, { estimated: true }), 'Estimate: Prompt 1 · Reply 2');
    assert.equal(usageLine({ prompt: null, thinking: 3, reply: 2 }, { estimated: true }), 'Estimate: Thinking 3 · Reply 2');
    assert.equal(dayOf(new Date(2026, 0, 5)), '2026-01-05');
});
