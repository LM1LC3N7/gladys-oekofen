// -----------------------------------------------------------------------------
// The client of the ÖkoFEN JSON interface: `GET http://<ip>:<port>/<password>
// /all?` (the format of the device, as the reference builds it), one request
// at a time, never two closer than 3 s (the boiler refuses reads closer than
// 2.5 s). The URL carries the password: it is built here only, and never
// leaves this file (no log, no error message, no status).
//
// Ported in part from dominikamann/oekofen-pellematic-compact 4.4.0
// (Apache-2.0), changed: see THIRD_PARTY_NOTICES.md.
// -----------------------------------------------------------------------------

import { isIP } from 'node:net';
import { TIMINGS } from './constants.js';
import { OekofenError, httpGet, parseRetryAfter } from './http.js';
import { hasMetadata, parseBody } from './oekofen.js';

/** The answer of a refused read that only asks to wait (401 "Wait at least 2500ms…"). */
const WAIT = /wait at least/i;

export class OekofenClient {
  constructor({ transport = httpGet, now = Date.now, timers = globalThis } = {}) {
    this.transport = transport;
    this.now = now;
    this.timers = timers;
    this.host = '';
    this.port = 0;
    this.password = '';
    this.lastRequestAt = -Infinity;
    this.queue = Promise.resolve();
  }

  configure({ host, port, password }) {
    this.host = host ?? '';
    this.port = port ?? 0;
    this.password = password ?? '';
  }

  get configured() {
    return this.host !== '' && this.password !== '' && this.port > 0;
  }

  /** The URL of the interface. Never logged: it holds the password. */
  url(suffix) {
    const host = isIP(this.host) === 6 ? `[${this.host}]` : this.host;
    return `http://${host}:${this.port}/${encodeURIComponent(this.password)}/all${suffix}`;
  }

  sleep(ms) {
    return new Promise((resolve) => this.timers.setTimeout(resolve, ms));
  }

  /**
   * One read, after the previous one and at least 3 s after it:
   * `{ root, metadata }`, or an OekofenError.
   */
  read(suffix, { timeout = TIMINGS.requestTimeout } = {}) {
    const run = this.queue.catch(() => {}).then(() => this.readNow(suffix, timeout));
    this.queue = run.catch(() => {});
    return run;
  }

  async readNow(suffix, timeout) {
    if (!this.configured) {
      throw new OekofenError('no_config', 'no address or no password');
    }
    const wait = this.lastRequestAt + TIMINGS.minRequestGap - this.now();
    if (wait > 0) {
      await this.sleep(wait);
    }
    // Counted from the attempt: a failed request is spaced too.
    this.lastRequestAt = this.now();
    const { status, headers, body } = await this.transport(this.url(suffix), { timeout });
    if (status === 200) {
      const root = parseBody(body);
      return { root, metadata: hasMetadata(root) };
    }
    if (
      status === 401 &&
      WAIT.test(
        Buffer.from(body ?? [])
          .subarray(0, 512)
          .toString('latin1'),
      )
    ) {
      throw new OekofenError('too_fast', 'the boiler asked to wait between two reads', { status });
    }
    if (status === 401 || status === 403 || status === 404) {
      throw new OekofenError('refused', 'the boiler refused the password', { status });
    }
    if (status === 429) {
      throw new OekofenError('rate_limited', 'too many requests', {
        status,
        retryAfter: parseRetryAfter(headers?.['retry-after'], this.now()),
      });
    }
    if (status >= 500 && status < 600) {
      throw new OekofenError('unavailable', 'the boiler answered an error', { status });
    }
    throw new OekofenError('http', 'unexpected answer', { status });
  }
}
