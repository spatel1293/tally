import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  centsFromDecimalString, dateFromEpoch, decodeSetupToken, parseAccessUrl,
  kindForBridge, roleForBridge, accountFromBridge, planSync, isConnected,
} from '../js/core/link.js';
import { newAccount } from '../js/core/defaults.js';

// The bridge reports money as a decimal string, so the whole conversion has
// to be exact. A float anywhere in here is the bug these tests exist to stop.
describe('centsFromDecimalString', () => {
  test('reads a plain figure exactly', () => {
    assert.equal(centsFromDecimalString('114265.51'), 11426551);
    assert.equal(centsFromDecimalString('0'), 0);
    assert.equal(centsFromDecimalString('0.07'), 7);
    assert.equal(centsFromDecimalString('1000'), 100000);
  });

  test('a single decimal place is tenths, not hundredths', () => {
    assert.equal(centsFromDecimalString('105884.8'), 10588480);
  });

  test('a credit card balance is negative', () => {
    assert.equal(centsFromDecimalString('-310.25'), -31025);
    assert.equal(centsFromDecimalString('+310.25'), 31025);
  });

  test('rounds past two decimals, half away from zero', () => {
    assert.equal(centsFromDecimalString('1.005'), 101);
    assert.equal(centsFromDecimalString('1.004'), 100);
    assert.equal(centsFromDecimalString('-1.005'), -101);
    assert.equal(centsFromDecimalString('1.999'), 200);
  });

  test('survives figures that a float would round wrong', () => {
    assert.equal(centsFromDecimalString('8225.35'), 822535);
    assert.equal(centsFromDecimalString('1.15'), 115);
    assert.equal(centsFromDecimalString('4.35'), 435);
  });

  test('refuses anything that is not a figure', () => {
    for (const bad of ['nope', '', '  ', null, undefined, '1,234.00', '$5', '1e5', '1.2.3', {}]) {
      assert.equal(centsFromDecimalString(bad), null, `should refuse ${JSON.stringify(bad)}`);
    }
  });

  test('refuses a figure too large to hold exactly', () => {
    assert.equal(centsFromDecimalString('999999999999999999999'), null);
  });

  test('tolerates surrounding whitespace', () => {
    assert.equal(centsFromDecimalString('  42.50\n'), 4250);
  });
});

describe('dateFromEpoch', () => {
  test('turns epoch seconds into a YYYY-MM-DD string', () => {
    assert.match(dateFromEpoch(1790208000), /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(dateFromEpoch(0).slice(0, 4), new Date(0).getFullYear().toString());
  });

  test('refuses anything that is not a number', () => {
    for (const bad of [null, undefined, 'today', NaN, Infinity]) assert.equal(dateFromEpoch(bad), null);
  });
});

describe('decodeSetupToken', () => {
  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
  const decode = (s) => Buffer.from(s, 'base64').toString('utf8');

  test('decodes to the one-time claim URL', () => {
    const url = 'https://beta-bridge.simplefin.org/simplefin/claim/abc123';
    assert.deepEqual(decodeSetupToken(b64(url), { decode }), { ok: true, claimUrl: url });
  });

  test('ignores whitespace the clipboard adds', () => {
    const url = 'https://bridge.simplefin.org/simplefin/claim/x';
    const wrapped = b64(url).replace(/(.{8})/g, '$1\n');
    assert.equal(decodeSetupToken(wrapped, { decode }).claimUrl, url);
  });

  test('says so when nothing was pasted', () => {
    assert.equal(decodeSetupToken('', { decode }).ok, false);
    assert.equal(decodeSetupToken('   ', { decode }).ok, false);
  });

  test('refuses a token that does not decode to https', () => {
    assert.equal(decodeSetupToken(b64('http://insecure/claim'), { decode }).ok, false);
    assert.equal(decodeSetupToken(b64('not a url at all'), { decode }).ok, false);
  });

  test('refuses something that is not base64 at all', () => {
    const throwing = () => { throw new Error('bad base64'); };
    assert.equal(decodeSetupToken('!!!!', { decode: throwing }).ok, false);
  });
});

describe('parseAccessUrl', () => {
  const url = 'https://user123:pass456@bridge.simplefin.org/simplefin';

  test('splits the credentials out of the address', () => {
    assert.deepEqual(parseAccessUrl(url), {
      ok: true,
      base: 'https://bridge.simplefin.org/simplefin',
      username: 'user123',
      password: 'pass456',
    });
  });

  test('un-escapes credentials that were percent-encoded', () => {
    const parsed = parseAccessUrl('https://a%40b:p%3Ass@bridge.simplefin.org/simplefin');
    assert.equal(parsed.username, 'a@b');
    assert.equal(parsed.password, 'p:ss');
  });

  test('drops a trailing slash so paths join cleanly', () => {
    assert.equal(parseAccessUrl(`${url}/`).base, 'https://bridge.simplefin.org/simplefin');
  });

  test('refuses an address with no credentials in it', () => {
    assert.equal(parseAccessUrl('https://bridge.simplefin.org/simplefin').ok, false);
  });

  test('refuses anything that is not https', () => {
    assert.equal(parseAccessUrl('http://u:p@bridge.simplefin.org/x').ok, false);
    assert.equal(parseAccessUrl('').ok, false);
    assert.equal(parseAccessUrl(null).ok, false);
  });
});

describe('guessing what an account is', () => {
  const at = (name, org) => ({ name, org: { name: org } });

  test('reads the kind from the names the bridge gives', () => {
    assert.equal(kindForBridge(at('Sapphire Preferred Card', 'Chase')), 'credit');
    assert.equal(kindForBridge(at('Individual', 'Robinhood')), 'brokerage');
    assert.equal(kindForBridge(at('Roth IRA', 'Vanguard')), 'brokerage');
    assert.equal(kindForBridge(at('Online Savings', 'Ally')), 'savings');
    assert.equal(kindForBridge(at('Interest Checking', 'Ally')), 'checking');
  });

  test('gives each kind the job it usually does', () => {
    assert.equal(roleForBridge(at('Brokerage', 'Schwab')), 'investing');
    assert.equal(roleForBridge(at('Everyday Card', 'Amex')), 'spending');
    assert.equal(roleForBridge(at('Savings', 'Ally')), 'savings');
    assert.equal(roleForBridge(at('Checking', 'Ally')), 'hub');
  });
});

describe('accountFromBridge', () => {
  const sf = {
    id: 'ACT-1',
    name: 'Individual',
    currency: 'USD',
    balance: '114265.51',
    'balance-date': 1790208000,
    org: { name: 'Wealthfront', domain: 'wealthfront.com' },
  };

  test('takes the figure, the bank and the bridge id', () => {
    const made = accountFromBridge(sf, { today: '2026-09-23' });
    assert.equal(made.name, 'Individual');
    assert.equal(made.institution, 'Wealthfront');
    assert.equal(made.balance, 11426551);
    assert.equal(made.kind, 'brokerage');
    assert.equal(made.role, 'investing');
    assert.equal(made.link.accountId, 'ACT-1');
    assert.equal(made.link.org, 'Wealthfront');
    assert.equal(made.link.lastSyncAt, null);
  });

  test('falls back to today when the bridge gives no date', () => {
    const made = accountFromBridge({ ...sf, 'balance-date': null }, { today: '2026-09-23' });
    assert.equal(made.balanceAt, '2026-09-23');
  });

  test('leaves the date empty when there is no balance to date', () => {
    const made = accountFromBridge({ ...sf, balance: 'n/a' }, { today: '2026-09-23' });
    assert.equal(made.balance, 0);
    assert.equal(made.balanceAt, null);
  });

  test('names an account the bridge did not name', () => {
    assert.equal(accountFromBridge({ id: 'x' }, {}).name, 'Account');
    assert.equal(accountFromBridge({ id: 'x' }, {}).institution, '');
  });

  test('fits the shape newAccount() makes, so a backup round trip is identical', () => {
    const made = newAccount(accountFromBridge(sf, { today: '2026-09-23' }));
    for (const key of Object.keys(newAccount())) assert.ok(key in made, `missing ${key}`);
    assert.equal(made.history.length, 0);
    assert.equal(made.vault, null);
  });
});

describe('planSync', () => {
  const book = (over = {}) => newAccount({ id: 'a1', name: 'Brokerage', balance: 11426551, balanceAt: '2026-09-20', link: { accountId: 'ACT-1', org: 'Wealthfront', lastSyncAt: null }, ...over });
  const bridge = (over = {}) => ({ id: 'ACT-1', name: 'Individual', currency: 'USD', balance: '114265.51', 'balance-date': 1790208000, org: { name: 'Wealthfront' }, ...over });
  const opts = { today: '2026-09-23', currency: 'USD' };

  test('an account the book does not follow is left alone', () => {
    const plan = planSync([newAccount({ id: 'manual', name: 'Cash tin', balance: 5000 })], [], opts);
    assert.equal(plan.updates.length, 0);
    assert.equal(plan.problems.length, 0);
  });

  test('a moved balance is a change', () => {
    const plan = planSync([book()], [bridge({ balance: '120000.00' })], opts);
    assert.equal(plan.updates.length, 1);
    assert.equal(plan.changed.length, 1);
    assert.equal(plan.changed[0].cents, 12000000);
    assert.equal(plan.changed[0].was, 11426551);
    assert.equal(plan.changed[0].name, 'Brokerage');
  });

  test('a balance that has not moved is looked at but not written', () => {
    const date = dateFromEpoch(1790208000);
    const plan = planSync([book({ balanceAt: date })], [bridge()], opts);
    assert.equal(plan.updates.length, 1);
    assert.equal(plan.changed.length, 0);
  });

  test('the same figure read on a new day is still a new reading', () => {
    const plan = planSync([book({ balanceAt: '1999-01-01' })], [bridge()], opts);
    assert.equal(plan.changed.length, 1);
  });

  test('only the balance and its date are ever taken from the bridge', () => {
    const mine = book({ name: 'The long game', institution: 'My note', apyBp: 425, role: 'savings' });
    const plan = planSync([mine], [bridge({ name: 'Individual Brokerage', org: { name: 'WEALTHFRONT INC' } })], opts);
    assert.deepEqual(Object.keys(plan.updates[0]).sort(), ['cents', 'changed', 'date', 'id', 'name', 'was']);
    assert.equal(plan.updates[0].name, 'The long game');
  });

  test('an account the bridge no longer offers is a problem, not a wipe', () => {
    const plan = planSync([book()], [], opts);
    assert.equal(plan.updates.length, 0);
    assert.equal(plan.problems[0].reason, 'gone');
    assert.match(plan.problems[0].message, /no longer offered/);
  });

  test('a foreign currency is refused rather than mixed in', () => {
    const plan = planSync([book()], [bridge({ currency: 'EUR' })], opts);
    assert.equal(plan.updates.length, 0);
    assert.equal(plan.problems[0].reason, 'currency');
    assert.match(plan.problems[0].message, /EUR/);
  });

  test('an unreadable balance is a problem, not a zero', () => {
    const plan = planSync([book()], [bridge({ balance: null })], opts);
    assert.equal(plan.updates.length, 0);
    assert.equal(plan.problems[0].reason, 'no-balance');
  });

  test('a missing balance-date falls back to today', () => {
    const plan = planSync([book()], [bridge({ 'balance-date': null, balance: '1.00' })], opts);
    assert.equal(plan.updates[0].date, '2026-09-23');
  });

  test('accounts the book has not taken up are offered', () => {
    const plan = planSync([book()], [bridge(), bridge({ id: 'ACT-2', name: 'Cash' })], opts);
    assert.equal(plan.offered.length, 1);
    assert.equal(plan.offered[0].id, 'ACT-2');
  });

  test('nothing is offered twice, even when the book is empty', () => {
    const plan = planSync([], [bridge()], opts);
    assert.equal(plan.offered.length, 1);
    assert.equal(plan.updates.length, 0);
  });

  test('copes with a bridge that sends nothing at all', () => {
    const plan = planSync([book()], undefined, opts);
    assert.equal(plan.problems.length, 1);
    assert.equal(plan.offered.length, 0);
  });

  test('matches on the bridge id even when the ids are typed differently', () => {
    const plan = planSync([book({ link: { accountId: 77, org: '', lastSyncAt: null } })], [bridge({ id: '77', balance: '1.00' })], opts);
    assert.equal(plan.updates.length, 1);
  });
});

describe('isConnected', () => {
  test('is true only for an account following the bridge', () => {
    assert.equal(isConnected(newAccount({ link: { accountId: 'ACT-1' } })), true);
    assert.equal(isConnected(newAccount()), false);
    assert.equal(isConnected(newAccount({ link: { accountId: '' } })), false);
    assert.equal(isConnected(null), false);
  });
});
