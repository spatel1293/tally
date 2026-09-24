# Tally: notes for Claude

Tally is a **wealth-fund book**: an installable PWA that keeps what the fund
is worth, what it is for, and where it sits. It began as a budgeting app and
was refocused twice — in September 2026 the owner removed spending entirely.
**There is no transaction logging in this app.** No transactions, no
categories, no budgets, no repeating items, no CSV. If a change starts by
adding any of those back, it is the wrong change.

What it does keep:

- **Accounts** — institution, the job each account does, what it pays,
  whether the login has a second step, when it was last reviewed, a stated
  balance with every earlier reading kept, and the account number and login
  **sealed with a passphrase** in the strongbox. A balance is stated by hand,
  or read from a bridge the owner connected (see below); either way it is a
  dated reading, never a derived figure.
- **Pots** — a safety net, nest eggs, trips and investments, each with a
  target, a share of the monthly surplus and a yield.
- **The figures** — what comes in and what goes out each month are *stated*
  in the endpapers, not derived from a ledger. The surplus is the difference.
- **The review** — the quarterly look-over as a computed checklist.

Its home is a **Google Pixel Fold (first generation, 2023)** and a **laptop**,
and the Fold is the device to design for when the two disagree.

## Commands

- `npm start`: local server on http://localhost:5173. It also prints a LAN address for the phone; that address is plain HTTP, so install and offline mode won't work there, but layouts will.
- `npm test`: 129 unit tests with Node's built-in runner. No install needed.
- `npm run test:browser`: 5 Playwright test files (`fund`, `strongbox`, `book`, `bridge`, `zz-audit`) at phone, Fold and laptop sizes, including both folded postures. `bridge` stubs the bridge with `page.route()`, so it never touches a real one or a Teller account. Needs `npm install` and `npx playwright install chromium` once. It builds `dist/` first.
- `npm run build`: rebuilds `dist/tally.html`, the single-file version.
- `npm run bridge`: runs `scripts/teller-proxy.js`, the bridge. Needs
  `TELLER_APP_ID`, `TELLER_CERT` and `TELLER_KEY`. Not part of the app and not
  precached — it runs on the owner's machine, not in the browser.

Run `npm test` and `npm run test:browser` before saying something works. If the browser tests can't run in this environment, say so plainly.

## Architecture

There is no framework and no build step. Plain ES modules load directly in the browser, and there are no runtime dependencies.

- `js/core/`: pure logic with no DOM or browser globals, all unit tested.
  - `money.js`, `dates.js`
  - `plans.js` — the pots: progress, shares of the surplus (`allocate`),
    yield (`growMonthly`, `projectGrowth`), the five-year table
    (`milestones`), `runway`, and the projection engine.
  - `fund.js` — the accounts: totals, weighted yield, reconciliation of pots
    against balances, the history of readings, what has gone stale.
  - `advisor.js` — the quarterly review as a computed checklist. Takes a
    `money` formatter as an argument so core stays free of locale.
  - `link.js` — reading a bridge: exact cents from decimal strings, decoding
    the line the bridge hands out, mapping Teller's account types, and
    `planSync()`, which decides what a sync may change.
  - `defaults.js` — `newAccount()` is the one shape an account has;
    `validate.js` sanitises and parses backups.
- `js/link.js`: the bridge. The only file in the app that makes a network
  request, and it only ever asks the owner's bridge for balances. Browser-only,
  so outside `core/`.
- `js/vault.js`: the strongbox. AES-GCM under a PBKDF2 key (300k rounds)
  from a passphrase that is never stored. Browser-only, so outside `core/`.
- `js/storage.js`: IndexedDB, falling back to localStorage, then memory.
- `js/store.js`: the `state` object and every mutation. Writes to storage
  first, then updates state and calls `emit()`.
- `js/ui/`: `html.js` (the escaping `html``` tag), `overlay.js` (sheets,
  confirm dialogs with an async `validate` hook, toasts), `charts.js`
  (`inkRing`, `progressRule`, `ruledBars`), `format.js`.
- `js/views/`: one file per chapter — `fund.js`, `pots.js`, `ledger.js`,
  `review.js`, `settings.js` — plus `chrome.js` (shared furniture: chapter
  heads, ruled rows, display figures, the icon set, and the `ui` selection
  state) and `forms.js` (every sheet).
- `js/app.js`: hash router over five chapters, the book shell, the facing
  page, `data-action` click delegation, keyboard, paper theme, service worker.
- `css/app.css`: all styles.
- `sw.js`: precaches every shipped file.
- `scripts/`: `serve.js`, `build-single-file.js`, `browser-test.js`, and
  `teller-proxy.js` — the bridge, which runs on the owner's machine rather
  than shipping with the app, so it is not in `sw.js`'s `FILES`.

## Rules that must not break

1. **Money is integer cents.** Never use floats for amounts. Parse with `parseAmount`, display with `money()`/`formatMoney`. The maximum is `MAX_CENTS`.
2. **Percentages are integer basis points.** A pot's share (`allocBp`) and
   yield (`apyBp`) are hundredths of a percent: 425 is 4.25%. `allocate()`
   floors each share so the shares can never claim more than the surplus, and
   reports the remainder as unallocated rather than losing it.
3. **Dates are `'YYYY-MM-DD'` strings.** Use the helpers in `core/dates.js`, which calculate in UTC. "Today" is `state.today`.
4. **Write first.** Every change goes through `store.js`, which commits to storage before touching `state`. Views never write to storage directly.
5. **Escape everything.** Build markup only with `html``` . `raw()` is only for SVG the app generates itself.
6. **Keep `js/core` browser-free** — including free of the locale: `advisorReview` takes a `money` formatter rather than importing one. Add or adjust unit tests for any change there.
7. **Nothing sensitive is ever stored in the clear.** Account numbers,
   routing numbers, usernames and passwords exist only as ciphertext in the
   `vault` blob. The passphrase is never stored, the key lives in memory, and
   the strongbox shuts on a timer and whenever the page is hidden. A browser
   test asserts the plaintext is in neither the DOM nor IndexedDB. `js/vault.js`
   is the only place that encrypts or decrypts.
8. **The newest reading is what an account is worth.** `recordBalance()`
   files a backdated reading under its own date and leaves the current figure
   alone. One reading per day; a second on the same date corrects the first.
9. **A record written today and one restored from a backup must be identical.**
   `newAccount()` is the one shape; `saveGoal` does the same for pots. Skip it
   and a backup round trip silently changes the data.
10. **Service worker:** when a shipped file is added, removed or renamed, update `FILES` in `sw.js` (a unit test enforces this). Bump `VERSION` in `sw.js` and `APP_VERSION` in `core/defaults.js` together on every change that ships.
11. **Backups carry what this version doesn't read.** `BACKUP_FORMAT` is in
    `core/defaults.js`. Older backups still restore, and the collections
    version 5 dropped (transactions, categories, repeating items) travel
    through in `archive`, untouched, so an upgrade can never be the thing
    that loses someone their history.
12. **Single-file bundler limits.** Single-line `import { a, b as c } from './x.js';` and `export function|const|let|class` only. No default exports, dynamic imports or import cycles. Run `npm run build` after source changes.
13. **Privacy by default.** No analytics, no AI; fonts self-hosted, and the
    book face is whichever serif the device already has. Anything that leaves
    the device must be the owner's explicit choice. There is **exactly one**
    runtime request the app can make, and it is that choice: reading balances
    from a bridge the owner runs themselves (rule 15). No other third party is
    ever contacted — not even Teller, which the bridge talks to on the app's
    behalf. Don't add a second one.
14. **UI copy** is the book's voice: plain, active, unhurried. Things are
    "written in", not "saved"; the strongbox is "shut", not "locked out".
    Error messages say what to do next.
15. **The bridge is the owner's, not ours.** Account connectivity is Teller's
    **free tier** (`TELLER_ENV=development`: real banks, never billed, 100
    enrolments), reached through `scripts/teller-proxy.js` — a bridge the
    owner runs. The owner chose free over serverless in September 2026, having
    previously chosen SimpleFIN; **don't quietly reintroduce a paid service.**
    - **Why a bridge exists at all**, so nobody tries to delete it: Teller
      requires a client certificate on every request (mTLS), which a browser
      cannot present and which Teller forbids shipping inside an app; and
      `api.teller.io` serves **no CORS headers** and 404s on `OPTIONS`. Both
      were verified against the live API. There is no browser-only path.
    - `js/link.js` is the only file that makes a network request, and it only
      ever talks to the owner's bridge — **never to `api.teller.io`**, which a
      browser test asserts. `js/core/link.js` is the only file that interprets
      what comes back.
    - The access token lives sealed in the vault (rule 7) and a read only
      works while the strongbox is open. The token is useless without the
      certificate and vice versa — keep them in different places.
    - The bridge asks Teller for the **`balance` product only**, so Teller
      never grants access to transactions. This app does not log spending and
      must never ask for it.
    - A sync may change **only** the balance and its date. Name, role, rate,
      pots and sealed details are the owner's; a bank renaming an account must
      not rewrite the book. `planSync()` enforces this and a unit test pins the
      shape.
    - A balance that hasn't moved is not a new reading (rule 8 still holds).
      Teller's balances are live, so a reading is dated `state.today`.
    - **A credit card is money owed.** Teller reports it positive and
      `fundTotal()` simply adds balances up, so `balanceFromTeller()` negates
      it. Undo that and linking a card silently inflates the fund.
    - Money arrives as a decimal string and becomes cents through integer
      arithmetic (`centsFromDecimalString`). Never `parseFloat` it.
    - Over a network the bridge must be https; plain http is allowed only on
      `localhost`, or the token travels in the clear. `parseBase()` enforces it.

## Design

**A real book**, adopted September 2026 at the owner's request, replacing the
Apple-system look before it. Take the reference literally: this is a printed
ledger, not "clean and minimal with a serif". Earlier rounds — the flat quiet
ledger, the indigo/violet one, the neo-brutalist ink-and-paper one, the liquid
glass one — are all retired. Don't go back to any of them, and note that the
old "colour only means money" and "one accent hue" rules went with them.

- **It is paper.** Warm, low-contrast, slightly uneven: two very large faint
  washes under everything, drifting slowly, **and a tooth over the top** —
  fine fibre grain with a coarser mottle, both `feTurbulence` the app draws
  itself into two data URIs (`.book::after`, `--tooth`). It multiplies into
  the sheet by day and soft-lights the board at night. Never black on white
  or white on black. Night mode is a dark board with the same warm ink
  reversed out.
- **It is imposed.** From 820px the two text blocks are mirrored: each sits
  snug against the gutter with a wide margin at the fore-edge, so an opening
  reads as one thing with a fold down it rather than two columns. The left
  page's block is pushed right (`.leaf:not(.recto) > *`); the facing page is
  `class="leaf recto"`, so **any `.leaf` rule hits it too** — mirror it
  deliberately rather than by accident.
- **Two sets of figures, never mixed.** Old-style (`oldstyle-nums`) in
  running prose, where numerals sit in the line like lowercase; lining
  tabular in anything that forms a column, so decimal points stack. The
  distinction is what makes the text read as set rather than typed.
- **Ornaments are drawn, not typed.** `fleuron()` in `chrome.js` is SVG
  because a dingbat character (❧, ❦) gets substituted by an emoji font on
  some devices. It closes every chapter opening and the colophon.
- **The endpapers are marbled** — two combs of thinned ink under the grain,
  scoped by `:root[data-chapter='settings']`, because that is what the inside
  of a bound cover looks like.
- **Controls are printed, not chromed.** A field is a ruled line you write on
  with an ink stroke drawn under it on focus — not a filled well. A choice is
  a strip of options along a rule with the one in force underlined in full
  ink — not a track with a sliding thumb.
- **It is set in a book face.** `--book` is the best serif the device already
  ships (Iowan Old Style, Palatino, Georgia, Noto Serif). `--hand` (Public
  Sans) is only for small caps and labels — the printed equivalent of a
  different case, not a different voice. Display figures are lining tabular
  numerals so columns line up.
- **Rules, not borders.** Rows are separated by printer's hairlines; a
  sidehead's rule runs from the heading to the end of the measure; a name is
  joined to its figure by leader dots (`.ruled-row`). No cards, no panels, no
  shadows around content.
- **It is a spread.** From 820px there are two pages with a spine between
  them. The left page is what you are reading, the right is what you picked
  out of it. `ui.selectedPlan` / `ui.selectedAccount` hold the choice.
- **It is bound.** Chapters are cut into the edge as a thumb index, a ribbon
  hangs at the chapter you are on, the running head carries the chapter and
  the fund's total once the opening has scrolled away, and the folio only
  appears where there is a margin to put it in (a pointing device).
- **Turning a page turns it.** The leaf lifts at the spine and falls the
  other way, through the View Transitions API. Only `main` is named, so the
  index, ribbon and facing page stay put.
- **Colour is ink.** `PALETTE` in `core/defaults.js` is bookbinding inks, and
  a pot's colour runs through its mark, its rule and its ring. Three inks
  mean money — `--covered`, `--thin`, `--short` — and `--accent` is the
  binding. No bright red or green in the palette, so a pot's colour is never
  mistaken for a verdict.
- **Avoid:** cards with shadows, pill-shaped "chips" of colour, gradients as
  decoration, emoji as interface (a pot's mark is the one exception, and it
  sits in a ruled circle), and anything that reads as a dashboard.

### What the Fold gets that nothing else does

The hinge is not a compatibility problem to survive; it is the reason the
book looks the way it does. Each of these is real behaviour:

- **Book posture is the book.** The crease *is* the spine: `.spine` is
  positioned with `env(viewport-segment-*)` so the gutter shadow falls into
  the hinge, the chapter sits on the left leaf and the thing you picked opens
  on the right one. Nothing is ever printed across the fold, and a sheet
  opens on the facing leaf.
- **Tabletop puts what you touch on the half lying flat.** The sheet takes
  the lower segment; the reading stays upright above the crease.
- **The cover screen will not show a secret in full.** Under 560px the reveal
  button is gone and a sealed number never gets past its last four.
  Unfolding is the gesture that asks for the rest.
- **The strongbox shuts when the phone is pocketed** (`visibilitychange`).
- **The index stays in the hand.** On any touch screen the chapters are at
  the bottom; only a pointing device gets them on the fore-edge.
- **The choice survives the fold**, because it lives in `ui`, not in the
  layout.

### The facing page

`<aside class="recto">` is one page with three homes: a sticky column from
820px, the right-hand leaf in book posture, and folded away below that —
where what it carries opens inline instead (`[data-inline-detail]`), so
nothing is reachable only on a wide screen. `renderFacing()` in `app.js`
paints it unconditionally and lets CSS decide when it is on screen; don't
add a posture check there, or it goes blank on the laptop. **Wherever the
facing page is showing, the inline copy is hidden** — printing the same
thing twice on one spread is the mistake a second page exists to avoid.

### Motion

- **Nothing snaps.** `--turn` is the page curve and `--settle` a real spring.
- **Ink behaves like ink.** A button is a stamp pressed into the sheet: it
  sinks 1px with an inset shadow and bleeds outward from the centre, and it
  never scales, because paper does not scale.
- **A page is set a line at a time.** Ruled rows cascade in on arrival rather
  than appearing at once, and a chapter's ornamented rule draws outward from
  its fleuron.
- **The ribbon answers the turn.** Its endless sway is replaced for the
  length of a page turn by a kick that settles back into it.
- Figures are *written*: `ink-in` wipes a display figure left to right by
  clip-path, never by counting, so the number on screen is always the real
  one and a test can read it at any moment. Rings draw round, rules fill
  across, columns grow from the baseline.
- **Some of it never stops.** The paper grain drifts, the ribbon sways, and
  a fleck of light orbits each ring. All slow, none of it on anything being
  read, all of it stopped by the reduced-motion block at the end of the file.
- **Theme:** set on `<html data-theme>` by `app.js` and by an inline script
  in `index.html` before first paint.
- **Review your work visually.** Screenshots of every chapter at cover,
  opened-flat and laptop sizes, light and dark, before calling anything done.

## Gotchas already hit (don't repeat them)

- **Unshrinkable grid and flex items.** Children containing `nowrap` text need `min-width: 0` or `minmax(0, 1fr)`, or one long name widens the page. `book.cjs` checks for horizontal overflow at every size and in both postures.
- **Hidden tables widen the page.** Wrap visually hidden (`.sr-only`) tables in a `div.sr-only`.
- **Toasts vs. modal dialogs.** A modal `<dialog>` sits in the top layer, so toasts must go inside the open dialog. `overlay.js` (`toastHost`) handles it, deferred with `queueMicrotask`.
- **Playwright waits:** a closed dialog is hidden, so wait with `waitForSelector('dialog#sheet[open]', { state: 'detached' })`.
- **A toast over a control blocks the next click.** Clear them between steps (`document.querySelectorAll('.toast').forEach(t => t.remove())`) rather than waiting them out.
- **Emulating a fold in Playwright.** Postures come from `Emulation.setDeviceMetricsOverride` with a `displayFeature` (via `context.newCDPSession`). **Both `page.screenshot()` and `page.click()` re-apply Playwright's own device metrics and silently unfold the phone** — capture with `Page.captureScreenshot` through CDP, and dispatch clicks in the page (`page.$eval(sel, el => el.click())`) while folded. This cost an hour: the symptom is a sheet that centres itself instead of taking the facing leaf.
- **Measuring geometry races the entrance animation.** A panel still scaling up reports its mid-flight box, which looks exactly like a layout bug. Await `el.getAnimations({ subtree: true })` finishing first; `book.cjs` has the helper.
- **Viewport segment indices are (x, y).** Side by side (book) the second segment is `env(… 1 0)`; stacked (tabletop) it's `env(… 0 1)`. The wrong pair silently falls back, which looks like a layout bug.
- **`color-mix()` percentages above 100% are invalid** and take the whole declaration with them. The spine's gutter went invisible that way; use an explicit token (`--gutter`) instead of trying to darken `--shade` past 100%.
- **Safe-area insets only bite on the device.** A laptop reports zero, so anything that forgets them looks perfect in every emulator and collides with the status bar on the Fold. `book.cjs` redefines `--safe-t`/`--safe-b` with a `<style>` tag after load — the only way to reproduce an inset in Chromium.
- **Claim both view-transition promises.** `startViewTransition()` returns `ready` as well as `finished`; a second turn starting before the first settles rejects `ready`, and an unclaimed rejection is reported as a page error.
- **Android's "Remove animations" setting reports `prefers-reduced-motion: reduce`**, which switches off every animation here. If the paper looks static on the phone but moves in the browser, check that setting before changing code.
- **Don't assume an aggregator needs (or doesn't need) a server — probe it.**
  One `curl` settled the architecture twice here. `api.teller.io` answers every
  request with `Missing certificate` and sends no CORS headers at all, which is
  why the bridge exists; SimpleFIN, by contrast, answered a browser directly.
  Check before designing.
- **Teller's balances are a second request per account.** `GET /accounts` does
  not include them; each needs `GET /accounts/:id/balances`. The bridge fans
  out and joins them so the phone makes one request however many accounts
  there are — don't move that work into the app.
- **A browser won't fetch a URL with credentials in it.** If a service hands
  out `https://user:pass@host/…`, split the userinfo out and send it as a
  Basic `Authorization` header instead.
- **`section()`'s `id` goes on the `<h2>`, not the `<section>`.** To address a
  whole section in a test, use `[aria-labelledby="…"]`. Getting this wrong
  makes assertions read only the heading and pass or fail for the wrong reason.
- **`ui` state doesn't survive a reload.** The list of accounts a bridge
  offers lives in `ui.offered`, so a browser test must change chapters with
  `location.hash`, not `page.goto`.
- **Early returns hide new furniture.** The Accounts chapter returns an empty
  page when there are no accounts; the bridge and its offered list had to be
  lifted into that branch, or connecting a bridge to a fresh book led nowhere.
  Check both branches when adding anything to a chapter.
- **A failed container-query unit takes the whole declaration with it.**
  `.ink-ring` was `width: clamp(104px, 30cqi, 150px)`; when the `cqi` failed
  to resolve the width fell back to `auto` and the ring grew to fill the page
  — worst on Review, at every screen size, and it had been shipping that way.
  Back any `cq`-based size with a plain `max-width`. Same family of bug as
  the `color-mix()` over 100% one below.
- **Never put `overflow: hidden` on `.btn`.** A coarse pointer gets an
  invisible 44px tap pad through `.btn.small::after`, and clipping the button
  clips the pad back to the size of the ink — silently shrinking every small
  touch target. Contain effects by sizing them inside the box instead. The
  layout audit catches this, which is what it is for.
- **The ribbon sways, so its box moves.** It hangs in the outer margin, and
  on a 360px page that margin is 20px — a 12px ribbon at `left: 4px` left
  only 4px of air, and the sway spent it, colliding with the chapter title
  intermittently. Leave real clearance and keep the rotation small.
- **`pkill -f`:** never use it with a pattern that also appears in your own shell command; it kills the shell.
- **German number format** puts a non-breaking space before `€`. Normalise whitespace in assertions.

## Working with the owner

- **Commits:** make small commits with clear messages. The first commit, "Tally 1.0.0 baseline", is the finished and tested app; the next one adds these handoff notes.
- **Ask first** before adding dependencies, a backend or hosted service, or anything that sends data off the device.
- **Device steps:** explain phone and laptop steps (installing, USB debugging, hosting setup) step by step, without assuming Android developer experience.
