// Turning prices into readings.
//
// This is the seam between "what the market says" and "what the book
// records". The old book's rule was that the newest reading is what an
// account is worth, and that a reading is stated rather than derived. A
// market value *is* derived — shares times price — so the rule is kept in
// spirit rather than letter: a valuation is filed as a dated reading through
// `recordBalance()`, exactly as a hand-written figure was, and everything
// downstream (the history, the charts, the staleness checks) goes on working
// without knowing the difference.
//
// One reading per account per day, so refreshing five times in an afternoon
// corrects the day's figure rather than filling the history with noise.

import { state, recordBalance, updateSettings } from './store.js';
import { symbolsHeld, valueBook } from './core/holdings.js';
import { fetchQuotes, pricesFrom, describePriceError } from './prices.js';

// Re-prices the whole book and files what changed.
//
// Returns { ok, valued, quotes, refused, changed[], errors[] } — the same
// shape of answer the old bridge gave, so the views that report a sync need
// no special case for where the figures came from.
export async function refreshPrices({ apiKey = state.settings.priceKey, today = state.today } = {}) {
  const symbols = symbolsHeld(state.accounts);
  if (!symbols.length) {
    return { ok: true, valued: null, quotes: new Map(), refused: [], changed: [], errors: [], empty: true };
  }

  const result = await fetchQuotes(symbols, apiKey);
  if (!result.ok) return { ok: false, code: result.code, error: result.error, changed: [], errors: [result.error] };

  const prices = pricesFrom(result.quotes);
  const valued = valueBook(state.accounts, prices);

  const changed = [];
  for (const account of state.accounts) {
    const view = valued.byAccount.find((v) => v.id === account.id);
    if (!view) continue;

    // An account whose holdings could not all be priced is left alone. Half a
    // valuation filed as a reading would understate it, and the history is
    // supposed to be trustworthy.
    if (!view.complete) continue;
    // An account with nothing in it has nothing to say.
    if (!account.positions?.length && !account.cash) continue;

    const moved = view.total !== (account.balance ?? 0) || account.balanceAt !== today;
    if (!moved) continue;

    await recordBalance(account.id, view.total, today);
    changed.push({ id: account.id, name: account.name, cents: view.total, was: account.balance ?? 0 });
  }

  await updateSettings({ pricedAt: new Date().toISOString() });

  const errors = [];
  if (result.refused.length) {
    errors.push(
      result.refused.length === 1
        ? `${result.refused[0]} could not be priced, so the accounts holding it were left as they were.`
        : `${result.refused.length} holdings could not be priced (${result.refused.slice(0, 3).join(', ')}${result.refused.length > 3 ? '…' : ''}), so the accounts holding them were left as they were.`
    );
  }

  return { ok: true, valued, quotes: result.quotes, refused: result.refused, changed, errors };
}

export { describePriceError };
