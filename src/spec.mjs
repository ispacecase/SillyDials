// Reads an OpenAPI spec and turns the chat-completions request schema into a list of options.
// Pure: no SillyTavern or browser imports.

/** Fields SillyTavern sends from its own settings or that Dials manages itself. Never shown as options. */
export const SILLYTAVERN_FIELDS = new Set([
    'messages', 'prompt', 'model', 'stream', 'stream_options', 'n',
    'temperature', 'top_p', 'frequency_penalty', 'presence_penalty',
    'max_tokens', 'max_completion_tokens', 'stop', 'seed', 'logit_bias',
    'logprobs', 'top_logprobs', 'tools', 'tool_choice', 'parallel_tool_calls', 'response_format',
]);

/** Used when an endpoint has no spec: common OpenAI-compatible extras that SillyTavern doesn't send on Custom. */
export const OPENAI_FALLBACK_SCHEMA = Object.freeze({
    type: 'object',
    properties: {
        reasoning_effort: { type: 'string', enum: ['none', 'minimal', 'low', 'medium', 'high'], description: 'How much the model thinks before answering, on models that support it.' },
        verbosity: { type: 'string', enum: ['low', 'medium', 'high'], description: 'How long the reply text should be, on models that support it.' },
        top_k: { type: 'integer', minimum: 0, description: 'Only pick from the top K most likely tokens.' },
        min_p: { type: 'number', minimum: 0, maximum: 1, description: 'Drop tokens less likely than this fraction of the most likely token.' },
        repetition_penalty: { type: 'number', minimum: 0, description: 'Penalty for repeating tokens. 1.0 means no penalty.' },
    },
});

/** Addresses tried, in order, to find a spec on an OpenAI-compatible endpoint. */
export function specCandidates(baseUrl) {
    let url;
    try { url = new URL(String(baseUrl)); } catch { return []; }
    const base = url.origin + url.pathname.replace(/\/+$/, '');
    const roots = [base];
    if (/\/v1$/.test(base)) roots.push(base.replace(/\/v1$/, ''));
    else roots.push(base + '/v1');
    const files = ['openapi.json', 'openapi.yaml', 'swagger.json', 'swagger.yaml', 'doc/api/swagger.yaml'];
    const out = [];
    for (const root of roots) for (const file of files) out.push(`${root}/${file}`);
    return [...new Set(out)];
}

function lookup(spec, ref) {
    if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;
    let node = spec;
    for (const raw of ref.slice(2).split('/')) {
        const part = raw.replace(/~1/g, '/').replace(/~0/g, '~');
        if (node == null || typeof node !== 'object') return undefined;
        node = node[part];
    }
    return node;
}

/** Inlines every local $ref and folds allOf. Recursive refs become a plain object marked recursive. */
export function deref(spec, node, seen = new Set()) {
    if (Array.isArray(node)) return node.map(x => deref(spec, x, seen));
    if (!node || typeof node !== 'object') return node;
    if (typeof node.$ref === 'string') {
        if (seen.has(node.$ref)) return { type: 'object', recursive: true };
        const target = lookup(spec, node.$ref);
        if (target === undefined) return { unresolved: node.$ref };
        const next = new Set(seen); next.add(node.$ref);
        const { $ref, ...rest } = node;
        return { ...deref(spec, target, next), ...deref(spec, rest, seen) };
    }
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = deref(spec, v, seen);
    if (Array.isArray(out.allOf)) {
        const merged = { ...out };
        delete merged.allOf;
        for (const part of out.allOf) {
            if (!part || typeof part !== 'object') continue;
            const { properties, required, ...rest } = part;
            Object.assign(merged, rest);
            if (properties) merged.properties = { ...(merged.properties || {}), ...properties };
            if (required) merged.required = [...(merged.required || []), ...required];
        }
        return merged;
    }
    return out;
}

/** Finds the chat-completions POST request body schema, fully dereferenced. Throws if the spec has none. */
export function chatRequestSchema(spec) {
    const paths = spec?.paths && typeof spec.paths === 'object' ? spec.paths : {};
    const key = Object.keys(paths).find(p => /(^|\/)chat\/completions\/?$/.test(p));
    const content = key && paths[key]?.post?.requestBody;
    const body = deref(spec, content);
    const schema = body?.content?.['application/json']?.schema;
    if (!schema || typeof schema !== 'object') throw Error('This spec has no chat-completions request.');
    return deref(spec, schema);
}

/** Turns "disable_thinking" into "Disable thinking". */
export function humanize(key) {
    const words = String(key).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
    return words ? words[0].toUpperCase() + words.slice(1) : '';
}

/** Unwraps `anyOf: [{type: X}, {type: 'null'}]` and nullable wrappers to the single real type. */
function unwrap(schema) {
    for (const key of ['anyOf', 'oneOf']) {
        if (!Array.isArray(schema?.[key])) continue;
        const real = schema[key].filter(x => x && x.type !== 'null' && !(x.enum && x.enum.length === 1 && x.enum[0] === null));
        if (real.length === 1) {
            const { [key]: _, ...rest } = schema;
            return unwrap({ ...real[0], ...rest, description: rest.description ?? real[0].description });
        }
    }
    return schema;
}

function kindOf(schema) {
    if (Array.isArray(schema.enum) && schema.enum.length && schema.enum.every(x => x === null || ['string', 'number', 'boolean'].includes(typeof x))) return 'enum';
    if (schema.type === 'boolean') return 'boolean';
    if (schema.type === 'integer') return 'integer';
    if (schema.type === 'number') return 'number';
    if (schema.type === 'string') return 'string';
    if (schema.type === 'object' && schema.properties && Object.keys(schema.properties).length) return 'group';
    return 'json';
}

/**
 * Lists the options a request schema accepts.
 * Each option: {key, path, kind, label, description, enum?, min?, max?, default?, children?}.
 * kind is boolean | enum | integer | number | string | json | group.
 */
export function optionsFromSchema(schema, { skip = SILLYTAVERN_FIELDS, path = [] } = {}) {
    const props = schema?.properties && typeof schema.properties === 'object' ? schema.properties : {};
    const out = [];
    for (const [name, raw] of Object.entries(props)) {
        if (path.length === 0 && skip.has(name)) continue;
        const s = unwrap(raw || {});
        if (s.deprecated) continue;
        const p = [...path, name];
        const opt = { key: p.join('.'), path: p, kind: kindOf(s), label: s.title || humanize(name), description: String(s.description || '').trim() };
        if (opt.kind === 'enum') opt.enum = s.enum.filter(x => x !== null);
        if (s.default !== undefined) opt.default = s.default;
        if (opt.kind === 'integer' || opt.kind === 'number') {
            if (typeof s.minimum === 'number') opt.min = s.minimum;
            if (typeof s.exclusiveMinimum === 'number') opt.min = s.exclusiveMinimum;
            if (typeof s.maximum === 'number') opt.max = s.maximum;
            if (typeof s.exclusiveMaximum === 'number') opt.max = s.exclusiveMaximum;
        }
        if (opt.kind === 'group') {
            opt.children = optionsFromSchema(s, { skip, path: p });
            if (!opt.children.length) opt.kind = 'json';
        }
        out.push(opt);
    }
    return out;
}

/** Flattens groups into their leaf options. */
export function leaves(options) {
    return options.flatMap(o => o.kind === 'group' ? leaves(o.children) : [o]);
}

/**
 * Checks and converts a value typed in the panel. Returns {ok, value} or {ok: false, error}.
 * Empty input means unset: {ok: true, value: undefined}.
 */
export function coerceValue(option, input) {
    if (input === undefined || input === null || input === '') return { ok: true, value: undefined };
    switch (option.kind) {
        case 'boolean':
            if (typeof input === 'boolean') return { ok: true, value: input };
            if (input === 'true') return { ok: true, value: true };
            if (input === 'false') return { ok: true, value: false };
            return { ok: false, error: 'Choose on or off.' };
        case 'enum': {
            const hit = option.enum.find(x => x === input || String(x) === String(input));
            return hit === undefined ? { ok: false, error: 'Not one of the allowed values.' } : { ok: true, value: hit };
        }
        case 'integer':
        case 'number': {
            const n = typeof input === 'number' ? input : Number(String(input).trim());
            if (!Number.isFinite(n)) return { ok: false, error: 'Enter a number.' };
            if (option.kind === 'integer' && !Number.isInteger(n)) return { ok: false, error: 'Enter a whole number.' };
            if (option.min !== undefined && n < option.min) return { ok: false, error: `At least ${option.min}.` };
            if (option.max !== undefined && n > option.max) return { ok: false, error: `At most ${option.max}.` };
            return { ok: true, value: n };
        }
        case 'string':
            return { ok: true, value: String(input) };
        default:
            if (typeof input !== 'string') return { ok: true, value: input };
            try { return { ok: true, value: JSON.parse(input) }; } catch { return { ok: false, error: 'Enter valid JSON.' }; }
    }
}
