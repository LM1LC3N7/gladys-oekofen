// -----------------------------------------------------------------------------
// What must survive a restart, in /data (the only writable place of the
// container), with the boiler it belongs to (a hash of its address and port),
// bounded when read back: a pause (429, or the backoff after failures and
// "Wait at least"), a stop on a refused password, and the alarms already seen
// (message keys, boilers in fault: 200 at most), so a restart or a gap never
// fires an old alarm again nor misses a new one.
// Never the password, nor a hash of it (a short password is easy to find back
// from its hash). The file is readable by the container user only (0600).
// -----------------------------------------------------------------------------

import { open, readFile, rename } from 'node:fs/promises';
import { LIMITS, POLL_INTERVAL, TIMINGS } from './constants.js';

export const STATE_FILE = '/data/oekofen-state.json';

export function fileStore(path = STATE_FILE) {
  // One write at a time: two saves never share the temporary file.
  let chain = Promise.resolve();
  return {
    async load() {
      try {
        return JSON.parse(await readFile(path, 'utf8'));
      } catch {
        return null;
      }
    },
    save(data) {
      const text = JSON.stringify(data);
      const write = chain.then(async () => {
        const temporary = `${path}.tmp`;
        const file = await open(temporary, 'w', 0o600);
        try {
          await file.writeFile(text, 'utf8');
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temporary, path);
      });
      chain = write.catch(() => {});
      return write;
    },
  };
}

/** The longest backoff: 15 min, or the interval when it is longer (1 h at most). */
const BACKOFF_MAX = Math.max(TIMINGS.backoff.at(-1), POLL_INTERVAL.max * 1000);

const time = (value) => (Number.isFinite(value) && value > 0 ? value : undefined);

/**
 * The persisted state, repaired; the end of a pause or of a stop is capped
 * from `now`, so a clock jump or a hand-edited file never stops for good.
 */
export function normalizeMemory(raw, now = Date.now()) {
  const key = typeof raw?.key === 'string' && /^[0-9a-f]{32}$/.test(raw.key) ? raw.key : '';
  const p = raw?.pause;
  const kind = p?.kind === 'backoff' ? 'backoff' : 'rate';
  const pause =
    key && time(p?.until)
      ? {
          kind,
          until: Math.min(p.until, now + (kind === 'rate' ? TIMINGS.rateLimitMax : BACKOFF_MAX)),
          failures: Number.isInteger(p.failures) && p.failures >= 0 ? Math.min(p.failures, 10) : 0,
        }
      : null;
  const a = raw?.alarms;
  const alarms =
    key && a && typeof a === 'object' && Array.isArray(a.seen)
      ? {
          seen: a.seen
            .filter((k) => typeof k === 'string' && k.length <= 512)
            .slice(-LIMITS.seenAlarms),
          faulted: Array.isArray(a.faulted)
            ? a.faulted.filter((id) => typeof id === 'string' && /^pe[1-9][0-9]?$/.test(id))
            : [],
        }
      : null;
  const b = raw?.block;
  const block =
    key && b && typeof b === 'object'
      ? {
          retries: Number.isInteger(b.retries) && b.retries >= 0 ? Math.min(b.retries, 10) : 0,
          retryAt: Math.min(time(b.retryAt) ?? now, now + TIMINGS.refusedRetry.at(-1)),
        }
      : null;
  return { key, pause, block, alarms };
}
