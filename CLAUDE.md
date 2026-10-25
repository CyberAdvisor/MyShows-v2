# MyShows V2 — Design Document

> **Status:** Approved for the V2 initial build (2026-10-25). Changes to scope still require Michael's approval.
> **Repository:** `CyberAdvisor/MyShows-v2` (new, separate from V1's `CyberAdvisor/MyShows`), served at **v2.myshows.fyi**
> **Last updated:** 2026-10-25

This file is the single source of truth for V2 scope. Claude must read it before any V2 work, must not build anything not described here, and must stop and ask when something is ambiguous or listed under [Open decisions](#10-open-decisions).

---

## Contents

1. [Purpose and scope](#1-purpose-and-scope)
2. [Ground rules for working on V2](#2-ground-rules-for-working-on-v2)
3. [Glossary](#3-glossary)
4. [Functional requirements](#4-functional-requirements)
5. [Screen mockups](#5-screen-mockups)
6. [Data model and storage](#6-data-model-and-storage)
7. [Sync design (GitHub Gist)](#7-sync-design-github-gist)
8. [Architecture, code structure and testing](#8-architecture-code-structure-and-testing)
9. [Deployment and test environment](#9-deployment-and-test-environment)
10. [Open decisions](#10-open-decisions)
11. [Usability review notes](#11-usability-review-notes)
12. [Out of scope for V2](#12-out-of-scope-for-v2)
13. [Change log for this document](#13-change-log-for-this-document)

---

## 1. Purpose and scope

MyShows is a single-file, vanilla-JS, no-build-step TV tracker. Its core value is computing the **next episode available to watch** for each tracked show using the TVmaze API. V1 lives in `CyberAdvisor/MyShows` and stays at myshows.fyi. V2 is a separate repository and a separate site at v2.myshows.fyi; the two share no code, data or storage.

V2 delivers three things, which ship **together** as one release:

| # | Change | Summary |
|---|---|---|
| A | **UI redesign** | V1 show rows and V1 detail screen, grouped into three status segments with counts (Watching / Waiting / Done), bottom tab bar navigation (Show / Add Show / Settings), simplified Add flow. No ratings. |
| B | **Mandatory multi-device sync** | Every user connects their own GitHub Gist with their own token before using the app. The gist is the source of truth; last-write-wins. |
| C | **Clean code base** | New repository with one copy of the app logic, inside `index.html`, shared by the app and the tests. No duplicated files. |

Hard constraints:

- **C-1** Free to run and free to use. No paid services.
- **C-2** No developer accounts (no Apple Developer Program, no OAuth app registration).
- **C-3** No shared backend. Each user's data lives in their own gist, with a working copy in the browser.
- **C-4** Sync via GitHub Gist is **mandatory**. The app cannot be used until a gist is connected.
- **C-5** V2 **starts fresh**. It never reads V1's on-device data (`my-shows-library-v1` in `localStorage`), and V2 never depends on V1. V2 is a separate app; the one way across is the user restoring a **V1 backup file** in V2 (SET-4), one-way, V1 → V2. Shows that can't be imported are left out and listed for the user to add again.

---

## 2. Ground rules for working on V2

- **R-1** Pencil-and-paper first. Discuss in prose and get approval before writing or changing any code.
- **R-2** Any proposed change is reviewed for usability and UI flow, and anything likely to confuse users is called out before implementation.
- **R-3** All code is tested before being presented. Both `logic.test.js`-style unit tests and `app.test.js` integration tests must pass.
- **R-4** No spaghetti and no dead code. Refactor when needed; remove anything made unused by a change.
- **R-5** Code is internally documented and simply structured (see §8).
- **R-6** **Script placement rule:** no `<script>` tag may appear after the main inline `<script>` in `index.html`. Any additional script goes in `<head>`. (`app.test.js` extracts the app logic with a greedy regex from the first bare `<script>` to the last `</script>`.)
- **R-7** Update `README.md`, `AGENTS.md`, `guide/`, `changelog/` and this file whenever a change affects what they describe.

---

## 3. Glossary

| Term | Meaning |
|---|---|
| **Library** | The array of shows the user has added. Stored in the user's gist (source of truth), with a working copy in `localStorage`. |
| **Setup** | The first-run screen where the user connects their gist. Shown until a gist is connected; nothing else in the app is reachable before then. |
| **Tracked show** | Every show in the library. The app computes its next-episode status and shows it in Watching, Waiting or Done. |
| **Watching** | Tracked show with at least one aired episode the user has not marked watched. |
| **Waiting** | Tracked show that is either (a) caught up and still in production, waiting for its next episode or season, or (b) suspended by the user. Shown in two sections. |
| **Done** | Tracked show that is no longer in production **and** has no episodes left to watch. Nothing else goes in Done. |
| **Suspended** | Existing V1 non-destructive override flag. The show is shown in the Waiting segment's Suspended section regardless of computed status; un-suspending restores computed status. |
| **Delete** | Removing a show from the detail screen. The show is deleted entirely from the library; there is no hidden or archived copy. |
| **Main display** | The Shows list screen: three segments plus the list for the selected segment. |
| **Segment** | One of the three status groups (Watching, Waiting, Done) shown as selection boxes at the top of the main display. |
| **Gist** | A GitHub Gist owned by the user that holds a JSON copy of their library. |

---

## 4. Functional requirements

Requirement IDs are stable; reference them in commits and tests.

### 4.1 Navigation

- **NAV-1** A bottom tool bar is always visible with exactly three buttons, in this order: **Show**, **Add Show**, **Settings**.
- **NAV-2** The tool bar replaces the V1 header icon buttons.
- **NAV-3** The active button is visually indicated.
- **NAV-4** **Show** returns the user to the main display from anywhere.
- **NAV-5** **Add Show** opens the Add screen (§4.4).
- **NAV-6** **Settings** opens the Settings screen (§4.6).
- **NAV-7** The **"My Shows" wordmark** in the header is a link that also returns to the main display, behaving identically to **Show**.
- **NAV-8** Screens below the top level (show detail, sync setup, backup & restore) show a **back arrow** in the header that returns to the previous screen.
- **NAV-9** Returning to the main display keeps the last-selected segment (see open decision **OD-13**).
- **VER-1** A small muted line under the "My Shows" wordmark shows the app version on every screen, including Setup, e.g. `Version 2.6.1`. Tapping it opens the changelog. The version comes from one constant, `APP_VERSION`, in `index.html` and must match the newest changelog entry. It is raised with every release (minor for new behavior, patch for fixes).

### 4.2 Main display (Shows list)

- **LIST-1** The top of the main display has three selection boxes, in this order: **Watching**, **Waiting**, **Done**.
- **LIST-2** Only one segment's shows are displayed at a time.
- **LIST-3** **Watching** is the default segment on first load.
- **LIST-4** Each selection box shows the count of shows in that segment beside its label, e.g. `Watching 7`. Counts are always shown, at every width, including 0.
- **LIST-5** Show rows on the main display are **the same as V1** (same content and layout). No new row fields are added; no ratings are added.
- **LIST-6** Segment membership:

  | Segment | Contains |
  |---|---|
  | Watching | Tracked, not suspended, at least one aired episode not marked watched |
  | Waiting | Section 1 **Waiting for next episode or season**: tracked, not suspended, caught up, still in production. Section 2 **Suspended**: every suspended show, whatever its computed status. |
  | Done | Tracked, not suspended, no longer in production, and no episodes left to watch |

- **LIST-7** Tapping a row opens that show's detail screen.
- **LIST-8** Status is **computed**, not stored: when a Waiting show's next episode airs, it appears in Watching on the next render with no user action.
- **LIST-9** Watching sort order: **LIST-14**. Waiting sort order within each section: see **OD-12**. Done: alphabetical by show name.
- **LIST-10** Each segment has an empty state with a short message (wording: **OD-5**).
- **LIST-11** The Waiting segment shows its two sections in this order, each with a section heading: **Waiting for next episode or season**, then **Suspended**. A section with no shows is not displayed. Section 1 behaves the same as V1's waiting group.
- **LIST-12** The Waiting count (LIST-4) includes both sections. See **OD-16**.
- **LIST-13** A show that is no longer in production but still has unwatched episodes is in **Watching**, not Done.
- **LIST-14** The Watching segment shows two sections, each with a section heading, in this order. A section with no shows is not displayed (as LIST-11).
  1. **Currently running shows**: TVmaze status anything other than `Ended` (including "To Be Determined"), by the air date of the show's **most recently released episode, newest first**, whether or not the user has reached it. No date limit.
  2. **Ended shows I'm binging**: TVmaze status `Ended`, in the V1 sink order (`availableOrder`): a newly added show goes to the top of this section; Mark watched moves a show that still has episodes waiting to the bottom, so the others move back up in turn.
  Unaired episodes are never counted. A show moves between sections only if its TVmaze status changes. The Watching count (LIST-4) covers both sections. While searching, results are one list with group tags (SRCH-3/4), not sections.
- **LIST-15** The bottom of the main display, after the list (or the empty-state message, or search results), has V1's centered, muted, underlined link **About My Shows & how to use**, which opens the guide. It is shown on every segment and only on the main display.

### 4.3 Search (on the Shows screen)

- **SRCH-1** A search field sits above the segmented control.
- **SRCH-2** Search filters the user's own library by show name, case-insensitive, substring match.
- **SRCH-3** While search text is present, results span **all segments**, not just the selected one.
- **SRCH-4** Each search result row shows which group it is in (a group tag on the row).
- **SRCH-5** Clearing the search returns to the previously selected segment.
- **SRCH-6** No-match state reads: `No shows match "<text>"`.

### 4.4 Add flow

- **ADD-1** The **Add Show** button opens a TVmaze search screen (same search source and search behavior as V1).
- **ADD-2** The add form: tap a result to select it, enter **Watching on** (platform), answer **Where are you up to?**, then tap **Add show**. There is a single way to add a show; there is no "Save for later".
- **ADD-7** **Watching on** is **required**. If it is blank (or only spaces), **Add show** shows `Enter where you're watching it.` above the button and nothing is added. The error disappears as soon as the user types. The placeholder reads `e.g. Hulu, Netflix` so it can't be mistaken for a filled-in value.
- **ADD-8** **Where are you up to?** has three choices, shown in this order with exactly these labels; **Caught Up** is selected by default:
  - **Starting** — nothing watched; the next episode is the first one.
  - **Season/Episode last watched** — Season and Episode fields (both required, shown only when this choice is picked) give the last episode watched, as in V1.
  - **Caught Up** — every episode (specials included) that has aired by today is marked watched. A show still in production goes to **Waiting** (countdown if the next date is known, otherwise "Renewed - no date yet"); an ended show goes to **Done**. A show with nothing aired yet goes to Waiting.
- **ADD-3** The app places the added show automatically from its computed status: **Watching** if its next episode has aired, otherwise **Waiting** (or **Done** if it has ended and everything is watched). The user does not pick the segment.
- **ADD-4** A show still waiting for a new season can never be placed in Watching (follows from ADD-3).
- **ADD-5** After adding, the app returns to the main display on the segment the show was placed in. A large confirmation toast names it for about 5 seconds, e.g. `The Bear added to Waiting`, and the new show's row is highlighted for the same time. If the show's TVmaze data could not be loaded, the toast says so instead: `The Bear was added, but its episode details couldn't be loaded.`
- **ADD-6** A search result already in the library shows its current segment (e.g. `In Watching`) and cannot be selected again.

### 4.5 Show detail

- **DET-1** The tracked show detail screen is **the same as V1**: same content, layout and actions (including mark watched, suspend/resume and delete), plus the Previous/Next episode buttons in DET-6.
- **DET-2** Suspending a show moves it to the **Suspended** section of Waiting; resuming returns it to its computed segment.
- **DET-3** **Delete series** on the detail screen deletes the show **entirely** from the library, exactly as in V1: there is no confirmation step, no archive and no undo in the app. The deletion is pushed to the gist like any other change (see DATA-9).
- **DET-5** No ratings anywhere.
- **DET-6** Below Mark watched, the detail screen has **‹ Previous episode** and **Next episode ›** buttons that **change the user's progress** (they do not just browse):
  - **Previous** moves the last-watched episode back one (in air-date order, specials included), e.g. to undo an accidental Mark watched. From the first episode it means "nothing watched". Disabled when nothing has been watched.
  - **Next** marks the next episode watched without watching it (skip). It works for unaired episodes too. Disabled when there is no further episode.
  - The user stays on the detail screen; a toast confirms the new position (`Now up to S04E02 - Sundae`, or `Caught up on The Bear`). The show's segment updates from its new computed status, and the change is saved and synced like any other.
  - Not shown for suspended shows (progress is frozen until reactivated).

### 4.6 Settings

- **SET-1** Settings lists: **Sync** (status line + entry to the Sync screen), **Backup & restore**, **About / Guide**, **Changelog**.
- **SET-2** **Backup & restore** moves here from V1's header. Export downloads the V2 library as JSON. Restore accepts a V2 backup file, or a V1 backup file (SET-4), and replaces the whole library after validation and confirmation.
- **SET-4** **Restoring a V1 backup file** (a bare JSON array, as V1 downloads):
  - Works exactly like a V2 restore: after a confirmation it **replaces the whole V2 list**, on every device once it syncs. The confirmation says how many shows will be imported and how many can't be. If the V2 list is empty, the wording is "Import N show(s)…"; otherwise "Replace your list…".
  - Each entry is copied with only the DATA-2 fields; platform is trimmed; progress, `availableOrder` and suspended state come across. A show listed twice is imported once.
  - **Not imported** (listed afterwards, with the reason): entries with no "Watching on" platform (required in V2, ADD-7); entries saved by a very old V1 format (`watchedThrough`); entries that are incomplete or damaged. They are never converted or guessed at.
  - After the import a **V1 import** screen shows `N shows imported` and, under "Not imported — add these again with Add Show", each left-out show by name (looked up on TVmaze; `TVmaze show #id` if that fails) with its reason, then **Go to my shows**.
- **SET-3** The Sync screen in Settings shows the connection and allows **Sync now**, **Change token** and **Disconnect**.

### 4.7 Sync and first-run setup (user-facing)

- **SYN-1** Sync is **mandatory**. On first launch, and whenever no gist is connected, the app shows only the **Setup** screen (mockup 5.11). The main display, Add Show and Settings are not reachable until setup succeeds. The tool bar is hidden on Setup.
- **SYN-2** Setup asks for one thing only: a **Personal access token** (classic, `gist` scope). The user does not create a gist or enter a gist ID. Help text links to the README steps for creating the token.
- **SYN-3** On **Connect**, the app validates the token and shows a specific error for: bad token, token missing the `gist` scope, network failure, rate limit. The user stays on Setup until it succeeds.
- **SYN-4** First connect (fresh start, no local data). The app lists the user's gists and looks for one created by My Shows V2 (GST-17):
  - **None found** → the app creates a new **secret** gist containing `myshows.json` with an empty library. This is the first device.
  - **One found, valid V2 library** → that gist is used and its library is loaded. This is how a second device joins.
  - **More than one valid one found** → the user picks which to use from a list showing each gist's show count and last-updated date (mockup 5.15). The others are left unchanged.
  - **Only invalid ones found** (a `myshows.json` that is not a valid V2 library) → error shown; those files are **not** changed; Setup offers **Start a new gist**, which creates a new secret My Shows gist with an empty library (mockup 5.13).
  - When valid and invalid ones both exist, only the valid ones are used (single → loaded; several → picker). Invalid ones are ignored.
- **SYN-9** The gist ID the app found or created is stored in sync settings (DATA-5) and shown in Settings › Sync. The user never types it.
- **SYN-5** A sync status indicator shows one of: **Synced** (with last-synced time), **Syncing…**, **Offline — changes saved on this device**, **Sync error** (tap for detail). Placement and prominence: **OD-8**.
- **SYN-6** **Disconnect** removes the token, gist ID and the local working copy from this device, then returns to Setup. The data stays in the gist. Confirmation required.
- **SYN-7** A sync failure never discards or blocks local changes. Once connected, the app stays usable offline from the local working copy and pushes when the connection returns.
- **SYN-8** If the token is later rejected (expired or revoked), the app stays usable from the local copy, shows **Sync error — token rejected**, and offers **Change token**. It does not drop the user back to Setup.

---

## 5. Screen mockups

Mockups are iPhone width (~375 px) unless noted. They show structure and content, not final styling. `[ ]` = button, `( )` = text field, `▸` = navigable row, `●` = selected segment.

### 5.1 Shows — Watching (default)

```
┌─────────────────────────────────────┐
│  My Shows                     ⟳ ✓   │  ← wordmark = home link (NAV-7)
│  Version 2.6.1                      │     sync indicator (SYN-5, OD-8); version (VER-1)
│  ( 🔍 Search my shows            )  │
│                                     │
│ ┌───────────┬───────────┬─────────┐ │
│ │●Watching 7│ Waiting 12│ Done 9  │ │  ← selection boxes + counts (LIST-1, LIST-4)
│ └───────────┴───────────┴─────────┘ │
│                                     │
│  CURRENTLY RUNNING SHOWS            │  ← section 1 (LIST-14)
│  ┌───────────────────────────────┐  │
│  │  V1 show row (unchanged)      │  │  ← LIST-5: rows identical to V1
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │  V1 show row (unchanged)      │  │
│  └───────────────────────────────┘  │
│  ENDED SHOWS I'M BINGING            │  ← section 2 (LIST-14)
│  ┌───────────────────────────────┐  │
│  │  V1 show row (unchanged)      │  │
│  └───────────────────────────────┘  │
│    About My Shows & how to use      │  ← guide link (LIST-15)
├─────────────────────────────────────┤
│   ▣ Show     ＋ Add Show   ⚙ Settings │  ← tab bar (NAV-1)
└─────────────────────────────────────┘
```

### 5.2 Shows — Waiting

```
┌─────────────────────────────────────┐
│  My Shows                     ⟳ ✓   │
│  ( 🔍 Search my shows            )  │
│ ┌───────────┬───────────┬─────────┐ │
│ │ Watching 7│●Waiting 12│ Done 9  │ │  ← count includes both sections (LIST-12)
│ └───────────┴───────────┴─────────┘ │
│                                     │
│  WAITING FOR NEXT EPISODE OR SEASON │  ← section 1 (LIST-11), same as V1
│  ┌───────────────────────────────┐  │
│  │  V1 show row (unchanged)      │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │  V1 show row (unchanged)      │  │
│  └───────────────────────────────┘  │
│                                     │
│  SUSPENDED                          │  ← section 2 (LIST-11)
│  ┌───────────────────────────────┐  │
│  │  V1 show row (unchanged)      │  │
│  └───────────────────────────────┘  │
├─────────────────────────────────────┤
│   ▣ Show     ＋ Add Show   ⚙ Settings │
└─────────────────────────────────────┘
```

### 5.3 Shows — Done

```
┌─────────────────────────────────────┐
│ ┌───────────┬───────────┬─────────┐ │
│ │ Watching 7│ Waiting 12│●Done 9  │ │
│ └───────────┴───────────┴─────────┘ │
│  ┌───────────────────────────────┐  │  ← only ended shows with no
│  │  V1 show row (unchanged)      │  │     episodes left (LIST-6)
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │  V1 show row (unchanged)      │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

### 5.4 Shows — search active (spans all groups)

```
┌─────────────────────────────────────┐
│  My Shows                     ⟳ ✓   │
│  ( 🔍 the                     ✕ )   │
│                                     │
│  Results in all groups              │  ← segment control hidden/dimmed while searching
│                                     │
│  ┌───────────────────────────────┐  │
│  │  V1 show row       [Waiting]  │  │  ← V1 row + group tag (SRCH-4)
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │  V1 show row      [Watching]  │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │  V1 show row          [Done]  │  │
│  └───────────────────────────────┘  │
├─────────────────────────────────────┤
│   ▣ Show     ＋ Add Show   ⚙ Settings │
└─────────────────────────────────────┘
```

### 5.5 Empty segment (wording pending OD-5)

```
┌─────────────────────────────────────┐
│ ┌───────────┬───────────┬─────────┐ │
│ │●Watching 0│ Waiting 3 │ Done 1  │ │
│ └───────────┴───────────┴─────────┘ │
│                                     │
│        Nothing to watch right now.  │
│   Shows move here when a new        │
│   episode airs.                     │
│                                     │
│            [ Add a show ]           │
└─────────────────────────────────────┘
```

### 5.6 Add Show (ADD-2, ADD-7, ADD-8)

```
┌─────────────────────────────────────┐
│  My Shows                     ⟳ ✓   │
│  Version 2.6.1                      │  ← VER-1
│  Add show                           │
│  Search                             │
│  ( shogun                        )  │
│ ┌─────────────────────────────────┐ │
│ │▢ Shōgun       2024, FX on Hulu  │ │  ← selected
│ └─────────────────────────────────┘ │
│  Watching on (required)             │
│  ( Hulu                          )  │
│  Where are you up to?               │
│  ( ) Starting                       │
│  ( ) Season/Episode last watched    │
│      Season ( 1 )   Episode ( 4 )   │  ← shown only for this choice
│  (●) Caught Up                      │  ← default
│  [            Add show            ] │
├─────────────────────────────────────┤
│   ▣ Show     ＋ Add Show   ⚙ Settings │  ← hidden while typing (OD-11)
└─────────────────────────────────────┘
```

### 5.7 After adding — placed segment, highlight and toast (ADD-5)

```
┌─────────────────────────────────────┐
│ ┌───────────┬───────────┬─────────┐ │
│ │ Watching 7│●Waiting 13│ Done 9  │ │  ← opens on the placed segment
│ └───────────┴───────────┴─────────┘ │
│  ┃ Shōgun - Hulu                  ┃ │  ← highlighted ~5 s
│  ┃ Renewed - no date yet          ┃ │
│  ...                                │
│ ┌─────────────────────────────────┐ │
│ │ ✓ Shōgun added to Waiting       │ │  ← larger, ~5 s
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│   ▣ Show     ＋ Add Show   ⚙ Settings │
└─────────────────────────────────────┘
```

### 5.8 Show detail — tracked

```
┌─────────────────────────────────────┐
│  ←  Severance                       │  ← back arrow (NAV-8)
│                                     │
│  ┌───────────────────────────────┐  │
│  │                               │  │
│  │  V1 show detail screen        │  │  ← DET-1: content, layout and
│  │  (unchanged)                  │  │     actions identical to V1
│  │                               │  │
│  │  incl. suspend / resume       │  │  ← DET-2: suspended → Waiting ›
│  │  incl. delete                 │  │     Suspended; DET-3: delete is
│  │                               │  │     immediate and permanent (V1)
│  └───────────────────────────────┘  │
│  [      Mark watched             ]  │
│  [‹ Previous episode][Next episode ›]│  ← DET-6: change progress
│  Moves where you're up to back or   │
│  forward one episode.               │
├─────────────────────────────────────┤
│   ▣ Show     ＋ Add Show   ⚙ Settings │
└─────────────────────────────────────┘
```

### 5.10 Settings

```
┌─────────────────────────────────────┐
│  Settings                           │
│                                     │
│  Sync                             ▸ │
│  Synced 2 min ago                   │  ← or "Offline" / "Sync error"
│ ─────────────────────────────────── │
│  Backup & restore                 ▸ │  ← SET-2
│ ─────────────────────────────────── │
│  Guide                            ▸ │
│ ─────────────────────────────────── │
│  Changelog                        ▸ │
├─────────────────────────────────────┤
│   ▣ Show     ＋ Add Show   ⚙ Settings │
└─────────────────────────────────────┘
```

### 5.11 Setup — first launch (required, SYN-1)

```
┌─────────────────────────────────────┐
│  My Shows                           │  ← no back arrow, no tool bar
│                                     │
│  Welcome. My Shows keeps your list  │
│  in your own GitHub Gist so it's    │
│  the same on all your devices.      │
│  Connect a gist to get started.     │
│                                     │
│  Personal access token (gist scope) │  ← only input (SYN-2)
│  ( ••••••••••••••••              )  │
│                                     │
│  How to get a token ▸               │  ← README setup steps
│                                     │
│  [ Connect ]                        │  ← validates, then finds or
│                                     │     creates the gist (SYN-4)
│                                     │
│  ⚠ Token not valid or missing the   │  ← example error state
│    gist scope.                      │
└─────────────────────────────────────┘
```

### 5.12 Settings › Sync — connected

```
┌─────────────────────────────────────┐
│  ←  Sync                            │
│                                     │
│  ✓ Connected                        │
│  Gist a1b2c3d4…                     │
│  Last synced: today 6:42 AM         │
│                                     │
│  [ Sync now ]                       │  ← SET-3
│  [ Change token ]                   │  ← SYN-8
│  [ Disconnect this device ]         │  ← SYN-6: clears this device,
│                                     │     data stays in gist, back to Setup
├─────────────────────────────────────┤
│   ▣ Show     ＋ Add Show   ⚙ Settings │
└─────────────────────────────────────┘
```

### 5.13 Setup — gist contains an invalid file (SYN-4)

```
┌─────────────────────────────────────┐
│  My Shows                           │
│  ...                                │
│  ⚠ Your My Shows gist contains a    │
│    file that isn't a valid list.    │
│    It was not changed.              │
│                                     │
│  [ Start a new gist ]               │  ← creates a new empty My Shows
│                                     │     gist (SYN-4); old one untouched
└─────────────────────────────────────┘
```

### 5.15 Setup — more than one My Shows gist found (SYN-4)

```
┌─────────────────────────────────────┐
│  My Shows                           │  ← no back arrow, no tool bar
│                                     │
│  More than one My Shows list was    │
│  found in your GitHub account.      │
│  Choose the one to use.             │
│                                     │
│  ○ 42 shows · updated Oct 24, 2026  │
│    gist a1b2c3d4…                   │
│  ○ 7 shows · updated Mar 2, 2026    │
│    gist e5f6a7b8…                   │
│                                     │
│  The others are left unchanged.     │
│                                     │
│  [ Use this list ]                  │
└─────────────────────────────────────┘
```

### 5.14 iPad / Mac width

V2 uses the same single-column layout at all widths, centered with a maximum content width. Separate iPhone vs iPad/Mac layouts are not in V2 (see §12).

```
┌───────────────────────────────────────────────────────────────┐
│              My Shows                               ⟳ ✓       │
│              ( 🔍 Search my shows                      )      │
│              ┌─────────────┬─────────────┬─────────────┐      │
│              │ ●Watching 7 │  Waiting 12 │   Done 9    │      │
│              └─────────────┴─────────────┴─────────────┘      │
│              V1 show row (unchanged)                          │
│              V1 show row (unchanged)                          │
├───────────────────────────────────────────────────────────────┤
│                 ▣ Show       ＋ Add Show      ⚙ Settings        │
└───────────────────────────────────────────────────────────────┘
```

---

## 6. Data model and storage

- **DATA-1** The gist file `myshows.json` (GST-1) is the source of truth. The local working copy lives in `localStorage` under a **new** key, **`my-shows-library-v2`**. V2 never reads `my-shows-library-v1`.
- **DATA-2** Each library item uses the same fields as V1 (V1 data itself is never read):

  ```js
  {
    showId: 251,              // TVmaze show id (required, integer, unique in the library)
    platform: "Hulu",         // free text, may be ""
    watchedEpisodeId: 20865,  // TVmaze episode id of the last watched episode, or null
    pendingSeasonNumber: { season: 2, number: 8 },  // transient (Season/Episode last watched), resolved to watchedEpisodeId on first load
    pendingCaughtUp: true,    // transient (Caught Up), resolved to the last aired episode on first load
    availableOrder: 0,        // sort position within Watching (lower = higher)
    archived: false,          // suspended (shown in Waiting › Suspended)
    archivedAt: "2026-07-16", // date suspended
    archivedSnapshot: { lastWatchedCode, episodesLeftInSeason, seasonsRemaining }
  }
  ```
- **DATA-4** Watching / Waiting / Done are **derived** from episode data plus the existing suspended flag. They are never stored.
- **DATA-5** Sync settings live under a **separate** key, `my-shows-sync-v2`. Their presence is what decides whether Setup is shown (SYN-1):

  ```json
  {
    "gistId": "string",
    "token": "string",
    "lastSyncedAt": "ISO-8601 or null",
    "lastLocalChangeAt": "ISO-8601 or null"
  }
  ```

- **DATA-6** Sync settings are **never** included in backup files or in the gist.
- **DATA-7** Backup files use the same wrapper as the gist file (GST-1), so a backup and the gist payload are interchangeable.
- **DATA-8** Only the library is synced; UI state (selected segment, search text) is not.
- **DATA-9** A deleted show is removed from the library array. No tombstone or deleted flag is stored. With last-write-wins, the next push writes the library without it, so it is removed from the gist as well.

---

## 7. Sync design (GitHub Gist)

### 7.1 Gist file

- **GST-1** One file in the gist, named `myshows.json`:

  ```json
  {
    "app": "myshows",
    "schemaVersion": 1,
    "updatedAt": "2026-10-25T12:42:00Z",
    "library": [ /* same items as localStorage */ ]
  }
  ```

- **GST-2** The payload is validated by one V2 validation function before being applied. The same function validates backup imports.
- **GST-18** The same validation runs on the local library **before every push**. If it fails, nothing is written to the gist and **Sync error** is shown, so a bug can never overwrite a user's gist with a malformed list.
- **GST-17** The app creates the gist itself (one POST to `api.github.com/gists`) as a **secret** gist with the description `My Shows V2` and the single file `myshows.json`. On later connects (other devices, or after Disconnect or Change token), the app identifies its gist by the `myshows.json` filename together with `"app": "myshows"` inside it.

### 7.2 When sync runs

- **GST-3** **On app load (connected):** render immediately from the local working copy, then GET the gist. If remote `updatedAt` is newer than `lastLocalChangeAt`, apply remote. Otherwise keep local and push if local is newer than `lastSyncedAt`.
- **GST-4** **On every local change:** the change is saved locally first (via existing `saveLibrary()`), then a push (PATCH) is scheduled, debounced (≈2 s) so rapid edits make one request.
- **GST-5** **Sync now** forces the same steps as load.
- **GST-6** Behavior when the app returns to the foreground: **OD-6**.
- **GST-7** Conflict rule is **last-write-wins** by timestamp. No per-show merging. (Devices are not edited at the same time.)

### 7.3 Failure handling

- **GST-8** Offline / network error: keep local changes, show **Offline** status, retry on next change, next load, or Sync now.
- **GST-9** 401/403 (bad or expired token): show **Sync error — token rejected**; stop retrying until the user updates the token.
- **GST-10** 404 (gist not found, e.g. deleted on GitHub): show **Sync error — gist not found**, keep the local copy, and offer **Recreate gist**, which creates a new My Shows gist (GST-17) from the local copy.
- **GST-11** Rate limited: show status and retry no sooner than the reset time GitHub returns.
- **GST-12** Malformed remote file: do not apply it; show error; keep local.

### 7.4 Security and privacy

- **GST-13** The token is stored only in this device's `localStorage` and sent only to `api.github.com`.
- **GST-14** README states plainly: a GitHub account is required to use MyShows V2; a classic token with `gist` scope can read and write **all** of the user's gists; secret gists are unlisted, not private; tokens unused for a year are revoked by GitHub.
- **GST-15** Privacy statements in README / AGENTS.md list every external call: `api.tvmaze.com` (show data), `api.github.com` / `gist.githubusercontent.com` (the user's gist), and Statcounter analytics (V2's own project, invisible mode).
- **GST-19** Statcounter is included in `<head>`, above the main inline script (R-6), using the V2 project (13362516). It never sees the library or the token.
- **GST-16** No third-party library. Plain `fetch` only.

---

## 8. Architecture, code structure and testing

- **ARC-1** Single shipped file: `index.html` at the repository root (HTML + CSS + one main inline `<script>`). No build step, no framework. Other repository files: `CNAME`, `README.md`, `AGENTS.md`, `CLAUDE.md`, the test files, `guide/`, `changelog/` and `screenshots/` (images used by the README only; the app never loads them).
- **ARC-2** **One source of logic.** The pure functions live only inside the main inline script in `index.html`. There is no separate `logic.js`. Tests extract logic from `index.html`. V1 code may be copied in as a starting point, but nothing from V1 is kept unless this document requires it.
- **ARC-3** The inline script is organized in clearly commented sections, in this order:
  1. Constants and storage keys
  2. Pure logic (status computation, grouping, sorting, search, sync decisions) — no DOM, no fetch
  3. Storage (`loadLibrary`, `saveLibrary`, sync settings)
  4. TVmaze client
  5. Gist client
  6. Sync controller (scheduling, status)
  7. Rendering (one function per screen)
  8. Event wiring and `init()`
- **ARC-4** Every function has a short comment stating what it does, its inputs and its outputs. Section headers explain the section's job.
- **ARC-5** Sync is hooked only at `saveLibrary()` (push), load (pull) and Setup (first connect). No other code path calls the gist client.
- **ARC-6** V1 compatibility is limited to SET-4: one pure function (`splitV1Backup`) that splits a V1 backup into importable entries and listed skips. No reading of V1 storage keys and no conversion of old V1 formats.
- **TST-1** Unit tests cover: status grouping (Watching / Waiting / Done), suspended override, sorting, search across groups, Add placement (ADD-3/ADD-4), last-write-wins decisions, payload wrap/unwrap and validation, identifying the My Shows gist in a gist list, and each first-connect case (SYN-4).
- **TST-2** Integration tests (jsdom, mocked `fetch` and `localStorage`) cover: Setup shown on first launch and blocking the rest of the app, connect success and each connect error, tab navigation, segment switching and counts, search, both Add actions and toast, suspend/resume, delete, backup/restore in Settings, push on change, pull on load, offline use, token rejected after connect, disconnect, and every failure in §7.3.
- **TST-3** Fixtures are V2-only: a gist list with no My Shows gist (app creates one), with one valid My Shows gist, with one invalid My Shows gist, and with more than one.
- **TST-4** All tests pass before any file is handed over.
- **DOC-1** `README.md` opens with a short **"V2 vs V1"** section, before any setup steps, stating:
  - V1 (myshows.fyi, `CyberAdvisor/MyShows`) and V2 (v2.myshows.fyi, `CyberAdvisor/MyShows-v2`) are **totally separate** apps: separate code, separate sites, separate data.
  - V2 is intended for **automatic multi-device sync** through the user's own GitHub Gist, with some UI cleanups.
  - Moving from V1 is **one-way, by backup file** (SET-4): shows that can't come across are listed so the user can add them again.
  - V1 continues to work unchanged.
- **DOC-2** The "V2 vs V1" section includes a short comparison table:

  | | V1 | V2 |
  |---|---|---|
  | Address | myshows.fyi | v2.myshows.fyi |
  | Data stored | This browser only | Your GitHub Gist, synced to all your devices |
  | Multi-device | Manual backup file export/import | Automatic |
  | Requires | Nothing | GitHub account and a classic token with `gist` scope |
  | Main display | V1 groups | Watching / Waiting / Done with counts; Waiting split into "Waiting for next episode or season" and "Suspended" |
  | Navigation | Header icons | Bottom tool bar: Show / Add Show / Settings |
  | Moving data between them | Download a backup file | Restore a V1 backup file in V2 (one-way, V1 → V2) |

- **DOC-3** The rest of the README covers: token creation steps (linked from Setup, SYN-2), what the "My Shows V2" gist is and not to delete it (U-16), how to remove unwanted My Shows gists (U-17), and the security and privacy points in GST-14 and GST-15.

---

## 9. Deployment and test environment

- **DEP-1** V1 (`CyberAdvisor/MyShows`) keeps serving **myshows.fyi** via GitHub Pages and is not changed by V2 work.
- **DEP-2** V2 is published by **GitHub Pages** from the `main` branch of `CyberAdvisor/MyShows-v2`, with custom domain **v2.myshows.fyi** (repository `CNAME` file).
- **DEP-3** DNS: one CNAME record, `v2` → `cyberadvisor.github.io`. The existing myshows.fyi records are not changed. No wildcard records.
- **DEP-4** Enforce HTTPS is on for v2.myshows.fyi. Verifying myshows.fyi in GitHub account settings is recommended to prevent subdomain takeover.
- **DEP-5** **Testing is done in production** at v2.myshows.fyi. There is no separate test site. All automated tests (TST-4) must pass before anything is pushed to `main`.
- **DEP-6** Manual testing uses a dedicated test GitHub token, not the owner's everyday one, on real iPhone and iPad (Safari) and Mac Safari.
- **DEP-7** Because v2.myshows.fyi is a different origin from myshows.fyi, V1 and V2 `localStorage` are fully separate. V1 users are unaffected unless they choose to go to v2.myshows.fyi.

---

## 10. Decisions

All open decisions were settled on 2026-10-25 before the initial build.

| ID | Decision |
|---|---|
| OD-5 | Empty-state wording drafted by Claude; reviewed by Michael during testing. |
| OD-6 | Pull from the gist whenever the app returns to the foreground. (Changes are saved on the device immediately and pushed about 2 s later.) |
| OD-7 | Restore and Disconnect warning wording drafted by Claude; reviewed during testing. |
| OD-8 | Sync status indicator always visible in the header; tapping it opens Settings › Sync. |
| OD-10 | After adding, return to the main display on the segment the show was placed in. |
| OD-11 | The tool bar is hidden while the on-screen keyboard is open: a text field has focus on a touch screen. On a Mac or an iPad with a hardware keyboard it stays visible. |
| OD-12 | Waiting section 1: soonest air date first, "no date yet" shows last (alphabetical). Suspended: alphabetical. |
| OD-13 | Returning to the main display keeps the last-selected segment. |
| OD-14 | Only classic tokens with the `gist` scope are documented. |
| OD-15 | Want and "Save for later" are dropped. |
| OD-16 | The Waiting count includes both sections. |

## 11. Usability review notes

Items in the current design that could confuse users, to resolve or accept explicitly:

- **U-1 Shows that "disappear" after adding.** A new show may land in Waiting while the user expects Watching. ADD-5 (return to the placed segment, highlighted row, toast) addresses this.
- **U-19 "Caught up" is the default.** Someone adding a show they haven't started must change the choice to **Starting**; otherwise the show lands in Waiting or Done with every aired episode marked watched. The highlighted row and toast naming the segment make a wrong choice visible straight away; the fix is to delete and re-add the show.
- **U-2 Automatic moves between segments.** Shows move from Waiting to Watching on their own when an episode airs. The guide should explain this once; otherwise a user may think a show vanished from Waiting.
- **U-3 Suspended shows live under Waiting.** A suspended show with new episodes available stays in Waiting › Suspended, not Watching. The section heading makes this visible, but a user who suspended a show long ago may look for it in Done.
- **U-4 Search changes the segment control's meaning.** While searching, the segments do not filter. The control is hidden or dimmed during search (mockup 5.4) so it does not look active.
- **U-5 Two "home" controls.** The Show button and the wordmark both go home; they must behave identically (same segment per OD-13).
- **U-9 "Show" as a button label.** Singular "Show" can read as a verb ("show me") rather than "my shows". "Shows" or "My Shows" would remove the ambiguity.
- **U-11 Permanent delete with no confirmation (accepted as V1).** Delete removes the show immediately, and within seconds it also disappears from every device. Recovery is only from a backup file or the gist's revision history on GitHub. V1 has no confirmation step and DET-1/DET-3 keep it that way.
- **U-12 Waiting count.** If the Waiting count includes suspended shows (LIST-12), the number can be larger than what the user thinks of as "waiting". See OD-16.
- **U-6 Token entry on iPhone.** A 40-character token is impractical to type; help text should recommend pasting from a password manager or Notes.
- **U-13 Setup is a barrier to entry.** Every new user still needs a GitHub account and a classic token before seeing anything. The app creating the gist removes the gist steps, but token creation in GitHub's developer settings remains the hardest step for non-technical users.
- **U-17 Leftover gists.** Start a new gist and the picker both leave unused My Shows gists in the user's account. Each later connect on a new device shows the picker again (if more than one is valid). The picker's show count and date are the only way to tell them apart; the README should explain how to delete an unwanted one on GitHub.
- **U-16 A My Shows gist appears in the user's GitHub account.** Users who browse their gists will see a secret gist named "My Shows V2". Deleting it there removes their data from every device. The README should say what it is and not to delete it.
- **U-14 Existing V1 users.** A V1 backup file brings a V1 list across (SET-4); only shows without a platform or in a very old V1 format need re-adding, and the import screen lists them. Nothing in V1 tells users V2 exists. A V1 restore replaces the V2 list, like any restore, so restoring V1 over a V2 list already in use loses the V2 changes on every device.
- **U-18 Testing in production.** Anyone who finds v2.myshows.fyi sees work in progress, and a bad push affects real V2 users' sync immediately. A pushed bug that writes a malformed library could overwrite a user's gist (GST-12 only protects reads), so the payload validation should also run before every push.
- **U-15 Disconnect wipes this device.** Users may expect Disconnect to leave their list visible. The confirmation must say the list stays in the gist and will be reloaded on reconnect.

---

## 12. Out of scope for V2

- Ratings of any kind.
- Any change to V1 show rows or the V1 show detail screen beyond what §4 states.
- Archive, trash or undo for deleted shows.
- Using the app without a gist (local-only mode).
- Any V1 migration beyond SET-4: no reading of V1 `localStorage` data, no automatic copying, no conversion of old V1 formats, nothing from V2 back to V1.
- PWA install (manifest, service worker) — can be added later; independent of sync.
- Separate iPhone vs iPad/Mac layouts (e.g., side-by-side list and detail).
- Per-show merge or real-time conflict resolution.
- Supabase, Firebase, Airtable, iCloud Drive file sync (evaluated and not selected).
- Netlify or any separate test/staging site.
- Any change to V1 or to the myshows.fyi site.
- Any shared backend or account system.

---

## 13. Change log for this document

| Date | Change |
|---|---|
| 2026-10-25 | Initial draft from V2 planning decisions. |
| 2026-10-25 | Main display reduced to three selection boxes (Watching / Waiting / Done) with counts always shown; tool bar renamed Show / Add Show / Settings; Want placement moved to OD-15. |
| 2026-10-25 | Rows and detail screen kept identical to V1; Waiting split into "Waiting for next episode or season" and "Suspended" sections; Done limited to ended shows with no episodes left; delete is permanent. |
| 2026-10-25 | Gist sync made mandatory with a blocking first-run Setup screen; V2 starts fresh with no V1 data compatibility (new storage keys, V2-only fixtures); OD-3 removed; OD-18 added. V1 → V2 migration explicitly excluded; users recreate their shows. |
| 2026-10-25 | OD-4 settled: the app creates the gist from the token. Setup asks for the token only; the app finds or creates its secret gist (GST-17). OD-19 and OD-20 added. |
| 2026-10-25 | OD-19 settled: user picks when several My Shows gists exist (mockup 5.15). OD-20 settled: Setup offers "Start a new gist" when only invalid ones exist. |
| 2026-10-25 | V2 moved to its own repository (`CyberAdvisor/MyShows-v2`) served by GitHub Pages at v2.myshows.fyi; V1 stays at myshows.fyi unchanged. Netlify dropped; testing is done in production. OD-18 settled by separate hosting. |
| 2026-10-25 | README requirements added (DOC-1 to DOC-3): opens with a "V2 vs V1" section stating the apps are totally separate, V2 is for automatic multi-device sync with UI cleanups, and there is no migration. |
| 2026-10-25 | All open decisions settled (§10). Want dropped; Add uses the V1 form and returns to the placed segment; DATA-2 schema defined; GST-18 validate before push; Statcounter V2 project added (GST-19); DET-3 corrected (V1 has no delete confirmation). |
| 2026-10-25 | Initial build: OD-11 limited to touch screens (found while testing: on a Mac the tool bar vanished whenever a field had focus); dark-mode text on accent buttons made readable; Settings rows made real buttons. |
| 2026-10-25 | Version 2.1.0: Watching on required (ADD-7); "Where are you up to?" with Caught up / Not started / Partway, Caught up default (ADD-8, DATA-2 `pendingCaughtUp`); version line under the wordmark (VER-1); larger 5 s toast, row highlight and explicit load-failure message (ADD-5); add error clears on typing and platform placeholder made unambiguous (ADD-7); U-19 added. |
| 2026-10-25 | Version 2.1.1: ADD-8 choices renamed and reordered to Starting / Season/Episode last watched / Caught Up (Caught Up still the default). |
| 2026-10-25 | Version 2.2.0: Previous / Next episode buttons on the detail screen change the user's progress (DET-6); DET-1 updated to include them. |
| 2026-10-25 | Version 2.3.0: V1 backup files can be restored into V2 (SET-4), replacing the list after confirmation like any restore; shows without a platform or in a very old V1 format are left out and listed with the reason. C-5, SET-2, ARC-6, DOC-1/2, U-14 and §12 updated. |
| 2026-10-25 | Version 2.4.0: Watching order changed to two tiers (LIST-14): one episode waiting (newest aired first), then several waiting (V1 sink order). LIST-9 updated. |
| 2026-10-25 | Version 2.5.0: Watching order (LIST-14) changed to current shows first, newest released episode first, then ended shows in V1 sink order. Replaces the 2.4.0 one-waiting / several-waiting tiers. |
| 2026-10-25 | Version 2.6.0: Watching split into two headed sections, "Currently running shows" and "Ended shows I'm binging" (LIST-14), by TVmaze status; order within each unchanged from 2.5.0; mockup 5.1 updated. |
| 2026-10-25 | Version 2.6.1: V1's "About My Shows & how to use" guide link added under the main display (LIST-15); mockup 5.1 updated. |
| 2026-10-25 | README: screenshots of the Watching list and a show's detail screen added under "What it does" (`screenshots/`, ARC-1). No app change. |
