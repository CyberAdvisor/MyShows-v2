// Integration tests for My Shows V2 (CLAUDE.md TST-2, TST-3).
// Loads the real index.html into jsdom with mocked TVmaze and GitHub APIs
// and drives it through the UI. Run with: node app.test.js
// Requires jsdom (npm install jsdom).
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
// Same extraction rule as V1: first bare <script> to the LAST </script>.
// This is why no <script> tag may follow the main inline script (R-6).
const scriptBody = html.match(/<script>([\s\S]*)<\/script>/)[1];

const LIBRARY_KEY = 'my-shows-library-v2';
const SYNC_KEY = 'my-shows-sync-v2';
const T0 = '2026-07-01T00:00:00.000Z'; // "last synced" time used by seeded data

// ---------------------------------------------------------------------
// Mock TVmaze (V1 fixtures plus two extra shows for segment coverage)
// ---------------------------------------------------------------------

const shows = {
  501: {
    info: { id: 501, name: 'The Bear', status: 'Running', premiered: '2022-06-23', network: { name: 'FX' }, image: { medium: 'https://example.com/bear.jpg' } },
    episodes: [
      { id: 1001, season: 4, number: 1, name: 'Ready', airdate: '2026-06-11', runtime: 30, summary: '<p>Season opener.</p>' },
      { id: 1002, season: 4, number: 2, name: 'Sundae', airdate: '2026-06-18', runtime: 31, summary: '<p>Ep 2.</p>' },
      { id: 1003, season: 4, number: 3, name: 'Doors', airdate: '2026-06-25', runtime: 32, summary: '<p>Ep 3.</p>', image: { medium: 'https://example.com/s4e3-medium.jpg' } },
      { id: 1004, season: 4, number: 4, name: 'Future', airdate: '2026-08-20', runtime: 30, summary: '<p>Ep 4.</p>' }
    ]
  },
  // Real Downton Abbey S2 data: two specials share season 2, number null.
  251: {
    info: { id: 251, name: 'Downton Abbey', status: 'Ended', premiered: '2010-09-26', network: { name: 'ITV1' } },
    episodes: [
      { id: 20864, season: 2, number: 7, name: 'Episode 7', airdate: '2011-10-30', runtime: 75, summary: '<p>Ep 7.</p>' },
      { id: 20865, season: 2, number: 8, name: 'Episode 8', airdate: '2011-11-06', runtime: 90, summary: '<p>Ep 8.</p>' },
      { id: 20888, season: 2, number: null, name: 'Behind the Drama', airdate: '2011-12-21', runtime: 60, summary: '<p>Documentary.</p>' },
      { id: 623241, season: 2, number: null, name: 'Christmas at Downton Abbey', airdate: '2011-12-25', runtime: 120, summary: '<p>Christmas special.</p>' },
      { id: 20866, season: 3, number: 1, name: 'Episode 1', airdate: '2012-09-16', runtime: 90, summary: '<p>S3 opener.</p>' }
    ]
  },
  999: {
    info: { id: 999, name: 'Fresh Show', status: 'Running', premiered: '2020-01-01', network: { name: 'Test Network' } },
    episodes: [{ id: 9001, season: 1, number: 1, name: 'Pilot', airdate: '2020-01-01', runtime: 30, summary: '<p>Pilot.</p>' }]
  },
  777: {
    info: { id: 777, name: 'Severance', status: 'Running', premiered: '2022-02-18', webChannel: { name: 'Apple TV+' } },
    episodes: [
      { id: 7001, season: 2, number: 1, name: 'Hello', airdate: '2026-01-01', runtime: 50, summary: '<p>S2 opener.</p>' },
      { id: 7002, season: 2, number: 2, name: 'Goodbye', airdate: '2026-09-01', runtime: 50, summary: '<p>Next.</p>' }
    ]
  },
  888: {
    info: { id: 888, name: 'Fleabag', status: 'Ended', premiered: '2016-07-21', webChannel: { name: 'Prime Video' } },
    episodes: [{ id: 8001, season: 1, number: 1, name: 'Ep 1', airdate: '2016-07-21', runtime: 25, summary: '<p>Ep 1.</p>' }]
  }
};

const searchResults = [
  { score: 10, show: { id: 501, name: 'The Bear', premiered: '2022-06-23', network: { name: 'FX' }, image: { medium: 'x.jpg' } } },
  { score: 9, show: { id: 777, name: 'Severance', premiered: '2022-02-18', webChannel: { name: 'Apple TV+' }, image: null } },
  { score: 8, show: { id: 999, name: 'Fresh Show', premiered: '2020-01-01', image: null } },
  { score: 7, show: { id: 888, name: 'Fleabag', premiered: '2016-07-21', image: null } },
  { score: 6, show: { id: 4242, name: 'Unloadable Show', premiered: '2021-01-01', image: null } } // TVmaze details fail
];

// Minimal fetch Response stand-in.
function response(status, body, headers) {
  const h = {};
  Object.keys(headers || {}).forEach(k => { h[k.toLowerCase()] = String(headers[k]); });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => (name.toLowerCase() in h ? h[name.toLowerCase()] : null) },
    json: () => Promise.resolve(typeof body === 'string' ? JSON.parse(body) : body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body))
  };
}

function tvmazeFetch(url) {
  if (url.startsWith('https://api.tvmaze.com/search/shows')) return Promise.resolve(response(200, searchResults));
  const m = url.match(/^https:\/\/api\.tvmaze\.com\/shows\/(\d+)(\/episodes\?specials=1)?$/);
  if (m && shows[m[1]]) return Promise.resolve(response(200, m[2] ? shows[m[1]].episodes : Object.assign({}, shows[m[1]].info)));
  return Promise.reject(new Error('unexpected fetch: ' + url));
}

// ---------------------------------------------------------------------
// Mock GitHub API (only what the app uses)
// ---------------------------------------------------------------------

function makeGitHub() {
  const gh = {
    tokens: { good: 'gist', other: 'gist', noscope: 'repo' },
    gists: {},
    seq: 0,
    offline: false,
    rateLimited: false,
    calls: [],
    addGist(content, extraFiles) {
      const id = 'gist' + (++gh.seq) + 'abcdef';
      const files = Object.assign({}, extraFiles || {});
      if (content !== undefined) files['myshows.json'] = { content: typeof content === 'string' ? content : JSON.stringify(content) };
      gh.gists[id] = { id, description: '', public: false, files };
      return id;
    },
    content(id) { return JSON.parse(gh.gists[id].files['myshows.json'].content); },
    writes() { return gh.calls.filter(c => c.method === 'PATCH' || c.method === 'POST'); },
    handle(url, options) {
      options = options || {};
      const method = options.method || 'GET';
      const pathPart = url.replace('https://api.github.com', '');
      if (gh.offline) return Promise.reject(new TypeError('Failed to fetch'));
      gh.calls.push({ method, path: pathPart });
      if (gh.rateLimited) {
        return Promise.resolve(response(403, { message: 'rate limit' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': Math.floor(Date.now() / 1000) + 3600 }));
      }
      const token = ((options.headers || {}).Authorization || '').replace('Bearer ', '');
      if (!(token in gh.tokens)) return Promise.resolve(response(401, { message: 'Bad credentials' }));

      if (method === 'GET' && pathPart === '/user') return Promise.resolve(response(200, { login: 'michael' }, { 'x-oauth-scopes': gh.tokens[token] }));
      if (method === 'GET' && pathPart.startsWith('/gists?')) {
        const page = Number(new URLSearchParams(pathPart.split('?')[1]).get('page'));
        const list = page === 1 ? Object.values(gh.gists).map(g => ({ id: g.id, files: Object.fromEntries(Object.keys(g.files).map(f => [f, { filename: f }])) })) : [];
        return Promise.resolve(response(200, list));
      }
      if (method === 'POST' && pathPart === '/gists') {
        const body = JSON.parse(options.body);
        const id = 'created' + (++gh.seq) + 'abcdef';
        gh.gists[id] = { id, description: body.description, public: body.public, files: body.files };
        return Promise.resolve(response(201, { id }));
      }
      const m = pathPart.match(/^\/gists\/([\w]+)$/);
      if (m) {
        const gist = gh.gists[m[1]];
        if (!gist) return Promise.resolve(response(404, { message: 'Not Found' }));
        if (method === 'GET') return Promise.resolve(response(200, { id: gist.id, files: gist.files }));
        if (method === 'PATCH') {
          const body = JSON.parse(options.body);
          Object.assign(gist.files, body.files);
          return Promise.resolve(response(200, { id: gist.id }));
        }
      }
      return Promise.reject(new Error('unexpected GitHub call: ' + method + ' ' + pathPart));
    }
  };
  return gh;
}

function payload(library, updatedAt) {
  return { app: 'myshows', schemaVersion: 1, updatedAt: updatedAt || T0, library };
}

// ---------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------

function freezeDate(window, iso) {
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) return new RealDate(iso);
      return new RealDate(...args);
    }
    static now() { return new RealDate(iso).getTime(); }
  }
  window.Date = FixedDate;
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// Every jsdom window opened by a test; closed at the end so pending app
// timers (e.g. a one-hour rate-limit retry) don't keep Node running.
const openWindows = [];

// Boots the app. With `library`, the device starts connected to a gist that
// already holds that library (in sync), unless `gistId`/`settings` say otherwise.
async function start(opts) {
  opts = opts || {};
  const gh = opts.gh || makeGitHub();
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://v2.myshows.fyi/', pretendToBeVisual: true });
  const { window } = dom;
  openWindows.push(window);
  freezeDate(window, '2026-07-12T12:00:00');
  window.fetch = (url, options) => url.startsWith('https://api.github.com') ? gh.handle(url, options) : tvmazeFetch(url);
  const env = { window, doc: window.document, gh, confirmAnswer: true, confirmMessages: [] };
  window.confirm = (msg) => { env.confirmMessages.push(msg); return env.confirmAnswer; };

  if (opts.library) {
    const gistId = opts.gistId || gh.addGist(payload(opts.library));
    window.localStorage.setItem(LIBRARY_KEY, JSON.stringify(opts.localLibrary || opts.library));
    window.localStorage.setItem(SYNC_KEY, JSON.stringify(opts.settings || { gistId, token: 'good', lastSyncedAt: T0, lastLocalChangeAt: T0 }));
    env.gistId = gistId;
  }
  window.eval(scriptBody);
  // The real debounce is 2 s (GST-4); checked once, then shortened for speed.
  assert.strictEqual(window.SYNC_DEBOUNCE_MS, 2000, 'push debounce is about 2 seconds');
  assert.strictEqual(window.CONFIRM_MS, 5000, 'add confirmation shows for about 5 seconds (ADD-5)');
  window.SYNC_DEBOUNCE_MS = 30;
  window.CONFIRM_MS = 60;
  await wait(80);
  return env;
}

function text(env, selector) {
  const el = env.doc.querySelector(selector);
  return el ? el.textContent : null;
}
function click(env, id) {
  const el = env.doc.getElementById(id);
  assert.ok(el, 'element #' + id + ' exists');
  el.click();
}
function type(env, id, value) {
  const el = env.doc.getElementById(id);
  assert.ok(el, 'input #' + id + ' exists');
  el.value = value;
  el.oninput({ target: el });
}
// Picks a "Where are you up to?" choice on the Add form (ADD-8).
function chooseProgress(env, value) {
  const radio = env.doc.querySelector('input[name="progress"][value="' + value + '"]');
  assert.ok(radio, 'progress choice ' + value + ' exists');
  radio.checked = true;
  radio.onchange();
}
// Searches on the Add screen and selects one result.
async function selectResult(env, query, showId) {
  click(env, 'tab-add');
  await wait(10);
  type(env, 'search-input', query);
  await wait(400);
  env.doc.querySelector('.search-result[data-id="' + showId + '"]').click();
  await wait(5);
}
function rowTitles(env) {
  return [...env.doc.querySelectorAll('.row-title')].map(el => el.childNodes[0].textContent.trim());
}
function segmentButtons(env) {
  return [...env.doc.querySelectorAll('.segments button')].map(b => b.textContent);
}
function clickSegment(env, key) {
  env.doc.querySelector('.segments button[data-segment="' + key + '"]').click();
}
function storedLibrary(env) { return JSON.parse(env.window.localStorage.getItem(LIBRARY_KEY)); }
function storedSettings(env) { return JSON.parse(env.window.localStorage.getItem(SYNC_KEY)); }

// The five-show library used by segment tests: one show per section.
function mixedLibrary() {
  return [
    { showId: 501, platform: 'Hulu', watchedEpisodeId: 1002 },  // next S4E3 aired      -> Watching
    { showId: 777, platform: '', watchedEpisodeId: 7001 },      // next 2026-09-01      -> Waiting (dated)
    { showId: 999, platform: '', watchedEpisodeId: 9001 },      // caught up, running   -> Waiting (no date)
    { showId: 888, platform: '', watchedEpisodeId: 8001 },      // ended, all watched   -> Done
    { showId: 251, platform: '', watchedEpisodeId: 20864, archived: true, archivedAt: '2026-07-01',
      archivedSnapshot: { lastWatchedCode: 'S02E07', episodesLeftInSeason: 3, seasonsRemaining: { remaining: 1, total: 2 } } } // -> Suspended
  ];
}

// =====================================================================
// Setup and first connect (SYN-1..4, GST-17)
// =====================================================================

async function testSetupBlocksAppUntilConnected() {
  const env = await start();
  assert.ok(env.doc.getElementById('token-input'), 'first launch shows Setup');
  assert.strictEqual(env.doc.getElementById('toolbar').className, 'hidden', 'tool bar is hidden on Setup (SYN-1)');
  assert.ok(!env.doc.getElementById('tab-show'), 'no way to reach the rest of the app');
  assert.ok(!env.doc.getElementById('gist-id-input'), 'Setup asks for the token only, never a gist id (SYN-2)');

  click(env, 'connect-btn');
  await wait(10);
  assert.ok(text(env, '.error-text').includes('Enter your token'), 'empty token is rejected');

  type(env, 'token-input', 'wrong');
  click(env, 'connect-btn');
  await wait(30);
  assert.ok(text(env, '.error-text').includes('Token not valid'), 'bad token shows a specific error');

  type(env, 'token-input', 'noscope');
  click(env, 'connect-btn');
  await wait(30);
  assert.ok(text(env, '.error-text').includes('missing the gist scope'), 'token without gist scope is rejected');

  env.gh.offline = true;
  type(env, 'token-input', 'good');
  click(env, 'connect-btn');
  await wait(30);
  assert.ok(text(env, '.error-text').includes('Couldn’t reach GitHub'), 'network failure shows a specific error');
  assert.strictEqual(env.window.localStorage.getItem(SYNC_KEY), null, 'nothing is stored until a connect succeeds');
  console.log('testSetupBlocksAppUntilConnected passed.');
}

async function testFirstDeviceCreatesSecretGist() {
  const gh = makeGitHub();
  gh.addGist(undefined, { 'notes.md': { content: 'unrelated' } }); // an unrelated gist is ignored
  const env = await start({ gh });
  type(env, 'token-input', '  good  ');
  click(env, 'connect-btn');
  await wait(60);

  const created = Object.values(gh.gists).find(g => g.id.startsWith('created'));
  assert.ok(created, 'the app created a gist (GST-17)');
  assert.strictEqual(created.public, false, 'the gist is secret');
  assert.strictEqual(created.description, 'My Shows V2');
  const content = JSON.parse(created.files['myshows.json'].content);
  assert.strictEqual(content.app, 'myshows');
  assert.deepStrictEqual(content.library, [], 'the new gist starts with an empty library');

  const settings = storedSettings(env);
  assert.strictEqual(settings.gistId, created.id, 'the gist id is stored for the user (SYN-9)');
  assert.strictEqual(settings.token, 'good', 'token is trimmed and stored on this device');
  assert.ok(text(env, '.empty').includes('No shows yet'), 'lands on the empty main display');
  assert.strictEqual(env.doc.getElementById('toolbar').className, '', 'tool bar visible once connected');
  assert.strictEqual(text(env, '#sync-indicator'), '✓ Synced');
  console.log('testFirstDeviceCreatesSecretGist passed.');
}

async function testSecondDeviceLoadsExistingGist() {
  const gh = makeGitHub();
  const id = gh.addGist(payload([{ showId: 501, platform: 'Hulu', watchedEpisodeId: 1002 }]));
  const env = await start({ gh });
  type(env, 'token-input', 'good');
  click(env, 'connect-btn');
  await wait(80);
  assert.deepStrictEqual(rowTitles(env), ['The Bear'], 'the existing list is loaded');
  assert.strictEqual(storedSettings(env).gistId, id);
  assert.strictEqual(gh.writes().length, 0, 'joining an existing gist does not write to it');
  console.log('testSecondDeviceLoadsExistingGist passed.');
}

async function testPickerWhenSeveralListsExist() {
  const gh = makeGitHub();
  const older = gh.addGist(payload([{ showId: 999 }], '2026-03-02T00:00:00.000Z'));
  gh.addGist(payload([{ showId: 501 }, { showId: 777 }], '2026-06-24T00:00:00.000Z'));
  gh.addGist('{"not":"a list"}'); // invalid ones are ignored when valid ones exist
  const env = await start({ gh });
  type(env, 'token-input', 'good');
  click(env, 'connect-btn');
  await wait(60);

  const choices = [...env.doc.querySelectorAll('.choice')].map(c => c.textContent);
  assert.strictEqual(choices.length, 2, 'only the two valid lists are offered');
  assert.ok(choices[0].startsWith('2 shows'), 'newest list first');
  assert.ok(choices[1].startsWith('1 show ·'), 'singular wording for one show');
  assert.ok(env.doc.getElementById('use-choice-btn').disabled, 'must choose before continuing');

  const radio = env.doc.querySelector('input[value="' + older + '"]');
  radio.checked = true;
  radio.onchange();
  await wait(5);
  click(env, 'use-choice-btn');
  await wait(60);
  assert.deepStrictEqual(rowTitles(env), ['Fresh Show'], 'the chosen (older) list is loaded');
  assert.strictEqual(storedSettings(env).gistId, older, 'the chosen gist is used');
  assert.strictEqual(gh.writes().length, 0, 'the other lists are left unchanged');
  console.log('testPickerWhenSeveralListsExist passed.');
}

async function testOnlyInvalidListStartsNewGist() {
  const gh = makeGitHub();
  const bad = gh.addGist('this is not json');
  const env = await start({ gh });
  type(env, 'token-input', 'good');
  click(env, 'connect-btn');
  await wait(60);
  assert.ok(text(env, '.error-text').includes('isn’t a valid list'), 'invalid file is reported');
  assert.ok(env.doc.getElementById('start-new-btn'), 'Start a new gist is offered');
  assert.strictEqual(gh.gists[bad].files['myshows.json'].content, 'this is not json', 'the invalid file is not changed');

  click(env, 'start-new-btn');
  await wait(60);
  const created = Object.values(gh.gists).find(g => g.id.startsWith('created'));
  assert.ok(created, 'a new gist was created');
  assert.strictEqual(storedSettings(env).gistId, created.id);
  assert.strictEqual(gh.gists[bad].files['myshows.json'].content, 'this is not json', 'old gist still untouched');
  console.log('testOnlyInvalidListStartsNewGist passed.');
}

// =====================================================================
// Main flow (ported from V1) with placement, toast and push
// =====================================================================

async function testAddShowFlowAndPush() {
  const env = await start({ library: [] });
  assert.ok(text(env, '.empty').includes('Tap Add Show'), 'empty state points to Add Show');

  click(env, 'tab-add');
  await wait(10);
  assert.ok(env.doc.getElementById('tab-add').className.includes('active'), 'Add Show tab is active');
  type(env, 'search-input', 'The Bear');
  await wait(400);
  env.doc.querySelector('.search-result[data-id="501"]').click();
  await wait(10);
  type(env, 'platform-input', 'Hulu');
  chooseProgress(env, 'lastwatched');
  await wait(5);
  type(env, 'season-input', '4');
  type(env, 'episode-input', '2');
  click(env, 'submit-add-btn');
  await wait(40);

  assert.strictEqual(env.window.state.view, 'list', 'returns to the main display after adding (OD-10)');
  assert.ok(env.doc.querySelector('.segments button[data-segment="watching"]').className.includes('active'), 'opens on the placed segment');
  assert.ok(text(env, '#toast').includes('The Bear added to Watching'), 'toast names the segment (ADD-5)');
  assert.ok(env.doc.querySelector('.row-title').innerHTML.includes('Hulu'), 'platform shown next to show name');
  assert.ok(text(env, '.row-sub').includes('S04E03') && text(env, '.row-sub').includes('Doors'), 'S4E2 watched surfaces S4E3 next');

  click(env, 'row-501');
  await wait(10);
  assert.ok(text(env, 'h1').includes('The Bear'), 'detail view shows show name');
  assert.ok([...env.doc.querySelectorAll('p')].some(p => p.textContent === 'Hulu'), 'platform on detail screen');
  assert.ok(text(env, '.synopsis').includes('Ep 3'), 'synopsis HTML stripped');
  assert.strictEqual(env.doc.querySelector('.episode-image').getAttribute('src'), 'https://example.com/s4e3-medium.jpg');
  assert.ok(/Episodes left in season\s*2/.test(text(env, '.detail-table')));
  assert.ok(/Seasons remaining\s*0 of 1/.test(text(env, '.detail-table')));

  click(env, 'mark-watched-btn');
  await wait(10);
  assert.ok(text(env, '.row-sub').includes('S04E04'), 'detail advances to S4E4');
  assert.ok(!env.doc.querySelector('.episode-image'), 'no image element when TVmaze has none');
  assert.ok(text(env, '.detail-table').includes('Aug 20, 2026'));

  click(env, 'back-btn');
  await wait(10);
  assert.ok(segmentButtons(env)[0].includes('0') && segmentButtons(env)[1].includes('1'), 'counts follow the show from Watching to Waiting');
  clickSegment(env, 'waiting');
  await wait(5);
  assert.ok(env.doc.body.textContent.match(/Aug 20/), 'upcoming date shown in Waiting');

  const persisted = storedLibrary(env);
  assert.strictEqual(persisted[0].watchedEpisodeId, 1003, 'progress stored as the unique episode id');
  assert.strictEqual(persisted[0].platform, 'Hulu');

  await wait(100);
  const remote = env.gh.content(env.gistId);
  assert.strictEqual(remote.library[0].watchedEpisodeId, 1003, 'the change reached the gist after the debounce (GST-4)');
  assert.ok(remote.updatedAt > T0, 'gist timestamp advanced');
  assert.strictEqual(text(env, '#sync-indicator'), '✓ Synced');
  console.log('testAddShowFlowAndPush passed.');
}

async function testAddScreenMarksShowsAlreadyInList() {
  const env = await start({ library: [{ showId: 501, platform: '', watchedEpisodeId: 1004 }] });
  click(env, 'tab-add');
  await wait(10);
  type(env, 'search-input', 'se');
  await wait(400);
  const bear = env.doc.querySelector('.search-result[data-id="501"]');
  assert.ok(bear.textContent.includes('In Waiting'), 'existing show shows its segment (ADD-6)');
  bear.click();
  await wait(5);
  assert.ok(!env.doc.getElementById('submit-add-btn'), 'a show already in the list cannot be selected');
  env.doc.querySelector('.search-result[data-id="777"]').click();
  await wait(5);
  type(env, 'platform-input', 'Apple TV+');
  chooseProgress(env, 'starting');
  await wait(5);
  click(env, 'submit-add-btn');
  await wait(40);
  assert.ok(text(env, '#toast').includes('Severance added to Watching'), 'a Starting show with an aired episode goes to Watching');
  console.log('testAddScreenMarksShowsAlreadyInList passed.');
}

async function testPlatformRequired() {
  const env = await start({ library: [] });
  await selectResult(env, 'Severance', 777);
  assert.ok(text(env, '#add-form .field-label').includes('required'), 'the field is labelled as required');
  click(env, 'submit-add-btn');
  await wait(20);
  assert.strictEqual(text(env, '#add-error'), 'Enter where you\u2019re watching it.', 'blank platform is rejected (ADD-7)');
  type(env, 'platform-input', '   ');
  click(env, 'submit-add-btn');
  await wait(20);
  assert.ok(text(env, '#add-error').includes('Enter where'), 'spaces alone do not count');
  const platformInput = env.doc.getElementById('platform-input');
  type(env, 'platform-input', 'H');
  assert.ok(!env.doc.getElementById('add-error'), 'the error clears as soon as the user types');
  assert.strictEqual(env.doc.getElementById('platform-input'), platformInput, 'without replacing the input');
  type(env, 'platform-input', '');
  assert.strictEqual(env.window.state.library.length, 0, 'nothing was added');
  assert.strictEqual(env.window.state.view, 'add', 'stays on the Add screen');
  console.log('testPlatformRequired passed.');
}

async function testWhereAreYouUpTo() {
  // Caught up is the default (ADD-8).
  let env = await start({ library: [] });
  await selectResult(env, 'fresh', 999);
  const checked = env.doc.querySelector('input[name="progress"]:checked');
  assert.strictEqual(checked.value, 'caughtup', 'Caught Up is selected by default');
  const labels = [...env.doc.querySelectorAll('.progress-choice span')].map(l => l.textContent);
  assert.deepStrictEqual(labels, ['Starting', 'Season/Episode last watched', 'Caught Up'], 'choices use the agreed wording and order (ADD-8)');
  assert.ok(!env.doc.getElementById('season-input'), 'season/episode fields are hidden unless that choice is picked');
  type(env, 'platform-input', 'Netflix');
  click(env, 'submit-add-btn');
  await wait(40);
  assert.ok(env.doc.querySelector('.segments button[data-segment="waiting"]').className.includes('active'), 'caught up, renewed, no date -> Waiting');
  assert.ok(text(env, '#toast').includes('Fresh Show added to Waiting'));
  assert.ok(text(env, '.row-sub').includes('Renewed - no date yet'), 'shown as pending return');
  assert.strictEqual(storedLibrary(env)[0].watchedEpisodeId, 9001, 'every aired episode marked watched');
  assert.strictEqual(storedLibrary(env)[0].pendingCaughtUp, undefined, 'the transient marker is resolved and removed');

  // ADD-5: highlighted row, cleared after the confirmation time.
  assert.ok(env.doc.getElementById('row-999').classList.contains('just-added'), 'new row is highlighted');
  await wait(120);
  assert.ok(!env.doc.getElementById('row-999').classList.contains('just-added'), 'highlight ends');
  assert.ok(!env.doc.getElementById('toast').classList.contains('show'), 'toast ends');

  // Caught up on a running show with a dated next episode -> Waiting with countdown.
  await selectResult(env, 'Severance', 777);
  type(env, 'platform-input', 'Apple TV+');
  click(env, 'submit-add-btn');
  await wait(40);
  assert.ok(text(env, '#toast').includes('Severance added to Waiting'));
  assert.ok(text(env, '#row-777').includes('S02E02'), 'next episode is the unaired one');

  // Caught up on an ended show -> Done.
  await selectResult(env, 'Fleabag', 888);
  type(env, 'platform-input', 'Prime Video');
  click(env, 'submit-add-btn');
  await wait(40);
  assert.ok(text(env, '#toast').includes('Fleabag added to Done'));

  // Season/Episode last watched needs both numbers.
  await selectResult(env, 'Bear', 501);
  type(env, 'platform-input', 'Hulu');
  chooseProgress(env, 'lastwatched');
  await wait(5);
  const choiceLabels = [...env.doc.querySelectorAll('#add-form .progress-choice, #add-form .partway-fields')].map(el => el.className);
  assert.deepStrictEqual(choiceLabels, ['progress-choice', 'progress-choice', 'field-row partway-fields', 'progress-choice'],
    'season/episode fields sit directly under their own choice, not under Caught Up');
  type(env, 'season-input', '4');
  click(env, 'submit-add-btn');
  await wait(20);
  assert.strictEqual(text(env, '#add-error'), 'Enter the season and episode you last watched.');
  type(env, 'season-input', '4');
  type(env, 'episode-input', '1');
  click(env, 'submit-add-btn');
  await wait(40);
  assert.ok(text(env, '#toast').includes('The Bear added to Watching'), 'last watched with an aired next episode -> Watching');
  assert.ok(text(env, '#row-501').includes('S04E02'));
  console.log('testWhereAreYouUpTo passed.');
}

async function testAddWhenDetailsCannotLoad() {
  const env = await start({ library: [] });
  await selectResult(env, 'unloadable', 4242);
  type(env, 'platform-input', 'Hulu');
  click(env, 'submit-add-btn');
  await wait(40);
  assert.strictEqual(text(env, '#toast'), '\u2713 Unloadable Show was added, but its episode details couldn\u2019t be loaded.', 'explicit message (ADD-5)');
  assert.strictEqual(storedLibrary(env)[0].showId, 4242, 'the show is still saved');
  console.log('testAddWhenDetailsCannotLoad passed.');
}

async function testVersionLine() {
  let env = await start();
  assert.strictEqual(text(env, '#version-link'), 'Version ' + env.window.APP_VERSION, 'version shown on Setup (VER-1)');
  env = await start({ library: [] });
  assert.strictEqual(text(env, '#version-link'), 'Version ' + env.window.APP_VERSION, 'version shown under the wordmark');
  assert.strictEqual(env.doc.getElementById('version-link').getAttribute('href'), 'changelog/', 'tapping it opens the changelog');
  click(env, 'tab-settings');
  await wait(5);
  assert.ok(env.doc.getElementById('version-link'), 'shown on Settings too');
  console.log('testVersionLine passed.');
}

// =====================================================================
// Segments, search and navigation (LIST, SRCH, NAV, OD-11, OD-13)
// =====================================================================

async function testSegmentsSearchAndNavigation() {
  const env = await start({ library: mixedLibrary() });
  assert.deepStrictEqual(segmentButtons(env), ['Watching1', 'Waiting3', 'Done1'], 'three boxes with counts; Waiting includes Suspended');
  assert.deepStrictEqual(rowTitles(env), ['The Bear'], 'Watching is the default segment');

  clickSegment(env, 'waiting');
  await wait(5);
  const labels = [...env.doc.querySelectorAll('.section-label')].map(l => l.textContent);
  assert.deepStrictEqual(labels, ['Waiting for next episode or season', 'Suspended'], 'two Waiting sections in order');
  assert.deepStrictEqual(rowTitles(env), ['Severance', 'Fresh Show', 'Downton Abbey'], 'dated first, then no-date, then suspended');
  assert.ok(env.doc.getElementById('reactivate-251'), 'suspended row keeps the V1 Reactivate button');

  clickSegment(env, 'done');
  await wait(5);
  assert.deepStrictEqual(rowTitles(env), ['Fleabag'], 'Done holds only ended, fully watched shows');
  assert.ok(text(env, '.row-sub').includes('All episodes watched'));

  // Search spans all groups and tags each row (SRCH-3/4).
  const search = env.doc.getElementById('list-search');
  type(env, 'list-search', 'E');
  await wait(5);
  assert.strictEqual(env.doc.getElementById('list-search'), search, 'search input is not replaced while typing');
  assert.ok(!env.doc.querySelector('.segments'), 'selection boxes are hidden while searching');
  const tags = [...env.doc.querySelectorAll('.group-tag')].map(t => t.textContent);
  assert.deepStrictEqual(rowTitles(env), ['Downton Abbey', 'Fleabag', 'Fresh Show', 'Severance', 'The Bear']);
  assert.deepStrictEqual(tags, ['Suspended', 'Done', 'Waiting', 'Waiting', 'Watching']);
  type(env, 'list-search', 'zzz');
  await wait(5);
  assert.ok(text(env, '.empty').includes('No shows match "zzz"'), 'no-match message (SRCH-6)');
  type(env, 'list-search', '');
  await wait(5);
  assert.ok(env.doc.querySelector('.segments button[data-segment="done"]').className.includes('active'), 'clearing search returns to the selected segment');

  // Tool bar and home links (NAV-1..7, OD-13).
  click(env, 'tab-settings');
  await wait(5);
  assert.strictEqual(env.window.state.view, 'settings');
  assert.ok(env.doc.getElementById('tab-settings').className.includes('active'));
  click(env, 'tab-show');
  await wait(5);
  assert.ok(env.doc.querySelector('.segments button[data-segment="done"]').className.includes('active'), 'last-selected segment kept');
  click(env, 'row-888');
  await wait(5);
  assert.ok(env.doc.getElementById('tab-show').className.includes('active'), 'detail belongs to the Show tab');
  click(env, 'home-link');
  await wait(5);
  assert.strictEqual(env.window.state.view, 'list', 'the wordmark returns to the main display');

  // OD-11: tool bar hidden while a text field has focus.
  env.doc.getElementById('list-search').focus();
  assert.ok(env.doc.body.classList.contains('typing'), 'focusing a field hides the tool bar');
  env.doc.getElementById('list-search').blur();
  assert.ok(!env.doc.body.classList.contains('typing'), 'blurring shows it again');

  // Empty segment message (LIST-10).
  click(env, 'row-888');
  await wait(5);
  click(env, 'remove-link');
  await wait(5);
  clickSegment(env, 'done');
  await wait(5);
  assert.ok(text(env, '.empty').includes('No finished shows yet'));
  console.log('testSegmentsSearchAndNavigation passed.');
}

async function testSuspendReactivateAndDelete() {
  const env = await start({ library: [{ showId: 501, platform: 'Hulu', watchedEpisodeId: null, pendingSeasonNumber: { season: 4, number: 2 } }] });
  click(env, 'row-501');
  await wait(5);
  assert.ok(!env.doc.getElementById('reactivate-link'));
  click(env, 'end-series-link');
  await wait(5);
  assert.strictEqual(env.window.state.view, 'list');

  let item = storedLibrary(env)[0];
  assert.strictEqual(item.archived, true);
  assert.strictEqual(item.watchedEpisodeId, 1002, 'suspending does not touch progress');
  assert.strictEqual(item.archivedAt, '2026-07-12');
  assert.strictEqual(item.archivedSnapshot.lastWatchedCode, 'S04E02');
  assert.strictEqual(item.archivedSnapshot.episodesLeftInSeason, 2);
  assert.deepStrictEqual(item.archivedSnapshot.seasonsRemaining, { remaining: 0, total: 1 });

  assert.deepStrictEqual(segmentButtons(env), ['Watching0', 'Waiting1', 'Done0'], 'suspended show counts under Waiting, not Done (DET-2)');
  clickSegment(env, 'waiting');
  await wait(5);
  assert.deepStrictEqual([...env.doc.querySelectorAll('.section-label')].map(l => l.textContent), ['Suspended'], 'empty section 1 is omitted');
  assert.strictEqual(text(env, '.row-sub'), 'Archived Jul 12, 2026');

  click(env, 'reactivate-501');
  await wait(5);
  item = storedLibrary(env)[0];
  assert.strictEqual(item.archived, false);
  assert.strictEqual(item.archivedAt, undefined);
  assert.strictEqual(item.archivedSnapshot, undefined);
  assert.deepStrictEqual(segmentButtons(env), ['Watching1', 'Waiting0', 'Done0'], 'resuming returns it to its computed segment');

  // Suspend again from detail and check the snapshot table, then reactivate from detail.
  clickSegment(env, 'watching');
  click(env, 'row-501');
  await wait(5);
  click(env, 'end-series-link');
  await wait(5);
  clickSegment(env, 'waiting');
  click(env, 'row-501');
  await wait(5);
  assert.ok(/Last watched\s*S04E02/.test(text(env, '.detail-table')));
  assert.ok(text(env, '.detail-table').includes('Archived on'));
  click(env, 'reactivate-link');
  await wait(5);
  assert.strictEqual(env.window.state.view, 'detail', 'reactivating from detail stays on detail');

  // Delete: immediate, no confirmation, pushed to the gist (DET-3, DATA-9).
  env.confirmMessages.length = 0;
  click(env, 'remove-link');
  await wait(100);
  assert.strictEqual(env.confirmMessages.length, 0, 'delete has no confirmation step, as in V1');
  assert.deepStrictEqual(storedLibrary(env), [], 'removed from this device');
  assert.deepStrictEqual(env.gh.content(env.gistId).library, [], 'and from the gist');
  console.log('testSuspendReactivateAndDelete passed.');
}

// =====================================================================
// Sync behavior (GST-3..12, OD-6)
// =====================================================================

async function testPullOnLoadAndOnResume() {
  const gh = makeGitHub();
  const id = gh.addGist(payload([{ showId: 501, platform: '', watchedEpisodeId: 1002 }], '2026-07-05T00:00:00.000Z'));
  const env = await start({ gh, library: [], gistId: id }); // device has an older, empty copy
  await wait(50);
  assert.deepStrictEqual(rowTitles(env), ['The Bear'], 'newer gist list replaced the device copy on load');
  assert.strictEqual(storedLibrary(env)[0].showId, 501, 'and was saved on the device');
  assert.strictEqual(gh.writes().length, 0, 'pulling does not write back');

  // Another device changes the list; this one returns to the foreground.
  gh.gists[id].files['myshows.json'].content = JSON.stringify(payload([{ showId: 888, platform: '', watchedEpisodeId: 8001 }], '2026-07-10T00:00:00.000Z'));
  env.doc.dispatchEvent(new env.window.Event('visibilitychange'));
  await wait(80);
  assert.deepStrictEqual(segmentButtons(env), ['Watching0', 'Waiting0', 'Done1'], 'resume pulled the other device’s change (OD-6)');
  console.log('testPullOnLoadAndOnResume passed.');
}

async function testDeviceNewerPushesOnLoad() {
  const gh = makeGitHub();
  const id = gh.addGist(payload([], T0));
  const env = await start({
    gh, gistId: id,
    library: [{ showId: 501, platform: '', watchedEpisodeId: 1002 }],
    settings: { gistId: id, token: 'good', lastSyncedAt: T0, lastLocalChangeAt: '2026-07-02T00:00:00.000Z' }
  });
  await wait(50);
  const remote = gh.content(id);
  assert.strictEqual(remote.library.length, 1, 'an unsent change on this device was pushed on load');
  assert.strictEqual(remote.updatedAt, '2026-07-02T00:00:00.000Z', 'pushed with the time of the change');
  console.log('testDeviceNewerPushesOnLoad passed.');
}

async function testOfflineKeepsLocalChanges() {
  const env = await start({ library: [{ showId: 501, platform: '', watchedEpisodeId: 1002 }] });
  env.gh.offline = true;
  click(env, 'mark-501');
  await wait(80);
  assert.strictEqual(text(env, '#sync-indicator'), 'Offline', 'offline is shown');
  assert.strictEqual(storedLibrary(env)[0].watchedEpisodeId, 1003, 'the change is kept on the device (SYN-7)');
  assert.strictEqual(env.gh.content(env.gistId).library[0].watchedEpisodeId, 1002, 'gist not yet updated');

  env.gh.offline = false;
  env.window.dispatchEvent(new env.window.Event('online'));
  await wait(80);
  assert.strictEqual(env.gh.content(env.gistId).library[0].watchedEpisodeId, 1003, 'pushed when the connection returned');
  assert.strictEqual(text(env, '#sync-indicator'), '✓ Synced');
  console.log('testOfflineKeepsLocalChanges passed.');
}

async function testTokenRejectedThenChanged() {
  const env = await start({ library: [{ showId: 501, platform: '', watchedEpisodeId: 1002 }] });
  delete env.gh.tokens.good; // revoked on GitHub
  click(env, 'sync-indicator');
  await wait(5);
  assert.strictEqual(env.window.state.view, 'sync', 'the indicator opens Settings › Sync');
  click(env, 'sync-now-btn');
  await wait(60);
  assert.strictEqual(text(env, '#sync-indicator'), '⚠ Sync error');
  assert.ok(text(env, '#sync-error-text').includes('token rejected'), 'specific message (GST-9)');
  assert.strictEqual(env.window.state.view, 'sync', 'not sent back to Setup (SYN-8)');

  // Automatic pushes stop until the token is changed.
  const before = env.gh.calls.length;
  click(env, 'tab-show');
  await wait(5);
  click(env, 'mark-501');
  await wait(80);
  assert.strictEqual(env.gh.calls.length, before, 'no automatic retries with a rejected token');
  assert.strictEqual(storedLibrary(env)[0].watchedEpisodeId, 1003, 'app still usable from the local copy');

  click(env, 'sync-indicator');
  await wait(5);
  click(env, 'change-token-btn');
  await wait(5);
  type(env, 'new-token-input', 'wrong');
  click(env, 'save-token-btn');
  await wait(40);
  assert.ok(env.doc.body.textContent.includes('Token not valid'), 'a bad replacement is rejected');
  type(env, 'new-token-input', 'other');
  click(env, 'save-token-btn');
  await wait(100);
  assert.strictEqual(storedSettings(env).token, 'other', 'new token stored');
  assert.strictEqual(text(env, '#sync-indicator'), '✓ Synced');
  assert.strictEqual(env.gh.content(env.gistId).library[0].watchedEpisodeId, 1003, 'the waiting change was pushed');
  console.log('testTokenRejectedThenChanged passed.');
}

async function testGistDeletedRecreate() {
  const env = await start({ library: [{ showId: 501, platform: '', watchedEpisodeId: 1002 }] });
  delete env.gh.gists[env.gistId];
  click(env, 'sync-indicator');
  await wait(5);
  click(env, 'sync-now-btn');
  await wait(60);
  assert.ok(text(env, '#sync-error-text').includes('gist not found'));
  click(env, 'recreate-btn');
  await wait(60);
  const newId = storedSettings(env).gistId;
  assert.notStrictEqual(newId, env.gistId, 'a new gist id is stored');
  assert.strictEqual(env.gh.content(newId).library[0].showId, 501, 'recreated from the list on this device (GST-10)');
  assert.strictEqual(text(env, '#sync-indicator'), '✓ Synced');
  console.log('testGistDeletedRecreate passed.');
}

async function testMalformedRemoteNotApplied() {
  const env = await start({ library: [{ showId: 501, platform: '', watchedEpisodeId: 1002 }] });
  env.gh.gists[env.gistId].files['myshows.json'].content = '{"app":"myshows","library":"broken"}';
  click(env, 'sync-indicator');
  await wait(5);
  click(env, 'sync-now-btn');
  await wait(60);
  assert.ok(text(env, '#sync-error-text').includes('not a valid My Shows list'), 'GST-12 message');
  assert.strictEqual(storedLibrary(env)[0].showId, 501, 'device copy unchanged');
  console.log('testMalformedRemoteNotApplied passed.');
}

async function testRateLimit() {
  const env = await start({ library: [{ showId: 501, platform: '', watchedEpisodeId: 1002 }] });
  env.gh.rateLimited = true;
  click(env, 'sync-indicator');
  await wait(5);
  click(env, 'sync-now-btn');
  await wait(60);
  assert.ok(text(env, '#sync-error-text').includes('rate limit'), 'GST-11 message');
  const calls = env.gh.calls.length;
  click(env, 'sync-now-btn');
  await wait(60);
  assert.strictEqual(env.gh.calls.length, calls, 'no requests before the reset time');
  console.log('testRateLimit passed.');
}

async function testInvalidLocalListIsNeverPushed() {
  const env = await start({ library: [{ showId: 501, platform: '', watchedEpisodeId: 1002 }] });
  // Simulate a bug that corrupts the in-memory list (GST-18).
  env.window.state.library.push({ showId: 'not-a-number' });
  env.window.saveLibrary(env.window.state.library);
  await wait(80);
  assert.strictEqual(env.gh.calls.filter(c => c.method === 'PATCH').length, 0, 'nothing written to the gist');
  assert.strictEqual(env.gh.content(env.gistId).library.length, 1, 'gist unchanged');
  click(env, 'sync-indicator');
  await wait(5);
  assert.ok(text(env, '#sync-error-text').includes('failed validation'));
  console.log('testInvalidLocalListIsNeverPushed passed.');
}

// =====================================================================
// Backup & restore and Disconnect (SET-2, DATA-7, SYN-6)
// =====================================================================

async function testBackupAndRestore() {
  const env = await start({ library: [{ showId: 501, platform: 'Hulu', watchedEpisodeId: 1002 }] });
  let blob = null, anchor = null;
  env.window.URL.createObjectURL = (b) => { blob = b; return 'blob:mock'; };
  env.window.URL.revokeObjectURL = () => {};
  env.window.HTMLAnchorElement.prototype.click = function () { anchor = this; };

  click(env, 'tab-settings');
  await wait(5);
  click(env, 'settings-backup');
  await wait(5);
  click(env, 'download-backup-btn');
  assert.match(anchor.download, /^my-shows-v2-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const exported = JSON.parse(await blob.text());
  assert.strictEqual(exported.app, 'myshows', 'backup uses the gist wrapper (DATA-7)');
  assert.strictEqual(exported.library[0].showId, 501);

  const input = env.doc.getElementById('restore-file-input');
  const file = (content) => new env.window.File([content], 'backup.json', { type: 'application/json' });

  input.onchange({ target: { files: [file('not json{{')] } });
  await wait(20);
  assert.ok(text(env, '.error-text').includes('not look like a valid'), 'malformed file rejected');

  // A V1 backup over an existing list asks to replace it (SET-4); cancel keeps it.
  env.confirmAnswer = false;
  input.onchange({ target: { files: [file(JSON.stringify([{ showId: 251, platform: 'Peacock' }]))] } });
  await wait(20);
  assert.ok(env.confirmMessages.pop().includes('Replace your list with this My Shows V1 backup'), 'V1 restore over a list asks to replace it');
  assert.strictEqual(storedLibrary(env)[0].showId, 501, 'cancelling leaves the list alone');

  // V2 restore: confirm, cancel, then replace.
  input.onchange({ target: { files: [file(JSON.stringify(payload([{ showId: 888, platform: 'Prime Video', watchedEpisodeId: 8001 }])))] } });
  await wait(20);
  assert.ok(env.confirmMessages.pop().includes('Replace your list'), 'restore asks for confirmation');
  assert.strictEqual(storedLibrary(env)[0].showId, 501, 'cancelling leaves the list alone');
  env.confirmAnswer = true;
  input.onchange({ target: { files: [file(JSON.stringify(payload([{ showId: 888, platform: 'Prime Video', watchedEpisodeId: 8001 }])))] } });
  await wait(120);
  assert.strictEqual(env.window.state.view, 'list');
  assert.strictEqual(storedLibrary(env)[0].showId, 888, 'restored on this device');
  assert.strictEqual(env.gh.content(env.gistId).library[0].showId, 888, 'and pushed to the gist');

  // V1 restore confirmed: replaces the V2 list, same as a V2 restore.
  click(env, 'tab-settings');
  await wait(5);
  click(env, 'settings-backup');
  await wait(5);
  const input2 = env.doc.getElementById('restore-file-input');
  input2.onchange({ target: { files: [file(JSON.stringify([{ showId: 251, platform: 'Peacock', watchedEpisodeId: 20864 }]))] } });
  await wait(120);
  assert.deepStrictEqual(storedLibrary(env).map(i => i.showId), [251], 'confirming replaces the V2 list with the V1 shows');
  assert.strictEqual(env.window.state.view, 'importreport', 'followed by the import report');
  await wait(80);
  assert.deepStrictEqual(env.gh.content(env.gistId).library.map(i => i.showId), [251], 'and synced');
  console.log('testBackupAndRestore passed.');
}

async function testV1BackupImport() {
  const env = await start({ library: [] });
  click(env, 'tab-settings');
  await wait(5);
  click(env, 'settings-backup');
  await wait(5);
  const input = env.doc.getElementById('restore-file-input');
  const file = (content) => new env.window.File([content], 'my-shows-backup.json', { type: 'application/json' });
  const v1Backup = JSON.stringify([
    { showId: 501, platform: 'Hulu', watchedEpisodeId: 1002, pendingSeasonNumber: null },
    { showId: 777, platform: '', watchedEpisodeId: 7001, pendingSeasonNumber: null },
    { showId: 888, platform: 'Prime', watchedThrough: { season: 1, number: 1 } },
    { showId: 251, platform: 'Peacock', watchedEpisodeId: 20864, archived: true, archivedAt: '2026-07-01',
      archivedSnapshot: { lastWatchedCode: 'S02E07', episodesLeftInSeason: 3, seasonsRemaining: { remaining: 1, total: 2 } } }
  ]);

  env.confirmAnswer = false;
  input.onchange({ target: { files: [file(v1Backup)] } });
  await wait(20);
  const question = env.confirmMessages.pop();
  assert.ok(question.includes('Import 2 show(s)') && question.includes("2 show(s) can\u2019t be imported"), 'confirmation gives both counts');
  assert.strictEqual(storedLibrary(env).length, 0, 'cancelling imports nothing');

  env.confirmAnswer = true;
  input.onchange({ target: { files: [file(v1Backup)] } });
  await wait(120);
  assert.strictEqual(env.window.state.view, 'importreport', 'a report follows the import');
  assert.ok(text(env, '.status-line').includes('2 shows imported'));
  const skipped = [...env.doc.querySelectorAll('#skipped-list .row')].map(r => r.textContent);
  assert.strictEqual(skipped.length, 2, 'both left-out shows are listed');
  assert.ok(skipped[0].startsWith('Severance') && skipped[0].includes('No "Watching on" platform'), 'named, with the reason');
  assert.ok(skipped[1].startsWith('Fleabag') && skipped[1].includes('older version of V1'), 'old-format entry named, with the reason');

  assert.deepStrictEqual(storedLibrary(env).map(i => i.showId), [501, 251], 'only the importable shows were saved');
  await wait(80);
  assert.deepStrictEqual(env.gh.content(env.gistId).library.map(i => i.showId), [501, 251], 'and synced to the gist');

  click(env, 'report-done-btn');
  await wait(5);
  assert.deepStrictEqual(segmentButtons(env), ['Watching1', 'Waiting1', 'Done0'], 'progress and suspended state came across');
  console.log('testV1BackupImport passed.');
}

async function testDisconnect() {
  const env = await start({ library: [{ showId: 501, platform: '', watchedEpisodeId: 1002 }] });
  click(env, 'tab-settings');
  await wait(5);
  click(env, 'settings-sync');
  await wait(5);

  env.confirmAnswer = false;
  click(env, 'disconnect-btn');
  await wait(5);
  assert.strictEqual(env.window.state.view, 'sync', 'cancel keeps the connection');

  env.confirmAnswer = true;
  click(env, 'disconnect-btn');
  await wait(5);
  assert.ok(env.confirmMessages.pop().includes('stays in your GitHub gist'), 'confirmation explains the data stays in the gist');
  assert.ok(env.doc.getElementById('token-input'), 'back to Setup');
  assert.strictEqual(env.window.localStorage.getItem(SYNC_KEY), null, 'token and gist id removed');
  assert.strictEqual(env.window.localStorage.getItem(LIBRARY_KEY), null, 'device copy removed');
  assert.strictEqual(env.gh.content(env.gistId).library.length, 1, 'gist untouched');
  console.log('testDisconnect passed.');
}

async function testV1DataIsIgnored() {
  const gh = makeGitHub();
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://v2.myshows.fyi/' });
  openWindows.push(dom.window);
  dom.window.fetch = (url, o) => url.startsWith('https://api.github.com') ? gh.handle(url, o) : tvmazeFetch(url);
  dom.window.localStorage.setItem('my-shows-library-v1', JSON.stringify([{ showId: 501, watchedEpisodeId: 1002 }]));
  dom.window.eval(scriptBody);
  await wait(30);
  assert.ok(dom.window.document.getElementById('token-input'), 'V1 data does not skip Setup (C-5, ARC-6)');
  assert.strictEqual(dom.window.localStorage.getItem('my-shows-library-v1') !== null, true, 'V1 data is not touched');
  console.log('testV1DataIsIgnored passed.');
}

// =====================================================================
// V1 regressions kept (specials, search input, search errors, ordering)
// =====================================================================

async function testDuplicateSpecialsRegression() {
  const env = await start({ library: [{ showId: 251, platform: 'Peacock', watchedEpisodeId: null, pendingSeasonNumber: { season: 2, number: 8 } }] });
  assert.ok(text(env, '.row-sub').includes('Behind the Drama'));
  await wait(80); // let the startup push (resolved season/episode) finish
  const patchesBefore = env.gh.calls.filter(c => c.method === 'PATCH').length;
  click(env, 'mark-251');
  assert.ok(text(env, '.row-sub').includes('Christmas at Downton Abbey'));
  click(env, 'mark-251');
  assert.ok(text(env, '.row-sub').includes('S03E01'), 'REGRESSION CHECK: second special advances to season 3');
  assert.strictEqual(storedLibrary(env)[0].watchedEpisodeId, 623241);
  await wait(80);
  assert.strictEqual(env.gh.calls.filter(c => c.method === 'PATCH').length - patchesBefore, 1, 'two changes inside the debounce window make one push (GST-4)');
  assert.strictEqual(env.gh.content(env.gistId).library[0].watchedEpisodeId, 623241);
  console.log('testDuplicateSpecialsRegression passed.');
}

async function testSearchInputStaysStableWhileTyping() {
  const env = await start({ library: [] });
  click(env, 'tab-add');
  await wait(10);
  const input = env.doc.getElementById('search-input');
  input.focus();
  type(env, 'search-input', 'The');
  await wait(400);
  assert.strictEqual(env.doc.getElementById('search-input'), input, 'same input element after results arrive');
  assert.strictEqual(env.doc.activeElement, input, 'focus kept');
  type(env, 'search-input', 'The Bear');
  await wait(400);
  assert.strictEqual(env.doc.getElementById('search-input'), input);
  env.doc.querySelector('.search-result[data-id="501"]').click();
  await wait(5);
  assert.strictEqual(env.doc.getElementById('search-input'), input, 'selecting a result does not replace the input either');
  console.log('testSearchInputStaysStableWhileTyping passed.');
}

async function testSearchErrorVisibility() {
  const env = await start({ library: [] });
  env.window.fetch = (url, o) => url.startsWith('https://api.tvmaze.com/search')
    ? Promise.reject(new TypeError('Failed to fetch'))
    : (url.startsWith('https://api.github.com') ? env.gh.handle(url, o) : tvmazeFetch(url));
  click(env, 'tab-add');
  await wait(10);
  type(env, 'search-input', 'Downton');
  await wait(400);
  assert.ok(text(env, '.error-text').includes('Failed to fetch'), 'the real error is shown');
  console.log('testSearchErrorVisibility passed.');
}

async function testWatchingOrdering() {
  const env = await start({ library: [
    { showId: 501, platform: '', watchedEpisodeId: 1002 },
    { showId: 251, platform: '', watchedEpisodeId: 20864 }
  ] });
  assert.deepStrictEqual(rowTitles(env), ['The Bear', 'Downton Abbey']);
  const newItem = { showId: 999, platform: '', watchedEpisodeId: null };
  env.window.state.library.push(newItem);
  await env.window.refreshComputedFor([newItem], { isNewAddition: true });
  env.window.render();
  assert.strictEqual(rowTitles(env)[0], 'Fresh Show', 'newly added available show goes to the top');
  click(env, 'mark-251');
  await wait(5);
  const titles = rowTitles(env);
  assert.strictEqual(titles[titles.length - 1], 'Downton Abbey', 'still-available after mark watched goes to the bottom');
  console.log('testWatchingOrdering passed.');
}

async function testPreviousNextEpisode() {
  const env = await start({ library: [{ showId: 501, platform: 'Hulu', watchedEpisodeId: 1002 }] });
  click(env, 'row-501');
  await wait(5);
  assert.ok(text(env, '.row-sub').includes('S04E03'), 'starts with S4E3 up next');

  // Previous: undo an accidental mark watched (DET-6).
  click(env, 'prev-episode-btn');
  await wait(5);
  assert.strictEqual(env.window.state.view, 'detail', 'stays on the detail screen');
  assert.ok(text(env, '.row-sub').includes('S04E02'), 'moved back one: S4E2 is next again');
  assert.ok(text(env, '#toast').includes('Now up to S04E02 - Sundae'), 'confirms where you are now');
  assert.strictEqual(storedLibrary(env)[0].watchedEpisodeId, 1001);

  click(env, 'prev-episode-btn');
  await wait(5);
  assert.strictEqual(storedLibrary(env)[0].watchedEpisodeId, null, 'back from the first episode: nothing watched');
  assert.ok(env.doc.getElementById('prev-episode-btn').disabled, 'Previous disabled when nothing is watched');

  // Next: skip forward without watching, all the way to caught up.
  click(env, 'next-episode-btn');
  click(env, 'next-episode-btn');
  click(env, 'next-episode-btn');
  await wait(5);
  assert.strictEqual(storedLibrary(env)[0].watchedEpisodeId, 1003, 'skipped forward three episodes');
  assert.ok(text(env, '.row-sub').includes('S04E04'), 'next up is the unaired S4E4');
  assert.ok(!env.doc.getElementById('mark-watched-btn'), 'no Mark watched for an unaired episode (V1)');
  click(env, 'next-episode-btn');
  await wait(5);
  assert.ok(text(env, '#toast').includes('Caught up on The Bear'), 'confirms caught up');
  assert.ok(env.doc.getElementById('next-episode-btn').disabled, 'Next disabled when there is no further episode');
  assert.ok(!env.doc.getElementById('prev-episode-btn').disabled, 'Previous still available when caught up');

  click(env, 'back-btn');
  await wait(5);
  assert.deepStrictEqual(segmentButtons(env), ['Watching0', 'Waiting1', 'Done0'], 'the show moved to the group its new place puts it in');
  await wait(80);
  assert.strictEqual(env.gh.content(env.gistId).library[0].watchedEpisodeId, 1004, 'the change synced to the gist');

  // Suspended shows have no Previous/Next.
  clickSegment(env, 'waiting');
  click(env, 'row-501');
  await wait(5);
  click(env, 'end-series-link');
  await wait(5);
  click(env, 'row-501');
  await wait(5);
  assert.ok(!env.doc.getElementById('prev-episode-btn') && !env.doc.getElementById('next-episode-btn'), 'no buttons while suspended');
  console.log('testPreviousNextEpisode passed.');
}

async function testEpisodesLeftOnDetail() {
  const env = await start({ library: [{ showId: 251, platform: '', watchedEpisodeId: 20864 }] });
  click(env, 'row-251');
  await wait(5);
  assert.ok(/Episodes left in season\s*3/.test(text(env, '.detail-table')));
  assert.ok(/Seasons remaining\s*1 of 2/.test(text(env, '.detail-table')));
  console.log('testEpisodesLeftOnDetail passed.');
}

(async () => {
  try {
    await testSetupBlocksAppUntilConnected();
    await testFirstDeviceCreatesSecretGist();
    await testSecondDeviceLoadsExistingGist();
    await testPickerWhenSeveralListsExist();
    await testOnlyInvalidListStartsNewGist();
    await testAddShowFlowAndPush();
    await testAddScreenMarksShowsAlreadyInList();
    await testPlatformRequired();
    await testWhereAreYouUpTo();
    await testAddWhenDetailsCannotLoad();
    await testVersionLine();
    await testSegmentsSearchAndNavigation();
    await testSuspendReactivateAndDelete();
    await testPullOnLoadAndOnResume();
    await testDeviceNewerPushesOnLoad();
    await testOfflineKeepsLocalChanges();
    await testTokenRejectedThenChanged();
    await testGistDeletedRecreate();
    await testMalformedRemoteNotApplied();
    await testRateLimit();
    await testInvalidLocalListIsNeverPushed();
    await testBackupAndRestore();
    await testV1BackupImport();
    await testDisconnect();
    await testV1DataIsIgnored();
    await testDuplicateSpecialsRegression();
    await testSearchInputStaysStableWhileTyping();
    await testSearchErrorVisibility();
    await testWatchingOrdering();
    await testEpisodesLeftOnDetail();
    await testPreviousNextEpisode();
    console.log('All app integration tests passed.');
    openWindows.forEach(w => w.close());
  } catch (err) {
    console.error('TEST FAILED:', err);
    process.exit(1);
  }
})();
