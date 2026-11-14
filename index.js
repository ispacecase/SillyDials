// Dials: provider options read from the provider, added to the outgoing request,
// plus a real token counter from the provider's usage data.
import { saveChatDebounced } from '../../../../script.js';
import { yaml, localforage } from '../../../../lib.js';
import { chatRequestSchema, optionsFromSchema, leaves, coerceValue, specCandidates, OPENAI_FALLBACK_SCHEMA } from './src/spec.mjs';
import { detectProvider, normalizeModels, supportsOption, canSendExtras } from './src/models.mjs';
import { buildExtras, applyExtras } from './src/extras.mjs';
import { createStreamReader, readJsonReply, limitStatus, costOf, addToTotals, pruneDays, usageLine, formatCost, dayOf } from './src/usage.mjs';
import { SILLYTAVERN, connectionKey, settingsKey, valuesFor, setValue, copyValues } from './src/keys.mjs';
import { CONCEPTS, BUILTIN_PRESETS, resolvePreset, allPresets, makeUserPreset } from './src/presets.mjs';
import { explainField, explainSillyTavern } from './src/explain.mjs';

const VERSION = '0.1.0';
const MODULE = 'dials';
const GENERATE_URL = '/api/backends/chat-completions/generate';
const TAG_FIELD = 'dials_tag';
const CACHE_HOURS = 24;
const VENICE_SPEC_URL = 'https://docs.venice.ai/swagger.yaml';
const BASE = new URL('.', import.meta.url);

const DEFAULTS = Object.freeze({ takeover: true, tab: 'options', preset: 'default', userPresets: [], undo: null, seen: {}, values: {}, totals: {}, showCost: false, requestUsage: true, nearAt: 0.9, showUnsupported: false, view: SILLYTAVERN });

const ctx = () => SillyTavern.getContext();

function settings() {
    const all = ctx().extensionSettings;
    all[MODULE] ??= {};
    for (const [k, v] of Object.entries(DEFAULTS)) if (all[MODULE][k] === undefined) all[MODULE][k] = structuredClone(v);
    return all[MODULE];
}
const save = () => ctx().saveSettingsDebounced();

// ---------- callers ----------

/** id -> {label, getConnection} ; SillyTavern's own chat is always there. */
const callers = new Map();
callers.set(SILLYTAVERN, { label: 'SillyTavern chat', getConnection: sillyTavernConnection });

function sillyTavernConnection() {
    const c = ctx();
    const s = c.chatCompletionSettings;
    return {
        active: c.mainApi === 'openai',
        profileId: c.extensionSettings?.connectionManager?.selectedProfile || null,
        source: s.chat_completion_source,
        url: s.custom_url || '',
        model: c.getChatCompletionModel(s),
        statusPayload: {
            chat_completion_source: s.chat_completion_source,
            custom_url: s.custom_url,
            custom_include_headers: c.substituteParams ? c.substituteParams(s.custom_include_headers || '') : s.custom_include_headers,
            reverse_proxy: s.reverse_proxy,
            proxy_password: s.proxy_password,
        },
    };
}

function connectionOf(callerId) {
    const caller = callers.get(callerId) ?? callers.get(SILLYTAVERN);
    try { return { active: true, ...caller.getConnection() }; } catch (e) { console.warn('[Dials] caller connection failed', e); return null; }
}

function keyFor(callerId, conn) {
    return settingsKey(callerId, connectionKey(conn), conn.model);
}

// ---------- provider info (spec + models), cached ----------

const memory = new Map();

async function cached(key, load, force) {
    if (!force && memory.has(key)) return memory.get(key);
    if (!force) {
        try {
            const hit = await localforage.getItem(key);
            if (hit && Date.now() - hit.at < CACHE_HOURS * 3600e3) { memory.set(key, hit.value); return hit.value; }
        } catch { /* storage unavailable */ }
    }
    const value = await load();
    memory.set(key, value);
    try { await localforage.setItem(key, { at: Date.now(), value }); } catch { /* storage unavailable */ }
    return value;
}

async function fetchText(url, ms = 8000) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
        const r = await fetch(url, { signal: ctl.signal, cache: 'no-cache', credentials: 'omit' });
        if (!r.ok) throw Error(`HTTP ${r.status}`);
        return await r.text();
    } finally { clearTimeout(timer); }
}

const parseSpecText = text => { const t = text.trim(); return t.startsWith('{') ? JSON.parse(t) : yaml.parse(t); };

/** Returns {schema, from: 'live' | 'bundled' | 'standard', address}. */
async function loadSchema(conn, force) {
    const provider = detectProvider(conn);
    const endpoint = conn.source === 'custom' ? conn.url : conn.source;
    return cached(`dials:spec:${provider}:${endpoint}`, async () => {
        if (provider === 'venice') {
            try { return { schema: chatRequestSchema(parseSpecText(await fetchText(VENICE_SPEC_URL))), from: 'live', address: VENICE_SPEC_URL }; } catch (e) { console.info('[Dials] live Venice spec unavailable, using bundled copy:', e.message); }
            const snap = await (await fetch(new URL('data/venice-chat-request.json', BASE))).json();
            return { schema: snap.schema, from: 'bundled', address: `${snap.source} (${snap.version})` };
        }
        if (provider === 'generic' && conn.source === 'custom') {
            for (const address of specCandidates(conn.url)) {
                try { return { schema: chatRequestSchema(parseSpecText(await fetchText(address, 4000))), from: 'live', address }; } catch { /* try next */ }
            }
        }
        return { schema: OPENAI_FALLBACK_SCHEMA, from: 'standard', address: null };
    }, force);
}

/** Returns a Map of id -> model, or an empty Map. Goes through SillyTavern's server so keys stay there. */
async function loadModels(conn, force) {
    const provider = detectProvider(conn);
    const endpoint = conn.source === 'custom' ? conn.url : conn.source;
    const raw = await cached(`dials:models:${endpoint}`, async () => {
        const c = ctx();
        const r = await fetch('/api/backends/chat-completions/status', { method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify(conn.statusPayload ?? { chat_completion_source: conn.source, custom_url: conn.url }), cache: 'no-cache' });
        if (!r.ok) throw Error(`model list HTTP ${r.status}`);
        const body = await r.json();
        if (body?.error) throw Error('provider returned no model list');
        return body;
    }, force).catch(e => { console.info('[Dials] model list unavailable:', e.message); return null; });
    return normalizeModels(raw, provider);
}

// ---------- sending ----------

let tagCounter = 0;
const pending = new Map(); // tag -> record

function newTag() { return `${Date.now().toString(36)}-${(++tagCounter).toString(36)}`; }

/**
 * Adds a caller's options to a request payload (mutates it) and tags it so its usage can be read.
 * @returns {{tag: string, sent: object, notSent: object, overridden: string[], problem: string|null}}
 */
function prepare(callerId, payload, conn, meta = {}) {
    const s = settings();
    const values = valuesFor(s.values, keyFor(callerId, conn));
    const result = applyExtras(payload, buildExtras(values), { parseYaml: text => yaml.parse(text), includeUsage: s.requestUsage });
    const tag = newTag();
    payload[TAG_FIELD] = tag;
    let resolve;
    const done = new Promise(r => { resolve = r; });
    pending.set(tag, { tag, caller: callerId, conn, model: payload.model, maxTokens: payload.max_tokens ?? payload.max_completion_tokens ?? null, type: meta.type ?? null, stream: payload.stream === true, chatId: ctx().getCurrentChatId?.() ?? null, result, done, resolve, mesId: null, outcome: undefined });
    lastPrepared.set(callerId, { at: Date.now(), result });
    renderPreviewIfOpen();
    return { tag, ...result };
}
const lastPrepared = new Map();

async function onSettingsReady(data) {
    try {
        const conn = connectionOf(SILLYTAVERN);
        if (!conn) return;
        const sendConn = { ...conn, source: data.chat_completion_source, url: data.custom_url || conn.url, model: data.model };
        await seedOnSend(sendConn, data);
        const prepared = prepare(SILLYTAVERN, data, sendConn, { type: data.type });
        if (data.type !== 'quiet' && data.type !== 'impersonate') awaitingMessage = prepared.tag;
    } catch (e) {
        console.error('[Dials] could not add options; request sent unchanged', e);
    }
}

/**
 * A model Dials hasn't seen yet, sent to before the panel was opened: start it on the selected use case now,
 * including this request's temperature / top P / max length.
 */
async function seedOnSend(conn, data) {
    const s = settings();
    const key = keyFor(SILLYTAVERN, conn);
    if (s.seen[key] || s.preset === 'default' || Object.keys(valuesFor(s.values, key)).length) return;
    const preset = allPresets(s.userPresets).find(p => p.id === s.preset);
    if (!preset) return;
    const [schemaInfo, models] = await Promise.all([loadSchema(conn, false), loadModels(conn, false)]);
    const model = models.get(conn.model) ?? null;
    const provider = detectProvider(conn);
    const r = resolvePreset(preset, {
        options: leaves(optionsFromSchema(schemaInfo.schema)),
        supports: o => supportsOption(o, model, provider),
        canSend: canSendExtras(conn.source),
        stControls: stControlIds(),
        maxOutput: model?.maxOutput ?? null,
    });
    s.undo = { key, values: {}, st: Object.fromEntries(r.st.map(x => [x.id, { kind: x.kind, value: readStValue(x.id, x.kind) }])), label: preset.name };
    if (Object.keys(r.extras).length) s.values = { ...(s.values || {}), [key]: { ...r.extras } };
    for (const x of r.st) writeStValue(x.id, x.kind, x.value);
    const requestField = { temp_openai: 'temperature', top_p_openai: 'top_p', openai_max_tokens: 'max_tokens' };
    for (const x of r.st) if (requestField[x.id]) data[requestField[x.id]] = x.value;
    s.seen[key] = true;
    save();
    toastr.info(`New model: started it on ${preset.name}. Undo is in Dials.`, 'Dials', { timeOut: 5000 });
}

// ---------- reading replies ----------

const originalFetch = window.fetch;

function installFetchWrap() {
    if (window.fetch.__dials) return;
    const wrapped = async function (input, init) {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
        if (!url || !String(url).endsWith(GENERATE_URL) || typeof init?.body !== 'string' || !init.body.includes(TAG_FIELD)) {
            return originalFetch.apply(this, arguments);
        }
        let tag = null;
        try {
            const body = JSON.parse(init.body);
            tag = body[TAG_FIELD] ?? null;
            delete body[TAG_FIELD];
            init = { ...init, body: JSON.stringify(body) };
        } catch { /* leave as is */ }
        const response = await originalFetch.call(this, input, init);
        const record = tag && pending.get(tag);
        if (record) readReply(record, response.clone()).catch(e => { console.warn('[Dials] could not read usage', e); settle(record, null); });
        return response;
    };
    wrapped.__dials = true;
    window.fetch = wrapped;
}

async function readReply(record, response) {
    if (!response.ok || !response.body) return settle(record, null);
    const type = response.headers.get('content-type') || '';
    if (record.stream || type.includes('text/event-stream')) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const sse = createStreamReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            sse.push(decoder.decode(value, { stream: true }));
        }
        return settle(record, sse.finish());
    }
    return settle(record, readJsonReply(await response.json()));
}

async function settle(record, outcome) {
    record.outcome = outcome;
    const s = settings();
    let model = null;
    try { model = (await loadModels(record.conn, false)).get(record.model) ?? null; } catch { /* none */ }
    const usage = outcome?.usage ?? null;
    const entry = {
        tag: record.tag,
        type: record.type,
        caller: record.caller,
        model: record.model,
        usage,
        estimated: false,
        finishReason: outcome?.finishReason ?? null,
        limit: limitStatus(outcome ?? {}, { maxTokens: record.maxTokens, providerCap: model?.maxOutput ?? null, nearAt: s.nearAt }),
        cost: costOf(usage, model?.pricing ?? null),
        at: Date.now(),
    };
    if (usage) {
        s.totals = pruneDays(addToTotals(s.totals, { usage, cost: entry.cost, chatId: record.caller === SILLYTAVERN ? record.chatId : null, caller: record.caller }));
        save();
    }
    pending.delete(record.tag);
    lastUsage = entry;
    record.resolve(entry);
    for (const fn of listeners) { try { fn(entry); } catch (e) { console.warn('[Dials] usage listener failed', e); } }
    document.dispatchEvent(new CustomEvent('dials:usage', { detail: entry }));
    if (record.mesId !== null) attachToMessage(record.mesId, entry, record.type);
    warnIfNeeded(entry);
    renderTotalsIfOpen();
    renderTokenBar();
}

let lastUsage = null;
const listeners = new Set();
let awaitingMessage = null;

function warnIfNeeded(entry) {
    if (entry.caller !== SILLYTAVERN) return;
    if (entry.limit.thinkingOnly) toastr.warning('The model used its whole budget thinking and wrote no reply.', 'Dials');
    else if (entry.limit.level === 'cut') toastr.warning(`The reply was cut off at the limit${entry.limit.limit ? ` (${entry.limit.limit.toLocaleString('en-US')} tokens)` : ''}.`, 'Dials');
}

// ---------- per-message line ----------

function onMessageReceived(mesId) {
    const tag = awaitingMessage;
    awaitingMessage = null;
    if (!tag) return;
    const record = pending.get(tag);
    if (record) { record.mesId = Number(mesId); return; }
    // Usage already arrived (non-streamed replies finish before the message is added).
    if (lastUsage?.tag === tag) attachToMessage(Number(mesId), lastUsage, lastUsage.type ?? null);
}

async function attachToMessage(mesId, entry, type) {
    const c = ctx();
    const msg = c.chat?.[mesId];
    if (!msg || msg.is_user) return;
    let info = { ...entry };
    if (!entry.usage) info = await estimateFor(msg, entry);
    if (type === 'continue' && msg.extra?.dials?.usage && info.usage) {
        const prev = msg.extra.dials.usage;
        info.usage = { ...info.usage, thinking: (prev.thinking ?? 0) + (info.usage.thinking ?? 0), reply: prev.reply + info.usage.reply, output: prev.output + info.usage.output };
        info.continued = (msg.extra.dials.continued ?? 0) + 1;
    }
    msg.extra ??= {};
    msg.extra.dials = info;
    const swipe = msg.swipe_info?.[msg.swipe_id ?? 0];
    if (swipe) { swipe.extra ??= {}; swipe.extra.dials = info; }
    saveChatDebounced();
    renderMessage(mesId);
}

/** Fallback when the provider sent no usage: SillyTavern's tokenizer on the reply and thinking, labelled as an estimate. */
async function estimateFor(msg, entry) {
    const c = ctx();
    const count = async text => (text && c.getTokenCountAsync ? await c.getTokenCountAsync(text) : 0);
    const reply = await count(msg.mes);
    const thinking = msg.extra?.reasoning ? await count(msg.extra.reasoning) : null;
    return { ...entry, estimated: true, usage: { prompt: null, cached: 0, thinking, reply, output: reply + (thinking ?? 0), total: null } };
}

function renderMessage(mesId) {
    const msg = ctx().chat?.[mesId];
    const el = document.querySelector(`#chat .mes[mesid="${mesId}"] .mes_block`);
    if (!el) return;
    el.querySelector(':scope > .dials-usage')?.remove();
    const info = msg?.extra?.dials;
    if (!info?.usage) return;
    const s = settings();
    const line = document.createElement('div');
    line.className = 'dials-usage';
    let text = usageLine(info.usage, { estimated: info.estimated });
    if (info.continued) text += ` (with ${info.continued} continue${info.continued > 1 ? 's' : ''})`;
    if (s.showCost && info.cost !== null && info.cost !== undefined) text += ` · ${formatCost(info.cost)}`;
    line.textContent = text;
    const warn = info.limit?.thinkingOnly ? 'All thinking, no reply'
        : info.limit?.level === 'cut' ? `Stopped at the limit${info.limit.limit ? ` (${info.limit.limit.toLocaleString('en-US')})` : ''}`
            : info.limit?.level === 'near' ? `Near the limit (${Math.round(info.limit.ratio * 100)}% of ${info.limit.limit.toLocaleString('en-US')})` : '';
    if (warn) {
        line.classList.add('dials-warn');
        const w = document.createElement('span');
        w.className = 'dials-warn-text';
        w.textContent = ` · ⚠ ${warn}`;
        line.append(w);
    }
    line.title = `Token usage reported by the provider${info.estimated ? ' (not reported, so this is SillyTavern\'s estimate)' : ''}. Model: ${info.model ?? '?'}`;
    el.querySelector('.mes_text')?.after(line);
}

function renderAllMessages() {
    const chat = ctx().chat ?? [];
    document.querySelectorAll('#chat .mes').forEach(el => {
        const id = Number(el.getAttribute('mesid'));
        if (chat[id]?.extra?.dials) renderMessage(id);
    });
}

// ---------- panel ----------

let panel = null;
let current = null; // {callerId, conn, key, schema, models, model, provider}

function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else if (k === 'text') node.textContent = v;
        else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c);
    return node;
}

// The Dials panel lives in SillyTavern's own left drawer (the sliders button). SillyTavern's real
// controls are moved in, not copied, so every change still lands in SillyTavern's own settings.
const moved = []; // {node, marker}
let shell = null;
let switchBox = null;

function moveInto(node, target) {
    if (!node || !target) return;
    const marker = document.createComment(`dials: original place of #${node.id}`);
    node.before(marker);
    target.append(node);
    moved.push({ node, marker });
}

function restoreMoved() {
    while (moved.length) {
        const { node, marker } = moved.pop();
        if (marker.isConnected) marker.replaceWith(node); else console.warn('[Dials] lost original place of', node.id);
    }
}

function addExplanations(root) {
    root.querySelectorAll('.range-block-title[data-i18n]').forEach(title => {
        const text = explainSillyTavern(title.getAttribute('data-i18n'));
        if (!text || title.nextElementSibling?.classList.contains('dials-explain')) return;
        title.after(el('div', { class: 'dials-explain', text }));
    });
}

function showTab(name) {
    if (!shell) return;
    settings().tab = name;
    save();
    shell.querySelectorAll('.dials-tab-button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    shell.querySelectorAll('.dials-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    if (name === 'tokens') renderTotals();
}

function takeOver() {
    const drawer = document.getElementById('left-nav-panel');
    const inner = drawer?.querySelector(':scope > .scrollableInner');
    const config = document.getElementById('ai_response_configuration');
    const prompts = document.getElementById('completion_prompt_manager');
    if (!drawer || !inner || !config || shell) return;
    const tabs = [['options', 'Provider options', 'fa-sliders'], ['st', 'SillyTavern settings', 'fa-gears'], ['prompts', 'Prompts', 'fa-list'], ['tokens', 'Tokens', 'fa-coins']];
    shell = el('div', { id: 'dials-shell', class: 'dials-settings scrollableInner' },
        el('div', { class: 'dials-head' },
            el('div', { class: 'dials-brand' }, el('i', { class: 'fa-solid fa-gauge-high' }), el('span', { text: 'Dials' })),
            el('div', { class: 'dials-top' })),
        el('div', { class: 'dials-presetbar' }),
        el('div', { class: 'dials-tabbar' }, tabs.map(([id, label, icon]) => el('button', { class: 'dials-tab-button', 'data-tab': id, type: 'button', onclick: () => showTab(id) }, el('i', { class: `fa-solid ${icon}` }), el('span', { text: label })))),
        el('div', { class: 'dials-tab', 'data-tab': 'options' },
            el('div', { class: 'dials-notes' }), el('div', { class: 'dials-options' }), el('div', { class: 'dials-extra' }), el('div', { class: 'dials-preview-box' })),
        el('div', { class: 'dials-tab dials-st', 'data-tab': 'st' }),
        el('div', { class: 'dials-tab', 'data-tab': 'prompts' }, el('div', { class: 'dials-muted dials-prompts-note' })),
        el('div', { class: 'dials-tab', 'data-tab': 'tokens' }, el('div', { class: 'dials-totals' }), el('div', { class: 'dials-prefs' })));
    inner.before(shell);
    inner.classList.add('dials-hidden');
    drawer.querySelector('#clickSlidersTips')?.classList.add('dials-hidden');
    moveInto(prompts, shell.querySelector('.dials-tab[data-tab="prompts"]'));
    moveInto(config, shell.querySelector('.dials-tab[data-tab="st"]'));
    addExplanations(shell.querySelector('.dials-st'));
    panel = shell;
    document.querySelector('#ai-config-button .drawer-toggle')?.addEventListener('click', onDrawerToggle);
    showTab(settings().tab || 'options');
    refreshPanel(false);
}

function onDrawerToggle() {
    setTimeout(() => { if (isOpen()) refreshPanel(false); }, 50);
}

function giveBack() {
    if (!shell) return;
    document.querySelector('#ai-config-button .drawer-toggle')?.removeEventListener('click', onDrawerToggle);
    shell.querySelectorAll('.dials-explain').forEach(x => x.remove());
    restoreMoved();
    document.querySelector('#left-nav-panel > .scrollableInner.dials-hidden')?.classList.remove('dials-hidden');
    document.getElementById('clickSlidersTips')?.classList.remove('dials-hidden');
    shell.remove();
    shell = null;
    panel = null;
}

function setTakeover(on) {
    settings().takeover = on;
    save();
    if (on) takeOver(); else giveBack();
}

/** Opens SillyTavern's left drawer (now Dials) on a tab. */
function openDials(tab) {
    if (!settings().takeover) setTakeover(true);
    const drawer = document.getElementById('left-nav-panel');
    if (drawer && !drawer.classList.contains('openDrawer')) document.querySelector('#ai-config-button .drawer-toggle')?.click();
    if (tab) showTab(tab);
}

function buildExtensionsSwitch() {
    const host = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
    if (!host) return;
    switchBox = el('div', { class: 'dials-ext' },
        el('div', { class: 'inline-drawer' },
            el('div', { class: 'inline-drawer-toggle inline-drawer-header' }, el('b', { text: 'Dials' }), el('div', { class: 'inline-drawer-icon fa-solid fa-circle-chevron-down down' })),
            el('div', { class: 'inline-drawer-content' },
                el('label', { class: 'checkbox_label' },
                    el('input', { type: 'checkbox', checked: settings().takeover, onchange: e => setTakeover(e.target.checked) }),
                    el('span', { text: 'Dials replaces the AI Response Configuration panel (the sliders button). Off puts SillyTavern\'s own panel back.' })),
                el('div', { class: 'menu_button', text: 'Open Dials', onclick: () => openDials() }))));
    host.append(switchBox);
}

const isOpen = () => !!panel && panel.offsetParent !== null;

// ---------- presets ----------

function stControlIds() {
    return new Set(Object.values(CONCEPTS).map(c => c.st?.id).filter(id => id && document.getElementById(id)));
}

function readStValue(id, kind) {
    const node = document.getElementById(id);
    if (!node) return undefined;
    return kind === 'checkbox' ? node.checked : Number(node.value);
}

function writeStValue(id, kind, value) {
    const $node = $(`#${id}`);
    if (!$node.length) return;
    if (kind === 'checkbox') $node.prop('checked', !!value).trigger('input');
    else $node.val(value).trigger('input');
}

function resolveForCurrent(preset) {
    const options = leaves(optionsFromSchema(current.schema));
    return resolvePreset(preset, {
        options,
        supports: o => supportsOption(o, current.model, current.provider),
        canSend: canSendExtras(current.conn.source),
        stControls: current.callerId === SILLYTAVERN ? stControlIds() : new Set(),
        maxOutput: current.model?.maxOutput ?? null,
    });
}

/** Applies a preset to the current caller/connection/model. Saves an undo snapshot first. */
function applyPreset(presetId, { quiet = false } = {}) {
    if (!current) return;
    const s = settings();
    const preset = allPresets(s.userPresets).find(p => p.id === presetId);
    if (!preset) return;
    const r = resolveForCurrent(preset);
    const kinds = Object.fromEntries(Object.values(CONCEPTS).filter(c => c.st).map(c => [c.st.id, c.st.kind]));
    s.undo = {
        key: current.key,
        values: structuredClone(valuesFor(s.values, current.key)),
        st: Object.fromEntries(r.st.map(x => [x.id, { kind: x.kind, value: readStValue(x.id, x.kind) }])),
        label: preset.name,
    };
    const next = { ...(s.values || {}) };
    if (Object.keys(r.extras).length) next[current.key] = { ...r.extras }; else delete next[current.key];
    s.values = next;
    for (const x of r.st) writeStValue(x.id, kinds[x.id] ?? x.kind, x.value);
    s.preset = presetId;
    s.seen[current.key] = true;
    save();
    renderPresetBar(); renderOptions(); renderExtraFields(); renderPreview();
    if (!quiet || r.st.length) {
        const skipped = r.skipped.length ? ` Not available here: ${r.skipped.map(k => CONCEPTS[k]?.label ?? k).join(', ')}.` : '';
        toastr.info(`${preset.name} applied to ${current.model?.name ?? current.conn.model}.${skipped} Use Undo in Dials to go back.`, 'Dials', { timeOut: 6000 });
    }
}

function undoPreset() {
    const s = settings();
    const u = s.undo;
    if (!u) return;
    const next = { ...(s.values || {}) };
    if (Object.keys(u.values).length) next[u.key] = u.values; else delete next[u.key];
    s.values = next;
    for (const [id, { kind, value }] of Object.entries(u.st)) if (value !== undefined) writeStValue(id, kind, value);
    s.undo = null;
    save();
    toastr.info(`Undid ${u.label}.`, 'Dials');
    renderPresetBar(); renderOptions(); renderExtraFields(); renderPreview();
}

async function saveAsMyPreset() {
    const c = ctx();
    const name = await c.callGenericPopup('Name for this preset:', c.POPUP_TYPE.INPUT, '');
    if (!name || !String(name).trim()) return;
    const s = settings();
    const stValues = {};
    for (const [concept, def] of Object.entries(CONCEPTS)) if (def.st && !def.fields) stValues[concept] = readStValue(def.st.id, def.st.kind);
    const preset = makeUserPreset(name, stValues, currentValues());
    s.userPresets = [...(s.userPresets || []).filter(p => p.id !== preset.id), preset];
    s.preset = preset.id;
    save();
    renderPresetBar();
    toastr.success(`Saved "${preset.name}".`, 'Dials');
}

function deleteMyPreset(id) {
    const s = settings();
    s.userPresets = (s.userPresets || []).filter(p => p.id !== id);
    if (s.preset === id) s.preset = 'default';
    save();
    renderPresetBar();
}

function renderPresetBar() {
    const bar = panel?.querySelector('.dials-presetbar');
    if (!bar) return;
    const s = settings();
    const presets = allPresets(s.userPresets);
    const chosen = presets.find(p => p.id === s.preset) ?? presets[0];
    const select = el('select', { class: 'text_pole', title: 'Use case', onchange: e => { s.preset = e.target.value; save(); renderPresetBar(); } },
        el('optgroup', { label: 'Built in' }, BUILTIN_PRESETS.map(p => el('option', { value: p.id, selected: p.id === chosen.id, text: p.name }))),
        (s.userPresets || []).length ? el('optgroup', { label: 'My presets' }, presets.filter(p => p.id.startsWith('my:')).map(p => el('option', { value: p.id, selected: p.id === chosen.id, text: p.name }))) : null);
    const button = (icon, label, title, onclick, disabled) => el('div', { class: `menu_button menu_button_icon${disabled ? ' disabled' : ''}`, title, onclick: disabled ? null : onclick }, el('i', { class: `fa-solid ${icon}` }), el('span', { text: label }));
    bar.replaceChildren(
        el('div', { class: 'dials-row' }, el('span', { class: 'dials-presetlabel', text: 'Use case' }), select,
            button('fa-check', 'Apply', 'Set this preset\'s values on the current model', () => applyPreset(chosen.id), !current),
            button('fa-rotate-left', 'Undo', s.undo ? `Undo ${s.undo.label}` : 'Nothing to undo', undoPreset, !s.undo),
            button('fa-floppy-disk', 'Save as mine', 'Save the current settings as your own preset', saveAsMyPreset, !current),
            chosen.id.startsWith('my:') ? button('fa-trash', '', 'Delete this preset of yours', () => deleteMyPreset(chosen.id)) : null),
        el('div', { class: 'dials-muted', text: `${chosen.description} New models start with the selected use case.` }));
}

/** First time Dials sees a caller/connection/model with nothing saved: start it on the selected use case. */
function seedIfNew() {
    const s = settings();
    if (!current || s.seen[current.key]) return;
    s.seen[current.key] = true;
    save();
    if (Object.keys(valuesFor(s.values, current.key)).length || s.preset === 'default') return;
    applyPreset(s.preset, { quiet: true });
}

// ---------- token bar by the chat box ----------

let tokenBar = null;

function buildTokenBar() {
    const form = document.getElementById('send_form');
    if (!form || tokenBar) return;
    tokenBar = el('div', { id: 'dials-tokenbar', title: 'Token usage from the provider. Click for totals.', onclick: () => openDials('tokens') });
    form.before(tokenBar);
    renderTokenBar();
}

function renderTokenBar() {
    if (!tokenBar) return;
    const s = settings();
    const chatId = ctx().getCurrentChatId?.();
    const chatSum = s.totals?.chats?.[chatId];
    const last = lastUsage?.caller === SILLYTAVERN ? lastUsage : null;
    const parts = [];
    if (last?.usage) parts.push(el('span', { class: 'dials-tb-last', text: `Last: ${usageLine(last.usage)}` }));
    if (chatSum) {
        const total = chatSum.prompt + chatSum.thinking + chatSum.reply;
        parts.push(el('span', { class: 'dials-tb-chat', text: `This chat: ${total.toLocaleString('en-US')} tokens${s.showCost && chatSum.cost ? ` · ${formatCost(chatSum.cost)}` : ''}` }));
    }
    if (last?.limit?.thinkingOnly) parts.push(el('span', { class: 'dials-warn-text', text: '⚠ All thinking, no reply' }));
    else if (last?.limit?.level === 'cut') parts.push(el('span', { class: 'dials-warn-text', text: '⚠ Last reply hit the limit' }));
    else if (last?.limit?.level === 'near') parts.push(el('span', { class: 'dials-warn-text', text: `⚠ Near the limit (${Math.round(last.limit.ratio * 100)}%)` }));
    if (!parts.length) parts.push(el('span', { class: 'dials-muted', text: 'Tokens: no replies counted yet' }));
    tokenBar.replaceChildren(el('i', { class: 'fa-solid fa-gauge-high' }), ...parts);
}

async function refreshPanel(force) {
    if (!panel) return;
    const s = settings();
    if (!callers.has(s.view)) s.view = SILLYTAVERN;
    const callerId = s.view;
    const conn = connectionOf(callerId);
    const top = panel.querySelector('.dials-top');
    const notes = panel.querySelector('.dials-notes');
    top.replaceChildren(); notes.replaceChildren();
    panel.querySelector('.dials-options').replaceChildren(el('div', { class: 'dials-muted', text: 'Reading options from the provider…' }));

    if (callers.size > 1) {
        const select = el('select', { class: 'text_pole', onchange: e => { s.view = e.target.value; save(); refreshPanel(false); } },
            [...callers].map(([id, c]) => el('option', { value: id, selected: id === callerId, text: c.label })));
        top.append(el('label', { class: 'dials-row' }, el('span', { text: 'Settings for' }), select));
    }
    const promptsNote = panel.querySelector('.dials-prompts-note');
    if (promptsNote) promptsNote.textContent = ctx().mainApi === 'openai' ? '' : 'The prompt list is only used with Chat Completion connections.';
    if (!conn || !conn.active) {
        current = null;
        panel.querySelector('.dials-options').replaceChildren(el('div', { class: 'dials-muted', text: 'Provider options work with Chat Completion connections. Switch the API type to Chat Completion to use them. SillyTavern\'s own settings are in the next tab.' }));
        renderPresetBar();
        renderTotals();
        renderPrefs();
        return;
    }
    const provider = detectProvider(conn);
    const [schemaInfo, models] = await Promise.all([loadSchema(conn, force), loadModels(conn, force)]);
    const model = models.get(conn.model) ?? null;
    current = { callerId, conn, key: keyFor(callerId, conn), schema: schemaInfo.schema, schemaInfo, models, model, provider };

    const providerName = { venice: 'Venice', openrouter: 'OpenRouter', generic: conn.source === 'custom' ? 'Custom endpoint' : conn.source }[provider];
    top.append(el('div', { class: 'dials-row dials-conn' },
        el('span', { text: `${providerName} · ${model?.name ?? conn.model ?? 'no model'}${conn.profileId ? ' · profile' : ''}` }),
        el('div', { class: 'menu_button menu_button_icon', title: 'Read options and models from the provider again', onclick: () => refreshPanel(true) },
            el('i', { class: 'fa-solid fa-rotate' }), el('span', { text: 'Refresh' }))));

    const from = { live: `Options read from ${schemaInfo.address}.`, bundled: `Couldn't reach the live spec; using the copy shipped with Dials (${schemaInfo.address}).`, standard: 'This endpoint has no spec Dials could read, so it shows the common OpenAI-compatible extras. Use “Add a field” for anything else.' }[schemaInfo.from];
    notes.append(el('div', { class: 'dials-muted', text: from }));
    if (!canSendExtras(conn.source)) {
        notes.append(el('div', { class: 'dials-note', text: `SillyTavern only forwards a fixed list of fields for ${providerName}, so options set here are not sent. To send them, use a Custom (OpenAI-compatible) connection pointed at the same provider${provider === 'openrouter' ? ' (https://openrouter.ai/api/v1)' : ''}. Token counting still works.` }));
    }
    if (model?.maxOutput) notes.append(el('div', { class: 'dials-muted', text: `This model's output cap: ${model.maxOutput.toLocaleString('en-US')} tokens.` }));

    renderPresetBar();
    seedIfNew();
    renderOptions();
    renderExtraFields();
    renderPreview();
    renderTotals();
    renderPrefs();
}

function currentValues() {
    return valuesFor(settings().values, current.key);
}

function setOption(key, value) {
    const s = settings();
    s.values = setValue(s.values, current.key, key, value);
    save();
    renderPreview();
}

function control(option) {
    const values = currentValues();
    const value = values[option.key];
    const def = option.default !== undefined ? ` (provider default: ${JSON.stringify(option.default)})` : '';
    let input;
    const commit = raw => {
        const r = coerceValue(option, raw);
        input.classList.toggle('dials-invalid', !r.ok);
        input.title = r.ok ? '' : r.error;
        if (r.ok) setOption(option.key, r.value);
    };
    if (option.kind === 'boolean' || option.kind === 'enum') {
        const choices = option.kind === 'boolean' ? [[true, 'On'], [false, 'Off']] : option.enum.map(x => [x, String(x)]);
        input = el('select', { class: 'text_pole', onchange: e => commit(e.target.value === '' ? '' : choices[Number(e.target.value)][0]) },
            el('option', { value: '', text: `Unset${def}` }),
            choices.map(([v, label], i) => el('option', { value: String(i), selected: value !== undefined && v === value, text: label })));
    } else if (option.kind === 'integer' || option.kind === 'number') {
        input = el('input', { class: 'text_pole', type: 'number', step: option.kind === 'integer' ? '1' : 'any', min: option.min, max: option.max, placeholder: `Unset${def}`, value: value ?? '', onchange: e => commit(e.target.value) });
    } else if (option.kind === 'string') {
        input = el('input', { class: 'text_pole', type: 'text', placeholder: `Unset${def}`, value: value ?? '', onchange: e => commit(e.target.value) });
    } else {
        input = el('textarea', { class: 'text_pole', rows: '2', placeholder: `Unset — JSON${def}`, onchange: e => commit(e.target.value) });
        input.value = value === undefined ? '' : JSON.stringify(value);
    }
    const clear = el('div', { class: 'menu_button menu_button_icon dials-clear', title: 'Unset (don\'t send)', onclick: () => { setOption(option.key, undefined); renderOptions(); } }, el('i', { class: 'fa-solid fa-xmark' }));
    return el('div', { class: `dials-option${value !== undefined ? ' dials-set' : ''}` },
        el('label', { class: 'dials-label', text: option.label, title: option.key }),
        el('div', { class: 'dials-input' }, input, value !== undefined ? clear : null),
        explainField(option.key) ? el('div', { class: 'dials-explain', text: explainField(option.key) }) : null,
        option.description ? el('details', { class: 'dials-desc' }, el('summary', { text: 'Provider\'s note' }), el('div', { text: option.description })) : null);
}

function renderOptions() {
    const box = panel.querySelector('.dials-options');
    const s = settings();
    const options = optionsFromSchema(current.schema);
    const values = currentValues();
    let hidden = 0;
    const visible = list => list.filter(o => {
        if (o.kind === 'group') return true;
        const ok = supportsOption(o, current.model, current.provider) !== false;
        if (!ok && values[o.key] === undefined) { hidden++; return s.showUnsupported; }
        return true;
    });
    const render = list => visible(list).map(o => o.kind === 'group'
        ? (() => { const kids = render(o.children); return kids.length ? el('details', { class: 'dials-group', open: o.children.some(c => values[c.key] !== undefined) || undefined }, el('summary', { text: o.label, title: o.description }), kids) : null; })()
        : control(o));
    const items = render(options);
    box.replaceChildren(...items);
    if (hidden) {
        box.append(el('label', { class: 'checkbox_label dials-muted' },
            el('input', { type: 'checkbox', checked: s.showUnsupported, onchange: e => { s.showUnsupported = e.target.checked; save(); renderOptions(); } }),
            el('span', { text: `Show ${hidden} option${hidden > 1 ? 's' : ''} this model doesn't list as supported` })));
    }
    // Copy from another caller
    const others = [...callers.keys()].filter(id => id !== current.callerId);
    for (const other of others) {
        const conn = connectionOf(other);
        if (!conn) continue;
        const fromKey = keyFor(other, conn);
        if (!Object.keys(valuesFor(s.values, fromKey)).length) continue;
        box.append(el('div', { class: 'menu_button', onclick: () => {
            if (!confirm(`Replace these settings with ${callers.get(other).label}'s settings for its current model?`)) return;
            s.values = copyValues(s.values, fromKey, current.key); save(); renderOptions(); renderExtraFields(); renderPreview();
        }, text: `Copy from ${callers.get(other).label}` }));
    }
}

function renderExtraFields() {
    const box = panel.querySelector('.dials-extra');
    const known = new Set(leaves(optionsFromSchema(current.schema)).map(o => o.key));
    const values = currentValues();
    const extra = Object.entries(values).filter(([k]) => !known.has(k));
    const nameIn = el('input', { class: 'text_pole', type: 'text', placeholder: 'field name, e.g. venice_parameters.foo' });
    const valueIn = el('input', { class: 'text_pole', type: 'text', placeholder: 'value (JSON or text)' });
    box.replaceChildren(
        el('div', { class: 'dials-subhead', text: 'Extra fields' }),
        ...extra.map(([k, v]) => el('div', { class: 'dials-row' }, el('code', { text: `${k}: ${JSON.stringify(v)}` }),
            el('div', { class: 'menu_button menu_button_icon', title: 'Remove', onclick: () => { setOption(k, undefined); renderExtraFields(); } }, el('i', { class: 'fa-solid fa-xmark' })))),
        el('div', { class: 'dials-row' }, nameIn, valueIn, el('div', { class: 'menu_button', text: 'Add a field', onclick: () => {
            const name = nameIn.value.trim();
            if (!/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/.test(name)) { toastr.warning('Use letters, numbers, _ and -, with dots for nested fields.', 'Dials'); return; }
            let v = valueIn.value.trim();
            if (v === '') return;
            try { v = JSON.parse(v); } catch { /* plain text */ }
            setOption(name, v); renderExtraFields();
        } })));
}

function renderPreview() {
    if (!panel || !current) return;
    const box = panel.querySelector('.dials-preview-box');
    const extras = buildExtras(currentValues());
    const s = settings();
    const sendable = canSendExtras(current.conn.source);
    const shown = sendable && s.requestUsage ? { ...extras, stream_options: { include_usage: true } } : extras;
    const last = lastPrepared.get(current.callerId);
    box.replaceChildren(
        el('div', { class: 'dials-subhead', text: sendable ? 'What will be added to the request' : 'Not sent on this connection' }),
        el('pre', { class: 'dials-preview', text: Object.keys(shown).length ? JSON.stringify(shown, null, 2) : '(nothing — all options unset)' }),
        sendable && s.requestUsage ? el('div', { class: 'dials-muted', text: 'stream_options is added only for streamed replies, so the provider reports token usage.' }) : null,
        last?.result?.overridden?.length ? el('div', { class: 'dials-note', text: `Last request: your own Include Body already set ${last.result.overridden.join(', ')}, so your values were kept.` }) : null,
        last?.result?.problem ? el('div', { class: 'dials-note', text: `Last request: ${last.result.problem}` }) : null);
}
function renderPreviewIfOpen() { if (isOpen() && current) renderPreview(); }

function sumLine(sum) {
    if (!sum) return 'nothing yet';
    const s = settings();
    let t = `${sum.count} repl${sum.count === 1 ? 'y' : 'ies'} · Prompt ${sum.prompt.toLocaleString('en-US')} · Thinking ${sum.thinking.toLocaleString('en-US')} · Reply ${sum.reply.toLocaleString('en-US')}`;
    if (s.showCost) t += sum.costKnown ? ` · ${formatCost(sum.cost)}` : ` · ${formatCost(sum.cost)}+ (some prices unknown)`;
    return t;
}

function renderTotals() {
    if (!panel) return;
    const box = panel.querySelector('.dials-totals');
    const t = settings().totals || {};
    const chatId = ctx().getCurrentChatId?.();
    const rows = [
        ['This chat', t.chats?.[chatId]],
        ['Today', t.days?.[dayOf(Date.now())]],
    ];
    if (callers.size > 1) for (const [id, c] of callers) rows.push([c.label, t.callers?.[id]]);
    box.replaceChildren(el('div', { class: 'dials-subhead', text: 'Token totals (from the provider)' }),
        ...rows.map(([label, sum]) => el('div', { class: 'dials-total' }, el('b', { text: `${label}: ` }), el('span', { text: sumLine(sum) }))),
        lastUsage ? el('div', { class: 'dials-muted', text: `Last reply: ${usageLine(lastUsage.usage) || 'no usage reported'}` }) : null);
}
function renderTotalsIfOpen() { if (isOpen()) renderTotals(); }

function renderPrefs() {
    const box = panel.querySelector('.dials-prefs');
    const s = settings();
    const check = (key, label, after) => el('label', { class: 'checkbox_label' },
        el('input', { type: 'checkbox', checked: s[key], onchange: e => { s[key] = e.target.checked; save(); after?.(); } }), el('span', { text: label }));
    box.replaceChildren(el('div', { class: 'dials-subhead', text: 'Preferences' }),
        check('showCost', 'Show cost (list prices from the provider; may not match your bill)', () => { renderAllMessages(); renderTotals(); }),
        check('requestUsage', 'Ask Custom endpoints to report token usage on streamed replies', () => renderPreviewIfOpen()));
}

// ---------- public API for other extensions ----------

window.Dials = Object.freeze({
    version: VERSION,
    /**
     * Registers another extension as a caller with its own settings.
     * getConnection() returns {profileId?, source, url?, model, statusPayload?} for the connection it is using now.
     */
    registerCaller(id, { label, getConnection }) {
        if (typeof id !== 'string' || !id || id === SILLYTAVERN || typeof getConnection !== 'function') throw Error('Dials.registerCaller: bad arguments');
        callers.set(id, { label: String(label || id), getConnection });
        if (isOpen()) refreshPanel(false);
    },
    /**
     * Adds the caller's options to a chat-completions payload (mutates it; only custom_include_body changes)
     * and tags it so usage is read. Returns {tag, sent, notSent, overridden, problem, usage: Promise}.
     * conn: {profileId?, source, url?, model}; defaults to the caller's getConnection().
     */
    prepare(callerId, payload, conn = null) {
        const c = conn ?? connectionOf(callerId);
        const info = prepare(callerId, payload, { ...c, source: payload.chat_completion_source ?? c.source, url: payload.custom_url ?? c.url, model: payload.model ?? c.model });
        return { ...info, usage: pending.get(info.tag)?.done ?? Promise.resolve(null) };
    },
    /** The options object a caller would send for a connection (no request needed). */
    getOptions(callerId, conn) {
        return buildExtras(valuesFor(settings().values, keyFor(callerId, conn ?? connectionOf(callerId))));
    },
    lastUsage: () => lastUsage,
    onUsage(fn) { listeners.add(fn); return () => listeners.delete(fn); },
});

// ---------- start ----------

(function init() {
    settings();
    installFetchWrap();
    const { eventSource, eventTypes } = ctx();
    eventSource.on(eventTypes.CHAT_COMPLETION_SETTINGS_READY, onSettingsReady);
    eventSource.on(eventTypes.MESSAGE_RECEIVED, onMessageReceived);
    for (const ev of [eventTypes.CHARACTER_MESSAGE_RENDERED, eventTypes.MESSAGE_UPDATED, eventTypes.MESSAGE_SWIPED]) {
        eventSource.on(ev, id => setTimeout(() => renderMessage(Number(id)), 0));
    }
    for (const ev of [eventTypes.CHAT_CHANGED, eventTypes.MORE_MESSAGES_LOADED]) {
        eventSource.on(ev, () => setTimeout(() => { renderAllMessages(); renderTotalsIfOpen(); }, 0));
    }
    for (const ev of [eventTypes.CHATCOMPLETION_SOURCE_CHANGED, eventTypes.CHATCOMPLETION_MODEL_CHANGED, eventTypes.CONNECTION_PROFILE_LOADED, eventTypes.MAIN_API_CHANGED]) {
        if (ev) eventSource.on(ev, () => setTimeout(() => { if (isOpen()) refreshPanel(false); }, 0));
    }
    buildExtensionsSwitch();
    buildTokenBar();
    if (settings().takeover) takeOver();
    eventSource.on(eventTypes.CHAT_CHANGED, () => setTimeout(renderTokenBar, 0));
    // Custom endpoints: the model is typed in, which SillyTavern doesn't announce as an event.
    let modelTimer = null;
    $(document).on('input change', '#custom_model_id, #model_custom_select', () => {
        clearTimeout(modelTimer);
        modelTimer = setTimeout(() => { if (isOpen()) refreshPanel(false); }, 600);
    });
    eventSource.on(eventTypes.SETTINGS_UPDATED ?? 'settings_updated', () => { if (shell) addExplanations(shell.querySelector('.dials-st')); });
    console.info(`[Dials] ${VERSION} loaded`);
})();
