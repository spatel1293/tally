# Tally

A book for a wealth fund, kept in your browser. It holds what the fund is
worth, what it is for, and where it sits — and nothing else. There is no
spending to log: what comes in and what goes out each month are two figures
you write in once, and everything else follows from them.

No backend of mine and no account to sign into. Account numbers and logins
are sealed with a passphrase that is never stored anywhere. Nothing leaves the
device unless you export it. The one thing it asks the network is what a
share costs — never what you hold, never who you are.

## What's in it

- **The Fund** — what it is all worth, what it earns while you do nothing,
  how many months of runway your safety net buys, and where each month's
  surplus goes.
- **Pots** — a safety net, nest eggs, trips and investments. Each has a
  target, a share of the surplus and a yield, and the book works out when it
  arrives and what it is worth in five years.
- **Accounts** — institution, the job each account does, its rate, whether
  the login has a second step, when you last looked at it, and a stated
  balance with every earlier reading kept. The numbers and logins go in the
  strongbox, sealed.
- **Review** — the quarterly look-over, worked out for you: whether the
  safety net covers its target, which pots have no home, which balances have
  gone stale, which logins still have no second step.
- **Endpapers** — the two monthly figures, paper and theme, copies, the
  strongbox and the price feed.

Balances are *stated*, not derived. You read a statement and write the figure
in, and every earlier reading stays on record — or you write in what an
account holds and the book prices it for you from then on.

## Run it

```sh
npm start        # http://localhost:5173
```

It also prints a LAN address for your phone. That address is plain HTTP, so
installing and offline mode won't work there, but every layout will.

There is nothing to install to run it: no framework, no build step, no
runtime dependencies. `npm install` is only needed for the browser tests.

## Put it online

Tally is a folder of static files, so any static host works: GitHub Pages,
Netlify, Cloudflare Pages, or your own web server. Upload everything except
`tests/`, `scripts/` and `node_modules/`. Serve it over HTTPS, because
browsers only allow offline mode and installing on HTTPS or `localhost`. The
app uses relative paths, so it can live in a subfolder.

`dist/tally.html` is the whole app in one file, if you'd rather carry it
around than host it.

### Install on a phone

This repository deploys itself: every push to `main` publishes the site
through [.github/workflows/pages.yml](.github/workflows/pages.yml).

On the phone, open the published https address in Chrome, then **⋮ → Add to
Home screen**. After that it opens like any other app and works with no
connection.

It has to be **https**, not the LAN address `npm start` prints. The strongbox
uses the browser's own encryption, which is only handed out on a secure
address, so over plain http the sealed pages cannot be set up at all. The book will say so rather than leaving you
guessing.

### Shipping an update

Bump `VERSION` in `sw.js` and `APP_VERSION` in `js/core/defaults.js` together,
then upload. Open devices pick the new version up on their next launch.

## Pricing what you hold

Balances are not fetched from a bank. The book stores **what each account
holds** — a ticker and a share count — and prices those holdings itself. The
whole thing is free, and there is nothing to run: no server, no bridge, no
aggregator account.

The reason it works is that the two halves move at very different speeds:

> **Holdings change rarely. Prices change daily.**

So the part that is expensive and gated — reading positions out of a broker —
only has to happen occasionally, by hand, while the part that actually keeps
the number fresh is free and unlimited.

### Setting it up

1. **Get a free key from [twelvedata.com](https://twelvedata.com/pricing)** —
   self-serve, about a minute, and yours for good.
2. In Tally: **Endpapers → The price feed → Add a price key**.
3. **Write in what each account holds.** Open an account, press *Write in a
   holding*, and give it a ticker and a share count. Fractional shares are
   fine. What you paid is optional — it is what lets the book show a gain
   rather than just a figure.
4. Press **Refresh prices**. The whole book is priced in one request.

The free allowance is 800 requests a day and the book uses **one per
refresh**, however many holdings there are, because the feed takes a
comma-separated list. You will not get near the limit.

### Where the holdings come from

| Account | How its holdings get in |
| --- | --- |
| **Robinhood** | By hand today. Its official agent API is a public OAuth client with `Access-Control-Allow-Origin: *`, so a browser-direct connector is possible with no server — it needs a dedicated Robinhood "Agentic" account and its schema is undocumented. |
| **Charles Schwab** | By hand. Its official API is free but is a confidential client (needs a server to hold the secret) and forces a browser re-login every seven days. |
| **Wealthfront** | By hand. It has no public API of any kind — confirmed by searching its own help centre, which returns nothing but articles about APY. |

Either way, **the value updates automatically**. Only the share counts need
an occasional look-in, and those change rarely enough to be a few minutes a
quarter rather than a daily chore.

### What it does and does not do

- **Only what a share costs** ever leaves the device. The request names the
  tickers; it carries no identity, no balance, no share count, and nothing
  sealed.
- **Transactions are never involved.** There is no aggregator and nothing that
  could see what you spent.
- **A holding the feed will not quote is reported, never counted as nothing**,
  and an account that is only half priced keeps its last complete figure
  rather than filing an understatement.
- **No floating point touches a figure.** Shares and prices are scaled
  integers multiplied in `BigInt` and rounded once, at the end, into cents.
- **A valuation is filed as a dated reading**, exactly like a hand-written
  one, so the history and the charts work the same either way.

## Being told what the day did

The book can push a notification to your phone once a day, without you opening
it. This is also free, and it runs in this repository rather than on a server.

1. In Tally: **Endpapers → Being told → Tell me daily**, and allow
   notifications. It gives you one long line.
2. In the repository: **Settings → Secrets and variables → Actions**, and add
   - a secret `TALLY_WATCH` — the line from step 1
   - a secret `VAPID_PRIVATE` — the `private` value from `vapid.local.json`
   - a variable `VAPID_PUBLIC` — the `public` value from the same file
3. That's it. [.github/workflows/notify.yml](.github/workflows/notify.yml)
   runs on weekday afternoons, prices your holdings, and pushes one line.

Generate the watch line again whenever your holdings change — it carries them,
so the job knows what to value. To try it without waiting for the schedule,
run the workflow by hand from the Actions tab; there is a *dry run* option
that works out the figure and sends nothing.

The job holds nothing. It writes nothing back, keeps no balance and no
history, and learns only what is already in the secret you gave it.

## How your data is stored

Everything lives in the browser you use, on that device.

- **Where:** IndexedDB, the browser's built-in database. If that's
  unavailable, Tally falls back to localStorage. If the browser allows no
  storage at all (some private-browsing modes), a banner says data will be
  lost when the tab closes.
- **When:** every change is written to storage *before* the screen updates,
  so there is no Save button to forget. If a write fails, your input stays on
  screen with an explanation.
- **Several tabs:** open tabs stay in sync.
- **Keeping it:** Tally asks the browser to treat its data as persistent. The
  endpapers show whether the browser agreed and how much space is used.
  - Safari may clear data for sites you haven't opened in a few weeks, unless
    the app is added to the Home Screen.
  - Clearing site data or browsing history erases Tally's data.
- **Other devices:** there's no sync. Each browser has its own copy. To move
  to a new device, save a copy on the old one and restore it on the new one.

### The strongbox

Account numbers, routing numbers, usernames, passwords, private notes and a
private notes are encrypted with AES-GCM under a key derived from your
passphrase (PBKDF2, 300,000 rounds). The passphrase is never stored, so there
is no way to recover it: lose it and the sealed pages stay shut for good. The
key lives only in memory, and the strongbox shuts itself on a timer and
whenever the phone is pocketed.

On a cover screen narrower than 560px a sealed number never gets past its
last four digits, and there is no reveal button. Unfolding is the gesture
that asks for the rest.

## Copies

**Endpapers → Copies.**

| Action | What it does |
| --- | --- |
| **Save a copy** | A `.json` file with everything: accounts and their readings, pots, settings and the sealed blobs. This is the one to keep. |
| **Restore from a copy** | Replaces everything with a copy. It shows what's in the file first and offers to save the current book before replacing it. Damaged records are skipped and counted, never restored half-broken. |

A copy carries the sealed blobs as they are, so restoring needs the same
passphrase. Older copies still restore — and collections this version no
longer reads travel through untouched, so an upgrade can never be the thing
that loses you your history.

The book asks for a copy when there are changes that haven't been saved for a
while (two weeks by default, adjustable).

## On a folding phone

The hinge is not something this book survives; it is the reason it looks the
way it does. Chrome reports the two halves only while the phone is *half*
folded, so opened flat or closed it uses the layout that fits the screen.

| How you're holding it | What you get |
| --- | --- |
| Closed (cover screen) | One column, chapters at the bottom in thumb reach. Sealed numbers never show past their last four. |
| Half folded, hinge top to bottom (book) | The crease *is* the spine. The chapter sits on the left leaf, whatever you picked out of it opens on the right one, and a sheet opens on the facing leaf. Nothing is ever printed across the fold. |
| Half folded, hinge left to right (tabletop) | What you touch takes the half lying flat; the reading stays upright above the crease. |
| Opened flat | A two-page spread with a spine between the pages. |

What you had picked survives folding, because it lives in the app's state
rather than in the layout.

One thing that isn't possible: showing something on the cover screen while
the phone is open. Android only gives an app the display it's running on, and
there's no web API for the second one.

## Keyboard shortcuts (desktop)

| Key | Action |
| --- | --- |
| `1` `2` `3` `4` `5` | The Fund, Pots, Accounts, Review, Endpapers |
| `N` | New account or new pot, depending on the chapter |
| `Ctrl`/`⌘` + `Enter` | Save the open sheet |
| `Esc` | Close the open sheet |

## Tests

```sh
npm test               # 129 unit tests, no install needed
npm run test:browser   # 5 browser test files (needs Playwright, see below)
```

**Unit tests** (`tests/*.test.js`) cover the money math and data handling:

- totals, weighted yield, reconciling pots against balances, stale readings
- pot progress, shares of the surplus, compounding, milestones and runway
- the quarterly review checklist
- exact cents from the feed's decimal strings, shares and prices as scaled
  integers, and the multiplication that turns them into money
- validation and backup round trips, including damaged files
- the offline file list, and HTML escaping of user text

**Browser tests** (`tests/browser/`) drive the real app in Chromium at phone,
Fold and laptop sizes, including both folded postures:

- `fund.cjs` — accounts, pots, readings, the surplus and the review
- `strongbox.cjs` — that sealed plaintext is in neither the page nor storage
- `book.cjs` — the spread, the crease, sheets on the facing leaf, safe areas,
  and a sweep for clipping and overflow at every size
- `holdings.cjs` — writing in holdings, pricing the book, and the two things
  that must not happen: a holding silently counted as nothing, and a
  half-priced account filed as a reading. The feed is stubbed throughout
- `zz-audit.cjs` — a layout audit over every chapter

They also fail on any browser console error, or if a page becomes wider than
the screen.

To run them once:

```sh
npm install
npx playwright install chromium
npm run test:browser
```

Screenshots go to a `tally-shots` folder in your system's temp directory, or
to `SHOTS_DIR` if set.

## Project layout

```
index.html              App shell
manifest.webmanifest    Install metadata
sw.js                   Offline cache (bump VERSION on every release)
css/app.css             All styles, light and dark
fonts/                  Public Sans (SIL Open Font License, see OFL.txt)
icons/                  App icons
js/
  app.js                The book shell, router, shortcuts, theme, page turns
  store.js              App state; every change goes through here, saved first
  storage.js            IndexedDB / localStorage / memory
  vault.js              The strongbox: the only place that encrypts
  link.js               The only place that makes a network request
  core/                 Pure logic, no browser and no locale (unit tested)
    money.js            Parsing and formatting amounts
    dates.js            Calendar dates
    plans.js            Pots: progress, shares, yield, milestones, runway
    fund.js             Accounts: totals, yield, reconciliation, history
    advisor.js          The quarterly review as a checklist
    holdings.js         Positions, prices, and what they are worth
    validate.js         Record checks and backup parsing
    defaults.js         The one shape a record has, the palette, settings
  ui/                   Templating, sheets and toasts, charts, formatting
  views/                One file per chapter, plus the sheets
scripts/
  serve.js              Local server (npm start)
  build-single-file.js  Builds dist/tally.html
  browser-test.js       Runs the browser tests
tests/                  Unit tests; tests/browser holds the browser tests
dist/tally.html         The single-file build
```

## Technical choices

- **No framework and no build step.** Plain JavaScript modules load directly
  in the browser. There are no runtime dependencies, so nothing needs
  updating.
- **Money is whole cents,** never a decimal fraction, so sums are exact. A
  price arrives as a decimal string and becomes a scaled integer, multiplied
  in BigInt, so no float ever touches a figure.
- **Percentages are basis points.** A share of 4.25% is stored as 425, and
  the shares are floored so they can never claim more than the surplus.
- **Dates are calendar dates** (`2026-09-23`) calculated in UTC, so a
  daylight-saving change can't move a reading to another day.
- **Charts are hand-written SVG,** with a hidden data table for screen
  readers.
- **All user text is escaped** before it's shown, so a note can never inject
  markup.
- **Changing the currency only changes the symbol.** Amounts are not
  converted, and there's one currency per book.
