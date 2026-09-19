# Tally

A personal budgeting app that runs entirely in your browser. Log spending and income, set monthly budgets, schedule repeating bills, and see where your money goes. It works on phones and laptops, keeps working offline, and has no accounts, no server, no tracking and no AI.

> Continuing this project with Claude in VS Code? Open `START-HERE.md`.

## Run it

You need [Node.js](https://nodejs.org) 20 or newer. There is nothing to install for the app itself.

```sh
npm start
```

Open http://localhost:5173. The server also prints a network address you can open on your phone if it's on the same Wi-Fi. Set `PORT` to use a different port.

**Without Node:** open `dist/tally.html` directly from your file system. It's the whole app in one file. Offline caching and home-screen install need a real web address, so they aren't available in that form. Everything else works, and its data is kept separately from the hosted version's. Rebuild it after changing the source with `npm run build`.

## Put it online

Tally is a folder of static files, so any static host works: GitHub Pages, Netlify, Cloudflare Pages, or your own web server. Upload everything except `tests/`, `scripts/` and `node_modules/`. Serve it over HTTPS, because browsers only allow offline mode and installing on HTTPS or `localhost`. The app uses relative paths, so it can live in a subfolder.

Each person's data stays in their own browser. Hosting the app doesn't give you, or anyone else, access to it.

### Install on a phone

- **iPhone / iPad (Safari):** Share, then *Add to Home Screen*.
- **Android (Chrome):** menu, then *Install app* or *Add to Home screen*.
- **Desktop Chrome / Edge:** the install icon in the address bar.

Installed, Tally opens full-screen and works without a connection. A long-press on the Android icon offers *Add*, which opens straight to a new transaction.

### Shipping an update

Bump `VERSION` at the top of `sw.js` whenever you change any file. Open copies of the app then show "A new version of Tally is ready" with an Update button. If you add a file, also add it to the `FILES` list in `sw.js`; `npm test` fails if you forget.

## How your data is stored

Everything lives in the browser you use, on that device.

- **Where:** IndexedDB, the browser's built-in database. If that's unavailable, Tally falls back to localStorage, which holds a few megabytes. If the browser allows no storage at all (some private-browsing modes), a red banner says data will be lost when the tab closes.
- **When:** every change is written to storage *before* the screen updates, so there is no Save button to forget. If a write fails, your input stays on screen with an explanation. The form you're typing in is saved as a draft on every keystroke, so closing the tab mid-entry loses nothing.
- **Several tabs:** open tabs stay in sync. Repeating transactions are protected against being added twice, even by two tabs at once.
- **Keeping it:** Tally asks the browser to treat its data as persistent. Settings shows whether the browser agreed and how much space is used.
  - Safari may clear data for sites you haven't opened in a few weeks, unless the app is added to the Home Screen.
  - Clearing site data or browsing history in your browser settings erases Tally's data.
- **Other devices:** there's no sync. Each browser has its own copy. To move to a new device, back up on the old one and restore on the new one.

## Backups, export and import

Everything is in **Settings, Backup and data**.

| Action | What it does |
| --- | --- |
| **Download full backup** | A `.json` file with everything: transactions, categories, budgets, accounts, repeating transactions, goals and settings. This is the one to keep. |
| **Restore from backup** | Replaces everything with a backup file. It shows what's in the file first and offers to download a backup of the current data before replacing it. Damaged records in a file are skipped and counted, never imported half-broken. |
| **Export transactions (CSV)** | Transactions only, for spreadsheets. Columns: `date, type, amount, category, parent_category, account, note, refund, id`. |
| **Import transactions (CSV)** | Adds transactions from a spreadsheet or bank export, with a preview first and Undo afterwards. |

Home shows a reminder when there are changes that haven't been backed up for a while (two weeks by default, adjustable in Settings). The sidebar on larger screens shows the last backup date.

On phones that support it, the download buttons open the share sheet, so you can save the file to Files, Drive or email. Elsewhere they download normally.

### CSV import details

The first row must hold column names. Tally recognizes common names, case-insensitively:

- **Date** (required): `date`, `transaction date`, `posted date`, `booking date` and similar. It accepts `2024-03-05`, `03/05/2024` and `05.03.24`. When a file uses dates like 03/04/2024, the import sheet asks whether the month or the day comes first.
- **Amount** (required): either one `amount` column, or separate `debit`/`credit` (also `money out`/`money in`, `withdrawal`/`deposit`). It understands `$1,234.56`, `1.234,56`, `(12.00)`, `-12` and `12-`.
  - With a single signed column and no type column, you choose whether positive numbers mean income (most banks) or spending.
- **Optional:**
  - `type` (income, expense, credit, debit, refund)
  - `category` and `parent_category`
  - `account`
  - `note`, `memo`, `description`, `payee` (several of these are joined together)
  - `refund` (yes/no)
- **New names:** unknown categories and accounts are created automatically, and the preview lists them.
- **Duplicates:** rows already in Tally (same date, type, amount and note) are skipped unless you turn that off. Importing the same file twice adds nothing the second time.
- **Bad rows:** they're skipped, and the preview lists each one with its line number and the reason.

## Using it

- **Add a transaction:** the round **+** button on phones or **New transaction** on desktop. Amount, category and date (today by default) are all it needs. A note or payee is optional. Type a payee you've used before and its last category is picked for you.
- **Refunds** are expenses with *This is a refund* ticked. They lower spending in their category instead of counting as income. A negative amount is rejected with a pointer to this option.
- **Budgets** are monthly limits per category.
  - Bars turn amber at 80% (adjustable) and red once you go over. Home compares how much of the budget is gone with how much of the month is gone.
  - A parent category's budget includes its subcategories. A subcategory can have its own budget too; it only counts toward the overall total when its parent has none.
- **Repeating transactions** can be added automatically on schedule or listed on Home as reminders to *Log* or *Skip*. Good uses: rent, salary, subscriptions, or a bill that varies.
  - An automatic rule with a start date in the past fills in the past dates right away. The form says how many first.
  - Dates stay on the same day of the month, falling back to the last day for short months (the 31st becomes Feb 28 or 29).
- **Deleting a category** asks where its transactions should go. Its subcategories move to the top level. Nothing is ever silently uncategorized.
- **Accounts** are optional. Each has a starting balance, and its balance is that plus income and refunds, minus spending. With two or more accounts, the add form asks which one you used. Transfers between accounts aren't tracked.
- **Plans** are the nest eggs you're filling and the trips you're saving for, on one page.
  - A **nest egg** is money you set aside and hold: an emergency fund, a deposit, a new laptop.
  - A **trip** works the same way, but spending can be charged to it, so you can see what it actually cost against what you put by. Pick the plan in the *Part of a plan* field when adding an expense — a flight booked months early still counts.
  - **What if** asks the question that matters: put a monthly amount in (and optionally a one-off), and every plan gets a projected finish date and a plain verdict on whether it makes the date you wanted. Tally starts from what you've actually had left over each month, taken from your own history, rather than a number you guessed.
  - Plans are filled in date order — the soonest deadline is funded first — so the projection reflects what would really happen rather than an even split.
  - Setting money aside is a counter, not a transaction. Moving money between your own accounts is neither income nor spending, and logging it as either would distort every total in the app.
- **Year in review** summarizes income, spending, the savings rate, top categories and highlights for any year.

### On a folding phone

Tally follows the hinge. Chrome reports the two halves only while the phone is *half* folded, so opened flat or closed it simply uses the layout that fits the screen.

| How you're holding it | What you get |
| --- | --- |
| Closed (cover screen) | The phone layout: tab bar at the bottom, one column, quick to log something one-handed. |
| Half folded, hinge top to bottom (book) | A two-page spread. The left page is the app; the right page shows the month's running total, and the add or edit form opens there, so the crease never cuts through what you're typing. |
| Half folded, hinge left to right (tabletop) | Propped up like a small laptop. The month's numbers stay in the upper half while the form opens in the lower half, flat under your hands. |
| Opened flat | The navigation rail, a two-column dashboard, and the add form gains a second column showing how the category you picked is tracking this month. |

Folding or unfolding mid-entry keeps the form open with everything you'd typed.

One thing that isn't possible: showing something on the cover screen while the phone is open. Android only gives an app the display it's running on, and there's no web API for the second one — a native wrapper wouldn't help either, since the Pixel Fold doesn't offer its cover screen to third-party apps that way.

### Keyboard shortcuts (desktop)

| Key | Action |
| --- | --- |
| `N` | New expense |
| `I` | New income |
| `/` | Search activity |
| `1` `2` `3` `4` | Home, Activity, Budgets, Repeating |
| `[` `]` | Previous / next month (Home, Budgets) or year (Year in review) |
| `Ctrl`/`⌘` + `Enter` | Save the open form |
| `Esc` | Close the open form |

## Tests

```sh
npm test               # 80 unit tests, no install needed
npm run test:browser   # 4 browser test files (needs Playwright, see below)
```

**Unit tests** (`tests/*.test.js`) cover the money math and data handling:
- totals, refunds and rounding with thousands of small amounts and very large sums
- budget states, including $0 and missing budgets, and parent/subcategory budgets without double counting
- repeating transactions on every frequency, including month-end clamping, end dates, pausing, reminders, and never adding the same date twice
- CSV parsing, export/import round trips, bank formats and error messages
- form validation, and backup round trips including damaged files
- the offline file list, and HTML escaping of user text

**Browser tests** (`tests/browser/`) drive the real app in Chromium at phone and laptop sizes:
- adding, editing and deleting with Undo; validation messages; drafts surviving a reload
- budgets turning amber then red; search and filters; paging through long histories
- CSV import and re-import, backup, erase and restore
- accounts, goals, repeating transactions and reminders, and category deletion
- German number format, dark mode, offline use, the single-file build, and very large numbers
- they also fail on any browser console error, or if a page becomes wider than a phone screen

To run them once:

```sh
npm install
npx playwright install chromium
npm run test:browser
```

Screenshots are saved to a `tally-shots` folder in your system's temp directory, or to `SHOTS_DIR` if set.

## Project layout

```
index.html              App shell
manifest.webmanifest    Install metadata
sw.js                   Offline cache (bump VERSION on every release)
css/app.css             All styles, light and dark themes
fonts/                  Public Sans (SIL Open Font License, see OFL.txt)
icons/                  App icons
js/
  app.js                Navigation, shortcuts, theme, service worker registration
  store.js              App state; every change goes through here and is saved first
  storage.js            IndexedDB / localStorage / memory storage and drafts
  core/                 Pure logic with no browser dependencies (unit tested)
    money.js            Parsing and formatting amounts
    dates.js            Calendar dates
    stats.js            Totals, budgets, balances, search, year review
    recurring.js        Repeating transaction schedules
    csv.js              CSV parsing, export, import mapping
    validate.js         Form checks and backup validation
    defaults.js         Default categories and settings
  ui/                   Templating, dialogs and toasts, charts, formatting
  views/                One file per screen, plus the forms
scripts/
  serve.js              Local server (npm start)
  build-single-file.js  Builds dist/tally.html
  browser-test.js       Runs the browser tests
tests/                  Unit tests; tests/browser holds the browser tests
dist/tally.html         The single-file build
```

### Technical choices

- **No framework and no build step.** Plain JavaScript modules load directly in the browser. There are no runtime dependencies, so nothing needs updating, and the whole app, including its font and icons, is about 320 KB.
- **Money is stored in whole cents,** never as decimal fractions, so sums are always exact. Amounts are limited to 1,000,000,000.00.
- **Dates are stored as calendar dates** (`2026-09-16`) and calculated in UTC, so daylight-saving changes can't move a transaction to another day.
- **Charts are hand-written SVG,** with a hidden data table for screen readers.
- **All user text is escaped** before it's shown, so a note can never inject markup.
- **Changing the currency only changes the symbol.** Amounts are not converted, and there's one currency per app.
