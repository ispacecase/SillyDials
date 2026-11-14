// Plans the merged settings list: every setting once, grouped by meaning, Recommended first.
// Pure: no SillyTavern or browser imports.
import { THINKING_FIELDS } from './thinking.mjs';

/**
 * Groups and their members, in display order.
 * A member names a SillyTavern control (`st`, its element id), provider fields (`fields`, first one listed wins), or both.
 * When both: if Dials can send the provider field, the provider row is shown and SillyTavern's duplicate is hidden;
 * otherwise SillyTavern's control is shown.
 */
export const GROUPS = Object.freeze([
    {
        id: 'recommended', label: 'Recommended', tab: 'recommended', open: true, members: [
            { st: 'temp_openai' },
            { st: 'top_p_openai' },
            { st: 'openai_max_tokens' },
            { st: 'openai_max_context' },
            { thinking: true, st: 'openai_reasoning_effort' },
            { st: 'openai_show_thoughts' },
            { st: 'stream_toggle' },
            { fields: ['venice_parameters.include_venice_system_prompt'] },
            { fields: ['venice_parameters.enable_web_search'], st: 'openai_enable_web_search' },
        ],
    },
    {
        id: 'thinking', label: 'Thinking', members: [
            { fields: ['venice_parameters.strip_thinking_response'] },
            { fields: ['reasoning.summary'] },
        ],
    },
    {
        id: 'wording', label: 'Word choice', members: [
            { fields: ['min_p'], st: 'min_p_openai' },
            { fields: ['top_k'], st: 'top_k_openai' },
            { st: 'top_a_openai' },
            { fields: ['min_temp'] },
            { fields: ['max_temp'] },
            { st: 'freq_pen_openai' },
            { st: 'pres_pen_openai' },
            { fields: ['repetition_penalty'], st: 'repetition_penalty_openai' },
        ],
    },
    {
        id: 'length', label: 'Length and stopping', members: [
            { fields: ['verbosity', 'text.verbosity'], st: 'openai_verbosity' },
            { st: 'n_openai' },
            { st: 'seed_openai' },
            { fields: ['stop_token_ids'] },
        ],
    },
    {
        id: 'web', label: 'Web and search', members: [
            { fields: ['venice_parameters.enable_web_citations'] },
            { fields: ['venice_parameters.enable_web_scraping'] },
            { fields: ['venice_parameters.enable_x_search'] },
            { fields: ['venice_parameters.include_search_results_in_stream'] },
            { fields: ['venice_parameters.return_search_results_as_documents'] },
        ],
    },
    {
        id: 'privacy', label: 'Privacy, caching and characters', members: [
            { fields: ['prompt_cache_retention'] },
            { fields: ['prompt_cache_key'] },
            { fields: ['venice_parameters.enable_e2ee'] },
            { fields: ['venice_parameters.character_slug'] },
        ],
    },
]);

/** Provider fields that are bookkeeping rather than settings; listed last under "Technical". */
export const TECHNICAL_FIELDS = Object.freeze(['user', 'anon_user_id', 'store', 'metadata', 'include', 'fallbacks']);

/**
 * @param {object} ctx
 * @param {Array} ctx.options leaf provider options (spec.leaves)
 * @param {(option) => boolean|null} ctx.supports model support (false = hide unless showUnsupported or already set)
 * @param {boolean} ctx.canSend whether this connection can send provider fields
 * @param {Set<string>} ctx.stPresent SillyTavern control ids that exist
 * @param {Set<string>} ctx.setKeys provider option keys the user has set (always shown)
 * @param {boolean} ctx.showUnsupported
 * @param {object|null} ctx.thinking thinkingInfo() for this model; when set (and sendable) one Thinking row replaces every thinking field
 * @returns {{groups: Array<{id, label, tab: 'recommended'|'experts', open, rows: Array<{type:'st', id} | {type:'field', option, supported} | {type:'thinking', info}>}>, hideSt: string[], hiddenUnsupported: number}}
 */
export function planLayout({ options = [], supports = () => null, canSend = true, stPresent = new Set(), setKeys = new Set(), showUnsupported = false, thinking = null } = {}) {
    const byKey = new Map(options.map(o => [o.key, o]));
    // The thinking fields are only ever shown through the single Thinking control.
    const placed = new Set(THINKING_FIELDS);
    const hideSt = [];
    let hiddenUnsupported = 0;
    const visible = option => {
        const supported = supports(option) !== false;
        if (supported || setKeys.has(option.key) || showUnsupported) return { ok: true, supported };
        hiddenUnsupported++;
        return { ok: false, supported };
    };
    const fieldRow = key => {
        const option = byKey.get(key);
        if (!option || placed.has(key)) return null;
        placed.add(key);
        const v = visible(option);
        return v.ok ? { type: 'field', option, supported: v.supported } : null;
    };

    const groups = GROUPS.map(g => {
        const rows = [];
        for (const m of g.members) {
            if (m.thinking) {
                if (canSend && thinking) {
                    rows.push({ type: 'thinking', info: thinking });
                    if (m.st && stPresent.has(m.st)) hideSt.push(m.st);
                } else if (m.st && stPresent.has(m.st)) {
                    rows.push({ type: 'st', id: m.st });
                }
                continue;
            }
            const fieldKey = canSend ? (m.fields ?? []).find(k => byKey.has(k)) : undefined;
            if (fieldKey) {
                // Alternate spellings of the same setting count as placed, so they don't show up again below.
                for (const k of m.fields) if (k !== fieldKey && byKey.has(k)) placed.add(k);
                const row = fieldRow(fieldKey);
                if (row) rows.push(row);
                if (m.st && stPresent.has(m.st)) hideSt.push(m.st);
                continue;
            }
            for (const k of m.fields ?? []) if (byKey.has(k)) placed.add(k); // can't send: provider rows not shown
            if (m.st && stPresent.has(m.st)) rows.push({ type: 'st', id: m.st });
        }
        return { id: g.id, label: g.label, tab: g.tab ?? 'experts', open: !!g.open, rows };
    });

    if (canSend) {
        const rest = [];
        const technical = [];
        for (const option of options) {
            if (placed.has(option.key)) continue;
            const row = fieldRow(option.key);
            if (!row) continue;
            (TECHNICAL_FIELDS.includes(option.path[0]) ? technical : rest).push(row);
        }
        groups.push({ id: 'more', label: 'More from the provider', tab: 'experts', open: false, rows: rest });
        groups.push({ id: 'technical', label: 'Technical', tab: 'experts', open: false, rows: technical });
    }
    return { groups: groups.filter(g => g.rows.length), hideSt, hiddenUnsupported };
}

/** SillyTavern control ids the layout can place (used to find and move their blocks). */
export function placeableStIds() {
    return [...new Set(GROUPS.flatMap(g => g.members.map(m => m.st).filter(Boolean)))];
}
