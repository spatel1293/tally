import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { html, raw, esc } from '../js/ui/html.js';

const root = fileURLToPath(new URL('..', import.meta.url));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('offline cache', () => {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const listed = new Set([...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean));

  test('every app file is precached', () => {
    const files = [
      ...walk(join(root, 'js')),
      ...walk(join(root, 'css')),
      join(root, 'fonts/public-sans.woff2'),
      ...walk(join(root, 'icons')).filter((f) => !f.endsWith('maskable.svg')),
      join(root, 'index.html'),
      join(root, 'manifest.webmanifest'),
    ].map((f) => relative(root, f).split('\\').join('/'));
    const missing = files.filter((f) => !listed.has(f));
    assert.deepEqual(missing, [], `Add these to FILES in sw.js: ${missing.join(', ')}`);
  });

  test('every precached file exists', () => {
    const gone = [...listed].filter((f) => !existsSync(join(root, f)));
    assert.deepEqual(gone, []);
  });

  test('manifest icons exist', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
    for (const icon of manifest.icons) assert.ok(existsSync(join(root, icon.src)), icon.src);
  });
});

describe('html templating', () => {
  test('escapes interpolated text', () => {
    const note = `<img src=x onerror="alert(1)">&'`;
    assert.equal(String(html`<p title="${note}">${note}</p>`), '<p title="&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;">&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;</p>');
  });

  test('nests templates and arrays without double escaping', () => {
    const items = ['a<b', 'c'].map((x) => html`<li>${x}</li>`);
    assert.equal(String(html`<ul>${items}</ul>`), '<ul><li>a&lt;b</li><li>c</li></ul>');
    assert.equal(String(html`${raw('<b>')}${'<b>'}`), '<b>&lt;b&gt;');
  });

  test('skips null, undefined and booleans', () => {
    assert.equal(String(html`${null}${undefined}${false}${true}${0}`), '0');
    assert.equal(esc(`"'`), '&quot;&#39;');
  });
});
