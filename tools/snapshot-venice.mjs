// Makes data/venice-chat-request.json: Venice's chat-completions request schema,
// shipped as a fallback for when the live spec can't be fetched.
// Usage: node tools/snapshot-venice.mjs <path to swagger.yaml> <path to a "yaml" package dir>
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { chatRequestSchema } from '../src/spec.mjs';

const [specPath, yamlDir] = process.argv.slice(2);
if (!specPath || !yamlDir) throw Error('usage: node tools/snapshot-venice.mjs <swagger.yaml> <yaml package dir>');
const yaml = createRequire(path.resolve(yamlDir, 'package.json'))(path.resolve(yamlDir));
const spec = yaml.parse(await readFile(specPath, 'utf8'));
const schema = chatRequestSchema(spec);
const out = { source: 'https://docs.venice.ai/swagger.yaml', version: spec?.info?.version ?? null, schema };
await writeFile(new URL('../data/venice-chat-request.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log('wrote snapshot, version', out.version, 'fields', Object.keys(schema.properties ?? {}).length);
