import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyOf, parseKey, longDate, esc, words, hasContent, isDate, dayNumber } from '../docs/util.js';

test('date keys round trip', () => { assert.equal(keyOf(parseKey('2026-02-09')), '2026-02-09'); });
test('long date', () => { assert.equal(longDate('2026-10-04'), 'Sunday, 4 October 2026'); });
test('isDate rejects impossible days', () => { assert.ok(isDate('2024-02-29')); assert.ok(!isDate('2025-02-29')); assert.ok(!isDate('2025-13-01')); assert.ok(!isDate('x')); assert.ok(!isDate(null)); });
test('escape', () => { assert.equal(esc('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;'); });
test('word count', () => { assert.equal(words('  one two\nthree '), 3); assert.equal(words(''), 0); assert.equal(words(null), 0); });
test('hasContent', () => { assert.ok(!hasContent(null)); assert.ok(!hasContent({ title: ' ', body: '', photos: [] })); assert.ok(hasContent({ body: 'x' })); assert.ok(hasContent({ photos: ['a'] })); });
test('day number', () => { assert.equal(dayNumber(new Date(2026, 0, 1)), 1); assert.equal(dayNumber(new Date(2026, 11, 31)), 365); });
