> **Historical.** This describes Tally as a budgeting app, which it stopped
> being in September 2026 — version 5 keeps a wealth fund and logs no
> spending at all. Kept for the record; see `CLAUDE.md` and `README.md` for
> what the app is now. Nothing here is a current requirement.

# Original requirements (restated)

This restates the brief Tally was built from. It is a faithful summary, not the verbatim text. Version 1.0.0 meets all of it. Keep these requirements intact while adapting the app.

## What it is

- A **single-user personal budgeting web app** that works well in phone and laptop browsers, is fast and reliable, and is pleasant to update daily.
- **No AI or LLM features of any kind.** It is a plain, predictable finance tool: no chatbot, no AI auto-categorization, no generated insights.

## Platform

- **One responsive web app** (not native), installable to a phone home screen as a PWA.
- **Client-side only.** Data lives in browser storage (IndexedDB or localStorage), and the app works offline. No backend, server or account.
- **Simple, modern stack.** Reliability and speed matter more than fancy frameworks.
- **Automatic saving.** No Save button for normal use.

## Core features

1. **Transactions**
   - Quick add with amount, type, category, date (defaults to today) and an optional note or payee.
   - Edit and delete.
   - A newest-first list grouped by day or month, with running totals.
   - Search and filter by category, date range, type and keyword.
2. **Categories**
   - Sensible defaults: Groceries, Rent/Housing, Utilities, Transportation, Dining Out, Entertainment, Health, Subscriptions, Income, Savings, Other.
   - Add, rename, delete and reorder, each with a color and/or icon.
   - Optional simple subcategories. Don't over-engineer.
3. **Budgets**
   - A monthly limit per category.
   - A progress bar of spent vs. budget that updates in real time, with a clear color warning when near or over.
4. **Recurring transactions**
   - A frequency (weekly, monthly and so on).
   - They auto-generate, or at least remind.
5. **Dashboard**
   - The current month's income, expenses and net at a glance.
   - A spending-by-category breakdown (bar or donut).
   - An income vs. expense trend over recent months.
   - Charts that are simple, readable and lightweight (SVG or a tiny library), with no heavy dependencies.
6. **Data portability**
   - Export to CSV and/or JSON, and import from CSV.
   - A visible "last backup/export" reminder.

## UI and UX

- **Look:** clean, minimal and easy to scan, with numbers readable at a glance.
- **Mobile first:** adding a transaction is doable one-handed in a few taps.
- **Themes:** light and dark mode, following the system setting with a manual toggle.
- **Currency:** clearly formatted, USD by default, with symbol and locale configurable in Settings.
- **Empty states:** helpful ones.
- **Validation:** no negative amounts unless intentionally a refund, required fields marked, and clear, non-technical error messages.

## Must work flawlessly

- **No data loss** on a crash, refresh, or closing the tab mid-entry.
- **Fast** even with years of history.
- **No broken states:** empty categories, deleting a category that has transactions, $0 budgets, months with no data, very large and very small numbers, and decimal rounding.
- **Thoroughly tested:** add/edit/delete, budget calculations and chart rendering, including **automated tests for the core money math** (totals, budget progress, recurring generation).

## Nice to have (only after the core is solid)

Multiple accounts or wallets with per-account balances, savings goals with progress, a year-in-review summary, and keyboard shortcuts for desktop entry. All four were built in 1.0.0.

## Deliverable

A working, deployable web app, plus a short README on how to run it locally and how storage and backups work.
