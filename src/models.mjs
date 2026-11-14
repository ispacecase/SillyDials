// Reads provider model lists into one shape and decides which options a model supports.
// Pure: no SillyTavern or browser imports.

/** Which provider family a connection talks to: venice | openrouter | generic. */
export function detectProvider({ source, url } = {}) {
    if (source === 'openrouter') return 'openrouter';
    let host = '';
    try { host = new URL(String(url || '')).hostname.toLowerCase(); } catch { /* no url */ }
    if (host === 'venice.ai' || host.endsWith('.venice.ai')) return 'venice';
    if (host === 'openrouter.ai' || host.endsWith('.openrouter.ai')) return 'openrouter';
    return 'generic';
}

const num = x => (typeof x === 'number' && Number.isFinite(x)) ? x : (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x)) ? Number(x) : null);

/**
 * Normalizes a /models response (Venice's model_spec shape is recognised by its fields). Returns a Map of id -> model:
 * {id, name, contextLength, maxOutput, pricing: {inputPerM, outputPerM, cachedPerM} | null,
 *  caps: object | null (Venice capabilities), supported: Set | null (OpenRouter supported_parameters)}.
 */
export function normalizeModels(list, provider) {
    const rows = Array.isArray(list?.data) ? list.data : Array.isArray(list) ? list : [];
    const out = new Map();
    for (const m of rows) {
        const id = typeof m === 'string' ? m : m?.id;
        if (typeof id !== 'string' || !id) continue;
        const model = { id, name: id, contextLength: null, maxOutput: null, pricing: null, caps: null, supported: null };
        if (typeof m === 'object') {
            if (m.model_spec && typeof m.model_spec === 'object') { // Venice shape, recognised wherever it comes from
                const s = m.model_spec;
                model.name = s.name || id;
                model.contextLength = num(s.availableContextTokens) ?? num(m.context_length);
                model.maxOutput = num(s.maxCompletionTokens);
                model.caps = s.capabilities && typeof s.capabilities === 'object' ? { ...s.capabilities } : null;
                const p = s.pricing;
                if (p && num(p.input?.usd) !== null && num(p.output?.usd) !== null) {
                    model.pricing = { inputPerM: num(p.input.usd), outputPerM: num(p.output.usd), cachedPerM: num(p.cache_input?.usd) };
                }
            } else {
                model.name = m.name || id;
                model.contextLength = num(m.context_length);
                model.maxOutput = num(m.top_provider?.max_completion_tokens) ?? num(m.max_completion_tokens);
                if (Array.isArray(m.supported_parameters)) model.supported = new Set(m.supported_parameters);
                const p = m.pricing;
                if (p && num(p.prompt) !== null && num(p.completion) !== null) {
                    model.pricing = { inputPerM: num(p.prompt) * 1e6, outputPerM: num(p.completion) * 1e6, cachedPerM: num(p.input_cache_read) !== null ? num(p.input_cache_read) * 1e6 : null };
                }
            }
        }
        out.set(id, model);
    }
    return out;
}

/** Venice option -> capability it needs. Keys match option keys; a group key covers its children. */
export const VENICE_CAPABILITY_RULES = Object.freeze({
    'reasoning': 'supportsReasoning',
    'reasoning.effort': 'supportsReasoningEffort',
    'reasoning_effort': 'supportsReasoningEffort',
    'venice_parameters.disable_thinking': 'supportsReasoning',
    'venice_parameters.strip_thinking_response': 'supportsReasoning',
    'venice_parameters.enable_web_search': 'supportsWebSearch',
    'venice_parameters.enable_web_citations': 'supportsWebSearch',
    'venice_parameters.include_search_results_in_stream': 'supportsWebSearch',
    'venice_parameters.return_search_results_as_documents': 'supportsWebSearch',
    'venice_parameters.enable_x_search': 'supportsXSearch',
    'venice_parameters.enable_e2ee': 'supportsE2EE',
});

/**
 * Whether a model supports an option: true, false, or null when the provider doesn't say.
 * @param {{key: string, path: string[]}} option
 */
export function supportsOption(option, model, provider) {
    if (!model) return null;
    if (model.caps) {
        const needs = [];
        for (let i = 1; i <= option.path.length; i++) {
            const rule = VENICE_CAPABILITY_RULES[option.path.slice(0, i).join('.')];
            if (rule) needs.push(rule);
        }
        if (!needs.length) return true;
        return needs.every(cap => model.caps[cap] === true);
    }
    if (model.supported) return model.supported.has(option.path[0]);
    return null;
}

/**
 * Whether SillyTavern's server passes extra fields through for this source.
 * Only Custom (OpenAI-compatible) has Include Body; other sources use a fixed list (checked in 1.19.0).
 */
export function canSendExtras(source) {
    return source === 'custom';
}
