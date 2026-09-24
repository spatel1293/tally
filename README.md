# Tally

A book for a wealth fund, kept in your browser. It holds what the fund is
worth, what it is for, and where it sits — and nothing else. There is no
spending to log: what comes in and what goes out each month are two figures
you write in once, and everything else follows from them.

No backend of mine and no account to sign into. Account numbers and logins
are sealed with a passphrase that is never stored anywhere. Nothing leaves the
device unless you export it — or unless you connect a bridge, which you run,
and which only ever reports balances.

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
  strongbox and the bridge.

Balances are *stated*, not derived. You read a statement and write the figure
in, and every earlier reading stays on record — or you connect a bridge and
the figures are read for you.

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

Open the HTTPS address in Chrome, then **⋮ → Add to Home screen**. After that
it opens like any other app and works with no connection.

### Shipping an update

Bump `VERSION` in `sw.js` and `APP_VERSION` in `js/core/defaults.js` together,
then upload. Open devices pick the new version up on their next launch.

## Connecting a bridge

Balances can be read for you instead of typed in, for **£0/$0**, using
[Teller](https://teller.io)'s free tier — its "development" environment talks
to real banks, is never billed, and allows up to 100 sign-ins.

It costs a little setup instead of money. Teller requires a **client
certificate** on every request, and a browser cannot present one — Teller also
says a private key must never be shipped inside an app, and serves no CORS
headers at all. So the certificate lives in a small program you run, called
the **bridge**:

```
your bank  →  Teller  →  your bridge  →  this device
```

Nothing of mine sits anywhere on that path. The bridge is one file,
`scripts/teller-proxy.js`, with no dependencies. It holds your certificate and
nothing else: no token, no balance, no history.

### Setting it up

1. **Sign up at [teller.io](https://teller.io)** — free, no card. It gives you
   an **application id** (`app_…`) and downloads **`teller.zip`**, which holds
   `certificate.pem` and `private_key.pem`. Keep those two files private.
2. **Start the bridge**, pointing it at them:

   ```sh
   TELLER_APP_ID=app_xxxxx \
   TELLER_CERT=./teller/certificate.pem \
   TELLER_KEY=./teller/private_key.pem \
   npm run bridge
   ```

   It prints the address it is running on.
3. **Open that address in a browser** and press *Sign in to a bank*. This page
   — not Tally — runs Teller's sign-in. Do it once per institution.
4. **Copy the line it gives you**, open Tally, and go to **Endpapers →
   Connections → Connect a bridge**. Paste it and open the strongbox when
   asked.
5. **Accounts** then lists what the bridge offers. Write in the ones you want
   the book to follow, and leave the rest.
6. Press **Read balances** whenever you like.

The bridge only needs to be running when you read balances. The rest of the
book works with no connection at all.

### Where to run it

| Where | Good for |
| --- | --- |
| **Your laptop** | Simplest. `npm run bridge`, read balances, stop it. Works on the phone too while both are on the same Wi-Fi — use the machine's LAN address. |
| **A Raspberry Pi or always-on machine at home** | Read balances from the phone any time you're home. |
| **A free host tier** | Read balances from anywhere. It needs to serve HTTPS and let you store two files, and you must be comfortable putting the certificate there. |

Over a network it must be **https**. Tally refuses a plain-http bridge unless
it is on the same machine (`localhost`), because the token would otherwise be
readable on the way.

### Settings

All through the environment:

| Variable | Meaning |
| --- | --- |
| `TELLER_APP_ID` | Required. From your Teller dashboard. |
| `TELLER_CERT` | Required. Path to `certificate.pem`. |
| `TELLER_KEY` | Required. Path to `private_key.pem`. |
| `TELLER_ENV` | `development` (the default: free, real banks, not billed), `sandbox` (fake banks, to try it out) or `production`. |
| `PORT` | Default 7000. |
| `HOST` | Default `0.0.0.0`, so your phone can reach it on the LAN. |
| `ALLOW_ORIGIN` | Default `*`. Set it to Tally's address to be stricter. |

Try `TELLER_ENV=sandbox` first if you want to see the whole thing work
without involving a real bank.

### What this does and does not do

- **Only the balance and the date it was read** are ever taken from the
  bridge. The name you gave an account, the job you gave it, the rate you
  wrote down and the pots kept in it stay yours — a bank renaming an account
  will not rewrite your book.
- **A balance that hasn't moved is not a new reading**, so reading twice in a
  day doesn't fill the history with identical entries.
- **Transactions are never requested.** The bridge asks Teller for the
  `balance` product only, so Teller never even grants access to what you
  spent. This app does not log spending and does not want the data.
- **A credit card is written in as money owed.** Teller reports a card's
  balance as a positive figure; the book negates it, so linking a card lowers
  the fund by what you owe rather than inflating it.
- **The token is the credential**, so it is sealed in the strongbox. Reading
  balances only works while the strongbox is open. The token is useless
  without the certificate and the certificate is useless without the token —
  they are deliberately kept in different places.
- **Disconnecting** forgets the token. Every balance it ever read stays in the
  book. To revoke access for good, do that in your Teller dashboard.

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
bridge's address are encrypted with AES-GCM under a key derived from your
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
- exact cents from the bridge's decimal strings, and what a sync may and may
  not change
- validation and backup round trips, including damaged files
- the offline file list, and HTML escaping of user text

**Browser tests** (`tests/browser/`) drive the real app in Chromium at phone,
Fold and laptop sizes, including both folded postures:

- `fund.cjs` — accounts, pots, readings, the surplus and the review
- `strongbox.cjs` — that sealed plaintext is in neither the page nor storage
- `book.cjs` — the spread, the crease, sheets on the facing leaf, safe areas,
  and a sweep for clipping and overflow at every size
- `bridge.cjs` — connecting, reading, adopting and disconnecting a bridge,
  against a stubbed one; no real bridge, Teller account or money involved
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
    link.js             Reading a bridge's figures, exactly
    validate.js         Record checks and backup parsing
    defaults.js         The one shape a record has, the palette, settings
  ui/                   Templating, sheets and toasts, charts, formatting
  views/                One file per chapter, plus the sheets
scripts/
  serve.js              Local server (npm start)
  build-single-file.js  Builds dist/tally.html
  browser-test.js       Runs the browser tests
  teller-proxy.js       The bridge: holds your Teller certificate (npm run bridge)
tests/                  Unit tests; tests/browser holds the browser tests
dist/tally.html         The single-file build
```

## Technical choices

- **No framework and no build step.** Plain JavaScript modules load directly
  in the browser. There are no runtime dependencies, so nothing needs
  updating.
- **Money is whole cents,** never a decimal fraction, so sums are exact. A
  balance read from a bridge arrives as a decimal string and is converted with
  integer arithmetic, so no float ever touches it.
- **Percentages are basis points.** A share of 4.25% is stored as 425, and
  the shares are floored so they can never claim more than the surplus.
- **Dates are calendar dates** (`2026-09-23`) calculated in UTC, so a
  daylight-saving change can't move a reading to another day.
- **Charts are hand-written SVG,** with a hidden data table for screen
  readers.
- **All user text is escaped** before it's shown, so a note can never inject
  markup.
- **Changing the currency only changes the symbol.** Amounts are not
  converted, and there's one currency per book. An account a bridge reports in
  another currency is refused rather than mixed in.
