// -----------------------------------------------------------------------------
// What must survive a restart, in /data (the only writable place of the
// container): a 429 pause and a stop on a refused password, with the boiler
// they belong to (a hash of its address and port), bounded when read back.
// Never the password, nor a hash of it (a short password is easy to find back
// from its hash). The file is readable by the container user only (0600).
// -----------------------------------------------------------------------------

import { open, readFile, rename } from 'node:fs/promises';
import { TIMINGS } from './constants.js';

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

const time = (value) => (Number.isFinite(value) && value > 0 ? value : undefined);

/**
 * The persisted state, repaired; the end of a pause or of a stop is capped
 * from `now`, so a clock jump or a hand-edited file never stops for good.
 */
export function normalizeMemory(raw, now = Date.now()) {
  const key = typeof raw?.key === 'string' && /^[0-9a-f]{32}$/.test(raw.key) ? raw.key : '';
  const pause =
    key && time(raw?.pause?.until)
      ? { until: Math.min(raw.pause.until, now + TIMINGS.rateLimitMax) }
      : null;
  const b = raw?.block;
  const block =
    key && b && typeof b === 'object'
      ? {
          retries: Number.isInteger(b.retries) && b.retries >= 0 ? Math.min(b.retries, 10) : 0,
          retryAt: Math.min(time(b.retryAt) ?? now, now + TIMINGS.refusedRetry.at(-1)),
        }
      : null;
  return { key, pause, block };
}
