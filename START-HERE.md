# Start here: hand Tally to Claude in VS Code

## 1. Set up (once)

1. Install [Node.js](https://nodejs.org), version 20 or newer.
2. Unzip this folder somewhere permanent, such as `Documents/tally`.
3. In VS Code, choose **File → Open Folder** and pick the `tally` folder (the one containing `CLAUDE.md`).
4. Open Claude in VS Code. It reads `CLAUDE.md` on its own, which points it to the task and the original requirements in `docs/`.

## 2. Paste this as your first message

> Read CLAUDE.md and docs/HANDOFF-pixel-fold-and-laptop.md. Run `npm test` to confirm everything passes. Then ask me the questions in "Ask the owner first", one at a time. After that, propose a step-by-step plan for making Tally my app on my Pixel Fold (first generation) and my laptop, and wait for my OK before changing anything.

## 3. Have these ready

- **Your Pixel Fold and a USB cable**, for checking the layout on the real screens. Claude will walk you through turning on USB debugging.
- **An account for free hosting** (GitHub, Cloudflare or Netlify). Chrome needs an `https://` address before it will install Tally on the Fold and run it offline. Claude will help you set it up.
- **Your laptop's operating system and browser.**
- **Any data you want to keep.** If you've already been using Tally, go to Settings → *Download full backup* first, so you can restore it into the new version.

## Good to know

- **One question comes first:** whether your phone and laptop should share the same data. Right now each device keeps its own copy, and you move data with a backup file. The handoff lists the options, from "keep it that way" to automatic sync through your own Google Drive.
- **Start point:** the folder is a git repository whose first commit is the finished 1.0.0 app, so you can always see what changed or go back.
- **More detail:** `README.md` explains how the app works today. `docs/ORIGINAL-BRIEF.md` lists the requirements it was built to.
