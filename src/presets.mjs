// Use-case presets, written by meaning and mapped onto whatever fields a provider/model has.
// Pure: no SillyTavern or browser imports.
// Rule from the owner: presets NEVER set repetition / frequency / presence penalties.

/**
 * Each concept says where a value can go:
 *  - fields: request fields to try, in order (first one this provider lists and supports wins)
 *  - st: a SillyTavern setting (its control's element id) used when no field fits, or always for st-only concepts
 *  - map: optional value translation per target
 */
export const CONCEPTS = Object.freeze({
    temperature: { label: 'Temperature', st: { id: 'temp_openai', kind: 'number' } },
    topP: { label: 'Top P', st: { id: 'top_p_openai', kind: 'number' } },
    minP: { label: 'Min P', fields: ['min_p'] },
    maxReply: { label: 'Max reply length', st: { id: 'openai_max_tokens', kind: 'number' }, clipToModel: true },
    thinkingEffort: { label: 'Thinking effort', fields: ['reasoning_effort', 'reasoning.effort'] },
    showThinking: { label: 'Show thinking', st: { id: 'openai_show_thoughts', kind: 'checkbox' } },
    verbosity: { label: 'Verbosity', fields: ['verbosity', 'text.verbosity'] },
    webSearch: { label: 'Web search', fields: ['venice_parameters.enable_web_search'] },
    providerSystemPrompt: { label: "Provider's own system prompt", fields: ['venice_parameters.include_venice_system_prompt'] },
    promptCaching: { label: 'Prompt caching', fields: ['prompt_cache_retention'] },
});

/** Never set by any preset. */
export const NEVER_SET = Object.freeze(['repetition_penalty', 'frequency_penalty', 'presence_penalty', 'freq_pen_openai', 'pres_pen_openai', 'repetition_penalty_openai']);

/** Built-in presets. A concept left out means "provider default / leave as is". */
export const BUILTIN_PRESETS = Object.freeze([
    { id: 'default', name: 'Default', description: 'Sets nothing. Every option stays at the provider\'s default unless you set it yourself.', values: {} },
    {
        id: 'roleplay', name: 'Roleplay', description: 'Lively, in-character replies of a few paragraphs.',
        values: { temperature: 1.0, topP: 0.95, minP: 0.05, maxReply: 600, thinkingEffort: 'low', showThinking: false, verbosity: 'medium', webSearch: 'off', providerSystemPrompt: false, promptCaching: 'extended' },
    },
    {
        id: 'novel', name: 'Novel', description: 'Long, careful prose: chapters and scenes.',
        values: { temperature: 0.9, topP: 0.95, minP: 0.05, maxReply: 4000, thinkingEffort: 'medium', showThinking: false, verbosity: 'high', webSearch: 'off', providerSystemPrompt: false, promptCaching: 'extended' },
    },
    {
        id: 'assistant', name: 'Assistant', description: 'Accurate, focused answers; may look things up.',
        values: { temperature: 0.4, topP: 1.0, maxReply: 2000, thinkingEffort: 'medium', verbosity: 'medium', webSearch: 'auto' },
    },
    {
        id: 'brainstorm', name: 'Brainstorm', description: 'Wild, varied ideas.',
        values: { temperature: 1.2, topP: 0.98, minP: 0.05, maxReply: 1500, thinkingEffort: 'low', showThinking: false, verbosity: 'medium', webSearch: 'off', providerSystemPrompt: false },
    },
]);

function fits(option, value) {
    if (option.kind === 'enum') return option.enum.includes(value);
    if (option.kind === 'boolean') return typeof value === 'boolean';
    if (option.kind === 'number' || option.kind === 'integer') {
        if (typeof value !== 'number') return false;
        if (option.kind === 'integer' && !Number.isInteger(value)) return false;
        if (option.min !== undefined && value < option.min) return false;
        if (option.max !== undefined && value > option.max) return false;
        return true;
    }
    if (option.kind === 'string') return typeof value === 'string';
    return false;
}

/**
 * Works out what a preset does on this connection.
 * @param {{values: object}} preset
 * @param {object} ctx
 * @param {Array} ctx.options leaf options this provider lists (from spec.leaves)
 * @param {(option) => boolean|null} ctx.supports whether the current model supports an option (null = unknown, treated as yes)
 * @param {boolean} ctx.canSend whether this connection can send extra fields
 * @param {Set<string>} ctx.stControls SillyTavern control ids that exist right now
 * @param {number|null} ctx.maxOutput the model's output cap, if known
 * @returns {{extras: object, st: Array<{id, kind, value, concept}>, skipped: string[]}}
 */
export function resolvePreset(preset, { options = [], supports = () => null, canSend = true, stControls = new Set(), maxOutput = null } = {}) {
    const byKey = new Map(options.map(o => [o.key, o]));
    const extras = {};
    const st = [];
    const skipped = [];
    for (const [concept, rawValue] of Object.entries(preset?.values ?? {})) {
        const def = CONCEPTS[concept];
        if (!def) { skipped.push(concept); continue; }
        let value = rawValue;
        if (def.clipToModel && typeof value === 'number' && maxOutput) value = Math.min(value, maxOutput);
        let placed = false;
        if (canSend) {
            for (const field of def.fields ?? []) {
                if (NEVER_SET.includes(field)) continue;
                const option = byKey.get(field);
                if (!option || supports(option) === false || !fits(option, value)) continue;
                extras[field] = value;
                placed = true;
                break;
            }
        }
        if (!placed && def.st && !NEVER_SET.includes(def.st.id) && stControls.has(def.st.id)) {
            st.push({ id: def.st.id, kind: def.st.kind, value, concept });
            placed = true;
        }
        if (!placed) skipped.push(concept);
    }
    // User presets also carry raw provider fields (whatever they had set), applied where this provider has them.
    if (canSend) {
        for (const [field, value] of Object.entries(preset?.fields ?? {})) {
            if (NEVER_SET.includes(field)) continue;
            const option = byKey.get(field);
            if (option && supports(option) !== false) extras[field] = value;
            else skipped.push(field);
        }
    }
    return { extras, st, skipped };
}

/** All presets: built-ins first, then the user's own (ids prefixed "my:"). */
export function allPresets(userPresets = []) {
    return [...BUILTIN_PRESETS, ...userPresets.map(p => ({ ...p, id: p.id.startsWith('my:') ? p.id : `my:${p.id}` }))];
}

/**
 * Builds a user preset from the current SillyTavern values (concept -> value) and the provider fields set in Dials.
 * Penalties are dropped. Concepts that are provider fields go in `fields`, so they come back exactly.
 */
export function makeUserPreset(name, stValues, fieldValues) {
    const set = v => v !== undefined && v !== null && v !== '';
    const values = Object.fromEntries(Object.entries(stValues || {}).filter(([k, v]) => CONCEPTS[k]?.st && !CONCEPTS[k].fields && set(v)));
    const fields = Object.fromEntries(Object.entries(fieldValues || {}).filter(([k, v]) => !NEVER_SET.includes(k) && set(v)));
    const id = `my:${String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'preset'}`;
    return { id, name: String(name).trim() || 'My preset', description: 'Saved by you.', values, fields };
}
