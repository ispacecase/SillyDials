import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

test('manifest points to shipped files and every local import exists', async () => {
    const root = new URL('../', import.meta.url);
    const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
    assert.equal(manifest.display_name, 'Dials');
    await access(new URL(manifest.js, root));
    await access(new URL(manifest.css, root));
    const js = await readFile(new URL(manifest.js, root), 'utf8');
    const local = [...js.matchAll(/from\s+['"](\.\/[^'"]+)['"]/g)].map(m => m[1]);
    assert.ok(local.length >= 5);
    for (const path of local) await access(new URL(path, root));
    await access(new URL('data/venice-chat-request.json', root));
});

test('Dials has no hard dependency on Storyloom', async () => {
    const js = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.doesNotMatch(js, /storyloom/i);
});
