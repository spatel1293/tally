// Runs the browser tests in tests/browser against a local server.
// Needs Playwright: `npm install` then `npx playwright install chromium`.
// Screenshots go to $SHOTS_DIR (default: a "tally-shots" folder in your temp dir).
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = process.env.PORT || '5199';
const url = `http://localhost:${port}/`;

const run = (args, env = {}) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
    child.on('exit', (code) => resolve(code ?? 1));
  });

if ((await run(['scripts/build-single-file.js'])) !== 0) process.exit(1);

const server = spawn(process.execPath, ['scripts/serve.js'], { cwd: root, env: { ...process.env, PORT: port, HOST: '127.0.0.1' }, stdio: 'ignore' });
let up = false;
for (let i = 0; i < 50 && !up; i++) {
  await new Promise((r) => setTimeout(r, 100));
  up = await fetch(url).then((r) => r.ok, () => false);
}
if (!up) {
  server.kill();
  console.error('The local server did not start.');
  process.exit(1);
}

const files = readdirSync(join(root, 'tests/browser')).filter((f) => f.endsWith('.cjs')).sort();
let failed = 0;
for (const f of files) {
  console.log(`\n=== ${f} ===`);
  const code = await run([join('tests/browser', f)], { TALLY_URL: url });
  if (code !== 0) failed++;
}
server.kill();
console.log(failed ? `\n${failed} of ${files.length} browser test files failed.` : `\nAll ${files.length} browser test files passed.`);
process.exit(failed ? 1 : 0);
