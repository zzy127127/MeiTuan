'use strict';

// These are storage/state regressions against the real app source. The small
// DOM mock deliberately does not replace browser checks for layout or playback.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const Core = require('../engine.js');

const KEY = 'mind-island-v2';
const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const appEnd = /\}\)\(\);\s*$/;
assert.match(appSource, appEnd, 'The test adapter must attach inside the app closure');
const source = appSource.replace(appEnd, `
  window.__test = {
    persist, syncDraft, saveEntry, editEntry, deleteEntry, switchDemo,
    exportData, importData, drawForm,
    get personal() { return personal; },
    get draft() { return draft; },
    get demo() { return demo; }
  };
})();`);

function draft() {
  return { mood: 2, comfort: 5, intensity: 5, tags: [], note: 'unfinished original', need: '', editId: null };
}

function entry(id, comfort = null, ageMs = 1000) {
  return { id, date: new Date(Date.now() - ageMs).toISOString(), mood: 2, comfort, intensity: 5, tags: [], note: 'old ' + id, need: '' };
}

function harness(seed) {
  const store = new Map(seed ? [[KEY, JSON.stringify(seed)]] : []);
  const elements = new Map();
  const events = {}, docEvents = {}, blobs = [];
  let failWrites = false, counter = 0, document;

  function get(id) {
    if (!elements.has(id)) elements.set(id, {
      id,
      value: id === 'moodFilter' ? 'all' : id === 'careDuration' ? '99' : '',
      hidden: false, open: false, innerHTML: '', textContent: '', dataset: {}, listeners: {},
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(name, fn) { this.listeners[name] = fn; },
      querySelector(selector) { return get(id + ' ' + selector); },
      setAttribute() {}, removeAttribute() {}, insertAdjacentHTML() {}, scrollIntoView() {}, click() {},
      focus() { this.focused = true; document.activeElement = this; },
      showModal() { this.open = true; },
      close() { this.open = false; }
    });
    return elements.get(id);
  }

  const location = { hash: '#today' };
  const localStorage = {
    getItem: key => store.get(key) ?? null,
    setItem(key, value) { if (failWrites) throw new Error('Quota'); store.set(key, value); }
  };
  document = {
    activeElement: null,
    getElementById: get,
    querySelector: selector => get(selector),
    querySelectorAll(selector) {
      return selector === '.app-dialog[open]' ? [...elements.values()].filter(el => el.open) : [];
    },
    addEventListener(name, fn) { docEvents[name] = fn; },
    createElement() { return { click() {} }; }
  };
  const window = {
    MindCore: Core,
    crypto: { randomUUID: () => String(++counter) },
    CarePlayer: { init(options) { this.options = options; }, stop() {}, open() {} },
    addEventListener(name, fn) { events[name] = fn; },
    scrollTo() {}
  };
  vm.runInNewContext(source, {
    window, document, location, localStorage,
    history: { replaceState(a, b, url) { location.hash = url; } },
    setTimeout() { return 1; }, clearTimeout() {}, Blob,
    URL: { createObjectURL(blob) { blobs.push(blob); return 'blob:test'; }, revokeObjectURL() {} },
    navigator: { clipboard: { writeText() {} } }, console
  }, { filename: 'app.js' });
  return { app: window.__test, get, store, events, docEvents, blobs, window, document, location, fail() { failWrites = true; } };
}

test('an outdated tab cannot overwrite newer records, including on pagehide', () => {
  const h = harness({ entries: [entry('a')], draft: draft() });
  const external = JSON.stringify({ entries: [entry('a'), entry('remote')], draft: {} });
  h.store.set(KEY, external); // A second tab saved after this tab loaded.
  assert.equal(h.app.persist(), false);
  h.events.pagehide();
  assert.equal(h.store.get(KEY), external);
  assert.match(h.get('storageBanner').textContent, /另一标签页/);
  assert.equal(h.get('storageBanner').hidden, false);
});

test('storage notifications freeze old-tab writes before another user action', () => {
  const h = harness({ entries: [entry('a')], draft: draft() });
  const external = JSON.stringify({ entries: [entry('remote')], draft: {} });
  h.store.set(KEY, external);
  h.events.storage({ key: KEY, newValue: external });
  h.get('note').value = 'keep this only in memory';
  h.app.syncDraft();
  assert.equal(h.store.get(KEY), external);
  assert.equal(h.app.personal.draft.note, 'keep this only in memory');
});

test('switching edited records retains the original draft and save restores it', () => {
  const h = harness({ entries: [entry('a'), entry('b')], draft: draft() });
  h.app.editEntry('a');
  h.app.editEntry('b');
  assert.equal(h.app.personal.previousDraft.note, 'unfinished original');
  h.get('note').value = 'edited text';
  h.app.saveEntry({ preventDefault() {} });
  assert.equal(h.app.personal.entries.find(e => e.id === 'b').note, 'edited text');
  assert.equal(h.app.draft.note, 'unfinished original');
  assert.equal(h.app.personal.previousDraft, null);
});

test('refreshing during editing still allows cancel to restore the original draft', () => {
  let h = harness({ entries: [entry('a')], draft: draft() });
  h.app.editEntry('a');
  h = harness(JSON.parse(h.store.get(KEY)));
  h.get('cancelEdit').listeners.click();
  assert.equal(h.app.draft.note, 'unfinished original');
  assert.equal(h.app.draft.editId, null);
  assert.equal(h.app.personal.entries[0].note, 'old a');
});

test('editing legacy text preserves an unknown comfort rating', () => {
  const h = harness({ entries: [entry('a')], draft: {} });
  h.app.editEntry('a');
  assert.match(h.get('comfortValue').innerHTML, /未评分/);
  h.get('note').value = 'only the text changed';
  h.app.saveEntry({ preventDefault() {} });
  assert.equal(h.app.personal.entries[0].comfort, null);
  assert.equal(JSON.parse(h.store.get(KEY)).entries[0].comfort, null);
});

test('an explicit slider adjustment can add a rating to a legacy entry', () => {
  const h = harness({ entries: [entry('a')], draft: {} });
  h.app.editEntry('a');
  h.get('comfort').value = '7';
  h.get('comfort').listeners.input();
  h.app.saveEntry({ preventDefault() {} });
  assert.equal(h.app.personal.entries[0].comfort, 7);
});

test('practice baseline expires after one hour and failed writes report failure', () => {
  const old = harness({ entries: [entry('a', 8, 7200000)], draft: {} });
  assert.equal(old.window.CarePlayer.options.getComfort(), null);
  const h = harness({ entries: [entry('a', 8)], draft: {} });
  assert.equal(h.window.CarePlayer.options.getComfort(), 8);
  h.fail();
  const saved = h.window.CarePlayer.options.onComplete({ id: 'practice', activityId: 'breathe', date: new Date().toISOString(), duration: 60, beforeComfort: 8, afterComfort: 8, feedback: 'same' });
  assert.equal(saved, false);
  assert.equal(h.app.personal.sessions.length, 1, 'Failed durable writes remain exportable in memory');
});

test('backup exports both drafts and imports them without overwriting an active draft', async () => {
  const h = harness({ entries: [entry('a')], draft: draft() });
  h.app.editEntry('a');
  h.app.exportData();
  const backup = JSON.parse(await h.blobs[0].text());
  assert.equal(backup.previousDraft.note, 'unfinished original');
  assert.equal(backup.draft.editId, 'a');
  const file = { size: 1000, text: async () => JSON.stringify(backup) };
  const empty = harness();
  await empty.app.importData(file);
  assert.equal(empty.app.draft.editId, 'a');
  assert.equal(empty.app.personal.previousDraft.note, 'unfinished original');
  const occupied = harness({ entries: [], draft: { ...draft(), note: 'do not overwrite me' } });
  await occupied.app.importData(file);
  assert.equal(occupied.app.draft.note, 'do not overwrite me');
  assert.equal(occupied.app.personal.entries.length, 1);
});

test('demo operations stay isolated and open app dialogs close on entry', () => {
  const h = harness({ entries: [entry('a')], draft: draft() });
  h.app.editEntry('a');
  h.get('aboutDialog').showModal();
  const personalEntries = JSON.stringify(h.app.personal.entries);
  h.app.switchDemo(true);
  assert.equal(h.app.demo, true);
  assert.equal(h.get('aboutDialog').open, false);
  h.get('note').value = 'fictional demo addition';
  h.app.syncDraft();
  assert.equal(JSON.stringify(h.app.personal.entries), personalEntries);
  h.app.switchDemo(false);
  assert.equal(h.app.draft.editId, 'a');
  assert.equal(h.app.personal.previousDraft.note, 'unfinished original');
  assert.notEqual(h.app.draft.note, 'fictional demo addition');
});

test('demo backups are rejected before any personal records are changed', async () => {
  const h = harness({ entries: [entry('a')], draft: draft() });
  await h.app.importData({ size: 100, text: async () => JSON.stringify({ dataKind: 'demo', entries: [entry('demo-b')] }) });
  assert.equal(h.app.personal.entries.length, 1);
  assert.equal(h.app.personal.entries[0].id, 'a');
});

test('the skip link focuses main without changing the selected page', () => {
  const h = harness();
  h.location.hash = '#journal';
  let prevented = false;
  h.docEvents.click({ target: { closest: selector => selector === 'a.skip-link' ? {} : null }, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(h.location.hash, '#journal');
  assert.equal(h.document.activeElement, h.get('main'));
});

test('re-rendering mood controls restores keyboard focus to the chosen mood', () => {
  const h = harness();
  h.document.activeElement = { dataset: { mood: '2' } };
  h.app.drawForm();
  assert.equal(h.document.activeElement, h.get('[data-mood="2"]'));
});
