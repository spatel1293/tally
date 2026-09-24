> **Historical.** This describes Tally as a budgeting app, which it stopped
> being in September 2026 — version 5 keeps a wealth fund and logs no
> spending at all. Kept for the record; see `CLAUDE.md` and `README.md` for
> what the app is now. Nothing here is a current requirement.

# Task: make Tally my app on a Pixel Fold (1st gen) and my laptop

The owner wants to use Tally every day on two devices: a **Google Pixel Fold (2023, first generation)** and a **laptop**. It should install like a real app on both, work offline, and look deliberate on the Fold's cover screen, its inner screen and the laptop.

Start by running `npm test` to confirm the baseline. Then ask the questions below, propose a plan, and wait for the owner's go-ahead before making changes.

## Ask the owner first

1. **Should both devices show the same data?** Today each browser keeps its own separate copy. Moving data means downloading a backup on one device and restoring it on the other, which replaces everything. The options:
   - **A. Keep separate copies** (no change). No infrastructure, and the most private.
   - **B. Easier manual transfer, still no server.**
     - Add "send backup" through the Android share sheet or email-to-self.
     - Add a *merge* import alongside the current replace-everything restore, matching records by `id` and keeping the newer `updatedAt`.
   - **C. Automatic sync through the owner's own Google Drive** (the hidden app-data folder, via Google sign-in and the Drive API).
     - No server of our own.
     - Needs a Google Cloud OAuth client, a network connection, and conflict handling (per-record newest `updatedAt`, plus deletion markers so deletes sync).
     - Data now leaves the device, so this is opt-in only.
   - **D. Sync through a small hosted backend** (for example Cloudflare Workers with D1, or Supabase). The most work, and it needs sign-in and ongoing hosting.

   Recommend A or B unless the owner clearly wants automatic sync; in that case recommend C. Syncing through a shared folder won't work on the Fold, because Chrome on Android doesn't support the File System Access API.
2. **Where should it be hosted?** Chrome only installs the app and enables offline mode over HTTPS. Free options include GitHub Pages, Cloudflare Pages and Netlify. Which accounts does the owner already have?
3. **Which laptop OS and browser?** Chrome and Edge can install web apps on Windows, macOS, ChromeOS and Linux; other browsers vary.
4. **Currency and number format?** The defaults are USD and US English; both can be changed in Settings.
5. **Is there data to keep?** If the owner has used `dist/tally.html` or a local `npm start` copy, that data lives separately from the hosted app. Download a backup there first (Settings, then *Download full backup*) and restore it into the hosted app.

## The devices

**Google Pixel Fold (2023)**
- **Cover screen:** 5.8", 1080 × 2092 px, 17.4:9. Tall and narrow, with a camera cutout.
- **Inner screen:** 7.6", 2208 × 1840 px, 6:5. When unfolded in its natural orientation it is wider than tall, and the hinge runs top to bottom.
- **CSS sizes:** these depend on the phone's display-size setting. Expect roughly **410 × 800** for the cover screen and roughly **840 × 700** for the inner screen (about 700 × 840 when rotated), assuming a device pixel ratio near 2.6. **Measure on the device** before relying on these numbers (see below).
  - The inner screen lands right around the current 900px sidebar breakpoint, so today it gets the phone layout.
- **Hinge reporting:** Chrome for Android 138 and later supports the Viewport Segments API: `horizontal-viewport-segments` / `vertical-viewport-segments` media features, `env(viewport-segment-width 0 0)` and related variables, and `window.viewport.segments`. It reports two segments only while the phone is partly folded (book or tabletop posture); flat or closed reports one.

**Laptop:** the desktop layout (sidebar at ≥900px) and keyboard shortcuts already exist.

## Work, in suggested order

### 1. Host over HTTPS and install on both devices

- **Publish only the app files:** `index.html`, `manifest.webmanifest`, `sw.js`, `css/`, `fonts/`, `icons/`, `js/`. All paths are relative, so a subfolder such as `username.github.io/tally/` works. For GitHub Pages, a small Actions workflow that copies those into the published site keeps tests and scripts out of it.
- **Install on the Fold:** open the URL in Chrome, then menu → *Install app* (or *Add to Home screen*). Chrome creates a real app entry with its own icon.
- **Install on the laptop:** use the install icon in the Chrome or Edge address bar.
- **Improve `manifest.webmanifest`:**
  - Add `screenshots` (at least one narrow and one wide, with `form_factor: "narrow"` / `"wide"`) so Android shows the richer install dialog.
  - Consider `launch_handler: { "client_mode": "focus-existing" }` so tapping the icon returns to the open window.
  - Keep `id`, `start_url` and `scope` as `./`.
- **Bump `VERSION`** in `sw.js`, and add any new shipped files to `FILES`.
- **Update the README** with exact install steps for both devices.

### 2. Layout for the inner screen (medium widths, about 600–899px)

Below 900px everything currently gets the phone layout: a bottom tab bar, content capped at 720px, and a single-column dashboard (two columns only start at 1040px). On the unfolded Fold that wastes space.

- **Navigation rail:** add a medium breakpoint (around 600px) with a slim rail on the left (icons with short labels, New transaction at the top) and no bottom tab bar. Let the content use the width.
- **Two-column dashboard from about 760px:** budgets and latest on one side, spending donut and trend on the other. Check that nothing is cramped at about 700px (inner screen rotated).
- **Keep the laptop sidebar** at ≥900px, but confirm the inner screen (about 840px) gets the rail rather than a squeezed sidebar.
- **Optional list–detail on Activity:** at medium widths and up, show the list on one side and the selected transaction's edit form on the other, instead of a modal sheet. Only if it stays simple and all current behaviors (drafts, Undo, validation) keep working.

### 3. Folding and unfolding without losing anything

Android keeps the app running and simply resizes the page. Check that:
- an open add/edit sheet stays open with its values through the resize and re-render
- Activity search, filters and scroll position stay put
- charts redraw at the new width (`hydrateCharts` on resize already exists)
- the switch between bottom sheet and centered dialog at 640px looks right mid-edit

Add a browser test: open the add sheet at about 412px wide, type an amount and note, resize to about 841px and back, then check the sheet is still open with the same values.

### 4. Half-folded postures (nice to have)

- **Book posture** (`horizontal-viewport-segments: 2`, hinge vertical): keep content off the hinge. For example, navigation and the list go in the left segment, and the open sheet or detail goes in the right one.
- **Tabletop posture** (`vertical-viewport-segments: 2`, hinge horizontal): the hero and charts go in the top segment, the list or form in the bottom one.
- **Measurement and fallback:** size the areas with `env(viewport-segment-width 0 0)` and related variables, and fall back to the normal layout everywhere else. Test with Chrome DevTools' foldable emulation if available; otherwise test on the device.

### 5. Android polish

- **Back gesture:** with a sheet or confirm dialog open, back should close it and stay in the app. Recent Chrome treats back as a close request for modal dialogs (firing `cancel`, which Tally already handles). Verify this in the installed app on the Fold. If back leaves the app or changes the page instead, add history-based handling: push an entry when a dialog opens, close on `popstate`, and leave no stray entries behind.
- **Touch targets:** at least 48 × 48px under `@media (pointer: coarse)`. Pay attention to icon buttons (36–44px today), the category reorder arrows, and the month arrows.
- **Safe areas:** the page uses `viewport-fit=cover`. In the installed app, check the cover screen's camera cutout and the gesture bar, and add `env(safe-area-inset-top/left/right)` padding where content collides.
- **On-screen keyboard:** when it opens in the add sheet, Save must stay reachable. Consider `interactive-widget=resizes-content` in the viewport meta tag, or `visualViewport` handling.
- **Status bar:** it should match the light or dark theme in the installed app (`theme-color` is already updated at runtime).

### 6. Laptop polish

- In the installed window, check the default size, the sidebar at narrow window widths, and that the shortcuts (`N`, `I`, `/`, `1`–`4`, `[`, `]`, `Ctrl/⌘+Enter`, `Esc`) work.
- Optional: register a file handler (`file_handlers` in the manifest plus `launchQueue`) so opening a Tally backup `.json` offers to restore it. This works in Chromium browsers on desktop only.

## Measuring on the device

- **Temporary readout:** behind a `?debug` URL flag, show `innerWidth × innerHeight`, `devicePixelRatio`, `matchMedia('(pointer: coarse)').matches` and `window.viewport?.segments` in a corner of the screen. Record the real numbers for the cover screen, the inner screen in both orientations, and half-folded. Use them for the breakpoints and test viewports.
- **USB debugging:**
  1. On the Fold, open Settings → About phone and tap *Build number* 7 times to enable Developer options.
  2. In Developer options, turn on *USB debugging*.
  3. Connect the Fold to the laptop by cable and open `chrome://inspect/#devices` in Chrome on the laptop.
- **Before hosting:** `npm start` prints a LAN URL you can open on the Fold over the same Wi-Fi. Layout checks work there; install and offline mode don't, because it's plain HTTP.

## Testing

- **Keep the existing tests green:** all 80 unit tests and the 4 browser test files.
- **New browser tests:**
  - viewports for the cover screen (about 412 × 800) and inner screen (about 841 × 701, and rotated), using the measured values once known
  - a check for horizontal overflow on every main screen at each size
  - the fold/unfold continuity test
  - a back-navigation test (`page.goBack()` with a sheet open) if history handling is added
- **Visual review:** take screenshots of Home, Activity, Budgets, Repeating, Settings and the add sheet at each size, in light and dark, and review them before calling the work done.

## Done when

- The app installs from the hosted URL on the Fold and the laptop, opens in its own window, works offline, and offers updates through the "new version" prompt.
- Every screen looks deliberate on the cover screen, the inner screen (both orientations) and the laptop, with no sideways scrolling anywhere.
- Folding or unfolding mid-entry loses nothing, and the back gesture closes dialogs instead of leaving the app.
- The data-sharing question is answered and implemented as agreed.
- Tests pass, `sw.js` `VERSION` is bumped, and the README covers hosting, installing on both devices, and any sync.
