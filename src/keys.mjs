// Where settings live: per caller, per connection, per model.
// Pure: no SillyTavern or browser imports.

/** The built-in caller: SillyTavern's own chat. Other extensions register their own. */
export const SILLYTAVERN = 'sillytavern';

/**
 * Identifies a connection: the connection profile when one is selected,
 * otherwise the source plus endpoint address (address only matters for Custom).
 */
export function connectionKey({ profileId = null, source = '', url = '' } = {}) {
    if (profileId) return `profile:${profileId}`;
    const cleanUrl = source === 'custom' ? String(url || '').trim().replace(/\/+$/, '').toLowerCase() : '';
    return cleanUrl ? `${source}@${cleanUrl}` : String(source || 'unknown');
}

/** The full key for one set of saved values. */
export function settingsKey(caller, connection, model) {
    return [caller || SILLYTAVERN, connection, String(model || '')].join('|');
}

/** Reads the values saved for a key (never undefined). */
export function valuesFor(store, key) {
    const v = store?.[key];
    return v && typeof v === 'object' ? v : {};
}

/** Returns a new store with one value set or (when undefined/empty) cleared. Empty sets are removed. */
export function setValue(store, key, optionKey, value) {
    const next = { ...(store || {}) };
    const values = { ...valuesFor(next, key) };
    if (value === undefined || value === null || value === '') delete values[optionKey];
    else values[optionKey] = value;
    if (Object.keys(values).length) next[key] = values; else delete next[key];
    return next;
}

/** Copies all values from one key to another (replacing what was there). */
export function copyValues(store, fromKey, toKey) {
    const next = { ...(store || {}) };
    const values = valuesFor(next, fromKey);
    if (Object.keys(values).length) next[toKey] = structuredClone(values); else delete next[toKey];
    return next;
}
