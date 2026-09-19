// Assembles the deployable site in dist/site: just the files the app needs to
// run, with the tests, scripts and docs left out. One definition of "what
// ships", used both by the GitHub Pages workflow and by hand when dragging
// the folder onto a host.
import { cpSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'dist/site');

const FILES = ['index.html', 'manifest.webmanifest', 'sw.js'];
const DIRS = ['css', 'fonts', 'icons', 'js'];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of [...FILES, ...DIRS]) cpSync(join(root, f), join(out, f), { recursive: true });

const count = (dir) =>
  readdirSync(dir).reduce((n, name) => n + (statSync(join(dir, name)).isDirectory() ? count(join(dir, name)) : 1), 0);
console.log(`Built dist/site (${count(out)} files). Drag that folder onto your host, or serve it as-is.`);
