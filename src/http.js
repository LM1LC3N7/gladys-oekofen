// -----------------------------------------------------------------------------
// The only network access: one HTTP GET to the boiler's JSON interface, and
// the errors it ends with. The body read is bounded; the messages never hold
// the URL (it carries the password), the address nor the password.
// -----------------------------------------------------------------------------

import http from 'node:http';
import { LIMITS, TIMINGS } from './constants.js';

/**
 * A failed read. `kind`:
 * - `no_config`: no address or no password (nothing sent);
 * - `refused`: the boiler refused the password (401, 403 or 404);
 * - `too_fast`: the boiler asked to wait between two requests (401 "Wait at least");
 * - `rate_limited`: 429, `retryAfter` in ms when given;
 * - `unavailable`: 5xx;
 * - `network`, `timeout`: no answer;
 * - `bad_response`, `size`, `empty`: not the expected JSON;
 * - `http`: any other status.
 */
export class OekofenError extends Error {
  constructor(kind, message, { status, retryAfter, code } = {}) {
    super(message);
    this.name = 'OekofenError';
    this.kind = kind;
    this.status = status;
    this.retryAfter = retryAfter;
    this.code = code;
  }
}

const NETWORK_REASONS = {
  ECONNREFUSED: 'connection refused',
  ECONNRESET: 'connection reset',
  EHOSTUNREACH: 'host unreachable',
  ENETUNREACH: 'network unreachable',
  ENOTFOUND: 'unknown host name',
  EAI_AGAIN: 'host name not resolved',
  ETIMEDOUT: 'connection timed out',
  EPIPE: 'connection closed',
  HPE_INVALID_CONSTANT: 'not an HTTP answer',
};

/**
 * A socket error -> OekofenError, from its code only: Node's own message
 * holds the address and the port (never the path, but still).
 */
export function networkError(err) {
  if (err instanceof OekofenError) {
    return err;
  }
  const code = typeof err?.code === 'string' && /^[A-Z_]{1,32}$/.test(err.code) ? err.code : '';
  return new OekofenError('network', NETWORK_REASONS[code] ?? 'network error', {
    code: code || undefined,
  });
}

/** A short, secret-free reason for a log. */
export function errorReason(err) {
  if (err instanceof OekofenError) {
    const details = [err.code, err.status ? `HTTP ${err.status}` : undefined].filter(Boolean);
    return details.length > 0 ? `${err.message} (${details.join(', ')})` : err.message;
  }
  return 'internal error';
}

/**
 * The options of a GET to `url`, its path kept as written: the boiler wants
 * `/all?` and `/all??`, and Node's URL parsing drops an empty query (`?`).
 */
export function requestOptions(url) {
  const target = new URL(url);
  const start = url.indexOf('/', url.indexOf('//') + 2);
  return {
    protocol: target.protocol,
    hostname: target.hostname.replace(/^\[(.*)\]$/, '$1'),
    port: target.port || 80,
    path: start === -1 ? '/' : url.slice(start),
    method: 'GET',
    headers: { Accept: 'application/json', Connection: 'close' },
    agent: false,
  };
}

/**
 * One GET; resolves `{ status, headers, body }` (body: a Buffer) whatever
 * the status. The promise settles once; the body read is bounded (a bigger
 * answer is an error, the socket is closed at once); the whole request is
 * bounded in time.
 */
export function httpGet(
  url,
  { timeout = TIMINGS.requestTimeout, maxBytes = LIMITS.responseBytes } = {},
) {
  return new Promise((resolve, reject) => {
    let timer;
    let settled = false;
    let req;
    const settle = (fn, value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn(value);
      }
    };
    try {
      req = http.get(requestOptions(url), (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            settle(reject, new OekofenError('size', 'answer too large'));
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          settle(resolve, {
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
        res.on('error', (err) => settle(reject, networkError(err)));
        res.on('aborted', () => settle(reject, new OekofenError('network', 'answer cut short')));
      });
    } catch (err) {
      // An URL Node refuses (should not happen: the address is checked before).
      settle(reject, new OekofenError('network', 'invalid address', { code: err?.code }));
      return;
    }
    timer = setTimeout(() => {
      settle(
        reject,
        new OekofenError('timeout', `no answer within ${Math.round(timeout / 1000)} s`),
      );
      req.destroy();
    }, timeout);
    req.on('error', (err) => settle(reject, networkError(err)));
  });
}

/** Retry-After (seconds or an HTTP date) -> milliseconds, undefined when absent. */
export function parseRetryAfter(value, now = Date.now()) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}
