// Unit tests for the pure logic in index.html (CLAUDE.md TST-1).
// There is no separate logic.js (ARC-2): the code from the top of the main
// inline script down to the "=== PURE LOGIC END ===" marker is extracted
// and run on its own, with no DOM. Run with: node logic.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const scriptBody = html.match(/<script>([\s\S]*)<\/script>/)[1];
const endMarker = '// === PURE LOGIC END ===';
assert.ok(scriptBody.includes(endMarker), 'index.html must keep the PURE LOGIC END marker');
const logicSource = scriptBody.slice(0, scriptBody.indexOf(endMarker));
assert.ok(!/document\.|window\.|fetch\(|localStorage/.test(logicSource.slice(logicSource.indexOf('// === PURE LOGIC START ==='))),
  'the pure logic section must not touch the DOM, network or storage');
// Run in this realm (not a vm context) so objects compare with deepStrictEqual.
const names = [...logicSource.matchAll(/^(?:function|var) (\w+)/gm)].map(m => m[1]);
const L = new Function(logicSource + '\nreturn { ' + names.join(', ') + ' };')();

const {
  sortedEpisodes, findWatchedIndex, findEpisodeIdBySeasonNumber,
  computeShowStatus, formatCountdown, isSpecial, formatEpisodeCode,
  nextTopAvailableOrder, nextBottomAvailableOrder,
  episodesLeftInSeason, seasonsRemaining, withArchiveOverride, buildArchiveSnapshot,
  segmentForStatus, displaySegment, groupTagLabel, buildSegments, segmentCounts, searchEntries,
  isValidLibraryItem, isValidLibrary, wrapPayload, isValidPayload, parsePayloadText,
  decideSync, nextTimestamp, findCandidateGistIds, classifyCandidates, describeSyncError, formatSyncTime,
  lastAiredEpisodeId, APP_VERSION, stepWatchedEpisode, splitV1Backup, V1_SKIP_REASONS,
  classifyLoadFailure, storedShowName, rememberShowName, buildFailedEntries, throttleDelay,
  localDateString, progressLost, rememberWatchedCode, isStale, searchErrorText
} = L;

// =====================================================================
// Reliability fixes (§4.9)
// =====================================================================

// --- DATE-1: today is the local date, not UTC ---
{
  const savedTz = process.env.TZ;
  process.env.TZ = 'America/Denver';
  const evening = new Date('2026-07-13T03:00:00Z'); // 9 PM on July 12 in Denver
  assert.strictEqual(evening.toISOString().slice(0, 10), '2026-07-13', 'UTC is already tomorrow');
  assert.strictEqual(localDateString(evening), '2026-07-12', 'local date is still today');
  assert.strictEqual(localDateString(new Date(2026, 0, 5, 0, 1)), '2026-01-05', 'zero-padded, just after midnight');
  process.env.TZ = savedTz === undefined ? '' : savedTz;
  if (savedTz === undefined) delete process.env.TZ;
}

// --- LOAD-12 / LOAD-13: changed episodes and the last-watched code ---
{
  const eps = [{ id: 1, season: 1, number: 1 }, { id: 2, season: 1, number: null }];
  assert.strictEqual(progressLost(eps, null), false, 'never started is not lost');
  assert.strictEqual(progressLost(eps, 1), false);
  assert.strictEqual(progressLost(eps, 99), true, 'stored episode no longer on TVmaze');
  assert.strictEqual(progressLost([], 5), true);

  const item = { showId: 1, watchedEpisodeId: 1 };
  assert.strictEqual(rememberWatchedCode(item, eps), true);
  assert.strictEqual(item.watchedCode, 'S01E01');
  assert.strictEqual(rememberWatchedCode(item, eps), false, 'unchanged');
  item.watchedEpisodeId = 2;
  assert.strictEqual(rememberWatchedCode(item, eps), true);
  assert.strictEqual(item.watchedCode, 'S01 Special', 'specials have a code too');
  item.watchedEpisodeId = 99;
  assert.strictEqual(rememberWatchedCode(item, eps), false, 'a vanished episode keeps the last known code');
  assert.strictEqual(item.watchedCode, 'S01 Special');
  item.watchedEpisodeId = null;
  assert.strictEqual(rememberWatchedCode(item, eps), true, 'back to nothing watched clears it');
  assert.ok(!('watchedCode' in item));
  assert.ok(isValidLibraryItem({ showId: 1, watchedCode: 'S01E01' }));
  assert.ok(!isValidLibraryItem({ showId: 1, watchedCode: 3 }), 'watchedCode must be a string');
}

// --- LOAD-14: staleness ---
{
  const H = 3600000;
  assert.strictEqual(isStale(0, 13 * H, 12 * H), true, 'never loaded counts as stale');
  assert.strictEqual(isStale(1 * H, 12 * H, 12 * H), false, '11 hours old');
  assert.strictEqual(isStale(1 * H, 14 * H, 12 * H), true, '13 hours old');
}

// --- ADD-10: search errors in plain words, with the detail ---
{
  const http = s => Object.assign(new Error('TVmaze returned ' + s), { status: s });
  assert.strictEqual(searchErrorText(new TypeError('Failed to fetch')),
    'Couldn’t reach TVmaze. Check your connection and try again. (Failed to fetch)');
  assert.strictEqual(searchErrorText(http(429)), 'TVmaze is busy. Wait a moment and try again. (TVmaze returned 429)');
  assert.strictEqual(searchErrorText(http(503)), 'TVmaze returned an error. Try again. (TVmaze returned 503)');
}

// =====================================================================
// Show load failures (§4.8)
// =====================================================================

// --- LOAD-3: classification ---
{
  const httpError = status => Object.assign(new Error('TVmaze returned ' + status), { status });
  assert.strictEqual(classifyLoadFailure(httpError(404)), 'gone', '404: TVmaze no longer has the show');
  [429, 500, 502, 503, 504].forEach(s => assert.strictEqual(classifyLoadFailure(httpError(s)), 'temporary', s + ' is temporary'));
  assert.strictEqual(classifyLoadFailure(new TypeError('Load failed')), 'temporary', 'no response is temporary');
  assert.strictEqual(classifyLoadFailure(new SyntaxError('Unexpected token')), 'temporary', 'unreadable data is temporary');
  assert.strictEqual(classifyLoadFailure(undefined), 'temporary');
}

// --- LOAD-1: stored names ---
{
  assert.strictEqual(storedShowName({ showId: 7, name: 'Severance' }), 'Severance');
  assert.strictEqual(storedShowName({ showId: 7 }), 'TVmaze show #7', 'no name stored yet');
  const item = { showId: 7 };
  assert.strictEqual(rememberShowName(item, { name: 'Severance' }), true, 'new name');
  assert.strictEqual(item.name, 'Severance');
  assert.strictEqual(rememberShowName(item, { name: 'Severance' }), false, 'unchanged');
  assert.strictEqual(rememberShowName(item, { name: 'Severance (2022)' }), true, 'renamed on TVmaze');
  assert.strictEqual(rememberShowName(item, { name: '' }), false, 'blank names are ignored');
  assert.strictEqual(rememberShowName(item, {}), false);
  assert.strictEqual(item.name, 'Severance (2022)');
  assert.ok(isValidLibraryItem({ showId: 1, name: 'X' }) && isValidLibraryItem({ showId: 1 }), 'name is optional');
  assert.ok(!isValidLibraryItem({ showId: 1, name: null }), 'name must be a string when present');
}

// --- LOAD-4: Couldn't load entries, A-Z, only failed shows ---
{
  const library = [{ showId: 1, name: 'Zeta' }, { showId: 2 }, { showId: 3, name: 'Alpha' }, { showId: 4, name: 'Loaded' }];
  const entries = buildFailedEntries(library, { 1: 'temporary', 2: 'gone', 3: 'temporary' });
  assert.deepStrictEqual(entries.map(e => [e.show.name, e.failure]),
    [['Alpha', 'temporary'], ['TVmaze show #2', 'gone'], ['Zeta', 'temporary']]);
  assert.strictEqual(entries[0].item, library[2], 'entries carry the library item');
  assert.deepStrictEqual(buildFailedEntries(library, {}), []);
  assert.deepStrictEqual(searchEntries(entries, 'zet').map(e => e.show.name), ['Zeta'], 'LOAD-10: searchable by name');
}

// --- LOAD-2: pacing ---
{
  assert.strictEqual(throttleDelay([], 0, 20, 10000), 0, 'nothing sent yet');
  const nineteen = Array.from({ length: 19 }, (_, i) => i * 10);
  assert.strictEqual(throttleDelay(nineteen, 500, 20, 10000), 0, 'under the limit');
  const twenty = nineteen.concat([190]);
  assert.strictEqual(throttleDelay(twenty, 500, 20, 10000), 9500, 'wait until the oldest leaves the window');
  assert.strictEqual(throttleDelay(twenty, 10000, 20, 10000), 0, 'oldest has left the window');
  assert.strictEqual(throttleDelay([0, 100, 200], 250, 2, 300), 150, 'only the most recent `max` matter');
}

const TODAY = '2026-07-12';

// =====================================================================
// Carried over from V1 (episode ordering, specials, status, snapshots)
// =====================================================================

// --- sortedEpisodes: regular episodes ---
{
  const raw = [
    { id: 2, season: 1, number: 2, airdate: '2026-01-08' },
    { id: 1, season: 1, number: 1, airdate: '2026-01-01' },
    { id: 3, season: null, number: null, airdate: '2026-01-01', name: 'no season at all - excluded' }
  ];
  const sorted = sortedEpisodes(raw);
  assert.strictEqual(sorted.length, 2, 'excludes entries with no season at all');
  assert.strictEqual(sorted[0].number, 1, 'sorts ascending by airdate');
}

// --- sortedEpisodes: specials included and positioned by airdate ---
{
  const raw = [
    { id: 1, season: 2, number: 1, airdate: '2026-01-01', name: 'S2E1' },
    { id: 2, season: 2, number: 2, airdate: '2026-01-08', name: 'S2E2' },
    { id: 3, season: 2, number: null, airdate: '2026-01-15', name: 'Christmas Special', type: 'significant_special' },
    { id: 4, season: 3, number: 1, airdate: '2026-02-01', name: 'S3E1' }
  ];
  const sorted = sortedEpisodes(raw);
  assert.strictEqual(sorted.length, 4, 'specials are no longer dropped');
  assert.strictEqual(sorted[2].name, 'Christmas Special', 'special slots into its correct chronological position');
  assert.ok(isSpecial(sorted[2]), 'isSpecial correctly identifies number:null episodes');
  assert.strictEqual(sorted[3].name, 'S3E1', 'season 3 premiere still comes after the special, by date');
}

// --- formatEpisodeCode ---
{
  assert.strictEqual(formatEpisodeCode({ season: 4, number: 3 }), 'S04E03');
  assert.strictEqual(formatEpisodeCode({ season: 2, number: null }), 'S02 Special');
}

// --- findWatchedIndex: matches by unique id, not season/number ---
{
  const episodes = [
    { id: 101, season: 1, number: 1 },
    { id: 102, season: 1, number: 2 },
    { id: 103, season: 1, number: 3 }
  ];
  assert.strictEqual(findWatchedIndex(episodes, 102), 1);
  assert.strictEqual(findWatchedIndex(episodes, null), -1, 'no watched id means -1 (start from episode 0)');
  assert.strictEqual(findWatchedIndex(episodes, 999), -1, 'unmatched id');
}

// --- findEpisodeIdBySeasonNumber: resolves user-entered season/number to an id ---
{
  const episodes = [
    { id: 101, season: 1, number: 1 },
    { id: 102, season: 1, number: 2 }
  ];
  assert.strictEqual(findEpisodeIdBySeasonNumber(episodes, 1, 2), 102);
  assert.strictEqual(findEpisodeIdBySeasonNumber(episodes, 9, 9), null, 'no match returns null');
}

// --- THE ACTUAL REPORTED BUG: two specials in the same season both have
// season set + number:null (real TVmaze data for Downton Abbey S2: "Behind
// the Drama" and "Christmas at Downton Abbey" are both season:2, number:null).
// Matching on season+number collapses them into one identifier, so marking
// the second one watched looks like a no-op. Matching on id fixes this. ---
{
  const episodes = sortedEpisodes([
    { id: 8, season: 2, number: 8, airdate: '2011-11-06', name: 'Episode 8' },
    { id: 88, season: 2, number: null, airdate: '2011-12-21', name: 'Behind the Drama' },
    { id: 241, season: 2, number: null, airdate: '2011-12-25', name: 'Christmas at Downton Abbey' },
    { id: 66, season: 3, number: 1, airdate: '2012-09-16', name: 'S3E1' }
  ]);

  const watchedId = findEpisodeIdBySeasonNumber(episodes, 2, 8);
  let status = computeShowStatus({ status: 'Ended' }, episodes, watchedId, TODAY);
  assert.strictEqual(status.nextEpisode.name, 'Behind the Drama', 'first special after S2E8 is Behind the Drama (earlier airdate)');

  let newWatchedId = status.nextEpisode.id;
  status = computeShowStatus({ status: 'Ended' }, episodes, newWatchedId, TODAY);
  assert.strictEqual(status.nextEpisode.name, 'Christmas at Downton Abbey', 'advances correctly to the second special');

  newWatchedId = status.nextEpisode.id;
  status = computeShowStatus({ status: 'Ended' }, episodes, newWatchedId, TODAY);
  assert.strictEqual(status.nextEpisode.name, 'S3E1', 'REGRESSION CHECK: marking the second special watched correctly advances to season 3, not stuck in place');
}

// --- computeShowStatus: available now (already aired) ---
{
  const episodes = [
    { id: 1, season: 1, number: 1, airdate: '2026-07-01' },
    { id: 2, season: 1, number: 2, airdate: '2026-07-08' }
  ];
  const status = computeShowStatus({ status: 'Running' }, episodes, 1, TODAY);
  assert.strictEqual(status.group, 'available');
  assert.strictEqual(status.nextEpisode.number, 2);
}

// --- computeShowStatus: upcoming (future airdate) ---
{
  const episodes = [
    { id: 1, season: 1, number: 1, airdate: '2026-07-01' },
    { id: 2, season: 1, number: 2, airdate: '2026-07-16' }
  ];
  const status = computeShowStatus({ status: 'Running' }, episodes, 1, TODAY);
  assert.strictEqual(status.group, 'upcoming');
  assert.strictEqual(status.daysUntil, 4, 'July 12 -> July 16 is 4 days');
}

// --- computeShowStatus: nothing watched yet -> next is episode 0 ---
{
  const episodes = [
    { id: 1, season: 1, number: 1, airdate: '2026-06-01' },
    { id: 2, season: 1, number: 2, airdate: '2026-06-08' }
  ];
  const status = computeShowStatus({ status: 'Running' }, episodes, null, TODAY);
  assert.strictEqual(status.nextEpisode.number, 1, 'unwatched show starts at episode 1');
  assert.strictEqual(status.group, 'available', 'already-aired episode 1 is available now');
}

// --- computeShowStatus: caught up, still running -> pending return ---
{
  const episodes = [
    { id: 1, season: 1, number: 1, airdate: '2026-06-01' },
    { id: 2, season: 1, number: 2, airdate: '2026-06-08' }
  ];
  const status = computeShowStatus({ status: 'Running' }, episodes, 2, TODAY);
  assert.strictEqual(status.group, 'pending');
  assert.strictEqual(status.nextEpisode, null);
}

// --- computeShowStatus: caught up, series ended -> completed ---
{
  const episodes = [{ id: 1, season: 1, number: 1, airdate: '2026-06-01' }];
  const status = computeShowStatus({ status: 'Ended' }, episodes, 1, TODAY);
  assert.strictEqual(status.group, 'completed');
}

// --- computeShowStatus: "am I on S4E3" semantics -> S4E3 itself is next up, not watched ---
{
  const episodes = [
    { id: 1, season: 4, number: 1, airdate: '2026-01-01' },
    { id: 2, season: 4, number: 2, airdate: '2026-01-08' },
    { id: 3, season: 4, number: 3, airdate: '2026-01-15' },
    { id: 4, season: 4, number: 4, airdate: '2026-01-22' }
  ];
  const watchedId = findEpisodeIdBySeasonNumber(episodes, 4, 2);
  const status = computeShowStatus({ status: 'Running' }, episodes, watchedId, TODAY);
  assert.strictEqual(status.nextEpisode.number, 3, 'entering "S4E3" surfaces S4E3 as next, not S4E4');
}

// --- nextTopAvailableOrder / nextBottomAvailableOrder ---
{
  assert.strictEqual(nextTopAvailableOrder([]), -1, 'first-ever top placement is -1 (above baseline 0)');
  assert.strictEqual(nextBottomAvailableOrder([]), 1, 'first-ever bottom placement is 1 (below baseline 0)');

  const items = [{ availableOrder: -1 }, { availableOrder: 0 }, { availableOrder: 3 }];
  assert.strictEqual(nextTopAvailableOrder(items), -2, 'top placement goes below the current minimum');
  assert.strictEqual(nextBottomAvailableOrder(items), 4, 'bottom placement goes above the current maximum');

  const untouchedItems = [{}, {}]; // no availableOrder field at all (pre-existing library items)
  assert.strictEqual(nextTopAvailableOrder(untouchedItems), -1, 'items missing availableOrder default to 0 for this calculation');
}
// --- formatCountdown ---
{
  assert.strictEqual(formatCountdown(0, TODAY), 'Today');
  assert.strictEqual(formatCountdown(1, '2026-07-13'), 'Tomorrow');
  assert.ok(formatCountdown(3, '2026-07-15').includes('3 days'));
  assert.ok(formatCountdown(30, '2026-08-11').match(/Aug/), 'far-future dates show a calendar date, not a day count');
}

// --- episodesLeftInSeason ---
{
  const episodes = sortedEpisodes([
    { id: 1, season: 2, number: 1, airdate: '2026-01-01' },
    { id: 2, season: 2, number: 2, airdate: '2026-01-08' },
    { id: 3, season: 2, number: 3, airdate: '2026-01-15' },
    { id: 4, season: 2, number: 4, airdate: '2026-01-22' },
    { id: 5, season: 3, number: 1, airdate: '2026-06-01' }
  ]);
  assert.strictEqual(episodesLeftInSeason(episodes, episodes[1]), 3, 'next episode counts itself plus the rest of its season (S2E2, E3, E4 = 3)');
  assert.strictEqual(episodesLeftInSeason(episodes, episodes[3]), 1, 'last episode of a season counts as 1 left (itself)');
  assert.strictEqual(episodesLeftInSeason(episodes, null), 0, 'no next episode (caught up) means 0 left');
  assert.strictEqual(episodesLeftInSeason(episodes, { id: 999, season: 2 }), 0, 'an episode not found in the list returns 0 rather than throwing');
}

// --- episodesLeftInSeason: specials count toward their season's total ---
{
  const episodes = sortedEpisodes([
    { id: 8, season: 2, number: 8, airdate: '2011-11-06', name: 'Episode 8' },
    { id: 88, season: 2, number: null, airdate: '2011-12-21', name: 'Behind the Drama' },
    { id: 241, season: 2, number: null, airdate: '2011-12-25', name: 'Christmas at Downton Abbey' },
    { id: 66, season: 3, number: 1, airdate: '2012-09-16', name: 'S3E1' }
  ]);
  assert.strictEqual(episodesLeftInSeason(episodes, episodes[0]), 3, 'S2E8 plus the two season-2 specials that follow it = 3 left');
}

// --- seasonsRemaining ---
{
  const episodes = sortedEpisodes([
    { id: 1, season: 1, number: 1, airdate: '2026-01-01' },
    { id: 2, season: 2, number: 1, airdate: '2026-02-01' },
    { id: 3, season: 3, number: 1, airdate: '2026-03-01' }
  ]);
  assert.deepStrictEqual(seasonsRemaining(episodes, episodes[0]), { remaining: 2, total: 3 }, 'on season 1 of 3, seasons 2 and 3 remain');
  assert.deepStrictEqual(seasonsRemaining(episodes, episodes[2]), { remaining: 0, total: 3 }, 'on the final season, nothing remains');
  assert.deepStrictEqual(seasonsRemaining(episodes, null), { remaining: 0, total: 3 }, 'no next episode (caught up) reports 0 remaining but still the correct total');
}

// --- seasonsRemaining: single-season show ---
{
  const episodes = sortedEpisodes([
    { id: 1, season: 1, number: 1, airdate: '2026-01-01' },
    { id: 2, season: 1, number: 2, airdate: '2026-01-08' }
  ]);
  assert.deepStrictEqual(seasonsRemaining(episodes, episodes[0]), { remaining: 0, total: 1 }, 'a single-season show has 0 remaining, 1 total');
}

// --- withArchiveOverride ---
{
  const availableStatus = { group: 'available', nextEpisode: { id: 1, season: 1, number: 1 } };
  assert.deepStrictEqual(withArchiveOverride(availableStatus, false), availableStatus, 'not archived: real status passes through unchanged');
  assert.strictEqual(withArchiveOverride(availableStatus, undefined), availableStatus, 'undefined archived flag (pre-existing data) behaves as not archived');

  const archivedResult = withArchiveOverride(availableStatus, true);
  assert.strictEqual(archivedResult.group, 'completed', 'archived show always reports as completed, regardless of real status');
  assert.strictEqual(archivedResult.nextEpisode, null, 'archived show has no actionable next episode');
  assert.strictEqual(archivedResult.archived, true, 'archived flag carries through onto the returned status');

  const upcomingStatus = { group: 'upcoming', nextEpisode: { airdate: '2027-01-01' }, daysUntil: 100 };
  assert.strictEqual(withArchiveOverride(upcomingStatus, true).group, 'completed', 'even a show with a known future episode is overridden to completed once archived');
}

// --- buildArchiveSnapshot ---
{
  const episodes = sortedEpisodes([
    { id: 1, season: 1, number: 1, airdate: '2026-01-01' },
    { id: 2, season: 1, number: 2, airdate: '2026-01-08' },
    { id: 3, season: 1, number: 3, airdate: '2026-01-15' },
    { id: 4, season: 2, number: 1, airdate: '2026-06-01' }
  ]);

  const snap = buildArchiveSnapshot(episodes, 2, episodes[2]); // watched S1E2, next is S1E3
  assert.strictEqual(snap.lastWatchedCode, 'S01E02');
  assert.strictEqual(snap.episodesLeftInSeason, episodesLeftInSeason(episodes, episodes[2]), 'matches episodesLeftInSeason computed directly (S1E3 itself = 1 left)');
  assert.deepStrictEqual(snap.seasonsRemaining, seasonsRemaining(episodes, episodes[2]), 'matches seasonsRemaining computed directly (season 2 remains = 1 of 2)');

  const snapNothingWatched = buildArchiveSnapshot(episodes, null, episodes[0]);
  assert.strictEqual(snapNothingWatched.lastWatchedCode, 'Not started', 'no watched episode yet reports "Not started" rather than a bogus code');

  const snapCaughtUp = buildArchiveSnapshot(episodes, 4, null); // watched everything, no next episode
  assert.strictEqual(snapCaughtUp.lastWatchedCode, 'S02E01', 'last watched still resolves correctly even with no next episode');
  assert.strictEqual(snapCaughtUp.episodesLeftInSeason, 0, 'no next episode means 0 episodes left in season');
  assert.deepStrictEqual(snapCaughtUp.seasonsRemaining, { remaining: 0, total: 2 }, 'no next episode means 0 seasons remaining, but total is still reported');
}


// =====================================================================
// V2: segments (LIST-6, LIST-12, LIST-13, OD-12, OD-16)
// =====================================================================

// --- segmentForStatus / displaySegment / groupTagLabel ---
{
  assert.strictEqual(segmentForStatus({ group: 'available' }), 'watching');
  assert.strictEqual(segmentForStatus({ group: 'upcoming' }), 'waiting');
  assert.strictEqual(segmentForStatus({ group: 'pending' }), 'waiting');
  assert.strictEqual(segmentForStatus({ group: 'completed' }), 'done');
  const suspended = withArchiveOverride({ group: 'available', nextEpisode: {} }, true);
  assert.strictEqual(segmentForStatus(suspended), 'suspended', 'suspended shows are their own section');
  assert.strictEqual(displaySegment(suspended), 'waiting', 'suspended shows sit inside the Waiting box, not Done');
  assert.strictEqual(groupTagLabel(suspended), 'Suspended');
  assert.strictEqual(groupTagLabel({ group: 'pending' }), 'Waiting');
  assert.strictEqual(groupTagLabel({ group: 'completed' }), 'Done');
}

// --- LIST-13: an ended show with unwatched episodes is Watching, not Done ---
{
  const episodes = [{ id: 1, season: 1, number: 1, airdate: '2020-01-01' }, { id: 2, season: 1, number: 2, airdate: '2020-01-08' }];
  const status = computeShowStatus({ status: 'Ended' }, episodes, 1, TODAY);
  assert.strictEqual(segmentForStatus(status), 'watching');
  assert.strictEqual(segmentForStatus(computeShowStatus({ status: 'Ended' }, episodes, 2, TODAY)), 'done', 'ended and fully watched is Done');
}

// --- buildSegments: membership and sort order ---
{
  const e = (name, status, order) => ({ show: { name }, status, availableOrder: order || 0 });
  const entries = [
    e('Later', { group: 'upcoming', nextEpisode: { airdate: '2026-09-01' } }),
    e('Zed Pending', { group: 'pending', nextEpisode: null }),
    e('Sooner', { group: 'upcoming', nextEpisode: { airdate: '2026-07-20' } }),
    e('Alpha Pending', { group: 'pending', nextEpisode: null }),
    e('Top', { group: 'available', ended: true, nextEpisode: {} }, -1),
    e('Bottom', { group: 'available', ended: true, nextEpisode: {} }, 2),
    e('Zulu Done', { group: 'completed', nextEpisode: null }),
    e('Able Done', { group: 'completed', nextEpisode: null }),
    e('Yankee Suspended', withArchiveOverride({ group: 'available', nextEpisode: {} }, true)),
    e('Bravo Suspended', withArchiveOverride({ group: 'pending', nextEpisode: null }, true))
  ];
  const seg = buildSegments(entries);
  assert.deepStrictEqual(seg.binging.map(x => x.show.name), ['Top', 'Bottom'], 'ended shows keep the V1 availableOrder sort');
  assert.deepStrictEqual(seg.waiting.map(x => x.show.name), ['Sooner', 'Later', 'Alpha Pending', 'Zed Pending'],
    'Waiting section 1: soonest air date first, then no-date shows A-Z (OD-12)');
  assert.deepStrictEqual(seg.suspended.map(x => x.show.name), ['Bravo Suspended', 'Yankee Suspended'], 'Suspended is A-Z');
  assert.deepStrictEqual(seg.done.map(x => x.show.name), ['Able Done', 'Zulu Done'], 'Done is A-Z');
  assert.deepStrictEqual(segmentCounts(seg), { watching: 2, waiting: 6, done: 2 }, 'Waiting count includes Suspended (OD-16)');
}

// =====================================================================
// V2: "Caught up" when adding (ADD-8)
// =====================================================================

{
  const episodes = sortedEpisodes([
    { id: 1, season: 1, number: 1, airdate: '2026-06-01' },
    { id: 2, season: 1, number: null, airdate: '2026-07-01', name: 'Special' },
    { id: 3, season: 2, number: 1, airdate: '2026-09-01' },
    { id: 4, season: 2, number: 2, airdate: '' }
  ]);
  assert.strictEqual(lastAiredEpisodeId(episodes, TODAY), 2, 'last aired episode, specials included');
  assert.strictEqual(lastAiredEpisodeId(episodes, '2026-07-01'), 2, 'an episode airing today counts as aired');
  assert.strictEqual(lastAiredEpisodeId(episodes, '2026-05-01'), null, 'nothing aired yet -> null (not started)');
  assert.strictEqual(lastAiredEpisodeId([], TODAY), null, 'no episodes -> null');

  // Placement that follows from caught up (ADD-3, ADD-4).
  const running = computeShowStatus({ status: 'Running' }, episodes, lastAiredEpisodeId(episodes, TODAY), TODAY);
  assert.strictEqual(segmentForStatus(running), 'waiting', 'caught up on a running show with a dated next episode -> Waiting');
  const noReturnDate = sortedEpisodes([{ id: 1, season: 1, number: 1, airdate: '2024-02-27' }, { id: 2, season: 1, number: 2, airdate: '2024-03-05' }]);
  const pending = computeShowStatus({ status: 'Running' }, noReturnDate, lastAiredEpisodeId(noReturnDate, TODAY), TODAY);
  assert.strictEqual(pending.group, 'pending', 'caught up, renewed, no date -> pending return');
  assert.strictEqual(segmentForStatus(pending), 'waiting');
  const ended = computeShowStatus({ status: 'Ended' }, noReturnDate, lastAiredEpisodeId(noReturnDate, TODAY), TODAY);
  assert.strictEqual(segmentForStatus(ended), 'done', 'caught up on an ended show -> Done');
  const unaired = computeShowStatus({ status: 'In Development' }, [{ id: 9, season: 1, number: 1, airdate: '2027-01-01' }], null, TODAY);
  assert.strictEqual(segmentForStatus(unaired), 'waiting', 'nothing aired yet -> Waiting, never Watching');
}

// --- DET-6: Previous / Next episode ---
{
  const eps = sortedEpisodes([
    { id: 1, season: 1, number: 1, airdate: '2026-01-01' },
    { id: 2, season: 1, number: null, airdate: '2026-01-05', name: 'Special' },
    { id: 3, season: 1, number: 2, airdate: '2026-01-08' }
  ]);
  assert.strictEqual(stepWatchedEpisode(eps, null, -1), undefined, 'nothing watched: cannot go back');
  assert.strictEqual(stepWatchedEpisode(eps, null, 1), 1, 'nothing watched: next marks the first episode');
  assert.strictEqual(stepWatchedEpisode(eps, 1, -1), null, 'back from the first episode: nothing watched');
  assert.strictEqual(stepWatchedEpisode(eps, 3, -1), 2, 'back steps over specials in air-date order too');
  assert.strictEqual(stepWatchedEpisode(eps, 1, 1), 2, 'next skips one episode, specials included');
  assert.strictEqual(stepWatchedEpisode(eps, 3, 1), undefined, 'last episode: no next');
  assert.strictEqual(stepWatchedEpisode(eps, 999, -1), undefined, 'unknown watched id: cannot go back');
}

// --- SET-4: splitting a V1 backup ---
{
  const v1 = [
    { showId: 501, platform: ' Hulu ', watchedEpisodeId: 1002, pendingSeasonNumber: null, availableOrder: -1, extra: 'dropped' },
    { showId: 777, platform: '', watchedEpisodeId: 7001 },                      // no platform
    { showId: 999, watchedEpisodeId: 9001 },                                    // platform missing entirely
    { showId: 888, platform: 'Prime', watchedThrough: { season: 1, number: 1 } }, // very old V1 format
    { showId: 'x', platform: 'Hulu' },                                          // damaged
    'not an object',                                                            // damaged
    { showId: 501, platform: 'Hulu', watchedEpisodeId: 1001 },                  // repeat: imported once
    { showId: 251, platform: 'Peacock', watchedEpisodeId: 20864, archived: true, archivedAt: '2026-07-01',
      archivedSnapshot: { lastWatchedCode: 'S02E07', episodesLeftInSeason: 3, seasonsRemaining: { remaining: 1, total: 2 } } }
  ];
  const { importable, skipped } = splitV1Backup(v1);
  assert.deepStrictEqual(importable.map(i => i.showId), [501, 251], 'only complete entries with a platform are imported, repeats once');
  assert.strictEqual(importable[0].platform, 'Hulu', 'platform trimmed');
  assert.strictEqual(importable[0].extra, undefined, 'only DATA-2 fields are kept');
  assert.strictEqual(importable[0].watchedEpisodeId, 1002, 'progress kept');
  assert.strictEqual(importable[1].archived, true, 'suspended shows stay suspended');
  assert.deepStrictEqual(skipped.map(s => [s.showId, s.reason]),
    [[777, 'platform'], [999, 'platform'], [888, 'oldformat'], [null, 'invalid'], [null, 'invalid']]);
  ['platform', 'oldformat', 'invalid'].forEach(r => assert.ok(V1_SKIP_REASONS[r], 'reason text for ' + r));
  assert.deepStrictEqual(splitV1Backup([]), { importable: [], skipped: [] });
}

// --- VER-1: version constant ---
{
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/, 'APP_VERSION is a semantic version');
  const changelog = require('fs').readFileSync(require('path').join(__dirname, 'changelog', 'index.html'), 'utf8');
  const newest = changelog.match(/class="entry-date">[^<]*<span class="tag">Version ([\d.]+)/);
  assert.ok(newest, 'changelog entries are tagged with a version');
  assert.strictEqual(newest[1], APP_VERSION, 'APP_VERSION matches the newest changelog entry');
  // DOC-5: the guide says which version it describes.
  const guide = require('fs').readFileSync(require('path').join(__dirname, 'guide', 'index.html'), 'utf8');
  const guideVersion = guide.match(/<span id="guide-version">([\d.]+)<\/span>/);
  assert.ok(guideVersion, 'the guide states its version');
  assert.strictEqual(guideVersion[1], APP_VERSION, 'the guide is for the current APP_VERSION');
}

// --- LIST-14: Watching order ---
{
  const w = (name, ended, latestAiredDate, order) => ({ show: { name }, availableOrder: order || 0,
    status: { group: 'available', ended, latestAiredDate, nextEpisode: { airdate: '2000-01-01' } } });
  const seg = buildSegments([
    w('Ended Bottom', true, '2020-01-01', 3),
    w('Current Old', false, '2025-01-10', 0),
    w('Ended Top', true, '2026-07-01', -2),
    w('Current New', false, '2026-07-10', 9),
    w('Ended Middle', true, '2024-05-05', 0),
    w('Current Mid', false, '2026-03-01', -5)
  ]);
  assert.deepStrictEqual(seg.running.map(x => x.show.name), ['Current New', 'Current Mid', 'Current Old'],
    'Currently running section: newest released episode first');
  assert.deepStrictEqual(seg.binging.map(x => x.show.name), ['Ended Top', 'Ended Middle', 'Ended Bottom'],
    'Ended section: sink order, not date');
  assert.strictEqual(segmentCounts(seg).watching, 6, 'Watching count covers both sections');

  const eps = [
    { id: 1, season: 1, number: 1, airdate: '2026-06-01' },
    { id: 2, season: 1, number: 2, airdate: '2026-06-08' },
    { id: 3, season: 1, number: 3, airdate: '2026-08-01' }
  ];
  const running = computeShowStatus({ status: 'Running' }, eps, null, TODAY);
  assert.strictEqual(running.latestAiredDate, '2026-06-08', 'newest aired episode, even when the user is behind; unaired ignored');
  assert.strictEqual(running.ended, false);
  assert.strictEqual(computeShowStatus({ status: 'Ended' }, eps, null, TODAY).ended, true, 'Ended status from TVmaze');
  assert.strictEqual(computeShowStatus({ status: 'To Be Determined' }, eps, null, TODAY).ended, false, 'only "Ended" counts as ended');
}

// --- searchEntries (SRCH-2, SRCH-3) ---
{
  const entries = [
    { show: { name: 'The Bear' }, status: { group: 'available' } },
    { show: { name: 'Severance' }, status: { group: 'pending' } },
    { show: { name: 'The Penguin' }, status: { group: 'completed' } }
  ];
  assert.deepStrictEqual(searchEntries(entries, '  THE ').map(x => x.show.name), ['The Bear', 'The Penguin'], 'case-insensitive substring across all groups, A-Z');
  assert.deepStrictEqual(searchEntries(entries, 'xyz'), [], 'no match');
  assert.deepStrictEqual(searchEntries(entries, '   '), [], 'blank query returns nothing (main display shows segments instead)');
}

// =====================================================================
// V2: validation and payloads (GST-1, GST-2, GST-18, DATA-2, DATA-7, SET-2)
// =====================================================================

{
  assert.ok(isValidLibraryItem({ showId: 1 }), 'minimal item');
  assert.ok(isValidLibraryItem({ showId: 1, platform: 'Hulu', watchedEpisodeId: null, availableOrder: -2, archived: true,
    archivedAt: '2026-07-16', archivedSnapshot: {}, pendingSeasonNumber: { season: 1, number: 2 } }), 'full item');
  assert.ok(!isValidLibraryItem({ showId: '1' }), 'string showId rejected');
  assert.ok(!isValidLibraryItem({ showId: 1.5 }), 'non-integer showId rejected');
  assert.ok(!isValidLibraryItem({ showId: 1, platform: 3 }), 'non-string platform rejected');
  assert.ok(!isValidLibraryItem({ showId: 1, watchedEpisodeId: 'x' }), 'non-numeric watchedEpisodeId rejected');
  assert.ok(!isValidLibraryItem({ showId: 1, archived: 'yes' }), 'non-boolean archived rejected');
  assert.ok(!isValidLibraryItem({ showId: 1, pendingSeasonNumber: { season: 1 } }), 'incomplete pendingSeasonNumber rejected');
  assert.ok(isValidLibraryItem({ showId: 1, pendingCaughtUp: true }), 'transient caught-up marker allowed');
  assert.ok(!isValidLibraryItem({ showId: 1, pendingCaughtUp: 'yes' }), 'non-boolean caught-up marker rejected');
  assert.ok(!isValidLibraryItem(null) && !isValidLibraryItem([]), 'non-objects rejected');

  assert.ok(isValidLibrary([]), 'empty library is valid');
  assert.ok(isValidLibrary([{ showId: 1 }, { showId: 2 }]));
  assert.ok(!isValidLibrary([{ showId: 1 }, { showId: 1 }]), 'duplicate showIds rejected');
  assert.ok(!isValidLibrary({ showId: 1 }), 'non-array rejected');
}

{
  const payload = wrapPayload([{ showId: 5 }], '2026-10-25T12:00:00.000Z');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(payload)),
    { app: 'myshows', schemaVersion: 1, updatedAt: '2026-10-25T12:00:00.000Z', library: [{ showId: 5 }] }, 'GST-1 wrapper shape');
  assert.ok(isValidPayload(payload));
  assert.ok(!isValidPayload(Object.assign({}, payload, { app: 'other' })), 'wrong app marker rejected');
  assert.ok(!isValidPayload(Object.assign({}, payload, { schemaVersion: 2 })), 'unknown schema version rejected');
  assert.ok(!isValidPayload(Object.assign({}, payload, { updatedAt: 'not a date' })), 'bad timestamp rejected');
  assert.ok(!isValidPayload(Object.assign({}, payload, { library: [{ showId: 'x' }] })), 'invalid library rejected');

  assert.strictEqual(parsePayloadText(JSON.stringify(payload)).ok, true);
  assert.strictEqual(parsePayloadText('{nope').reason, 'json', 'not JSON');
  assert.strictEqual(parsePayloadText('[{"showId":1}]').reason, 'v1', 'a bare array is a V1 backup and is rejected');
  assert.strictEqual(parsePayloadText('{"hello":1}').reason, 'shape', 'JSON that is not a V2 payload');
}

// =====================================================================
// V2: sync decisions (GST-3, GST-7)
// =====================================================================

{
  const A = '2026-10-25T10:00:00.000Z', B = '2026-10-25T11:00:00.000Z', C = '2026-10-25T12:00:00.000Z';
  assert.strictEqual(decideSync(C, B, B), 'pull', 'gist newer than this device -> pull');
  assert.strictEqual(decideSync(A, C, A), 'push', 'device changed since last sync, gist older -> push');
  assert.strictEqual(decideSync(B, B, B), 'none', 'both sides match');
  assert.strictEqual(decideSync(C, B, A), 'pull', 'last write wins: the gist is newer even though the device also has unsent changes');
  assert.strictEqual(decideSync(null, B, A), 'push', 'no remote timestamp -> push');
  assert.strictEqual(decideSync(B, null, null), 'pull', 'nothing local -> pull');
}

{
  const t1 = nextTimestamp(Date.parse('2026-10-25T12:00:00.000Z'), null);
  assert.strictEqual(t1, '2026-10-25T12:00:00.000Z');
  const t2 = nextTimestamp(Date.parse('2026-10-25T12:00:00.000Z'), t1);
  assert.ok(t2 > t1, 'two changes in the same millisecond still get increasing timestamps');
  const t3 = nextTimestamp(Date.parse('2026-10-25T11:00:00.000Z'), t2);
  assert.ok(t3 > t2, 'a clock that went backwards still yields a later timestamp');
}

// =====================================================================
// V2: finding the My Shows gist (SYN-4, GST-17)
// =====================================================================

{
  const list = [
    { id: 'a', files: { 'myshows.json': {} } },
    { id: 'b', files: { 'notes.md': {} } },
    { id: 'c', files: { 'myshows.json': {}, 'other.txt': {} } },
    { id: 'd' }
  ];
  assert.deepStrictEqual(findCandidateGistIds(list), ['a', 'c'], 'only gists with a myshows.json file are candidates');

  const older = JSON.stringify(wrapPayload([{ showId: 1 }], '2026-03-02T00:00:00.000Z'));
  const newer = JSON.stringify(wrapPayload([{ showId: 1 }, { showId: 2 }], '2026-10-24T00:00:00.000Z'));
  const result = classifyCandidates([
    { id: 'old', text: older },
    { id: 'bad', text: '{"app":"something-else"}' },
    { id: 'new', text: newer },
    { id: 'gone', text: null }
  ]);
  assert.deepStrictEqual(result.valid.map(v => v.id), ['new', 'old'], 'valid lists, newest first for the picker');
  assert.deepStrictEqual(result.invalid, ['bad', 'gone'], 'invalid files are kept apart and never used');
}

// --- describeSyncError and formatSyncTime ---
{
  ['offline', 'token', 'notfound', 'malformed', 'invalid', 'ratelimit', 'server'].forEach(code => {
    assert.ok(describeSyncError(code).length > 10, 'message exists for ' + code);
  });
  assert.ok(describeSyncError('token').includes('Change token'), 'token error points to Change token (SYN-8)');
  assert.ok(describeSyncError('notfound').includes('Recreate gist'), 'gist-not-found error points to Recreate gist (GST-10)');
  const now = Date.parse('2026-10-25T12:00:00.000Z');
  assert.strictEqual(formatSyncTime(null, now), 'never');
  assert.strictEqual(formatSyncTime('2026-10-25T11:59:40.000Z', now), 'just now');
  assert.strictEqual(formatSyncTime('2026-10-25T11:55:00.000Z', now), '5 min ago');
}

// --- sitemap.xml and robots.txt (search engines) ---
{
  const fs = require('fs');
  const path = require('path');
  const sitemap = fs.readFileSync(path.join(__dirname, 'sitemap.xml'), 'utf8');
  const locs = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]);
  assert.deepStrictEqual(locs, ['https://v2.myshows.fyi/', 'https://v2.myshows.fyi/guide/', 'https://v2.myshows.fyi/changelog/'],
    'sitemap lists the app, the guide and the changelog');
  locs.forEach(url => {
    const file = path.join(__dirname, url.replace('https://v2.myshows.fyi/', ''), 'index.html');
    assert.ok(fs.existsSync(file), 'sitemap page exists: ' + url);
    const desc = fs.readFileSync(file, 'utf8').match(/<meta name="description" content="([^"]+)"/);
    assert.ok(desc && desc[1].length <= 160, 'search-result description (160 characters max) on ' + url);
  });
  assert.strictEqual((sitemap.match(/<url>/g) || []).length, (sitemap.match(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g) || []).length,
    'every page has a lastmod date');
  const host = fs.readFileSync(path.join(__dirname, 'CNAME'), 'utf8').trim();
  assert.ok(locs.every(u => u.startsWith('https://' + host + '/')), 'sitemap uses the CNAME host');
  const robots = fs.readFileSync(path.join(__dirname, 'robots.txt'), 'utf8');
  assert.ok(robots.includes('Sitemap: https://' + host + '/sitemap.xml'), 'robots.txt points to the sitemap');
}

console.log('All logic tests passed.');
