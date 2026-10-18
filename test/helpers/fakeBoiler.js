// -----------------------------------------------------------------------------
// A fake ÖkoFEN JSON interface behind the transport of the client (no
// network): it checks the password in the path like the boiler, answers the
// current document, and can be told to fail. It records every request with
// its time, to check the spacing of the reads.
// -----------------------------------------------------------------------------

import { OekofenError } from '../../src/http.js';
import { PASSWORD, json, modern } from '../fixtures/oekofen.js';

export function fakeBoiler({ password = PASSWORD, document = modern(), encode = json } = {}) {
  const server = {
    password,
    document,
    encode,
    /** Answers to give before the document: { status, body?, headers? } or an Error. */
    queue: [],
    /** suffix -> answer, for the URL variant tests ('?' or '??'). */
    bySuffix: {},
    requests: [],
    transport: async (url, { timeout } = {}) => {
      const parsed = new URL(url);
      const [, given, all] = parsed.pathname.split('/');
      const suffix = url.endsWith('??') ? '??' : url.endsWith('?') ? '?' : '';
      server.requests.push({ at: Date.now(), suffix, timeout, url });
      const next = server.queue.shift();
      if (next instanceof Error) {
        throw next;
      }
      if (next) {
        return { headers: {}, body: Buffer.alloc(0), ...next };
      }
      if (decodeURIComponent(given) !== server.password || all !== 'all') {
        return { status: 401, headers: {}, body: Buffer.from('Unauthorized') };
      }
      const special = server.bySuffix[suffix];
      if (special) {
        return { headers: {}, ...special };
      }
      return { status: 200, headers: {}, body: server.encode(server.document) };
    },
    failNetwork(code = 'EHOSTUNREACH') {
      server.queue.push(new OekofenError('network', 'host unreachable', { code }));
    },
  };
  return server;
}

export function memoryStore(initial = null) {
  return {
    data: initial,
    saves: 0,
    async load() {
      return this.data === null ? null : structuredClone(this.data);
    },
    async save(data) {
      this.saves += 1;
      this.data = structuredClone(data);
    },
  };
}

/** Lets the pending promises settle (no timer involved). */
export const settle = async (rounds = 30) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
