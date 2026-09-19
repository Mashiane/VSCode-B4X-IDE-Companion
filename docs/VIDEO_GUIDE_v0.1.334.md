# B4X IntelliSense v0.1.334 — Video Walkthrough Guide

> **Audience:** B4X developers who may not be familiar with this extension or its newer features.
> **Tone:** Conversational, demo-driven. Show each feature in action, then explain what it does and why it matters.

---

## Opening (30 seconds)

**On screen:** VS Code with a B4X project open, the B4X Companion sidebar visible.

> "Hi everyone, I'm walking you through the latest release of B4X IntelliSense — version 0.1.334. This update brings a completely redesigned companion dashboard, a full library browser, direct library updates, and a lot more. Let me show you each feature."

---

## 1. Project Resources — The Companion Dashboard (4 minutes)

**On screen:** Click the B4X Companion icon in the secondary sidebar (right side). The "Project Resources" panel opens with two tabs: **Libraries** and **Files**.

> "The biggest new feature is the Companion Dashboard. You'll find it in the secondary sidebar — click the B4X logo icon here. It opens the Project Resources panel with two tabs."

### 1a. Libraries Tab (2 minutes)

**On screen:** The Libraries tab showing a table with columns: checkbox, Library name, Version, Online, Source.

> "The Libraries tab shows every library your project references — and every library found on disk. Each row shows the local version you have installed, and the online version from the B4X community catalog."

**Click the search/filter input.** Type "xml" to filter.

> "You can filter libraries by name using the search box up here. It filters instantly as you type."

**Point to a library with an orange badge in the Online column.**

> "When the online version is newer than your local version, it shows as an orange badge. This tells you at a glance which libraries have updates available."

**Point to the Update button and badge count.**

> "The Update button at the top shows a count of how many libraries have newer versions available. In this case, it says 3 — meaning three of your libraries are outdated."

### 1b. Files Tab (2 minutes)

**On screen:** Click the Files tab. Show the file tree grouped by extension.

> "The Files tab organizes your project files by extension — B4A files, layout XMLs, images, and so on. Each group is collapsible, and clicking a file opens it directly in the editor."

**Click a file to open it.**

> "Clicking any file opens it immediately. The file icons match VS Code's codicon set, so you'll recognize them instantly."

---

## 2. Updating Libraries — Direct Download (3 minutes)

**On screen:** Back on the Libraries tab. Click the **Update** button.

> "Here's where this version really shines. When you click Update, the extension downloads the latest library files directly — no more hunting for forum threads to find download links."

**Show the progress notification appearing.**

> "You'll see a progress notification showing each library being checked and downloaded. The extension validates each URL before downloading, so if a file is unavailable, it's skipped automatically."

**Point out the cancel button on the progress notification.**

> "If something gets stuck — a slow server, a network hiccup — you can cancel the whole operation with the Cancel button. Libraries that already downloaded successfully are kept."

> "After downloading, the extension extracts the version from each file and updates both your local listing and the catalog. The dashboard refreshes immediately to show the new versions — and the update count drops accordingly."

**Show the result: the badge count decreases, the orange badges turn to normal text.**

> "Notice how the update count went from 3 down to 0. The version numbers in the Version column are now current, and the Online column no longer shows orange badges."

### Where Libraries Are Saved

> "Libraries are saved to the correct folder automatically. Internal libraries go to your B4A Libraries folder, and External libraries go to the Additional Libraries folder you've configured in B4A settings. The extension knows which folder to use based on where each library was originally found."

---

## 3. Refresh Library Catalog (1.5 minutes)

**On screen:** Open the Command Palette (Ctrl+Shift+P). Type "Refresh Library Catalog" and run it.

> "The Refresh Library Catalog command pulls the latest library index from GitHub and merges it with the Google Sheet catalog. You'll see the status bar update as it progresses — fetching the index, extracting versions, and merging sheet entries."

> "Once the refresh completes, both the Library Browser and the Project Resources dashboard automatically update with the latest catalog data. No need to reload the project or reopen anything — it just refreshes in place."

---

## 4. Library Browser (2.5 minutes)

**On screen:** Command Palette → "Browse Libraries". The Library Browser panel opens.

> "The Library Browser is a full-featured searchable catalog of every B4X library. You can search by name, filter by platform — B4X, B4A, B4J, B4i, or B4R — and by type — b4xlib or native."

**Type a search term and apply filters.**

> "Each library card shows the name, author, platform badges, and a snippet preview. Clicking a library opens its detail view with the full description and a link to the forum thread."

**Click a library to open its detail.**

> "From here you can open the forum thread to learn more, or download the library directly."

---

## 5. Version Extraction Improvements (1 minute)

**On screen:** Show the Libraries tab with version numbers populated.

> "Behind the scenes, version extraction is now much more reliable. Previously, some .b4xlib files — particularly those with paths containing spaces or special characters — would fail to extract their version number. The extension now has a fallback parser that reads the ZIP central directory directly, bypassing the issue entirely. This means virtually every library now shows its correct version."

---

## 6. DaisyUI Component System (1 minute)

**On screen:** Point at the dashboard UI elements — search input, buttons, badges, tabs.

> "The dashboard UI is now built entirely with DaisyUI components — the same design system used by the Library Browser. This means consistent styling, proper theming that respects your VS Code color settings, and proper behavior for inputs, buttons, badges, and tabs."

> "Notifications like 'files loaded' now use native VS Code information messages instead of custom toasts — so they appear in the same place and behave the same way as every other VS Code notification."

---

## 7. New Commands (30 seconds)

**On screen:** Command Palette showing the new commands.

> "Three new commands are available. **Focus Dashboard** opens and focuses the Project Resources panel. **Browse Libraries** opens the full library catalog. **Refresh Library Catalog** updates the library index from GitHub and the community spreadsheet."

---

## 8. Status Bar Integration (30 seconds)

**On screen:** Point to the B4X status bar item at the bottom.

> "The status bar shows the current state of B4X IntelliSense. During a catalog refresh, it updates in real time — fetching the index, extracting versions, and merging sheet data — so you always know what's happening."

---

## Closing (30 seconds)

> "That's B4X IntelliSense 0.1.334. The Companion Dashboard gives you a real-time view of your project's libraries and files. Direct library updates save you from manual downloads. The Library Browser puts the entire B4X ecosystem at your fingertips. And the catalog refresh keeps everything current. Thanks for watching — check the release notes for the full changelog."

---

## Quick Reference — New Features Summary

| Feature | What It Does | Where to Find |
|---------|--------------|---------------|
| **Companion Dashboard** | Shows project libraries (with version tracking) and files | Secondary sidebar → B4X Companion |
| **Library Update** | Downloads updated libraries directly to the correct folder | Libraries tab → Update button |
| **Library Browser** | Searchable catalog of all B4X libraries with filters | Command Palette → Browse Libraries |
| **Refresh Library Catalog** | Pulls latest index from GitHub + Google Sheet | Command Palette → Refresh Library Catalog |
| **Focus Dashboard** | Opens and focuses the Project Resources panel | Command Palette → Focus Dashboard |
| **Version Extraction Fix** | Fallback ZIP parser for .b4xlib files that StreamZip rejects | Automatic — no action needed |
| **Cancel Download** | Cancel in-progress library updates via progress notification | Progress notification → Cancel button |
| **DaisyUI Components** | Consistent, VS Code-themed UI for all dashboard elements | Automatic — visible in tabs, inputs, badges |
| **Native Notifications** | VS Code info messages instead of custom toasts | Automatic — e.g., "B4X: 605 files loaded (8 groups)" |

---

## Quick Reference — Keyboard Shortcuts

| Action | Command ID |
|--------|-----------|
| Open/focus dashboard | `b4xIntellisense.focusDashboard` |
| Browse library catalog | `b4xIntellisense.browseLibraries` |
| Refresh library catalog | `b4xIntellisense.refreshLibraryCatalog` |