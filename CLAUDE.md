# Tally: notes for Claude

Tally is a personal budgeting web app (installable PWA) that runs entirely in the browser: no backend, no accounts, no AI. Version 1.0.0 is complete and tested. The owner now wants it set up as their app on a **Google Pixel Fold (first generation, 2023)** and their **laptop**.

- Current task, including questions to ask the owner before starting: @docs/HANDOFF-pixel-fold-and-laptop.md
- Original requirements (still apply): @docs/ORIGINAL-BRIEF.md
- Features, storage, backups, CSV format and project layout: see `README.md`

## Commands

- `npm start`: local server on http://localhost:5173. It also prints a LAN address for the phone; that address is plain HTTP, so install and offline mode won't work there, but layouts will.
- `npm test`: 108 unit tests with Node's built-in runner. No install needed.
- `npm run test:browser`: 7 Playwright test files at phone and laptop sizes. Needs `npm install` and `npx playwright install chromium` once. It builds `dist/` first.
- `npm run build`: rebuilds `dist/tally.html`, the single-file version.

Run `npm test` and `npm run test:browser` before saying something works. If the browser tests can't run in this environment, say so plainly.

## Architecture

There is no framework and no build step. Plain ES modules load directly in the browser, and there are no runtime dependencies.

- `js/core/`: pure logic with no DOM or browser globals, all unit tested.
  - `money.js`, `dates.js`, `stats.js` (totals, budgets, balances, search, year review)
  - `plans.js` (nest eggs, trips, surplus and projections)
  - `recurring.js`, `csv.js`, `validate.js` (forms and backup parsing), `defaults.js`
- `js/storage.js`: IndexedDB, falling back to localStorage, then memory. Also holds drafts, which are saved synchronously.
- `js/store.js`: the `state` object and every mutation. It writes to storage first, then updates state and calls `emit()`. BroadcastChannel keeps tabs in sync.
- `js/ui/`:
  - `html.js`: the escaping `html\`\`` template tag
  - `overlay.js`: sheets, confirm dialog, toasts
  - `charts.js`: hand-written SVG charts
  - `format.js`: money and date display
- `js/views/`: one file per screen, plus `txForm.js` (add/edit transaction) and `forms.js` (everything else).
- `js/app.js`: hash router, shell (sidebar and tab bar), `data-action` click delegation, keyboard shortcuts, theme, service worker registration.
- `css/app.css`: all styles.
  - Tokens live on `:root` and are overridden in `:root[data-theme='dark']`.
  - Breakpoints: sheets become centered dialogs at ≥640px; at ≥600px the content lifts onto its own canvas and the tab-bar capsule moves from the bottom of the screen into the toolbar (icons only, with the compact title beside it and an add button opposite); **the second page appears at ≥820px** (the Pixel Fold opened flat); the capsule gives way to a labelled sidebar at ≥1120px; the dashboard goes two-column at 760–819px and again at ≥1180px — in between, the second page has the width instead.
  - Radii come from `--r-sm/--r/--r-lg/--r-screen` and *change with the breakpoint*, so don't hardcode a corner value.
  - The liquid-glass material is `--glass*` plus the `.glass` class; every floating piece of chrome uses it.
- `sw.js`: precaches every shipped file.
- `scripts/`: `serve.js` (dev server), `build-single-file.js` (a small bundler), `browser-test.js`.

## Rules that must not break

1. **Money is integer cents.** Never use floats for amounts. Parse with `parseAmount`, display with `money()`/`formatMoney`. The maximum is `MAX_CENTS`.
2. **Dates are `'YYYY-MM-DD'` strings.** Use the helpers in `core/dates.js`, which calculate in UTC. Don't use `new Date('2026-09-16')` for calendar logic. "Today" is `state.today` (the local calendar date).
3. **Write first.** Every data change goes through `store.js`, which commits to storage before touching `state`. Views never write to storage directly. If a write fails, the user's input stays on screen with a plain-language error.
4. **Escape everything.** Build markup only with `html\`\``. Never put user text into `innerHTML` directly. `raw()` is only for SVG the app generates itself.
5. **Keep `js/core` browser-free** and add or adjust unit tests for any change there.
6. **Service worker:** when a shipped file is added, removed or renamed, update `FILES` in `sw.js` (a unit test enforces this). Bump `VERSION` in `sw.js` on every change that ships, and `APP_VERSION` in `core/defaults.js` with it — a test keeps the two in step, because the version in Settings is how someone tells which build a device is actually running (it matters most for hand-copied `dist/tally.html`).
7. **Single-file bundler limits.** It only understands:
   - single-line `import { a, b as c } from './x.js';`
   - `export function|const|let|class` and `export { … }`

   No default exports, dynamic imports or import cycles. Run `npm run build` after source changes; a browser test opens `dist/tally.html`.
8. **Backups:** the format number is `BACKUP_FORMAT` in `core/defaults.js`. If the stored data shape changes, bump it, keep `parseBackup` able to read older backups, and add a test.
9. **Privacy by default.** No analytics, no AI or LLM features, and no runtime requests to third parties; fonts and icons are self-hosted. Anything that sends data off the device must be the owner's explicit choice (see the handoff's sync question).
10. **UI copy** is plain, active voice, and free of jargon. Error messages say what to do next.

## Design

**What Apple would ship on a folding iPhone**, adopted September 2026 at the
owner's request, replacing the flat "quiet ledger", the indigo/violet round,
the neo-brutalist "ink and paper" round and its warm-paper successor. Don't go
back to any of them. Take the reference literally: this is the system design
language, not "clean and modern" in general.

- **The chrome is liquid glass.** Navigation floats *above* the content in
  translucent pieces that blur and saturate whatever scrolls under them, carry
  a specular rim along the lit edge, and never touch the screen edge. The
  `.glass` class and the `--glass-*` tokens are the one definition; a
  `@supports` block falls back to an opaque fill where a backdrop can't be
  blurred, so nothing is ever unreadable. The tab bar is a **capsule**, not a
  bar — never restore a full-bleed bottom bar with a top border.
- **One capsule, three homes.** `<nav class="tabbar">` is a child of
  `.topbar`, and `position: fixed` is what lets it sit at the bottom of the
  cover screen and of either folded leaf regardless of where it sits in the
  markup. From 600px it goes `position: static` and is laid out *inside* the
  toolbar, where the equal flex slots either side hold it on the centre line.
  It drops its labels there: a labelled capsule and the compact title were
  fighting over the same ~550px on the Fold opened flat, and the title is the
  one carrying something the capsule can't say — which month you are looking
  at. Because it lives in a `pointer-events: none` toolbar, the capsule sets
  `pointer-events: auto` itself, or nothing on it is clickable.
- **Type comes from `--t-*`,** the system's text styles: body is 17px and
  everything else is a step on the same ladder. Don't write a bare font-size.
- **List separators start at the text, not the edge** (`--row-inset`), drawn
  as a background on the `<li>` so no extra element is needed. Rows fill on
  press.
- **The segmented control's pill slides.** One `::before` moves between the
  options, driven by `:has()` — no script. Its `<input>` needs a z-index above
  the label text, or the text swallows the tap.
- **Corners are concentric with the hardware.** `--r-sm/--r/--r-lg/--r-screen`
  still step *down* as the viewport widens, because a folding phone's display
  is rounded far harder than a laptop window. Anything nested in a rounded
  shape takes the parent's radius minus the gap (`--r-nested` on `.panel`), so
  curves run parallel. A hardcoded `border-radius` breaks this on one device.
- **Colour is the system palette, and only ever means money.** Green in, amber
  near a limit, red over — the darker accessible variants for text, the vivid
  ones for fills. The interface itself uses one hue, system blue (`--accent`),
  and nothing else is tinted. The backup reminder is deliberately *not* amber.
- **Surfaces are a ladder, and it inverts on wide screens.** On a phone the
  page is the grouped background and cards are white. From 600px the content
  lifts onto an opaque **canvas** inset from the window with the glass rail
  beside it, so the cards step to `--surface-2` instead. That override lives at
  the very end of `css/app.css` — it has to come after `.panel`, or source
  order hands the plain rule the win.
- **Large titles hand over on scroll.** `.topbar` is invisible until the
  screen's own `h1` scrolls under it, then fades in carrying that heading's
  text (so Home's bar reads "September 2026", not "Home"). `watchPageTitle()`
  in `app.js` does this with an IntersectionObserver on the heading, not a
  scroll listener.
- **A sheet pushes the page back a step.** `overlay.js` sets `data-sheet` on
  `<html>`; CSS shrinks `.app` into a rounded card against black and drops the
  tab bar. It's switched off in both folded postures, where the sheet takes a
  whole leaf and there is nothing to push back.
- **Depth is fill plus a soft neutral shadow**, not a drawn border and not a
  stamped offset block. Buttons are capsules: tinted by default, filled for
  the one that commits, and they compress under a press.
- **The motif is the tally stroke**, kept to section headings
  (`.panel > h2::before`) and the brand mark. It is deliberately *not* on the
  tab bar any more — that marks the current page with tint and a lifted icon,
  the way the system does.
- **Links need underlines**, not colour.
- **Category colours** (`PALETTE` in `core/defaults.js`) are printer's inks for
  chart identity only, with no strong red or green, so a swatch is never
  mistaken for a signal.
- **Avoid:** cream/terracotta palettes, all-caps eyebrow labels, a separate
  card per list row, arrows in button text, and middle-dot separators.
- **A card inside a card** is the usual mistake: `.figures.compact` exists
  because that one already sits inside a `.panel`.

### Plans

Nest eggs, trips and scenario planning are deliberately **one feature**, because they are one shape at different moments: a named pot with a target and a date, that you fill over time and sometimes spend down. Don't split them into separate pages.

- Stored under the older **`goals`** name — store, state key and mutations all still say `goals`, and renaming them would mean an IndexedDB migration for no user-visible gain. `kind` (`'fund' | 'trip'`) is what separates a nest egg from a trip.
- **Setting money aside stays a counter (`saved`), not a transaction.** Moving money between your own accounts is neither income nor spending, and logging it as either would distort every total in the app.
- **Spending is what carries a `planId`.** A transaction charged to a plan draws its pot down, which is how a trip shows what it actually cost — and why a flight booked six months early still counts. Income can never carry one (`validateTransactionInput` drops it), or the same money would be counted twice.
- `js/core/plans.js` is the whole engine and is pure: `planProgress`, `monthlySurplus`, `planOrder`, `projectPlans`, `requiredMonthly`. Anything that answers "will I make it?" belongs there, with a test, not in a view.
- **The surplus comes from whole months only.** The current month is part-finished and would always look like a bad one. `typical` is the median, not the mean, so a single bonus month doesn't set the expectation for every month after it.
- Plans are funded **in date order** — soonest deadline first — because that is what would really happen; an even split would flatter every projection.
- The what-if levers (`planScenario` in `views/pages.js`) are **not persisted**: they're a question you ask, not a setting. `afterPlansMount` re-mounts only `#plan-results`, so typing doesn't rebuild the page under the cursor.

### The second page

`<aside class="companion">` is one feature with two homes, and that's the point — it is not foldable-only chrome:

- **≥820px, any device** (the Fold opened flat, a laptop window): a sticky third grid column.
- **Book posture**: the same pane, pinned to the right-hand leaf with `env(viewport-segment-*)`.
- **Anywhere narrower**: `display: none`.

It carries the month's net, in and out, what's left to spend per day, where the money actually went, and one-tap buttons to log another of whatever you buy most (`data-action="log-again"`). `renderCompanion()` in `app.js` renders it unconditionally and lets CSS decide when it's on screen — don't re-add a posture check there, or it goes blank on the laptop.

### Motion

Animation is load-bearing here, not decoration — see the `Motion` section of `css/app.css`.

- **The easings are the system's.** `--spring` and `--bounce` are real spring
  curves written as `linear()`, and `--ease` is the sheet curve
  (`cubic-bezier(0.32, 0.72, 0, 1)`) — fast to leave, long to settle. Reach for
  those rather than inventing a curve.
- **Route changes push sideways** through the View Transitions API, in the
  direction you're travelling. Only `main` is given a `view-transition-name`,
  so the rail, tab bar and second page stay live while the screen slides
  across. `app.js` sets `data-nav="forward" | "back"` on `<html>` for the
  duration. The slide is a *fraction* of the width, not a full screen, so it
  can't escape the content column on a folded phone.
- **The stagger is the fallback.** `main[data-enter]` is set only when there's no view transition to play, and only on a route change — otherwise saving a transaction replays the whole page.
- Figures wipe upward (`reveal-up`) by **masking, never by counting**, so the number on screen is always the real one and tests can read it at any moment.
- Bars, chart columns and donut segments **re-animate whenever their figures change** — that's deliberate feedback that a save landed.
- Everything animated is a transform, an opacity, a clip-path or the donut's stroke-width. Durations sit at 160–620ms with `--spring`, `--bounce` or `--ease`. The reduced-motion block at the end of the file switches all of it off, so never rely on an animation to make something readable.
- **Theme:** set on `<html data-theme>` by `app.js`, and by an inline script in `index.html` before first paint.
- **Review your work visually.** Take screenshots of changed screens at every target size, in light and dark, before calling anything done.

## Gotchas already hit (don't repeat them)

- **Hidden tables widen the page.** Visually hidden (`.sr-only`) tables still expand the layout, so wrap them in a `div.sr-only`.
- **Unshrinkable grid and flex items.** Children containing `nowrap` text need `min-width: 0` or `minmax(0, 1fr)`. Otherwise one long note widens the page on a phone, mobile Chrome zooms out, and the fixed tab bar and sheet buttons end up off-screen. `tests/browser/phone-screens.cjs` checks `scrollWidth`.
- **Toasts vs. modal dialogs.** A modal `<dialog>` sits in the top layer, so toasts must go inside the open dialog. `overlay.js` (`toastHost`) handles this, deferred with `queueMicrotask` so a sheet closing in the same step doesn't swallow the message. Only one toast shows at a time, so Undo always belongs to the latest action.
- **Closing a sheet fires `change`.** The blur re-triggers the form's listener, so `txForm.js` sets a `finished` flag to keep a saved entry from being written back as a draft.
- **Playwright waits:** a closed dialog is hidden, so wait with `waitForSelector('dialog#sheet[open]', { state: 'detached' })`.
- **German number format** puts a non-breaking space before `€`. Normalize whitespace in assertions.
- **Dates in browser tests:** steps use dates relative to today, but the CSV fixture is fixed (Sep 2025 to Sep 2026). Don't assert current-month numbers that come from fixture data.
- **`pkill -f`:** never use it with a pattern that also appears in your own shell command; it kills the shell.
- **Emulating a fold in Playwright.** Postures come from `Emulation.setDeviceMetricsOverride` with a `displayFeature` (via `context.newCDPSession`); `setDisplayFeaturesOverride` on its own is accepted but does nothing. `page.screenshot()` *clears* that override and drops the app back to flat, so capture with `Page.captureScreenshot` through CDP instead. Its captures composite the top layer oddly, so an open sheet looks see-through in them; on the device it's opaque.
- **Viewport segment indices are (x, y).** Side by side (book) the second segment is `env(… 1 0)`; stacked (tabletop) it's `env(… 0 1)`. Using the wrong pair silently falls back, which looks like a layout bug.
- **Media queries and `vw` measure the whole viewport, not one page.** In book posture the content sits in a phone-width segment while the viewport spans both halves, so `vw`-based type and `min-width` breakpoints are sized for the spread. `css/app.css` pins `.hero-line`, `.figures dd` and `.dash-grid` back to their narrow values there.
- **Measuring geometry races the entrance animation.** `boundingBox()` on something that's still springing returns the mid-flight box, not the resting one — which looks exactly like a layout bug (a sheet reading 438px instead of 441px). Await `el.getAnimations()` finishing first; `tests/browser/fold-postures.cjs` has the helper.
- **`vw` measures the window, the content column is narrower.** With the second page taking a column, the Fold opened flat is an 841px window with a ~470px content area. `main` is therefore a `container-type: inline-size` container named `page`, and headline figures size themselves in `cqi`, not `vw`. Sizing a figure from `vw` breaks numbers across two lines (`+$5,972.4` / `2`), which is how this was found — twice.
- **Reversing a view transition with `animation-direction: reverse` is wrong.** It plays the outgoing screen from its `to` state, so the screen you are leaving fades *in* as it goes. Write separate keyframes for the back direction (`page-out-back`, `page-in-back`).
- **A pane that slides in from the right edge overflows the page while it does it.** The overflow checks in `fold-continuity.cjs` measure mid-animation and catch it. The second page wipes open with `clip-path` instead.
- **Android's "Remove animations" accessibility setting reports `prefers-reduced-motion: reduce`**, and the block at the end of `css/app.css` then switches off every animation in the app. If motion appears to be missing on the phone but works in the browser, check that setting before changing any code.
- **Hovering a toast pauses it.** `pointerenter` clears the dismiss timer on purpose. A test that leaves the pointer where it clicked can sit over the toast and wait forever; move the mouse away first (`page.mouse.move(5, 5)`).

## Working with the owner

- **Commits:** make small commits with clear messages. The first commit, "Tally 1.0.0 baseline", is the finished and tested app; the next one adds these handoff notes.
- **Ask first** before adding dependencies, a backend or hosted service, or anything that sends data off the device.
- **Device steps:** explain phone and laptop steps (installing, USB debugging, hosting setup) step by step, without assuming Android developer experience.
