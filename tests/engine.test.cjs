'use strict';
const assert = require('node:assert/strict');
const core = require('../engine.js');
const now = new Date(2026, 8, 23, 12, 0, 0);
const iso = (day, hour = 9) => new Date(2026, 8, day, hour).toISOString();
const entry = (id, day, comfort, extra = {}) => ({ id, date: iso(day), mood: 0, intensity: 5, comfort, tags: [], note: '', need: '', ...extra });

assert.deepEqual(core.MOODS.map(mood => mood.name), ['低落', '焦虑', '平静', '开心', '充满能量', '烦躁']);
assert.equal(new Set(core.MOODS.map(mood => mood.comfortDefault)).size, 1, 'Mood must not imply a comfort ranking');
assert.deepEqual(core.ACTIVITIES.map(activity => activity.id), ['breathe', 'ground', 'sound', 'walk', 'stretch', 'write']);
const empty = core.summarize([], [], 7, now);
assert.equal(empty.count, 0);
assert.equal(empty.comfortAverage, null);
assert.equal(empty.series.length, 7);
assert.ok(empty.series.every(day => day.average === null && day.count === 0));
assert.equal(empty.series[0].date, '2026-09-17');
assert.equal(empty.series[6].date, '2026-09-23');

const records = [
  entry('old', 16, 10),
  entry('boundary', 17, 2, { date: iso(17, 0), tags: ['工作', '工作'] }),
  entry('same-day', 17, 8, { mood: 4, tags: ['工作'] }),
  entry('legacy', 18, undefined, { tags: ['睡眠'] }),
  entry('null', 19, null),
  entry('invalid-score', 20, 11),
  entry('zero', 21, 0),
  entry('numeric-string', 21, '6'),
  entry('today', 23, 6, { mood: 3 }),
  entry('future-time', 23, 10, { date: iso(23, 13) }),
  entry('future-day', 24, 10),
  entry('bad-date', 23, 9, { date: 'not-a-date' }),
  entry('bad-mood', 23, 9, { mood: 25 })
];
const original = JSON.stringify(records);
const sessions = [
  { id: 'one', activityId: 'breathe', date: iso(17), feedback: 'better', beforeComfort: 4, afterComfort: 6 },
  { id: 'two', activityId: 'breathe', date: iso(20), feedback: null, beforeComfort: 4, afterComfort: 5 },
  { id: 'three', activityId: 'breathe', date: iso(21), feedback: 'worse', beforeComfort: 4, afterComfort: 8 },
  { id: 'not-scored', activityId: 'sound', date: iso(22), feedback: null, beforeComfort: null, afterComfort: 5 },
  { id: 'too-old', activityId: 'breathe', date: iso(16), feedback: 'better' },
  { id: 'too-new', activityId: 'breathe', date: iso(23, 14), feedback: 'better' },
  { id: 'unknown', activityId: 'missing', date: iso(22), feedback: 'better' }
];
const result = core.summarize(records, sessions, 7, now);
assert.equal(result.count, 8, 'Legacy and unscored entries remain in record counts');
assert.equal(result.activeDays, 6);
assert.equal(result.comfortAverage, 5.3, 'Only independent valid numeric comfort values participate');
assert.equal(result.series[0].average, 5);
assert.equal(result.series[1].count, 1);
assert.equal(result.series[1].average, null, 'A legacy-only day is a gap, not a made-up score');
assert.deepEqual(result.topTriggers[0], { tag: '工作', count: 2, uncomfortableCount: 1 }, 'Repeated tags in one record count once');
assert.deepEqual(result.helpful[0], { activityId: 'breathe', total: 3, better: 2 }, 'Explicit feedback wins over score change');
assert.deepEqual(result.helpful[1], { activityId: 'sound', total: 1, better: 0 }, 'Missing baseline is not evidence of benefit');
assert.equal(JSON.stringify(records), original, 'Summarizing must not edit stored records');
assert.equal(result.moodCounts.length, 6);
assert.ok(core.summarize([entry('one', 23, 5)], [], 7, now).observations.some(item => item.text.includes('不足')));

const needs = core.recommend({ mood: 2, need: '留住好时刻', tags: [] });
assert.equal(needs[0].activityId, 'write');
assert.ok(needs[0].reason.includes('留住好时刻'));
const sleep = core.recommend({ mood: 2, tags: ['睡眠'] });
assert.equal(sleep[0].activityId, 'sound');
const intense = core.recommend({ mood: 1, intensity: 10, comfort: 2, tags: [], need: '让自己平静' });
assert.ok(['ground', 'breathe'].includes(intense[0].activityId));
assert.equal(new Set(intense.map(item => item.activityId)).size, 3);
assert.equal(core.recommend(null, null).length, 3);
assert.ok(core.recommend({}, [{ activityId: 'walk', feedback: 'better' }])[0].reason.includes('曾'));

const demo = core.demoData(now);
assert.equal(demo.entries.length, 20);
assert.equal(new Set(demo.entries.map(item => item.id)).size, 20);
assert.ok(demo.entries.every(item => item.id.startsWith('demo-') && item.note.includes('虚构示例')));
assert.ok(demo.entries.every(item => new Date(item.date) <= now));
assert.equal(core.summarize(demo.entries, demo.sessions, 14, now).count, 20);
assert.deepEqual(core.demoData(now), demo, 'Example data is deterministic for a given date');
demo.entries[0].tags.push('mutation');
assert.ok(core.demoData(now).entries.every(item => !item.tags.includes('mutation')), 'Example data returns fresh records');
assert.equal(core.summarize(null, null, 7, now).count, 0);
console.log('engine: all assertions passed');
