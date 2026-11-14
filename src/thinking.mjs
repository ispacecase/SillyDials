// One "Thinking" setting in place of the provider's several overlapping fields
// (reasoning_effort, reasoning.effort, reasoning.enabled, venice_parameters.disable_thinking).
// Pure: no SillyTavern or browser imports.
import { allowedValues, defaultFor } from './models.mjs';

/** Every provider field that turns thinking on/off or sets its level. Shown only through the one Thinking control. */
export const THINKING_FIELDS = Object.freeze(['reasoning_effort', 'reasoning.effort', 'reasoning.enabled', 'venice_parameters.disable_thinking']);
const LEVEL_FIELDS = ['reasoning_effort', 'reasoning.effort'];

/**
 * What the Thinking control can offer on this connection/model.
 * @returns {null | {levels: string[], canTurnOff: boolean, offVia: string|null, levelField: string|null, default: string|null, defaultFrom: 'model'|'spec'|null}}
 *   null when the provider lists none of the thinking fields (or the model doesn't support them).
 */
export function thinkingInfo(options, model, supports = () => null) {
    const byKey = new Map(options.filter(o => supports(o) !== false).map(o => [o.key, o]));
    const levelField = LEVEL_FIELDS.find(k => byKey.has(k)) ?? null;
    const levelOption = levelField ? byKey.get(levelField) : null;
    const allowed = levelOption ? allowedValues(levelOption, model) : [];
    let offVia = null;
    if (levelOption && allowed.includes('none')) offVia = levelField;
    else if (byKey.has('venice_parameters.disable_thinking')) offVia = 'venice_parameters.disable_thinking';
    else if (byKey.has('reasoning.enabled')) offVia = 'reasoning.enabled';
    if (!levelField && !offVia) return null;
    const def = levelOption ? defaultFor(levelOption, model) : null;
    return {
        levels: allowed.filter(v => v !== 'none'),
        canTurnOff: !!offVia,
        offVia,
        levelField,
        default: def ? (def.value === 'none' ? 'off' : String(def.value)) : null,
        defaultFrom: def?.from ?? null,
    };
}

/** The Thinking choice saved in these values: 'off', a level, or undefined (not set, model default). */
export function readThinking(values) {
    const v = values || {};
    if (v['venice_parameters.disable_thinking'] === true || v['reasoning.enabled'] === false) return 'off';
    for (const k of LEVEL_FIELDS) if (v[k] !== undefined) return v[k] === 'none' ? 'off' : v[k];
    return undefined;
}

/**
 * Returns new values with the Thinking choice applied: every thinking field is cleared first,
 * then only the field(s) this model understands are set. choice undefined = back to the model default.
 */
export function writeThinking(values, choice, info) {
    const next = { ...(values || {}) };
    for (const k of THINKING_FIELDS) delete next[k];
    if (choice === undefined || choice === null || choice === '' || !info) return next;
    if (choice === 'off') {
        if (!info.offVia) return next;
        if (LEVEL_FIELDS.includes(info.offVia)) next[info.offVia] = 'none';
        else if (info.offVia === 'venice_parameters.disable_thinking') next[info.offVia] = true;
        else next[info.offVia] = false;
        return next;
    }
    if (info.levelField && info.levels.includes(choice)) next[info.levelField] = choice;
    return next;
}
