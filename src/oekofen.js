// -----------------------------------------------------------------------------
// The answer of the ÖkoFEN JSON interface (pure): its bytes decoded (UTF-8,
// Latin-1 or a mix of both), its known JSON defects repaired, its values read.
// Ported from dominikamann/oekofen-pellematic-compact 4.4.0 (Apache-2.0):
// `_charset_from_raw`, the `L_statetext:` hotfix and the escaping of control
// characters of `fetch_data`, `get_api_value`, the sentinel and scale filters
// of `sensor.py`, `decode_state` and `parse_message` of `diagnosis.py`.
//
// The answer is untrusted: only own keys of the expected shapes are read
// (`Object.hasOwn`), every object built here has no prototype, a key such as
// `__proto__` or `constructor` is just never looked at.
//
// Shape of an answer (modern firmware; old firmware sends bare values):
//   { "system": { "L_ambient": { "val": -69, "unit": "°C", "factor": 0.1,
//                 "min": -32768, "max": 32767, "text": "Außentemperatur" }, … },
//     "pe1": { "L_temp_act": { … }, "L_statetext": "Leistungsbrand|…", … },
//     "hk1": { … }, "ww1": { … }, "pu1": { … }, "sk1": { … }, "se1": { … },
//     "wp1": { … },
//     "error": { "error_1": "29-01-2026 18:21:32|PE 1 Pellets Warnung [5054]" } }
// -----------------------------------------------------------------------------

import { LIMITS } from './constants.js';
import { OekofenError } from './http.js';

/** The component kinds read, and their key: `pe1`, `hk2`… (1 to 99). */
export const KINDS = ['pe', 'hk', 'ww', 'pu', 'sk', 'se', 'wp'];
const COMPONENT = /^(pe|hk|ww|pu|sk|se|wp)([1-9][0-9]?)$/;

/** U+FFFD, what a broken UTF-8 sequence decodes to. */
const REPLACEMENT = String.fromCharCode(0xfffd);
const utf8 = new TextDecoder('utf-8', { fatal: true });
const utf8Lenient = new TextDecoder('utf-8');

/**
 * The text of an answer. UTF-8 when it decodes; a mostly-UTF-8 answer with a
 * few Latin-1 bytes (less than 20 % of its non-ASCII characters broken, as
 * the reference measures it) stays UTF-8 without the broken bytes; anything
 * else is Latin-1 (ISO-8859-1), the charset of many boilers.
 */
export function decodeBody(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  let text;
  try {
    text = utf8.decode(buffer);
  } catch {
    const lenient = utf8Lenient.decode(buffer);
    let broken = 0;
    let nonAscii = 0;
    for (const char of lenient) {
      if (char === REPLACEMENT) {
        broken += 1;
      }
      if (char.codePointAt(0) > 127) {
        nonAscii += 1;
      }
    }
    text =
      nonAscii > 0 && broken / nonAscii < 0.2
        ? lenient.replaceAll(REPLACEMENT, '')
        : buffer.toString('latin1');
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * The known defects of the answer, repaired in one linear pass:
 * - firmware 4.02 writes `"L_statetext:"…` (a quote missing);
 * - messages hold raw new lines (and other control characters) inside
 *   strings, which JSON forbids: they are escaped.
 */
export function repairJson(text) {
  const source = text.split('L_statetext:').join('L_statetext":');
  const out = [];
  let start = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i += 1) {
    const code = source.charCodeAt(i);
    if (!inString) {
      if (code === 0x22) {
        inString = true;
      }
      continue;
    }
    if (escaped) {
      escaped = false;
    } else if (code === 0x5c) {
      escaped = true;
    } else if (code === 0x22) {
      inString = false;
    } else if (code < 0x20) {
      out.push(source.slice(start, i));
      out.push(
        code === 0x0a
          ? '\\n'
          : code === 0x0d
            ? '\\r'
            : code === 0x09
              ? '\\t'
              : `\\u${code.toString(16).padStart(4, '0')}`,
      );
      start = i + 1;
    }
  }
  out.push(source.slice(start));
  return out.join('');
}

/** The bytes of an answer -> its JSON root (an object), or an OekofenError. */
export function parseBody(bytes) {
  const text = decodeBody(bytes);
  if (text.trim() === '') {
    throw new OekofenError('empty', 'empty answer');
  }
  let root;
  try {
    root = JSON.parse(repairJson(text));
  } catch {
    throw new OekofenError('bad_response', 'the answer is not JSON');
  }
  if (!isRecord(root)) {
    throw new OekofenError('bad_response', 'the answer is not a JSON object');
  }
  return root;
}

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** An own field of a section, never one of its prototype. */
export const field = (section, key) =>
  isRecord(section) && Object.hasOwn(section, key) ? section[key] : undefined;

/** Modern firmware: `{ val, unit, factor, … }` objects; old firmware: bare values. */
export function hasMetadata(root) {
  for (const key of Object.keys(root)) {
    const section = root[key];
    if (!isRecord(section)) {
      continue;
    }
    for (const name of Object.keys(section)) {
      const value = section[name];
      if (
        isRecord(value) &&
        ['val', 'unit', 'factor', 'format'].some((k) => Object.hasOwn(value, k))
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * The components of an answer, in a stable order: `[{ id, kind, index,
 * section }]` (`pe1`, `hk1`…), at most LIMITS.components.
 */
export function componentsOf(root) {
  const found = [];
  for (const key of Object.keys(root)) {
    const match = COMPONENT.exec(key);
    if (match && isRecord(root[key])) {
      found.push({ id: key, kind: match[1], index: Number(match[2]), section: root[key] });
    }
  }
  found.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.index - b.index);
  return found.slice(0, LIMITS.components);
}

/** The value of a field: `val` of a metadata object, else the bare value. */
export function rawValue(raw) {
  if (isRecord(raw)) {
    return Object.hasOwn(raw, 'val') ? raw.val : undefined;
  }
  return raw;
}

const NUMERIC = /^\s*[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?\s*$/;

/** A number from a number or a numeric string; undefined otherwise (null, '', true…). */
export function asNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && NUMERIC.test(value)) {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
  return undefined;
}

// The boiler reports "no sensor / not available" as the int16 extremes.
const SENTINEL_HIGH = [32765, 32767];
const SENTINEL_LOW = [-32768, -32766];

/**
 * The int16 "not available" markers (sensor.py `_is_sentinel_value`): the
 * high band only when a `max` inside int16 is declared (counters reach it),
 * the low band unless a `min` below int16 is declared.
 */
function isSentinel(value, min, max) {
  if (value >= SENTINEL_HIGH[0] && value <= SENTINEL_HIGH[1]) {
    return max !== undefined && max <= SENTINEL_HIGH[1];
  }
  if (value >= SENTINEL_LOW[0] && value <= SENTINEL_LOW[1]) {
    return min === undefined || min >= SENTINEL_LOW[0];
  }
  return false;
}

/** More than a full range beyond the declared limits: a firmware glitch. */
function isOutOfScale(value, min, max) {
  if (min === undefined || max === undefined || max - min <= 0) {
    return false;
  }
  const range = max - min;
  return value > max + range || value < min - range;
}

/**
 * The number of a field, scaled: its `factor`, else `bareFactor` (old
 * firmware sends raw values: tenths of a degree…). Undefined when absent,
 * not a number, a sentinel, out of scale, or outside `[min, max]` once
 * scaled (the plausible range of the feature).
 */
export function readNumber(
  raw,
  { bareFactor = 1, min = -Infinity, max = Infinity, decimals = 2 } = {},
) {
  const value = asNumber(rawValue(raw));
  if (value === undefined) {
    return undefined;
  }
  const meta = isRecord(raw) ? raw : undefined;
  const declaredMin = asNumber(field(meta, 'min'));
  const declaredMax = asNumber(field(meta, 'max'));
  if (
    isSentinel(value, declaredMin, declaredMax) ||
    isOutOfScale(value, declaredMin, declaredMax)
  ) {
    return undefined;
  }
  const declaredFactor = asNumber(field(meta, 'factor'));
  const factor = declaredFactor !== undefined && declaredFactor !== 0 ? declaredFactor : bareFactor;
  const scaled = value * factor;
  if (!Number.isFinite(scaled) || scaled < min || scaled > max) {
    return undefined;
  }
  const power = 10 ** decimals;
  return Math.round(scaled * power) / power;
}

/** A yes/no field: 1/0, "1"/"0", true/false, "true"/"false", "on"/"off". */
export function readBoolean(raw) {
  const value = rawValue(raw);
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value === 1 ? true : value === 0 ? false : undefined;
  }
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (['1', 'true', 'on'].includes(text)) {
      return true;
    }
    if (['0', 'false', 'off'].includes(text)) {
      return false;
    }
  }
  return undefined;
}

/** Code point ranges removed from texts (built from numbers: no invisible character in the source). */
const INVISIBLE_RANGES = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x200b, 0x200f],
  [0x2028, 0x2029],
  [0xfeff, 0xfeff],
];
const hex = (code) => code.toString(16).padStart(4, '0');
const INVISIBLE = new RegExp(
  `[${INVISIBLE_RANGES.map(([a, b]) => `\\u${hex(a)}-\\u${hex(b)}`).join('')}]`,
  'g',
);

/** A text for Gladys: no control character, spaces collapsed, bounded. */
export function cleanText(value, length = LIMITS.textLength) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }
  const text = String(value)
    // Control characters, zero-width marks, line separators, BOM.
    .replace(INVISIBLE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '') {
    return undefined;
  }
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

/** `L_statetext` ("Leistungsbrand|Kesseltemp grösser…") as one line. */
export function readStateText(raw) {
  const value = rawValue(raw);
  if (typeof value !== 'string') {
    return undefined;
  }
  return cleanText(
    value
      .split('|')
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' · '),
  );
}

/** The integer index of an enumerated field (a mode). */
export function readIndex(raw) {
  const value = asNumber(rawValue(raw));
  return value !== undefined && Number.isInteger(value) && value >= 0 && value < 1000
    ? value
    : undefined;
}

/** The label the boiler gives to `index` in the field's `format` ("0:Aus|1:Auto"). */
export function formatLabel(raw, index) {
  const format = field(isRecord(raw) ? raw : undefined, 'format');
  if (typeof format !== 'string' || format.length > 4096) {
    return undefined;
  }
  for (const entry of format.split('|')) {
    const colon = entry.indexOf(':');
    if (colon > 0 && entry.slice(0, colon).trim() === String(index)) {
      return cleanText(entry.slice(colon + 1), LIMITS.nameLength);
    }
  }
  return undefined;
}

/** Highest state index the boiler documents (diagnosis.py `_MAX_STATE_INDEX`). */
const MAX_STATE_INDEX = 101;

/**
 * The state indices of `pe.L_state` (diagnosis.py `decode_state`): a
 * metadata object with a `format` carries one index; one without, a bit
 * mask (16 = bit 4, full burn; 2048 = bit 11, fault). Bare values are
 * indices; anything beyond the highest index can only be a bit mask.
 */
export function decodeState(raw) {
  const value = asNumber(rawValue(raw));
  if (value === undefined || value < 0 || !Number.isSafeInteger(Math.trunc(value))) {
    return undefined;
  }
  const integer = Math.trunc(value);
  const bitmask = isRecord(raw) && !Object.hasOwn(raw, 'format');
  if (bitmask || integer > MAX_STATE_INDEX) {
    const states = new Set();
    for (let bit = 0; bit < 53 && 2 ** bit <= integer; bit += 1) {
      if (Math.floor(integer / 2 ** bit) % 2 === 1) {
        states.add(bit);
      }
    }
    return states;
  }
  return new Set([integer]);
}

/** The fault state of a boiler (diagnosis.py `STATE_FAULT`). */
export const STATE_FAULT = 11;

const MESSAGE_TIME = /^\s*(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})\s*\|/;

/**
 * One `error.error_N` message, "29-01-2026 18:21:32|PE 1 Pellets Warnung
 * [5054]" -> `{ time: '2026-01-29 18:21:32', text, code: '5054' }`. The time
 * is the boiler's local time, kept as written (no time zone guess). Linear:
 * the time is matched at the start, the code at the end, no backtracking.
 */
export function parseMessage(raw) {
  if (typeof raw !== 'string' || raw.length > 4096) {
    return undefined;
  }
  const match = MESSAGE_TIME.exec(raw);
  let body = (match ? raw.slice(match[0].length) : raw).trim();
  let code;
  if (body.endsWith(']')) {
    const open = body.lastIndexOf('[');
    const digits = body.slice(open + 1, -1);
    if (open >= 0 && /^\d{1,9}$/.test(digits)) {
      code = digits;
      body = body.slice(0, open);
    }
  }
  const text = cleanText(body);
  if (!text && code === undefined) {
    return undefined;
  }
  const time = match
    ? `${match[3]}-${match[2]}-${match[1]} ${match[4]}:${match[5]}:${match[6]}`
    : undefined;
  return { time, text: text ?? '', code };
}

/**
 * The messages of the `error` section, newest first (by their time, then by
 * their key), at most LIMITS.messages; `undefined` when the answer has no
 * `error` section.
 */
export function messagesOf(root) {
  const section = field(root, 'error');
  if (!isRecord(section)) {
    return undefined;
  }
  const messages = [];
  for (const key of Object.keys(section).sort()) {
    if (!/^error_\d{1,3}$/.test(key)) {
      continue;
    }
    const message = parseMessage(section[key]);
    if (message) {
      messages.push(message);
    }
    if (messages.length >= LIMITS.messages) {
      break;
    }
  }
  return messages
    .map((message, order) => ({ message, order }))
    .sort((a, b) => (b.message.time ?? '').localeCompare(a.message.time ?? '') || a.order - b.order)
    .map(({ message }) => message);
}

/** A stable key of a message, to tell a new one. */
export const messageKey = (message) =>
  `${message.time ?? ''}|${message.code ?? ''}|${message.text}`;
