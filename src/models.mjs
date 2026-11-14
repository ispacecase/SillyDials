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
        const model = { id, name: id, contextLength: null, maxOutput: null, pricing: null, caps: null, supported: null, description: '', facts: {}, constraints: null };
        if (typeof m === 'object') {
            if (m.model_spec && typeof m.model_spec === 'object') { // Venice shape, recognised wherever it comes from
                const s = m.model_spec;
                model.name = s.name || id;
                model.contextLength = num(s.availableContextTokens) ?? num(m.context_length);
                model.maxOutput = num(s.maxCompletionTokens);
                model.caps = s.capabilities && typeof s.capabilities === 'object' ? { ...s.capabilities } : null;
                model.description = String(s.description || '');
                model.constraints = s.constraints && typeof s.constraints === 'object' ? s.constraints : null;
                model.facts = pickFacts({ privacy: s.privacy, traits: s.traits, uncensored: s.uncensored, beta: s.betaModel, offline: s.offline, deprecation: s.deprecation, source: s.modelSource });
                const p = s.pricing;
                if (p && num(p.input?.usd) !== null && num(p.output?.usd) !== null) {
                    model.pricing = { inputPerM: num(p.input.usd), outputPerM: num(p.output.usd), cachedPerM: num(p.cache_input?.usd) };
                }
            } else {
                model.name = m.name || id;
                model.description = String(m.description || '');
                model.facts = pickFacts({ ...m, id: undefined, name: undefined, description: undefined, pricing: undefined, supported_parameters: undefined, top_provider: undefined, context_length: undefined });
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

/** Keeps the simple facts a model list gives (text, numbers, yes/no, short lists) for the model card. */
function pickFacts(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
        if (v === undefined || v === null || v === '') continue;
        if (['string', 'number', 'boolean'].includes(typeof v)) out[k] = v;
        else if (Array.isArray(v) && v.length && v.every(x => ['string', 'number'].includes(typeof x))) out[k] = v.join(', ');
        else if (Array.isArray(v) && !v.length) continue;
        else if (v && typeof v === 'object') {
            const flat = Object.entries(v).filter(([, x]) => ['string', 'number', 'boolean'].includes(typeof x));
            if (flat.length) out[k] = flat.map(([a, b]) => `${a}: ${b}`).join(', ');
        }
    }
    return out;
}

/** Plain words for Venice capability flags. */
export const CAPABILITY_LABELS = Object.freeze({
    supportsReasoning: 'Thinks before answering',
    supportsReasoningEffort: 'Thinking effort can be changed',
    reasoningEffortOptions: 'Thinking effort choices',
    defaultReasoningEffort: 'Default thinking effort',
    supportsWebSearch: 'Web search',
    supportsXSearch: 'X (Twitter) search',
    supportsVision: 'Understands images',
    supportsMultipleImages: 'Several images at once',
    maxImages: 'Most images per message',
    supportsAudioInput: 'Understands audio',
    supportsVideoInput: 'Understands video',
    maxVideos: 'Most videos per message',
    supportsFunctionCalling: 'Tool use (function calling)',
    supportsResponseSchema: 'Structured (JSON) output',
    supportsLogProbs: 'Word probabilities (debugging)',
    supportsE2EE: 'End-to-end encryption',
    supportsTeeAttestation: 'Runs in a verified secure enclave',
    optimizedForCode: 'Tuned for code',
    quantization: 'Quantization (compression)',
});

/** Capability flags as [label, value-in-words] pairs, in a stable order. */
export function capabilityList(caps) {
    if (!caps) return [];
    const words = v => v === true ? 'yes' : v === false ? 'no' : Array.isArray(v) ? v.join(', ') : String(v);
    const known = Object.keys(CAPABILITY_LABELS).filter(k => k in caps).map(k => [CAPABILITY_LABELS[k], words(caps[k])]);
    const other = Object.keys(caps).filter(k => !(k in CAPABILITY_LABELS)).map(k => [k, words(caps[k])]);
    return [...known, ...other];
}

const EFFORT_KEYS = ['reasoning_effort', 'reasoning.effort'];

/**
 * The model's default for an option, with where it came from, or null when nobody publishes one.
 * Order: the model's own published default, then the spec's default.
 * @returns {{value: any, from: 'model' | 'spec'} | null}
 */
export function defaultFor(option, model) {
    if (model?.caps && EFFORT_KEYS.includes(option.key) && model.caps.defaultReasoningEffort !== undefined) return { value: model.caps.defaultReasoningEffort, from: 'model' };
    const c = model?.constraints?.[option.key];
    if (c && c.default !== undefined && c.default !== null) return { value: c.default, from: 'model' };
    if (option.default !== undefined && option.default !== null) return { value: option.default, from: 'spec' };
    return null;
}

/** The model's own default for one of SillyTavern's request fields (temperature, top_p, …), or null. */
export function modelDefaultForField(model, field) {
    const c = model?.constraints?.[field];
    return c && c.default !== undefined && c.default !== null ? c.default : null;
}

/** Narrows an enum option to the values this model accepts (Venice reasoningEffortOptions). */
export function allowedValues(option, model) {
    if (option.kind !== 'enum') return option.enum;
    const allowed = EFFORT_KEYS.includes(option.key) ? model?.caps?.reasoningEffortOptions : null;
    if (!Array.isArray(allowed) || !allowed.length) return option.enum;
    const narrowed = option.enum.filter(v => allowed.includes(v));
    return narrowed.length ? narrowed : option.enum;
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
