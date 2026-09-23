import { readFile, writeFile } from 'node:fs/promises';
import handler from '../.vercel/output/functions/__server.func/index.mjs';

const output = new URL('../.vercel/output/', import.meta.url);
const response = await handler.fetch(new Request('https://cardtape.bimlabs.xyz/'), {});
const html = await response.text();

if (!response.ok || !html.startsWith('<!DOCTYPE html>') || !html.includes('CARDTAPE')) {
  throw new Error(`Could not prerender Cardtape: HTTP ${response.status}`);
}

await writeFile(new URL('static/index.html', output), html);

const configUrl = new URL('config.json', output);
const config = JSON.parse(await readFile(configUrl, 'utf8'));
if (!config.routes?.some((route) => route.handle === 'filesystem')) {
  throw new Error('Vercel output is missing its filesystem route');
}

// Every published view lives on the client and reads the checked-in snapshot.
// Serve the entry page from the CDN instead of invoking a server function.
config.routes = [
  ...config.routes.filter((route) => route.dest !== '/__server' && route.dest !== '/index.html'),
  { src: '^/$', dest: '/index.html' },
];
await writeFile(configUrl, `${JSON.stringify(config, null, 2)}\n`);
console.log('Published static Cardtape entry page for Vercel');
