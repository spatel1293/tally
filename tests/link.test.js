import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  centsFromDecimalString, parseBase, decodeLinkToken, kindForBridge, roleForBridge,
  balanceFromBridge, accountFromBridge, planSync, isConnected,
} from '../js/core/link.js';
import { newAccount } from '../js/core/defaults.js';
import { fundTotal } from '../js/core/fund.js';

// Teller reports money as a decimal string, so the whole conversion has to be
// exact. A float anywhere in here is the bug these tests exist to stop.
describe('centsFromDecimalString', () => {
  test('reads a plain figure exactly', () => {
    assert.equal(centsFromDecimalString('28575.02'), 2857502);
    assert.equal(centsFromDecimalString('0'), 0);
    assert.equal(centsFromDecimalString('0.07'), 7);
    assert.equal(centsFromDecimalString('1000'), 100000);
  });

  test('a single decimal place is tenths, not hundredths', () => {
    assert.equal(centsFromDecimalString('105884.8'), 10588480);
  });

  test('reads a signed figure', () => {
    assert.equal(centsFromDecimalString('-310.25'), -31025);
    assert.equal(centsFromDecimalString('+310.25'), 31025);
  });

  test('rounds past two decimals, half away from zero', () => {
    assert.equal(centsFromDecimalString('1.005'), 101);
    assert.equal(centsFromDecimalString('1.004'), 100);
    assert.equal(centsFromDecimalString('-1.005'), -101);
    assert.equal(centsFromDecimalString('1.999'), 200);
  });

  test('survives figures a float would round wrong', () => {
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

// A token travels to the bridge on every read, so the address it travels to
// has to be encrypted unless the bridge is on this very machine.
describe('parseBase', () => {
  test('accepts an https bridge', () => {
    assert.deepEqual(parseBase('https://bridge.example.test/'), { ok: true, base: 'https://bridge.example.test' });
  });

  test('accepts plain http only on this machine', () => {
    assert.equal(parseBase('http://localhost:7000').ok, true);
    assert.equal(parseBase('http://127.0.0.1:7000').ok, true);
    assert.equal(parseBase('http://[::1]:7000').ok, true);
  });

  test('refuses plain http anywhere else, because the token would be readable', () => {
    for (const bad of ['http://192.168.1.5:7000', 'http://bridge.example.test', 'http://my-pi.local:7000']) {
      const parsed = parseBase(bad);
      assert.equal(parsed.ok, false, `should refuse ${bad}`);
      assert.match(parsed.error, /https/);
    }
  });

  test('strips credentials, query and fragment from the address', () => {
    assert.equal(parseBase('https://u:p@bridge.example.test/x?a=1#b').base, 'https://bridge.example.test/x');
  });

  test('drops a trailing slash so paths join cleanly', () => {
    assert.equal(parseBase('https://bridge.example.test///').base, 'https://bridge.example.test');
  });

  test('refuses what is not an address at all', () => {
    for (const bad of ['', null, undefined, 'bridge.example.test', 'ftp://x/']) assert.equal(parseBase(bad).ok, false);
  });
});

describe('decodeLinkToken', () => {
  const decode = (s) => Buffer.from(s, 'base64').toString('utf8');
  const line = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');

  test('carries the bridge and the token in one paste', () => {
    const token = line({ u: 'https://bridge.example.test', t: 'token_abc123' });
    assert.deepEqual(decodeLinkToken(token, { decode }), {
      ok: true,
      base: 'https://bridge.example.test',
      accessToken: 'token_abc123',
    });
  });

  test('ignores whitespace the clipboard adds', () => {
    const token = line({ u: 'https://bridge.example.test', t: 'token_abc' }).replace(/(.{8})/g, '$1\n');
    assert.equal(decodeLinkToken(token, { decode }).accessToken, 'token_abc');
  });

  test('says so when nothing was pasted', () => {
    assert.equal(decodeLinkToken('', { decode }).ok, false);
    assert.equal(decodeLinkToken('   ', { decode }).ok, false);
  });

  test('refuses a line that is not base64', () => {
    const throwing = () => { throw new Error('bad base64'); };
    assert.equal(decodeLinkToken('!!!!', { decode: throwing }).ok, false);
  });

  test('refuses a line that is not the right shape', () => {
    assert.equal(decodeLinkToken(Buffer.from('hello', 'utf8').toString('base64'), { decode }).ok, false);
    assert.equal(decodeLinkToken(line({ u: 'https://bridge.example.test' }), { decode }).ok, false);
    assert.equal(decodeLinkToken(line({ t: 'token_abc' }), { decode }).ok, false);
  });

  test('refuses a bridge the token could be overheard on', () => {
    assert.equal(decodeLinkToken(line({ u: 'http://bridge.example.test', t: 'token_abc' }), { decode }).ok, false);
  });
});

describe('reading what the bridge says an account is', () => {
  const at = (type, subtype) => ({ type, subtype });

  test('takes the kind from the type the provider gives, rather than guessing at a name', () => {
    assert.equal(kindForBridge(at('depository', 'checking')), 'checking');
    assert.equal(kindForBridge(at('depository', 'savings')), 'savings');
    assert.equal(kindForBridge(at('depository', 'money_market')), 'savings');
    assert.equal(kindForBridge(at('depository', 'certificate_of_deposit')), 'savings');
    // Providers spell the same thing differently; the subtype is normalised.
    assert.equal(kindForBridge(at('depository', 'money market')), 'savings');
    assert.equal(kindForBridge(at('depository', 'cd')), 'savings');
    assert.equal(kindForBridge(at('investment', 'brokerage')), 'brokerage');
    assert.equal(kindForBridge(at('investment', 'ira')), 'brokerage');
    assert.equal(kindForBridge(at('investment', '401k')), 'brokerage');
    assert.equal(kindForBridge(at('investment', 'roth')), 'brokerage');
    assert.equal(kindForBridge(at('depository', 'treasury')), 'brokerage');
    assert.equal(kindForBridge(at('depository', 'sweep')), 'brokerage');
    assert.equal(kindForBridge(at('credit', 'credit_card')), 'credit');
  });

  test('falls back to checking for a subtype it has not met', () => {
    assert.equal(kindForBridge(at('depository', 'something_new')), 'checking');
    assert.equal(kindForBridge({}), 'checking');
  });

  test('gives each kind the job it usually does', () => {
    assert.equal(roleForBridge(at('credit', 'credit_card')), 'spending');
    assert.equal(roleForBridge(at('depository', 'treasury')), 'investing');
    assert.equal(roleForBridge(at('depository', 'savings')), 'savings');
    assert.equal(roleForBridge(at('depository', 'checking')), 'hub');
  });
});

describe('balanceFromBridge', () => {
  test('prefers the ledger, which is what a statement would print', () => {
    assert.equal(balanceFromBridge({ balance: { ledger: '28575.02', available: '28000.00' } }), 2857502);
  });

  test('falls back to available when there is no ledger', () => {
    assert.equal(balanceFromBridge({ balance: { ledger: null, available: '28000.00' } }), 2800000);
  });

  // The one that would quietly corrupt the fund: Teller reports a card as
  // what you owe, positively, and fundTotal simply adds balances up.
  test('a credit card is money owed, so it is negative in the book', () => {
    assert.equal(balanceFromBridge({ type: 'credit', balance: { ledger: '310.25' } }), -31025);
    assert.equal(balanceFromBridge({ type: 'credit', balance: { ledger: '-310.25' } }), -31025);
  });

  test('linking a card lowers the fund rather than inflating it', () => {
    const cash = newAccount({ id: 'a', name: 'Cash', balance: balanceFromBridge({ type: 'depository', balance: { ledger: '1000.00' } }) });
    const card = newAccount({ id: 'b', name: 'Card', balance: balanceFromBridge({ type: 'credit', balance: { ledger: '250.00' } }) });
    assert.equal(fundTotal([cash, card]), 75000);
  });

  test('gives nothing when there is no balance at all', () => {
    assert.equal(balanceFromBridge({ balance: { ledger: null, available: null } }), null);
    assert.equal(balanceFromBridge({}), null);
    assert.equal(balanceFromBridge(null), null);
  });
});

describe('accountFromBridge', () => {
  const sf = {
    id: 'acc_oiin624iajrg2mp2ea000',
    name: 'Individual',
    currency: 'USD',
    type: 'depository',
    subtype: 'treasury',
    status: 'open',
    last_four: '4417',
    institution: { id: 'wealthfront', name: 'Wealthfront' },
    balance: { ledger: '114265.51' },
  };

  test('takes the figure, the bank and the bridge id', () => {
    const made = accountFromBridge(sf, { today: '2026-09-23' });
    assert.equal(made.name, 'Individual');
    assert.equal(made.institution, 'Wealthfront');
    assert.equal(made.balance, 11426551);
    assert.equal(made.kind, 'brokerage');
    assert.equal(made.role, 'investing');
    assert.equal(made.link.accountId, 'acc_oiin624iajrg2mp2ea000');
    assert.equal(made.link.org, 'Wealthfront');
    assert.equal(made.link.lastFour, '4417');
    assert.equal(made.link.lastSyncAt, null);
  });

  // Teller's balances are live, so there is no statement date to file under.
  test('a live balance is read today', () => {
    assert.equal(accountFromBridge(sf, { today: '2026-09-23' }).balanceAt, '2026-09-23');
  });

  test('leaves the date empty when there is no balance to date', () => {
    const made = accountFromBridge({ ...sf, balance: {} }, { today: '2026-09-23' });
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
  const book = (over = {}) => newAccount({ id: 'a1', name: 'Brokerage', balance: 11426551, balanceAt: '2026-09-23', link: { accountId: 'acc_1', org: 'Wealthfront', lastFour: '4417', lastSyncAt: null }, ...over });
  const bridge = (over = {}) => ({ id: 'acc_1', name: 'Individual', currency: 'USD', type: 'depository', subtype: 'treasury', status: 'open', institution: { name: 'Wealthfront' }, balance: { ledger: '114265.51' }, ...over });
  const opts = { today: '2026-09-23', currency: 'USD' };

  test('an account the book does not follow is left alone', () => {
    const plan = planSync([newAccount({ id: 'manual', name: 'Cash tin', balance: 5000 })], [], opts);
    assert.equal(plan.updates.length, 0);
    assert.equal(plan.problems.length, 0);
  });

  test('a moved balance is a change', () => {
    const plan = planSync([book()], [bridge({ balance: { ledger: '120000.00' } })], opts);
    assert.equal(plan.updates.length, 1);
    assert.equal(plan.changed.length, 1);
    assert.equal(plan.changed[0].cents, 12000000);
    assert.equal(plan.changed[0].was, 11426551);
    assert.equal(plan.changed[0].name, 'Brokerage');
  });

  test('a balance that has not moved is looked at but not written', () => {
    const plan = planSync([book()], [bridge()], opts);
    assert.equal(plan.updates.length, 1);
    assert.equal(plan.changed.length, 0);
  });

  test('the same figure read on a new day is still a new reading', () => {
    const plan = planSync([book({ balanceAt: '1999-01-01' })], [bridge()], opts);
    assert.equal(plan.changed.length, 1);
  });

  test('only the balance and its date are ever taken from the bridge', () => {
    const mine = book({ name: 'The long game', institution: 'My note', apyBp: 425, role: 'savings' });
    const plan = planSync([mine], [bridge({ name: 'Individual Brokerage', institution: { name: 'WEALTHFRONT INC' } })], opts);
    assert.deepEqual(Object.keys(plan.updates[0]).sort(), ['cents', 'changed', 'date', 'id', 'name', 'was']);
    assert.equal(plan.updates[0].name, 'The long game');
  });

  test('an account the bridge no longer offers is a problem, not a wipe', () => {
    const plan = planSync([book()], [], opts);
    assert.equal(plan.updates.length, 0);
    assert.equal(plan.problems[0].reason, 'gone');
    assert.match(plan.problems[0].message, /no longer offered/);
  });

  test('an account closed at the bank keeps the figure it had', () => {
    const plan = planSync([book()], [bridge({ status: 'closed' })], opts);
    assert.equal(plan.updates.length, 0);
    assert.equal(plan.problems[0].reason, 'closed');
    assert.match(plan.problems[0].message, /left as it was/);
  });

  test('a closed account is never offered, because there is nothing to follow', () => {
    const plan = planSync([], [bridge({ status: 'closed' })], opts);
    assert.equal(plan.offered.length, 0);
  });

  test('a foreign currency is refused rather than mixed in', () => {
    const plan = planSync([book()], [bridge({ currency: 'EUR' })], opts);
    assert.equal(plan.updates.length, 0);
    assert.equal(plan.problems[0].reason, 'currency');
    assert.match(plan.problems[0].message, /EUR/);
  });

  test('an unreadable balance is a problem, not a zero', () => {
    const plan = planSync([book()], [bridge({ balance: {} })], opts);
    assert.equal(plan.updates.length, 0);
    assert.equal(plan.problems[0].reason, 'no-balance');
  });

  test('accounts the book has not taken up are offered', () => {
    const plan = planSync([book()], [bridge(), bridge({ id: 'acc_2', name: 'Cash' })], opts);
    assert.equal(plan.offered.length, 1);
    assert.equal(plan.offered[0].id, 'acc_2');
  });

  test('copes with a bridge that sends nothing at all', () => {
    const plan = planSync([book()], undefined, opts);
    assert.equal(plan.problems.length, 1);
    assert.equal(plan.offered.length, 0);
  });

  test('matches on the bridge id even when the ids are typed differently', () => {
    const plan = planSync([book({ link: { accountId: 77, org: '', lastSyncAt: null } })], [bridge({ id: '77', balance: { ledger: '1.00' } })], opts);
    assert.equal(plan.updates.length, 1);
  });

  test('a followed card writes in what is owed, not what is held', () => {
    const card = book({ id: 'c1', name: 'Card', balance: 0, link: { accountId: 'acc_c', org: 'Chase', lastSyncAt: null } });
    const plan = planSync([card], [bridge({ id: 'acc_c', type: 'credit', subtype: 'credit_card', balance: { ledger: '310.25' } })], opts);
    assert.equal(plan.changed[0].cents, -31025);
  });
});

describe('isConnected', () => {
  test('is true only for an account following the bridge', () => {
    assert.equal(isConnected(newAccount({ link: { accountId: 'acc_1' } })), true);
    assert.equal(isConnected(newAccount()), false);
    assert.equal(isConnected(newAccount({ link: { accountId: '' } })), false);
    assert.equal(isConnected(null), false);
  });
});
