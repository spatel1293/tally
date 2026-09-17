# Tally: notes for Claude

Tally is a personal budgeting web app (installable PWA) that runs entirely in the browser: no backend, no accounts, no AI. Version 1.0.0 is complete and tested. The owner now wants it set up as their app on a **Google Pixel Fold (first generation, 2023)** and their **laptop**.

- Current task, including questions to ask the owner before starting: @docs/HANDOFF-pixel-fold-and-laptop.md
- Original requirements (still apply): @docs/ORIGINAL-BRIEF.md
- Features, storage, backups, CSV format and project layout: see `README.md`

## Commands

- `npm start`: local server on http://localhost:5173. It also prints a LAN address for the phone; that address is plain HTTP, so install and offline mode won't work there, but layouts will.
- `npm test`: 80 unit tests with Node's built-in runner. No install needed.
- `npm run test:browser`: 4 Playwright test files at phone and laptop sizes. Needs `npm install` and `npx playwright install chromium` once. It builds `dist/` first.
- `npm run build`: rebuilds `dist/tally.html`, the single-file version.

Run `npm test` and `npm run test:browser` before saying something works. If the browser tests can't run in this environment, say so plainly.

## Architecture

There is no framework and no build step. Plain ES modules load directly in the browser, and there are no runtime dependencies.

- `js/core/`: pure logic with no DOM or browser globals, all unit tested.
  - `money.js`, `dates.js`, `stats.js` (totals, budgets, balances, search, year review)
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
  - Breakpoints: sheets become centered dialogs at ≥640px; the sidebar replaces the tab bar at ≥900px; the dashboard goes two-column at ≥1040px.
- `sw.js`: precaches every shipped file.
- `scripts/`: `serve.js` (dev server), `build-single-file.js` (a small bundler), `browser-test.js`.

## Rules that must not break

1. **Money is integer cents.** Never use floats for amounts. Parse with `parseAmount`, display with `money()`/`formatMoney`. The maximum is `MAX_CENTS`.
2. **Dates are `'YYYY-MM-DD'` strings.** Use the helpers in `core/dates.js`, which calculate in UTC. Don't use `new Date('2026-09-16')` for calendar logic. "Today" is `state.today` (the local calendar date).
3. **Write first.** Every data change goes through `store.js`, which commits to storage before touching `state`. Views never write to storage directly. If a write fails, the user's input stays on screen with a plain-language error.
4. **Escape everything.** Build markup only with `html\`\``. Never put user text into `innerHTML` directly. `raw()` is only for SVG the app generates itself.
5. **Keep `js/core` browser-free** and add or adjust unit tests for any change there.
6. **Service worker:** when a shipped file is added, removed or renamed, update `FILES` in `sw.js` (a unit test enforces this). Bump `VERSION` in `sw.js` on every change that ships.
7. **Single-file bundler limits.** It only understands:
   - single-line `import { a, b as c } from './x.js';`
   - `export function|const|let|class` and `export { … }`

   No default exports, dynamic imports or import cycles. Run `npm run build` after source changes; a browser test opens `dist/tally.html`.
8. **Backups:** the format number is `BACKUP_FORMAT` in `core/defaults.js`. If the stored data shape changes, bump it, keep `parseBackup` able to read older backups, and add a test.
9. **Privacy by default.** No analytics, no AI or LLM features, and no runtime requests to third parties; fonts and icons are self-hosted. Anything that sends data off the device must be the owner's explicit choice (see the handoff's sync question).
10. **UI copy** is plain, active voice, and free of jargon. Error messages say what to do next.

## Design

- **Look:** cool paper background, ink-blue accent for actions only, green only for money coming in, amber for warnings, red for over budget.
- **Structure:** hairline rules rather than boxed cards, and tabular figures (the `.amt` class) wherever numbers appear.
- **Avoid:** cream/terracotta palettes, all-caps eyebrow labels, grids of identical rounded cards, arrows in button text, and middle-dot separators in text.
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

## Working with the owner

- **Commits:** make small commits with clear messages. The first commit, "Tally 1.0.0 baseline", is the finished and tested app; the next one adds these handoff notes.
- **Ask first** before adding dependencies, a backend or hosted service, or anything that sends data off the device.
- **Device steps:** explain phone and laptop steps (installing, USB debugging, hosting setup) step by step, without assuming Android developer experience.
