#!/usr/bin/env node
// The bridge: a small program that stands between Tally and Plaid.
//
// It exists because Plaid's API is authenticated with a client secret, which
// must never live in a shipped app, and serves no CORS headers to a browser
// anyway. So the secret lives here, on a machine you control, and the book
// talks only to this.
//
//     your bank  ->  Plaid  ->  this bridge  ->  Tally
//
// Nothing here is ours and nothing here phones home. It holds your Plaid
// credentials and nothing else: no access token, no balance, no history.
// The access token stays sealed in the book and arrives with each request,
// which means this bridge on its own can read nothing at all — and the
// credentials on their own can read nothing either.
//
// Run it:
//
//   PLAID_CLIENT_ID=xxxx PLAID_SECRET=yyyy npm run bridge
//
// Then open it in a browser, sign in to your banks, and paste the line it
// gives you into Tally's endpapers.
//
// Settings, all through the environment:
//   PLAID_CLIENT_ID  required. From the Plaid dashboard, Team Settings > Keys.
//   PLAID_SECRET     required. Use the key for the environment below.
//   PLAID_ENV        "production" (the default; your free Limited Production
//                    allowance lives here) or "sandbox" (fake banks, free and
//                    unlimited, for trying the whole thing out).
//   PLAID_PRODUCTS   comma separated, default "auth". Plaid requires at least
//                    one product on every Link session, and "balance" cannot
//                    be that one — it is only ever granted automatically
//                    alongside another product (confirmed against Plaid's own
//                    API: it answers INVALID_PRODUCT and says so explicitly).
//                    "auth" is the most broadly supported product across
//                    ordinary banks and asks for nothing about what you
//                    spend. If Plaid refuses it for an institution you use,
//                    its own message is printed and shown, verbatim.
//   PLAID_EXTRA_PRODUCTS  comma separated, default "investments,liabilities".
//                    Sent as required_if_supported_products: added in
//                    automatically for a brokerage or a credit card issuer
//                    wherever the institution offers them, but never narrows
//                    which institutions Link will show, the way putting them
//                    in PLAID_PRODUCTS would.
//   PORT             default 7000.
//   HOST             default 127.0.0.1. See the note on binding below.
//   PUBLIC_URL       override the address handed out. Rarely needed.
//   ALLOW_ORIGIN     default "*". Set it to Tally's address to be stricter.
//
// This app never asks for transactions. It does not log spending and has no
// use for the data, so the product list should stay as narrow as it can be.

import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';

const PORT = Number(process.env.PORT || 7000);
// Binds to this machine only. The book is served over https, and a browser
// will not let an https page call a plain-http address, so exposing the
// bridge on the LAN would achieve nothing except exposing it. Put it behind
// a real certificate instead — `tailscale serve` is the easy way.
const HOST = process.env.HOST || '127.0.0.1';
const CLIENT_ID = process.env.PLAID_CLIENT_ID || '';
const SECRET = process.env.PLAID_SECRET || '';
const ENVIRONMENT = process.env.PLAID_ENV || 'production';
const PRODUCTS = (process.env.PLAID_PRODUCTS || 'auth').split(',').map((s) => s.trim()).filter(Boolean);
const EXTRA_PRODUCTS = (process.env.PLAID_EXTRA_PRODUCTS || 'investments,liabilities').split(',').map((s) => s.trim()).filter(Boolean);
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!CLIENT_ID || !SECRET) die('Set PLAID_CLIENT_ID and PLAID_SECRET from your Plaid dashboard (Team Settings > Keys).');
if (!['sandbox', 'production'].includes(ENVIRONMENT)) die(`PLAID_ENV must be "sandbox" or "production", not "${ENVIRONMENT}".`);

const API_HOST = `${ENVIRONMENT}.plaid.com`;

// ---------- Talking to Plaid ----------

// One call to Plaid. The body is returned as text as well as parsed, because
// balances need the text (see below).
function plaid(path, body) {
  const payload = JSON.stringify({ client_id: CLIENT_ID, secret: SECRET, ...body });
  return new Promise((resolve) => {
    const req = httpsRequest(
      {
        host: API_HOST,
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: 30000,
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(text);
          } catch {
            // left null; the caller decides what that means
          }
          resolve({ status: res.statusCode, body: parsed, text });
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Plaid timed out')));
    req.on('error', (err) => resolve({ status: 0, error: explain(err) }));
    req.write(payload);
    req.end();
  });
}

function explain(err) {
  const text = String(err?.message ?? err);
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ENETUNREACH/i.test(text)) {
    return 'This bridge could not reach Plaid. Check the machine it runs on is online.';
  }
  return text;
}

// Plaid's own words when it refuses something. Far more useful than anything
// this bridge could invent, so it is passed through as it is.
const plaidError = (r) =>
  r.error || r.body?.error_message || r.body?.error_code || (r.status ? `Plaid answered ${r.status}.` : 'Plaid did not answer.');

// Money, without ever becoming a float.
//
// Plaid sends balances as JSON *numbers* — "current": 114265.51 — and a JSON
// number is a double. Parsing it and multiplying by 100 is exactly the sort
// of thing that turns 8225.35 into 822534.9999. So the raw text is rewritten
// to quote those numbers before it is parsed, and the exact digits Plaid
// printed survive all the way into integer cents.
function quoteBalances(text) {
  return text.replace(/"(current|available|limit)"\s*:\s*(-?\d+(?:\.\d+)?)/g, '"$1":"$2"');
}

const INSTITUTIONS = new Map();

async function institutionName(id) {
  if (!id) return '';
  if (INSTITUTIONS.has(id)) return INSTITUTIONS.get(id);
  const r = await plaid('/institutions/get_by_id', { institution_id: id, country_codes: ['US'] });
  const name = r.status === 200 ? String(r.body?.institution?.name ?? '') : '';
  INSTITUTIONS.set(id, name);
  return name;
}

// Every account the enrolment covers, with its balance, in the one shape the
// book understands. Normalising here rather than in the app is what lets the
// book stay provider-agnostic: it has spoken this shape since the first
// bridge, and swapping who is behind it does not reach the reader.
async function accountsWithBalances(accessToken) {
  const r = await plaid('/accounts/balance/get', { access_token: accessToken });
  if (r.status === 400 && /INVALID_ACCESS_TOKEN|INVALID_API_KEYS/i.test(r.text || '')) return { status: 401 };
  if (r.status !== 200 || !r.text) return { status: 502, errors: [plaidError(r)] };

  let body;
  try {
    body = JSON.parse(quoteBalances(r.text));
  } catch {
    return { status: 502, errors: ['Plaid sent something that was not readable.'] };
  }

  const org = await institutionName(body?.item?.institution_id);
  const accounts = (body.accounts ?? []).map((a) => ({
    id: a.account_id,
    name: a.official_name || a.name || 'Account',
    last_four: a.mask ?? '',
    type: a.type === 'credit' ? 'credit' : 'depository',
    subtype: a.subtype ?? '',
    status: 'open',
    currency: a.balances?.iso_currency_code ?? 'USD',
    institution: { name: org },
    balance: { ledger: a.balances?.current ?? null, available: a.balances?.available ?? null },
  }));
  return { status: 200, accounts, errors: [] };
}

// ---------- The sign-in page ----------

// This page — not the book — is what loads Plaid Link. Keeping their script
// here means Tally itself never fetches anything from a third party and goes
// on working with no connection at all.
function signInPage(publicUrl) {
  // Signing in here is the expensive step — a real login at every
  // institution — and the line it produces carries whatever address this
  // page was opened on. Opened on localhost, that line works on this machine
  // and nowhere else, which is a miserable thing to discover afterwards.
  const local = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/i.test(publicUrl);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Tally bridge</title>
<style>
  :root { color-scheme: light dark; --ink: #2b2722; --paper: #f4efe4; }
  @media (prefers-color-scheme: dark) { :root { --ink: #e8e0d2; --paper: #1b1917; } }
  body { margin: 0; padding: 2rem 1.25rem 4rem; background: var(--paper); color: var(--ink);
         font: 17px/1.55 "Iowan Old Style", Palatino, Georgia, serif; }
  main { max-width: 34rem; margin: 0 auto; }
  h1 { font-size: 1.7rem; font-weight: 600; margin: 0 0 .25rem; }
  p.sub { margin: 0 0 2rem; opacity: .7; font-style: italic; }
  button { font: inherit; font-size: 1rem; padding: .7rem 1.3rem; border: 0; border-radius: 2rem;
           background: #1d4e6f; color: #fff; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  textarea { width: 100%; box-sizing: border-box; margin-top: 1rem; padding: .8rem;
             font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
             border: 1px solid rgba(128,128,128,.4); border-radius: .4rem;
             background: transparent; color: inherit; }
  .step { border-top: 1px solid rgba(128,128,128,.3); padding-top: 1.2rem; margin-top: 1.5rem; }
  .label { font: 600 .72rem/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: .09em;
           text-transform: uppercase; opacity: .6; }
  code { font-size: .85em; }
  .hide { display: none; }
  .step.warn { border-left: 3px solid #8c2f2a; border-top: 0; padding-left: 1rem; }
  .step.warn code { display: inline-block; padding: .2rem .45rem; background: rgba(128,128,128,.16); border-radius: .25rem; }
  .bad { color: #8c2f2a; white-space: pre-wrap; }
</style>
</head>
<body>
<main>
  <h1>Tally bridge</h1>
  <p class="sub">Running. Sign in to your banks here, then carry one line back to the book.</p>

  ${local ? `<div class="step warn">
    <p class="label">Read this first</p>
    <p>You opened this bridge at <strong>${publicUrl}</strong>, which only this
    machine can reach. Sign in here and the line you get back will work in the
    book on this laptop and <strong>nowhere else</strong> &mdash; your phone
    will not be able to use it.</p>
    <p>To set up your phone, put the bridge behind a certificate first and
    open <em>that</em> address instead:</p>
    <p><code>tailscale serve --bg ${PORT}</code></p>
  </div>` : ''}

  <div class="step">
    <p class="label">Step one</p>
    <p>Sign in to each institution you want the book to follow. This page talks to Plaid; the book never does.</p>
    <button id="go">Sign in to a bank</button>
    <p id="env" class="sub" style="margin-top:1rem"></p>
    <p id="err" class="bad"></p>
  </div>

  <div class="step hide" id="done">
    <p class="label">Step two</p>
    <p>Copy this line, open Tally, and go to <strong>Endpapers &rarr; Connections &rarr; Connect a bridge</strong>.</p>
    <textarea id="token" rows="5" readonly onclick="this.select()"></textarea>
    <p><button id="copy">Copy</button></p>
    <p class="sub">It carries this bridge's address and the token for the accounts you just approved. Treat it like a password.</p>
  </div>
</main>

<script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
<script>
  var BRIDGE = ${JSON.stringify(publicUrl)};
  var ENVIRONMENT = ${JSON.stringify(ENVIRONMENT)};
  document.getElementById('env').textContent =
    ENVIRONMENT === 'sandbox'
      ? 'Using Plaid\\u2019s sandbox: fake banks, free and unlimited.'
      : 'Using Plaid production. Your free allowance is 200 live calls per product.';

  var err = document.getElementById('err');
  var go = document.getElementById('go');

  function fail(m) { err.textContent = m; go.disabled = false; go.textContent = 'Try again'; }

  go.addEventListener('click', async function () {
    err.textContent = '';
    go.disabled = true;
    go.textContent = 'Opening\\u2026';
    var res, data;
    try {
      res = await fetch(BRIDGE + '/link-token', { method: 'POST' });
      data = await res.json();
    } catch (e) { return fail('Could not reach this bridge: ' + e.message); }
    if (!res.ok) return fail(data.error || 'Plaid would not start a sign-in.');

    var handler = Plaid.create({
      token: data.link_token,
      onSuccess: async function (publicToken) {
        try {
          var x = await fetch(BRIDGE + '/exchange', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ public_token: publicToken }),
          });
          var out = await x.json();
          if (!x.ok) return fail(out.error || 'Plaid would not finish the sign-in.');
          var line = btoa(JSON.stringify({ u: BRIDGE, t: out.access_token }));
          document.getElementById('token').value = line;
          document.getElementById('done').classList.remove('hide');
          document.getElementById('done').scrollIntoView({ behavior: 'smooth' });
          go.disabled = false;
          go.textContent = 'Sign in to another bank';
        } catch (e) { fail('Could not finish: ' + e.message); }
      },
      onExit: function (e) {
        go.disabled = false;
        go.textContent = 'Sign in to a bank';
        if (e && e.error_message) fail(e.error_message);
      },
    });
    handler.open();
  });

  document.getElementById('copy').addEventListener('click', function () {
    var field = document.getElementById('token');
    field.select();
    navigator.clipboard.writeText(field.value).then(function () {
      document.getElementById('copy').textContent = 'Copied';
    }, function () {});
  });
</script>
</body>
</html>`;
}

// ---------- The server ----------

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function json(res, status, body) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let text = '';
    req.on('data', (c) => (text += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(text || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

function publicOrigin(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http';
  return `${proto}://${host}`;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);

  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(signInPage(publicOrigin(req)));
  }

  if (req.method === 'POST' && url.pathname === '/link-token') {
    const r = await plaid('/link/token/create', {
      client_name: 'Tally',
      user: { client_user_id: 'tally-owner' },
      // "balance" rides along automatically with any other product and
      // cannot be requested on its own (Plaid: INVALID_PRODUCT). The extra
      // products go in required_if_supported_products rather than products,
      // so an institution that only supports one of them — a brokerage that
      // doesn't do auth, say — is not excluded from the Link picker; they
      // are simply added in silently wherever the institution offers them.
      products: PRODUCTS,
      required_if_supported_products: EXTRA_PRODUCTS,
      country_codes: ['US'],
      language: 'en',
    });
    if (r.status !== 200 || !r.body?.link_token) {
      const message = plaidError(r);
      console.error(`\n  Plaid refused to start a sign-in: ${message}`);
      console.error(`  Products asked for: ${JSON.stringify(PRODUCTS)} (required_if_supported: ${JSON.stringify(EXTRA_PRODUCTS)}). Set PLAID_PRODUCTS / PLAID_EXTRA_PRODUCTS to change them.\n`);
      return json(res, 502, { error: message });
    }
    return json(res, 200, { link_token: r.body.link_token });
  }

  if (req.method === 'POST' && url.pathname === '/exchange') {
    const { public_token: publicToken } = await readBody(req);
    if (!publicToken) return json(res, 400, { error: 'No public token.' });
    const r = await plaid('/item/public_token/exchange', { public_token: publicToken });
    if (r.status !== 200 || !r.body?.access_token) return json(res, 502, { error: plaidError(r) });
    // The token is handed to the page and kept nowhere. The page is this
    // bridge's own, on the owner's machine, and the book seals it on arrival.
    return json(res, 200, { access_token: r.body.access_token });
  }

  if (req.method === 'GET' && url.pathname === '/accounts') {
    const match = /^Basic\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!match) return json(res, 401, { error: 'No token.' });
    const accessToken = Buffer.from(match[1], 'base64').toString('utf8').split(':')[0];
    if (!accessToken) return json(res, 401, { error: 'No token.' });

    const result = await accountsWithBalances(accessToken);
    if (result.status === 401) return json(res, 401, { error: 'Plaid turned that token down.' });
    if (result.status !== 200) return json(res, 502, { accounts: [], errors: result.errors ?? [] });
    return json(res, 200, { accounts: result.accounts, errors: result.errors });
  }

  json(res, 404, { error: 'Not found.' });
});

server.listen(PORT, HOST, () => {
  const where = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`\n  Tally bridge is running.\n`);
  console.log(`  Open        http://${where}:${PORT}/`);
  console.log(`  Environment ${ENVIRONMENT}${ENVIRONMENT === 'sandbox' ? '  (fake banks, free and unlimited)' : '  (200 free live calls per product)'}`);
  console.log(`  Products    ${JSON.stringify(PRODUCTS)} required, ${JSON.stringify(EXTRA_PRODUCTS)} if supported`);
  console.log(`\n  To reach it from your phone, put it behind a certificate:`);
  console.log(`    tailscale serve --bg ${PORT}`);
  console.log(`\n  It holds your Plaid credentials and nothing else. Stop it with Ctrl-C.\n`);
});
