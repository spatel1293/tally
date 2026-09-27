#!/usr/bin/env node
// Telling the phone what the day did.
//
// This runs in GitHub Actions on a schedule, which is the only part of this
// book that is awake when the book itself is shut. It does exactly one
// thing: price the holdings it was given, work out the day's movement, and
// push one line to the phone.
//
// It is given two secrets and holds nothing:
//
//   TALLY_WATCH    the line the book's endpapers generate — where to push,
//                  what is held, and the price key to value it with
//   VAPID_PRIVATE  the private half of the signing key, so the browser's
//                  push service believes the push came from this book
//
// Nothing is written anywhere. No balance is stored, no history is kept, and
// the repository learns nothing it did not already have in a secret.

import { createSign, createECDH, createHmac, randomBytes, createCipheriv, createPrivateKey } from 'node:crypto';

const WATCH = process.env.TALLY_WATCH || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE || '';
const VAPID_PUBLIC = process.env.VAPID_PUBLIC || '';
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:tally@example.invalid';
const DRY_RUN = process.env.DRY_RUN === '1';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(s, 'base64url');

function die(message) {
  console.error(message);
  process.exit(1);
}

// ---------- What we were told to watch ----------

function readWatch() {
  if (!WATCH) die('No TALLY_WATCH secret. Generate the line in the book’s endpapers and paste it into the repository’s secrets.');
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(WATCH, 'base64').toString('utf8'));
  } catch {
    die('TALLY_WATCH is not a line this understands. Generate it again from the endpapers.');
  }
  if (!parsed?.sub?.endpoint) die('That line carries no push address.');
  return parsed;
}

// ---------- Pricing, exactly as the book does it ----------

// The same integer arithmetic the book uses. A notification that disagrees
// with the page it is about would be worse than no notification.
const SHARE_SCALE = 1_000_000n;
const PRICE_SCALE = 1_000_000n;

function parseScaled(text, scale) {
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const digits = String(scale).length - 1;
  const frac = m[3] ?? '';
  const kept = (frac + '0'.repeat(digits)).slice(0, digits);
  let value = BigInt(m[2]) * scale + BigInt(kept || '0');
  if (frac.length > digits && Number(frac[digits]) >= 5) value += 1n;
  return m[1] === '-' ? -value : value;
}

function valueCents(sharesBig, priceBig) {
  const divisor = (SHARE_SCALE * PRICE_SCALE) / 100n;
  const product = sharesBig * priceBig;
  const whole = product / divisor;
  return (product % divisor) * 2n >= divisor ? whole + 1n : whole;
}

async function priceBook(holdings, key) {
  const symbols = [...new Set(holdings.map((h) => h.s))];
  if (!symbols.length) return null;
  if (!key) die('That line carries no price key, so there is nothing to value the holdings with.');

  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbols.join(','))}&apikey=${encodeURIComponent(key)}`;
  const response = await fetch(url);
  if (!response.ok) die(`The price feed answered ${response.status}.`);
  const body = await response.json();
  if (body?.status === 'error') die(`The price feed refused: ${body.message ?? body.code}`);

  const quoteFor = (symbol) => (symbols.length === 1 ? body : body?.[symbol]);

  let now = 0n;
  let before = 0n;
  let priced = 0;
  for (const holding of holdings) {
    const quote = quoteFor(holding.s);
    const price = parseScaled(quote?.close ?? quote?.price, PRICE_SCALE);
    const previous = parseScaled(quote?.previous_close, PRICE_SCALE);
    const shares = parseScaled(holding.q, SHARE_SCALE);
    if (price == null || shares == null) continue;
    now += valueCents(shares, price);
    if (previous != null) before += valueCents(shares, previous);
    priced += 1;
  }
  if (!priced) return null;
  return { now, before, priced, total: symbols.length };
}

const money = (cents) =>
  `$${(Number(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ---------- Web Push ----------

// Web Push is RFC 8291 (encryption) over RFC 8292 (VAPID). Both are done
// here with Node's own crypto rather than a dependency, because this book
// has none and a scheduled job is a bad place to start collecting them.

function vapidHeaders(endpoint) {
  const { origin } = new URL(endpoint);
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({
    aud: origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: SUBJECT,
  }));
  const unsigned = `${header}.${claims}`;

  const key = createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: VAPID_PRIVATE, x: b64u(fromB64u(VAPID_PUBLIC).subarray(1, 33)), y: b64u(fromB64u(VAPID_PUBLIC).subarray(33, 65)) },
    format: 'jwk',
  });
  const der = createSign('SHA256').update(unsigned).sign(key);

  // DER → the raw r||s pair JWS wants.
  let offset = 2;
  if (der[1] & 0x80) offset += der[1] & 0x7f;
  const readInt = () => {
    const length = der[offset + 1];
    let start = offset + 2;
    let end = start + length;
    while (der[start] === 0 && end - start > 32) start += 1;
    const part = Buffer.alloc(32);
    der.copy(part, 32 - (end - start), start, end);
    offset = end;
    return part;
  };
  const r = readInt();
  const s = readInt();

  return {
    Authorization: `vapid t=${unsigned}.${b64u(Buffer.concat([r, s]))}, k=${VAPID_PUBLIC}`,
  };
}

function hkdf(salt, ikm, info, length) {
  const prk = createHmac('sha256', salt).update(ikm).digest();
  return createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, length);
}

function encrypt(payload, clientPublic, auth) {
  const salt = randomBytes(16);
  const server = createECDH('prime256v1');
  server.generateKeys();
  const shared = server.computeSecret(clientPublic);

  const info = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    clientPublic,
    server.getPublicKey(),
  ]);
  const ikm = hkdf(auth, shared, info, 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);

  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(65, 20);

  return Buffer.concat([header, server.getPublicKey(), body]);
}

async function push(subscription, message) {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  const body = encrypt(payload, fromB64u(subscription.keys.p256dh), fromB64u(subscription.keys.auth));

  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      ...vapidHeaders(subscription.endpoint),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
    },
    body,
  });

  if (response.status === 404 || response.status === 410) {
    die('The phone’s push address has expired. Turn notifications on again in the endpapers and paste the new line.');
  }
  if (!response.ok) die(`The push service answered ${response.status}: ${await response.text()}`);
  return response.status;
}

// ---------- What to say ----------

function compose(priced) {
  if (!priced) return { title: 'Tally', body: 'Nothing could be priced today.' };
  const change = priced.now - priced.before;
  const pct = priced.before > 0n ? Number((change * 10_000n) / priced.before) / 100 : 0;
  const partial = priced.priced < priced.total ? ` (${priced.priced} of ${priced.total} priced)` : '';

  if (change === 0n) {
    return { title: money(priced.now), body: `Level today.${partial}` };
  }
  const direction = change > 0n ? 'Up' : 'Down';
  const magnitude = change > 0n ? change : -change;
  return {
    title: money(priced.now),
    body: `${direction} ${money(magnitude)} today, ${Math.abs(pct).toFixed(2)}%.${partial}`,
  };
}

// ---------- Go ----------

const watch = readWatch();
const priced = await priceBook(watch.holdings ?? [], watch.key);
const message = compose(priced);

console.log(`${message.title} — ${message.body}`);

if (DRY_RUN) {
  console.log('DRY_RUN=1, so nothing was sent.');
} else {
  if (!VAPID_PRIVATE || !VAPID_PUBLIC) die('VAPID_PRIVATE and VAPID_PUBLIC must both be set.');
  const status = await push(watch.sub, message);
  console.log(`Pushed (${status}).`);
}
