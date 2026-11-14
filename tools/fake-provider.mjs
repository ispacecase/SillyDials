// A tiny fake OpenAI-compatible provider for browser tests. Never talks to the internet.
// Usage: node tools/fake-provider.mjs [port]   (default 8041, binds to 127.0.0.1 only)
//   GET  /v1/models              Venice-shaped model list (from tests/fixtures)
//   GET  /v1/openapi.json        spec built from the bundled Venice snapshot
//   POST /v1/chat/completions    streams or returns a reply with thinking; usage only if asked for
//   GET  /last                   the last chat request body received (to check what was sent)
// Model "fake-cut" stops at the length limit; "fake-think-only" thinks and writes nothing.
import http from 'node:http';
import { readFile } from 'node:fs/promises';

const port = Number(process.argv[2] || 8041);
const models = JSON.parse(await readFile(new URL('../tests/fixtures/venice-models.json', import.meta.url), 'utf8'));
models.data.push(
    { id: 'fake-cut', object: 'model', type: 'text', model_spec: { name: 'Fake (cut off)', maxCompletionTokens: 50, capabilities: { supportsReasoning: true, supportsReasoningEffort: true }, pricing: { input: { usd: 1 }, output: { usd: 2 } } } },
    { id: 'fake-think-only', object: 'model', type: 'text', model_spec: { name: 'Fake (thinks only)', maxCompletionTokens: 1000, capabilities: { supportsReasoning: true, supportsReasoningEffort: false } } },
);
const snapshot = JSON.parse(await readFile(new URL('../data/venice-chat-request.json', import.meta.url), 'utf8'));
const spec = { openapi: '3.0.0', info: { title: 'Fake', version: '1' }, paths: { '/chat/completions': { post: { requestBody: { content: { 'application/json': { schema: snapshot.schema } } } } } } };

let last = null;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', ...cors }); res.end(JSON.stringify(body)); };

http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (req.method === 'GET' && url.pathname === '/v1/models') return json(res, 200, models);
    if (req.method === 'GET' && url.pathname === '/v1/openapi.json') return json(res, 200, spec);
    if (req.method === 'GET' && url.pathname === '/last') return json(res, 200, last ?? {});
    if (req.method !== 'POST' || url.pathname !== '/v1/chat/completions') return json(res, 404, { error: 'not found' });

    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    last = body;
    const thinkOnly = body.model === 'fake-think-only';
    const cut = body.model === 'fake-cut';
    const thinking = 'Let me think about this. '.repeat(4);
    const reply = thinkOnly ? '' : 'Hello from the fake provider. This is the reply text.';
    const reasoningTokens = thinkOnly ? 900 : 24;
    const replyTokens = thinkOnly ? 0 : (cut ? 26 : 11);
    const usage = { prompt_tokens: 1234, completion_tokens: reasoningTokens + replyTokens, total_tokens: 1234 + reasoningTokens + replyTokens, completion_tokens_details: { reasoning_tokens: reasoningTokens } };
    const finish = cut || thinkOnly ? 'length' : 'stop';
    const base = { id: 'fake', object: 'chat.completion.chunk', created: 0, model: body.model };

    if (!body.stream) {
        return json(res, 200, { ...base, object: 'chat.completion', choices: [{ index: 0, finish_reason: finish, message: { role: 'assistant', content: reply, reasoning_content: thinking } }], usage });
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...cors });
    const send = obj => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    for (const word of thinking.split(' ')) send({ ...base, choices: [{ index: 0, delta: { reasoning_content: word + ' ' } }] });
    for (const word of reply.split(' ').filter(Boolean)) send({ ...base, choices: [{ index: 0, delta: { content: word + ' ' } }] });
    send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: finish }] });
    if (body.stream_options?.include_usage) send({ ...base, choices: [], usage });
    res.write('data: [DONE]\n\n');
    res.end();
}).listen(port, '127.0.0.1', () => console.log(`fake provider on http://127.0.0.1:${port}/v1`));
