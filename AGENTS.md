# My Shows V2 contributor guide

`CLAUDE.md` is the design document and the single source of truth for V2: every requirement (by ID), decision, mockup and usability note. Read it before changing anything, and don't build anything it doesn't describe.

## Project layout

- `index.html` is the shipped app, served at the site root (v2.myshows.fyi). It is a self-contained vanilla HTML/CSS/JavaScript file.
- `guide/index.html` and `changelog/index.html` are separate static pages, linked from Settings.
- `sitemap.xml` and `robots.txt` are for search engines (CLAUDE.md DEP-8). When you add a page, add it to the sitemap; when a page changes, update its `<lastmod>`. `logic.test.js` checks every sitemap URL has a matching page.
- `screenshots/` holds the images shown in `README.md`. The app doesn't use them; retake them when the screens they show change.
- `logic.test.js` contains unit tests and `app.test.js` is a jsdom integration suite. Both read the code straight out of `index.html`; there is **no** separate `logic.js` to keep in sync.
- V2 is a separate app from V1 (`CyberAdvisor/MyShows`, myshows.fyi). Never read V1 storage keys. The one V1 path is restoring a V1 **backup file** (`splitV1Backup` / `importV1Backup`, CLAUDE.md SET-4): entries are copied with only the DATA-2 fields, and anything that can't be imported is listed for the user, never converted.

## Development rules

- Keep the product dependency-free: no framework, build step, or backend.
- Preserve the mobile-first, simple, readable UI. The app must work as a static HTTPS site, particularly on iPhone Safari.
- Keep the main inline script in the section order in `CLAUDE.md` ARC-3, and keep the `// === PURE LOGIC START ===` / `// === PURE LOGIC END ===` markers: `logic.test.js` loads everything above the END marker, so that part must not touch the DOM, network or storage.
- Every user change goes through `saveLibrary()`, which saves on the device and schedules a push to the gist. Changes that come *from* the gist use `writeLocalLibrary()` so they aren't pushed back. Nothing else calls the gist client except Setup, Change token and Recreate gist.
- The local working copy is `localStorage['my-shows-library-v2']`; the token and gist id are in `localStorage['my-shows-sync-v2']`. Neither goes into backups or the gist file except the library itself.
- Validate before every push (GST-18). Never write a library to the gist that fails `isValidLibrary`.
- Treat `watchedEpisodeId` as the persistent progress identifier. Do not persist season/episode numbers instead: several TVmaze specials can share a season with no episode number.
- Fetch episodes with `/shows/:id/episodes?specials=1`. The `?embed=episodes` shortcut omits specials.
- Keep text inputs stable while results update (Add Show search, main-display search, Setup token, Change token). Replacing an input while typing loses focus on iOS Safari. Sync updates must only touch the header indicator or a results container, never rebuild a screen whose input has focus.
- Preserve suspend ("archive") as an override layered on computed status, with a frozen snapshot, so reactivating is a flag flip.
- Do not add a `<script>` tag after the main inline script. The tests extract it with a greedy regex; analytics and any other script tags belong in `<head>` before it.

## Verification

Run from the repository root:

```sh
npm install jsdom
node logic.test.js
node app.test.js
```

Add or update tests for every behavior change — especially episode ordering, progress, segments, search, sync decisions, every sync failure path, backup/restore and suspend.

**Testing happens in production** (v2.myshows.fyi has no staging copy), so both suites must pass before anything is pushed to `main`. Use a dedicated test GitHub token for manual testing.

## Documentation and deployment

- Update `README.md`, `guide/index.html`, `changelog/index.html` and `CLAUDE.md` when a user-visible workflow changes.
- GitHub Pages serves this repository as a static HTTPS site; `CNAME` sets v2.myshows.fyi. Avoid anything that assumes server-side routing or APIs.
- Keep privacy statements accurate: external calls are TVmaze (show data), GitHub (the user's own gist) and the documented Statcounter beacon. The token stays on the device and is sent only to GitHub.
