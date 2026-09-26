# The 6.0 rework: a portfolio book

## Why

Tally was a wealth-fund book where balances were *stated* — read off a
statement and written in by hand, or fetched whole from an aggregator. The
owner's three accounts are all investments (Wealthfront, Robinhood, Charles
Schwab), and the ask changed to: a unified view of all three, on the phone,
completely free, automated rather than typed.

Three attempts at aggregation ran aground on that "free" requirement — Teller
has no self-serve signup any more, Plaid's production access demands a card
and a metered pricing agreement, and SimpleFIN is $15/yr. All three were
verified directly rather than taken from marketing copy.

## The insight this version is built on

**Holdings change rarely. Prices change daily.**

A portfolio's *value* moves every day, but *what you own* barely moves at all.
So the expensive, gated thing (reading positions out of a broker) only has to
happen occasionally, while the thing that actually keeps the number fresh
(pricing those positions) is free, unlimited and needs no permission from
anyone.

That inverts the problem. Instead of paying an aggregator to re-read the same
balance every day, the book stores positions and prices them itself.

## What each account gets

| Account | Holdings come from | Value updates |
| --- | --- | --- |
| Robinhood | Its official agent API — OAuth 2.1 + PKCE, a public client with no secret, `Access-Control-Allow-Origin: *`. Verified live; browser-direct, no server. | Automatic |
| Charles Schwab | Occasional refresh by hand. Its official API is free but is a confidential client (needs a server for the secret) and forces a browser re-login every 7 days. | Automatic |
| Wealthfront | Occasional refresh by hand. It has no public API of any kind — confirmed by searching its own help-centre API, which returns nothing but articles about APY. | Automatic |

So every account's *value* is automatic. Only Schwab's and Wealthfront's
*positions* need an occasional look-in, and those change rarely enough that
this is a few minutes a quarter rather than a daily chore.

## Prices

Twelve Data: free key, self-serve, 800 requests a day, and it takes a
comma-separated list of symbols so one request prices the whole book.
`Access-Control-Allow-Origin: *`, verified by probe — the phone calls it
directly and nothing sits in between.

Prices arrive as decimal strings, which is exactly what this codebase wants:
they convert to exact integers with no floating point anywhere in the path.

## Rules this supersedes

These were true of the old book and are deliberately changed here. They are
listed so the change is on purpose rather than by drift.

- **Old rule 8, "the newest reading is what an account is worth… never a
  derived figure."** A position's market value *is* derived — shares times
  price. The rule survives in spirit: a valuation is still filed as a dated
  reading through `recordBalance()`, so the history, the charts and the
  staleness checks all keep working. What changed is where the figure comes
  from.
- **Old rule 13, "exactly one runtime request, to one third party."** A
  unified view of three brokerages plus a price feed cannot be one request to
  one party. The privacy commitment is unchanged — no analytics, no AI,
  nothing that profiles the owner — but the count is now: the price feed, and
  whichever brokers the owner has connected. Each is the owner's explicit
  choice and each is listed in the endpapers.
- **Old rule 15, "connectivity is SimpleFIN, paid."** Reversed by the owner:
  "It should be completely free to set up and use." SimpleFIN is gone.

## Money and quantities

Money stays integer cents. Share counts are new and cannot be integers —
Robinhood and Wealthfront both do fractional shares — so quantities are
scaled integers at 1e6 (micro-shares), and prices are scaled integers at 1e6
(micro-dollars). Value is computed with `BigInt` so the multiplication is
exact, then rounded once, at the end, into cents.

No float is allowed anywhere in that path, for the same reason as before: a
portfolio that is a few cents wrong every time it is priced is a portfolio
nobody trusts.
