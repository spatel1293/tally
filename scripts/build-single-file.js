// Builds dist/tally.html: the whole app in one file that opens straight from
// disk (double-click), no server needed. Offline caching via the service
// worker isn't available in this form; everything else works the same.
//
// This is a tiny purpose-built bundler for this codebase's module style:
// named imports/exports only, no cycles, no default exports.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const entry = join(root, 'js/app.js');

const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*'([^']+)';\s*$/gm;
const modules = new Map();

async function load(file) {
  if (modules.has(file)) return;
  modules.set(file, null);
  const src = await readFile(file, 'utf8');
  const deps = [];
  for (const m of src.matchAll(IMPORT_RE)) deps.push(resolve(dirname(file), m[2]));
  for (const d of deps) await load(d);
  modules.set(file, { src, deps });
}

const order = [];
function visit(file, seen = new Set()) {
  if (order.includes(file)) return;
  if (seen.has(file)) throw new Error(`Import cycle at ${relative(root, file)}`);
  seen.add(file);
  for (const d of modules.get(file).deps) visit(d, seen);
  order.push(file);
}

const varName = (file) => `__m_${relative(root, file).replace(/[^a-zA-Z0-9]/g, '_')}`;

function transform(file) {
  let { src } = modules.get(file);
  const exported = [];
  src = src.replace(IMPORT_RE, (_, names, spec) => {
    const target = varName(resolve(dirname(file), spec));
    const parts = names.split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/\s+as\s+/, ': '));
    return `const { ${parts.join(', ')} } = ${target};`;
  });
  if (/^\s*import\s/m.test(src)) throw new Error(`Unsupported import form in ${relative(root, file)}`);
  src = src.replace(/^export\s+(async\s+function|function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm, (_, kind, name) => {
    exported.push(name);
    return `${kind} ${name}`;
  });
  src = src.replace(/^export\s*\{([^}]*)\};?\s*$/gm, (_, names) => {
    for (const n of names.split(',').map((s) => s.trim()).filter(Boolean)) exported.push(n);
    return '';
  });
  if (/^\s*export\s/m.test(src)) throw new Error(`Unsupported export form in ${relative(root, file)}`);
  return `// ${relative(root, file)}\nconst ${varName(file)} = (() => {\n${src}\nreturn { ${exported.join(', ')} };\n})();\n`;
}

await load(entry);
visit(entry);
const bundle = `globalThis.TALLY_SINGLE_FILE = true;\n${order.map(transform).join('\n')}`;

const font = (await readFile(join(root, 'fonts/public-sans.woff2'))).toString('base64');
let css = await readFile(join(root, 'css/app.css'), 'utf8');
css = css.replace(
  /src: url\('\.\.\/fonts\/public-sans\.woff2'\)[^;]*;/,
  `src: url(data:font/woff2;base64,${font}) format('woff2');`
);
const icon = (await readFile(join(root, 'icons/icon.svg'), 'utf8')).replace(/\s+/g, ' ').trim();
const iconUri = `data:image/svg+xml,${encodeURIComponent(icon)}`;

let htmlSrc = await readFile(join(root, 'index.html'), 'utf8');
htmlSrc = htmlSrc
  .replace(/\s*<link rel="manifest"[^>]*>/, '')
  .replace(/\s*<link rel="icon" href="icons\/icon-192\.png"[^>]*>/, '')
  .replace(/\s*<link rel="apple-touch-icon"[^>]*>/, '')
  .replace(/\s*<link rel="preload"[^>]*>/, '')
  .replace(/<link rel="icon" href="icons\/icon\.svg"[^>]*>/, `<link rel="icon" href="${iconUri}" />`)
  .replace(/<link rel="stylesheet" href="css\/app\.css" \/>/, () => `<style>\n${css}\n</style>`)
  .replace(/<script type="module" src="js\/app\.js"><\/script>/, () => `<script type="module">\n${bundle.replace(/<\/script/gi, '<\\/script')}\n</script>`);

await mkdir(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist/tally.html');
await writeFile(out, htmlSrc);
console.log(`Built ${relative(root, out)} (${(Buffer.byteLength(htmlSrc) / 1024).toFixed(0)} KB, ${order.length} modules)`);
