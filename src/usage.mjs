// Reads token usage from provider replies (streamed or whole) and does the counter's sums.
// Pure: no SillyTavern or browser imports.

const n = x => (typeof x === 'number' && Number.isFinite(x)) ? x : null;

/**
 * Normalizes a usage object from OpenAI-style, Anthropic or Gemini replies.
 * Returns {prompt, cached, thinking, reply, output, total} (thinking is null when the provider doesn't split it out),
 * or null when nothing usable is there.
 */
export function normalizeUsage(u) {
    if (!u || typeof u !== 'object') return null;
    // OpenAI / OpenRouter / Venice
    if (n(u.prompt_tokens) !== null || n(u.completion_tokens) !== null) {
        const prompt = n(u.prompt_tokens) ?? 0;
        const output = n(u.completion_tokens) ?? 0;
        const thinking = n(u.completion_tokens_details?.reasoning_tokens);
        return {
            prompt,
            cached: n(u.prompt_tokens_details?.cached_tokens) ?? 0,
            thinking,
            reply: Math.max(0, output - (thinking ?? 0)),
            output,
            total: n(u.total_tokens) ?? prompt + output,
        };
    }
    // Gemini usageMetadata
    if (n(u.promptTokenCount) !== null || n(u.candidatesTokenCount) !== null) {
        const prompt = n(u.promptTokenCount) ?? 0;
        const reply = n(u.candidatesTokenCount) ?? 0;
        const thinking = n(u.thoughtsTokenCount);
        const output = reply + (thinking ?? 0);
        return { prompt, cached: n(u.cachedContentTokenCount) ?? 0, thinking, reply, output, total: n(u.totalTokenCount) ?? prompt + output };
    }
    // Anthropic
    if (n(u.input_tokens) !== null || n(u.output_tokens) !== null) {
        const cached = n(u.cache_read_input_tokens) ?? 0;
        const prompt = (n(u.input_tokens) ?? 0) + cached + (n(u.cache_creation_input_tokens) ?? 0);
        const output = n(u.output_tokens) ?? 0;
        return { prompt, cached, thinking: null, reply: output, output, total: prompt + output };
    }
    return null;
}

const FINISH_MAP = { max_tokens: 'length', MAX_TOKENS: 'length', length: 'length', stop: 'stop', end_turn: 'stop', STOP: 'stop', stop_sequence: 'stop', tool_calls: 'tool_calls', tool_use: 'tool_calls' };
const mapFinish = r => (r ? FINISH_MAP[r] ?? String(r) : null);

/** Pulls {usage, finishReason} hints out of one parsed reply or stream chunk. Anthropic's usage arrives in two parts. */
function scan(obj, state) {
    if (!obj || typeof obj !== 'object') return;
    const choice = Array.isArray(obj.choices) ? obj.choices[0] : null;
    if (choice?.finish_reason) state.finishReason = mapFinish(choice.finish_reason);
    if (obj.usage && typeof obj.usage === 'object') {
        if (n(obj.usage.input_tokens) !== null || n(obj.usage.output_tokens) !== null) state.anthropic = { ...state.anthropic, ...obj.usage };
        else state.raw = obj.usage;
    }
    if (obj.type === 'message_start' && obj.message?.usage) state.anthropic = { ...state.anthropic, ...obj.message.usage };
    if (obj.type === 'message_delta' && obj.delta?.stop_reason) state.finishReason = mapFinish(obj.delta.stop_reason);
    if (obj.stop_reason) state.finishReason = mapFinish(obj.stop_reason);
    if (obj.usageMetadata) state.raw = obj.usageMetadata;
    const cand = Array.isArray(obj.candidates) ? obj.candidates[0] : null;
    if (cand?.finishReason) state.finishReason = mapFinish(cand.finishReason);
}

function result(state) {
    const usage = normalizeUsage(state.raw) ?? normalizeUsage(state.anthropic);
    return { usage, finishReason: state.finishReason ?? null };
}

/** Reads a whole (non-streamed) JSON reply. */
export function readJsonReply(json) {
    const state = {};
    scan(json, state);
    return result(state);
}

/** Incremental reader for a server-sent-events stream. push() text as it arrives, then finish(). */
export function createStreamReader() {
    const state = {};
    let buffer = '';
    const line = raw => {
        const l = raw.replace(/\r$/, '');
        if (!l.startsWith('data:')) return;
        const data = l.slice(5).trim();
        if (!data || data === '[DONE]') return;
        try { scan(JSON.parse(data), state); } catch { /* not JSON */ }
    };
    return {
        push(text) {
            buffer += text;
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (const l of lines) line(l);
        },
        finish() {
            if (buffer) { line(buffer); buffer = ''; }
            return result(state);
        },
    };
}

/**
 * How close the output came to its limit.
 * level: 'cut' (stopped by the limit), 'near' (>= nearAt of the limit), 'ok', or 'unknown'.
 * thinkingOnly: true when the model spent tokens thinking and wrote no reply.
 */
export function limitStatus({ usage, finishReason }, { maxTokens = null, providerCap = null, nearAt = 0.9 } = {}) {
    const caps = [maxTokens, providerCap].filter(x => typeof x === 'number' && x > 0);
    const limit = caps.length ? Math.min(...caps) : null;
    const thinkingOnly = !!usage && (usage.thinking ?? 0) > 0 && usage.reply === 0;
    if (finishReason === 'length') return { level: 'cut', limit, ratio: limit && usage ? usage.output / limit : null, thinkingOnly };
    if (!usage || !limit) return { level: 'unknown', limit, ratio: null, thinkingOnly };
    const ratio = usage.output / limit;
    return { level: ratio >= 1 ? 'cut' : ratio >= nearAt ? 'near' : 'ok', limit, ratio, thinkingOnly };
}

/** Cost in USD from per-million prices, or null if prices are missing. Cached prompt tokens use the cached price when given. */
export function costOf(usage, pricing) {
    if (!usage || !pricing || n(pricing.inputPerM) === null || n(pricing.outputPerM) === null) return null;
    const cachedPrice = n(pricing.cachedPerM);
    const cached = cachedPrice === null ? 0 : Math.min(usage.cached || 0, usage.prompt);
    const fresh = usage.prompt - cached;
    return (fresh * pricing.inputPerM + cached * (cachedPrice ?? 0) + usage.output * pricing.outputPerM) / 1e6;
}

const emptySum = () => ({ count: 0, prompt: 0, thinking: 0, reply: 0, cost: 0, costKnown: true });

function addTo(sum, usage, cost) {
    sum.count += 1;
    sum.prompt += usage.prompt;
    sum.thinking += usage.thinking ?? 0;
    sum.reply += usage.reply;
    if (cost === null) sum.costKnown = false; else sum.cost += cost;
}

/** Local date as YYYY-MM-DD. */
export function dayOf(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Adds one reply to the running totals (returns a new object).
 * totals: {chats: {chatId: sum}, days: {YYYY-MM-DD: sum}, callers: {caller: sum}}.
 */
export function addToTotals(totals, { usage, cost = null, chatId = null, caller = 'sillytavern', date = Date.now() }) {
    const t = structuredClone(totals || {});
    t.chats ??= {}; t.days ??= {}; t.callers ??= {};
    if (!usage) return t;
    const day = dayOf(date);
    addTo(t.days[day] ??= emptySum(), usage, cost);
    addTo(t.callers[caller] ??= emptySum(), usage, cost);
    if (chatId) addTo(t.chats[chatId] ??= emptySum(), usage, cost);
    return t;
}

/** Keeps only the last `keep` days of daily totals. */
export function pruneDays(totals, keep = 90) {
    const t = structuredClone(totals || {});
    const days = Object.keys(t.days || {}).sort();
    for (const d of days.slice(0, Math.max(0, days.length - keep))) delete t.days[d];
    return t;
}

const fmt = x => Math.round(x).toLocaleString('en-US');

/** "Prompt 18,400 · Thinking 2,100 · Reply 1,350" (Prompt or Thinking left out when unknown). */
export function usageLine(usage, { estimated = false } = {}) {
    if (!usage) return '';
    const parts = [];
    if (usage.prompt !== null && usage.prompt !== undefined) parts.push(`Prompt ${fmt(usage.prompt)}`);
    if (usage.thinking !== null && usage.thinking !== undefined) parts.push(`Thinking ${fmt(usage.thinking)}`);
    parts.push(`Reply ${fmt(usage.reply)}`);
    return (estimated ? 'Estimate: ' : '') + parts.join(' · ');
}

/** "$0.0123" style, more decimals for tiny amounts. */
export function formatCost(usd) {
    if (usd === null || usd === undefined) return '';
    if (usd === 0) return '$0';
    return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}
