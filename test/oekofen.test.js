// -----------------------------------------------------------------------------
// The answer of the JSON interface (src/oekofen.js): charsets, repairs,
// untrusted keys, values, messages. Pure, no network.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  componentsOf,
  decodeBody,
  decodeState,
  formatLabel,
  hasMetadata,
  messagesOf,
  parseBody,
  parseMessage,
  readBoolean,
  readNumber,
  readStateText,
  repairJson,
} from '../src/oekofen.js';
import { BARE, BROKEN, json, latin1, modern } from './fixtures/oekofen.js';

test('UTF-8, Latin-1 and mixed answers decode to the same text', () => {
  const doc = { pe1: { L_statetext: 'Kesseltemp grösser Wiedereinschalttemp.' }, u: '°C' };
  assert.equal(decodeBody(json(doc)), JSON.stringify(doc));
  assert.equal(decodeBody(latin1(doc)), JSON.stringify(doc));
  // Mostly UTF-8 with one stray Latin-1 byte: stays UTF-8, the broken byte dropped.
  const mixed = Buffer.concat([
    Buffer.from('{"a":"Außentemperatur Füllstand grösser Rücklauf Zündung', 'utf8'),
    Buffer.from([0xb0]),
    Buffer.from('C"}', 'utf8'),
  ]);
  assert.equal(decodeBody(mixed), '{"a":"Außentemperatur Füllstand grösser Rücklauf ZündungC"}');
  // A BOM is dropped.
  assert.equal(decodeBody(Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])), '{}');
});

test('a Latin-1 answer parses with its accents', () => {
  const root = parseBody(latin1(modern()));
  assert.equal(root.system.L_ambient.unit, '°C');
  assert.equal(root.pu1.L_tpo_act.text, 'Einschaltfühler');
});

test('the known JSON defects are repaired (L_statetext:, raw new lines)', () => {
  const root = parseBody(BROKEN);
  assert.equal(root.pe1.L_statetext, 'Zündung|Start');
  const [message] = messagesOf(root);
  assert.deepEqual(message, {
    time: '2026-01-29 18:21:32',
    text: 'PE 1 Aschebox in Kürze voll Bitte in den nächsten Tagen entleeren',
    code: '5050',
  });
  // Valid JSON is left alone, escapes included.
  const valid = '{"a":"x\\"y\\n","L_statetext":"ok"}';
  assert.equal(repairJson(valid), valid);
  assert.equal(repairJson('{"a":"\u0001"}'), '{"a":"\\u0001"}');
});

test('not JSON, empty, or not an object: a bad_response / empty error', () => {
  assert.throws(() => parseBody(Buffer.from('<html>')), { kind: 'bad_response' });
  assert.throws(() => parseBody(Buffer.from('  ')), { kind: 'empty' });
  assert.throws(() => parseBody(Buffer.from('[1,2]')), { kind: 'bad_response' });
  assert.throws(() => parseBody(Buffer.from('null')), { kind: 'bad_response' });
  // Deep nesting cannot crash the parser outside the error.
  assert.throws(() => parseBody(Buffer.from('['.repeat(200_000))), { kind: 'bad_response' });
});

test('hostile keys never reach a prototype', () => {
  const body = Buffer.from(
    '{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}},' +
      '"pe1":{"__proto__":{"L_temp_act":{"val":999}},"L_temp_set":{"val":650,"factor":0.1}},' +
      '"hk1":[],"pe0":{},"pe100":{},"ww1x":{},"error":{"__proto__":"x","error_1":"m"}}',
  );
  const root = parseBody(body);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  const components = componentsOf(root);
  assert.deepEqual(
    components.map((c) => c.id),
    ['pe1'],
  );
  // The own `__proto__` field of pe1 is never read as one of its keys.
  assert.equal(readNumber(components[0].section.L_temp_act), undefined);
  assert.equal(readNumber(components[0].section.L_temp_set), 65);
  assert.deepEqual(
    messagesOf(root).map((m) => m.text),
    ['m'],
  );
});

test('components: known kinds only, a stable order, bounded', () => {
  const root = modern();
  assert.deepEqual(
    componentsOf(root).map((c) => c.id),
    ['pe1', 'hk1', 'hk2', 'ww1', 'pu1', 'sk1', 'se1'],
  );
  const many = Object.fromEntries(Array.from({ length: 99 }, (_, i) => [`hk${i + 1}`, {}]));
  assert.equal(componentsOf(many).length, 40);
  assert.equal(hasMetadata(root), true);
  assert.equal(hasMetadata(BARE), false);
});

test('numbers: factor, bare tenths, sentinels, out of scale, plausible range', () => {
  const temp = (val, extra) => ({ val, factor: 0.1, min: -32768, max: 32767, ...extra });
  assert.equal(readNumber(temp(633), { bareFactor: 0.1 }), 63.3);
  assert.equal(readNumber(temp('-69'), { bareFactor: 0.1 }), -6.9);
  assert.equal(readNumber(640, { bareFactor: 0.1 }), 64);
  assert.equal(readNumber('700', { bareFactor: 0.1 }), 70);
  // int16 markers of an absent sensor.
  assert.equal(readNumber(temp(-32768)), undefined);
  assert.equal(readNumber(temp(32767)), undefined);
  assert.equal(readNumber(-32768), undefined, 'the low band holds without metadata');
  assert.equal(readNumber(32767), 32767, 'a counter without metadata is kept');
  assert.equal(readNumber({ val: '32766', max: '32767' }), undefined, 'string metadata');
  // A glitch of another magnitude, beyond a full range.
  assert.equal(readNumber({ val: 304366, factor: 1, min: 150, max: 30000 }), undefined);
  assert.equal(readNumber({ val: 810, factor: 1, min: 0, max: 800 }), 810);
  // Outside the plausible range of the feature.
  assert.equal(readNumber(temp(9000), { min: -20, max: 150 }), undefined);
  // Not numbers.
  for (const val of [null, '', ' ', 'true', true, [], {}, 'NaN', '1e999']) {
    assert.equal(readNumber({ val }), undefined, JSON.stringify(val));
  }
  // A tiny factor (ms -> min) and rounding.
  assert.equal(readNumber({ val: 7200000, factor: 1.6666666666666667e-5 }), 120);
});

test('booleans, state texts, mode labels', () => {
  for (const [raw, expected] of [
    [1, true],
    [0, false],
    ['true', true],
    ['false', false],
    [{ val: '1' }, true],
    [{ val: 2 }, undefined],
    ['maybe', undefined],
  ]) {
    assert.equal(readBoolean(raw), expected, JSON.stringify(raw));
  }
  assert.equal(
    readStateText('Leistungsbrand|Kesseltemp grösser Wiedereinschalttemp.'),
    'Leistungsbrand · Kesseltemp grösser Wiedereinschalttemp.',
  );
  assert.equal(readStateText('a\u0007b\n|  |c'), 'a b · c');
  assert.equal(readStateText('x'.repeat(500)).length, 160);
  const raw = { val: 3, format: '0:Aus|1:Auto|2:Heizen|3:Absenken' };
  assert.equal(formatLabel(raw, 3), 'Absenken');
  assert.equal(formatLabel(raw, 7), undefined);
});

test('boiler state: an index with a format, a bit mask without', () => {
  assert.deepEqual([...decodeState({ val: 11, format: '0:Dauerlauf|11:Störung' })], [11]);
  assert.deepEqual([...decodeState({ val: 2048, factor: 1 })], [11]);
  assert.deepEqual([...decodeState({ val: 268435472, factor: 1 })], [4, 28]);
  assert.deepEqual([...decodeState('4')], [4]);
  assert.deepEqual([...decodeState(2064)], [4, 11], 'beyond the last index: a bit mask');
  assert.equal(decodeState({ val: 'x' }), undefined);
  assert.equal(decodeState(-1), undefined);
});

test('messages: time, text and code; newest first; bounded; linear on hostile input', () => {
  assert.deepEqual(parseMessage('04-02-2026 16:12:43|PE 1 Pellets Warnung [5054]'), {
    time: '2026-02-04 16:12:43',
    text: 'PE 1 Pellets Warnung',
    code: '5054',
  });
  assert.deepEqual(parseMessage('Free text'), {
    time: undefined,
    text: 'Free text',
    code: undefined,
  });
  assert.equal(parseMessage('   '), undefined);
  assert.equal(parseMessage(42), undefined);
  const root = {
    error: {
      error_1: '01-02-2026 10:00:00|old [1]',
      error_2: '03-02-2026 10:00:00|new [2]',
      other: 'ignored',
    },
  };
  assert.deepEqual(
    messagesOf(root).map((m) => m.code),
    ['2', '1'],
  );
  assert.equal(messagesOf({}), undefined);
  assert.deepEqual(messagesOf({ error: {} }), []);
  const flood = {
    error: Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`error_${i}`, `m${i}`])),
  };
  assert.equal(messagesOf(flood).length, 10);
  const started = process.hrtime.bigint();
  parseMessage(`01-01-2026 00:00:00|${' '.repeat(4000)}[`);
  parseMessage(`01-01-2026 00:00:00|${'['.repeat(4000)}`);
  assert.ok(process.hrtime.bigint() - started < 50_000_000n, 'linear');
});
