#!/usr/bin/env node
// The bridge: a small program that stands between Tally and Teller.
//
// It exists because Teller requires a client certificate on every request
// (mutual TLS) and serves no CORS headers, so a browser cannot call it —
// not with a certificate installed, not ever. Teller also says a private key
// must never be shipped inside an app. So the certificate lives here, on a
// machine you control, and the book talks only to this.
//
//     your bank  ->  Teller  ->  this bridge  ->  Tally
//
// Nothing here is ours and nothing here phones home. It holds your
// certificate and nothing else: no token, no balance, no history. The access
// token stays sealed in the book and arrives with each request, which means
// this bridge on its own can read nothing at all.
//
// Run it:
//
//   TELLER_APP_ID=app_xxxxx \
//   TELLER_CERT=./teller/certificate.pem \
//   TELLER_KEY=./teller/private_key.pem \
//   node scripts/teller-proxy.js
//
// Then open it in a browser, sign in to your banks, and paste the line it
// gives you into Tally's endpapers.
//
// Settings, all through the environment:
//   TELLER_APP_ID  required. From your Teller dashboard.
//   TELLER_CERT    required. Path to certificate.pem from teller.zip.
//   TELLER_KEY     required. Path to private_key.pem from teller.zip.
//   TELLER_ENV     "development" (the default: free, real banks, not billed),
//                  "sandbox" (fake banks, for trying it out) or "production".
//   PORT           default 7000.
//   HOST           default 127.0.0.1. See the note on binding below.
//   ALLOW_ORIGIN   default "*". Set it to Tally's address to be stricter.

import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFileSync } from 'node:fs';

const PORT = Number(process.env.PORT || 7000);
// Binds to this machine only. The book is served over https, and a browser
// will not let an https page call a plain-http address, so exposing the
// bridge on the LAN would achieve nothing except exposing it. Put it in
// front of a real certificate instead — `tailscale serve` is the easy way,
// and the README has the steps. Set HOST=0.0.0.0 to override.
const HOST = process.env.HOST || '127.0.0.1';
const APP_ID = process.env.TELLER_APP_ID || '';
const ENVIRONMENT = process.env.TELLER_ENV || 'development';
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
// Override the address the bridge hands out, for a host that sets no
// forwarded headers. Usually unnecessary.
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const CERT_PATH = process.env.TELLER_CERT || '';
const KEY_PATH = process.env.TELLER_KEY || '';

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!APP_ID) die('Set TELLER_APP_ID to your application id (it looks like app_xxxxx).');
if (!CERT_PATH || !KEY_PATH) die('Set TELLER_CERT and TELLER_KEY to the two files from teller.zip.');

let cert;
let key;
try {
  cert = readFileSync(CERT_PATH);
  key = readFileSync(KEY_PATH);
} catch (err) {
  die(`Couldn't read your certificate: ${err.message}`);
}

// ---------- Talking to Teller ----------

// An OpenSSL failure is unreadable and would end up in a toast in the book,
// so the two that actually happen are named plainly. Anything else is passed
// through, because a surprise is better hidden than mislabelled.
function explain(err) {
  const text = String(err?.message ?? err);
  if (/bad certificate|alert number 42|unknown ca|certificate unknown/i.test(text)) {
    return 'Teller rejected this bridge’s certificate. Check TELLER_CERT and TELLER_KEY point at the files from your own teller.zip.';
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ENETUNREACH/i.test(text)) {
    return 'This bridge could not reach Teller. Check the machine it runs on is online.';
  }
  return text;
}

// One authenticated call to Teller, with the certificate attached. The access
// token arrives from Tally and is passed straight through; it is never kept.
function teller(path, accessToken) {
  return new Promise((resolve) => {
    const req = httpsRequest(
      {
        host: 'api.teller.io',
        path,
        method: 'GET',
        cert,
        key,
        headers: {
          Authorization: `Basic ${Buffer.from(`${accessToken}:`).toString('base64')}`,
          Accept: 'application/json',
        },
        timeout: 30000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(body);
          } catch {
            // left as null; the caller decides what that means
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Teller timed out')));
    req.on('error', (err) => resolve({ status: 0, error: explain(err) }));
    req.end();
  });
}

// Every account the enrolment covers, each with its balance attached.
//
// Teller lists accounts and reports balances separately, so this fans out
// and joins them up. Doing it here rather than in the book means the phone
// makes one request however many accounts there are — which matters on a
// train.
async function accountsWithBalances(accessToken) {
  const listed = await teller('/accounts', accessToken);
  if (listed.status === 401 || listed.status === 403) return { status: 401 };
  if (listed.status !== 200 || !Array.isArray(listed.body)) {
    return { status: 502, errors: [listed.error || `Teller answered ${listed.status || 'nothing'}.`] };
  }

  const errors = [];
  const accounts = await Promise.all(
    listed.body.map(async (account) => {
      // A closed account has no balance to fetch; it is passed through so
      // the book can say it has gone rather than silently dropping it.
      if (String(account?.status ?? '').toLowerCase() === 'closed') return account;
      const balances = await teller(`/accounts/${encodeURIComponent(account.id)}/balances`, accessToken);
      if (balances.status !== 200 || !balances.body) {
        const where = account?.institution?.name || account?.name || 'An account';
        errors.push(`${where} didn't return a balance (${balances.error || `Teller answered ${balances.status}`}).`);
        return account;
      }
      return { ...account, balance: { ledger: balances.body.ledger, available: balances.body.available } };
    })
  );

  return { status: 200, accounts, errors };
}

// ---------- The sign-in page ----------

// This page — not the book — is what loads Teller Connect. Keeping their
// script here means Tally itself never fetches anything from a third party
// and still works with no connection at all.
function signInPage(publicUrl) {
  // Signing in here is the expensive step — it is a real login at every
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
  .step.warn { border-left: 3px solid #8c2f2a; padding-left: 1rem; border-top: 0; }
  .step.warn code { display: inline-block; padding: .2rem .45rem; background: rgba(128,128,128,.16); border-radius: .25rem; }
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
    <p>Sign in to each institution you want the book to follow. This page talks to Teller; the book never does.</p>
    <button id="go">Sign in to a bank</button>
    <p id="env" class="sub" style="margin-top:1rem"></p>
  </div>

  <div class="step hide" id="done">
    <p class="label">Step two</p>
    <p>Copy this line, open Tally, and go to <strong>Endpapers &rarr; Connections &rarr; Connect a bridge</strong>.</p>
    <textarea id="token" rows="5" readonly onclick="this.select()"></textarea>
    <p><button id="copy">Copy</button></p>
    <p class="sub">It carries this bridge's address and the token for the accounts you just approved. Treat it like a password.</p>
  </div>
</main>

<script src="https://cdn.teller.io/connect/connect.js"></script>
<script>
  var BRIDGE = ${JSON.stringify(publicUrl)};
  var ENVIRONMENT = ${JSON.stringify(ENVIRONMENT)};
  document.getElementById('env').textContent =
    ENVIRONMENT === 'development'
      ? 'Using Teller\\u2019s free development tier: real banks, not billed, up to 100 enrolments.'
      : 'Using the ' + ENVIRONMENT + ' environment.';

  var connect = TellerConnect.setup({
    applicationId: ${JSON.stringify(APP_ID)},
    environment: ENVIRONMENT,
    // Balances only. This book does not log spending, so it never asks for
    // permission to read transactions in the first place.
    products: ['balance'],
    onSuccess: function (enrollment) {
      var line = btoa(JSON.stringify({ u: BRIDGE, t: enrollment.accessToken }));
      document.getElementById('token').value = line;
      document.getElementById('done').classList.remove('hide');
      document.getElementById('done').scrollIntoView({ behavior: 'smooth' });
    },
  });
  document.getElementById('go').addEventListener('click', function () { connect.open(); });
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
  res.setHeader('Access-Control-Allow-Headers', 'authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function json(res, status, body) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// The address the outside world reaches this bridge on. Behind a proxy that
// terminates TLS — `tailscale serve`, a tunnel, any real host — the socket
// here is plain http, and only the forwarded headers know it was https. Get
// this wrong and the bridge hands out a line saying http://, which the book
// refuses outright, correctly, as a token it would have to send in the clear.
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
    // Whatever address this page was opened on is the address that works, so
    // the line it hands out points back at exactly that.
    return res.end(signInPage(publicOrigin(req)));
  }

  if (req.method === 'GET' && url.pathname === '/accounts') {
    const auth = req.headers.authorization || '';
    const match = /^Basic\s+(.+)$/i.exec(auth);
    if (!match) return json(res, 401, { error: 'No token.' });
    const accessToken = Buffer.from(match[1], 'base64').toString('utf8').split(':')[0];
    if (!accessToken) return json(res, 401, { error: 'No token.' });

    const result = await accountsWithBalances(accessToken);
    if (result.status === 401) return json(res, 401, { error: 'Teller turned that token down.' });
    if (result.status !== 200) return json(res, 502, { accounts: [], errors: result.errors ?? [] });
    return json(res, 200, { accounts: result.accounts, errors: result.errors });
  }

  json(res, 404, { error: 'Not found.' });
});

server.listen(PORT, HOST, () => {
  const where = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`\n  Tally bridge is running.\n`);
  console.log(`  Open        http://${where}:${PORT}/`);
  console.log(`  Environment ${ENVIRONMENT}${ENVIRONMENT === 'development' ? '  (free, real banks, not billed)' : ''}`);
  console.log(`\n  To reach it from your phone, put it behind a certificate:`);
  console.log(`    tailscale serve --bg ${PORT}`);
  console.log(`\n  It holds your certificate and nothing else. Stop it with Ctrl-C.\n`);
});
