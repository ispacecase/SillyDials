// Builds the extra request fields and merges them into a copy of the user's Include Body.
// Pure: YAML parsing is passed in so this runs in Node tests and in the browser.

export const isPlainObject = x => !!x && typeof x === 'object' && !Array.isArray(x);

/** Turns saved values {"venice_parameters.disable_thinking": true} into a nested object. Unset values are skipped. */
export function buildExtras(values) {
    const out = {};
    for (const [key, value] of Object.entries(values || {})) {
        if (value === undefined || value === null || value === '') continue;
        const path = key.split('.');
        let node = out;
        for (const part of path.slice(0, -1)) {
            if (!isPlainObject(node[part])) node[part] = {};
            node = node[part];
        }
        node[path[path.length - 1]] = value;
    }
    return out;
}

/**
 * Merges our extras under the user's own values: the user wins key by key, nested objects merge.
 * Returns {merged, overridden}, where overridden lists our keys the user already set.
 */
export function mergeUserWins(user, ours, prefix = '') {
    const merged = isPlainObject(user) ? { ...user } : {};
    const overridden = [];
    for (const [k, v] of Object.entries(ours || {})) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (!(k in merged)) { merged[k] = v; continue; }
        if (isPlainObject(merged[k]) && isPlainObject(v)) {
            const inner = mergeUserWins(merged[k], v, key);
            merged[k] = inner.merged;
            overridden.push(...inner.overridden);
        } else {
            overridden.push(key);
        }
    }
    return { merged, overridden };
}

/** Removes the keys the user overrode, so the preview shows only what Dials actually adds. */
export function withoutKeys(obj, keys) {
    const out = structuredClone(obj);
    for (const key of keys) {
        const path = key.split('.');
        let node = out;
        for (const part of path.slice(0, -1)) node = node?.[part];
        if (isPlainObject(node)) delete node[path[path.length - 1]];
    }
    const prune = o => { for (const [k, v] of Object.entries(o)) if (isPlainObject(v)) { prune(v); if (!Object.keys(v).length) delete o[k]; } return o; };
    return prune(out);
}

/**
 * Reads Include Body text the way SillyTavern's server does (YAML object, or a list of objects merged shallowly).
 * Returns {ok, value} or {ok: false} when the text can't be read.
 */
export function parseIncludeBody(text, parseYaml) {
    if (!text || !String(text).trim()) return { ok: true, value: {} };
    let parsed;
    try { parsed = parseYaml(String(text)); } catch { return { ok: false }; }
    if (Array.isArray(parsed)) {
        const value = {};
        for (const item of parsed) if (isPlainObject(item)) Object.assign(value, item);
        return { ok: true, value };
    }
    if (isPlainObject(parsed)) return { ok: true, value: parsed };
    if (parsed === null || parsed === undefined) return { ok: true, value: {} };
    return { ok: false };
}

/**
 * Adds extras to an outgoing SillyTavern request (mutates generateData).
 * Custom source: merged into custom_include_body (user's values win), plus stream_options.include_usage when streaming.
 * Other sources: nothing is changed; everything is reported as not sent.
 * @returns {{sent: object, overridden: string[], notSent: object, problem: string|null}}
 */
export function applyExtras(generateData, extras, { parseYaml, includeUsage = true } = {}) {
    const ours = structuredClone(extras || {});
    const result = { sent: {}, overridden: [], notSent: {}, problem: null };
    if (generateData?.chat_completion_source !== 'custom') {
        result.notSent = ours;
        return result;
    }
    if (includeUsage && generateData.stream) {
        ours.stream_options = { ...(isPlainObject(ours.stream_options) ? ours.stream_options : {}), include_usage: true };
    }
    if (!Object.keys(ours).length) return result;
    const user = parseIncludeBody(generateData.custom_include_body, parseYaml);
    if (!user.ok) {
        result.notSent = ours;
        result.problem = 'Your Include Body text could not be read, so Dials left the request alone.';
        return result;
    }
    const { merged, overridden } = mergeUserWins(user.value, ours);
    generateData.custom_include_body = JSON.stringify(merged);
    result.sent = withoutKeys(ours, overridden);
    result.overridden = overridden;
    return result;
}
