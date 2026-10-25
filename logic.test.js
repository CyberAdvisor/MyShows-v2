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
  decideSync, nextTimestamp, findCandidateGistIds, classifyCandidates, describeSyncError, formatSyncTime
} = L;

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
    e('Top', { group: 'available', nextEpisode: {} }, -1),
    e('Bottom', { group: 'available', nextEpisode: {} }, 2),
    e('Zulu Done', { group: 'completed', nextEpisode: null }),
    e('Able Done', { group: 'completed', nextEpisode: null }),
    e('Yankee Suspended', withArchiveOverride({ group: 'available', nextEpisode: {} }, true)),
    e('Bravo Suspended', withArchiveOverride({ group: 'pending', nextEpisode: null }, true))
  ];
  const seg = buildSegments(entries);
  assert.deepStrictEqual(seg.watching.map(x => x.show.name), ['Top', 'Bottom'], 'Watching keeps the V1 availableOrder sort');
  assert.deepStrictEqual(seg.waiting.map(x => x.show.name), ['Sooner', 'Later', 'Alpha Pending', 'Zed Pending'],
    'Waiting section 1: soonest air date first, then no-date shows A-Z (OD-12)');
  assert.deepStrictEqual(seg.suspended.map(x => x.show.name), ['Bravo Suspended', 'Yankee Suspended'], 'Suspended is A-Z');
  assert.deepStrictEqual(seg.done.map(x => x.show.name), ['Able Done', 'Zulu Done'], 'Done is A-Z');
  assert.deepStrictEqual(segmentCounts(seg), { watching: 2, waiting: 6, done: 2 }, 'Waiting count includes Suspended (OD-16)');
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

console.log('All logic tests passed.');
