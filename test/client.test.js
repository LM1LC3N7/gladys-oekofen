// -----------------------------------------------------------------------------
// The client (src/client.js) against a fake transport, and the bounded GET
// (src/http.js) against a server on the loopback interface (127.0.0.1 only:
// nothing leaves the machine).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { OekofenClient } from '../src/client.js';
import { errorReason, httpGet, networkError, requestOptions } from '../src/http.js';
import { PASSWORD, json, modern } from './fixtures/oekofen.js';

const answer =
  (status, body = '', headers = {}) =>
  async () => ({
    status,
    headers,
    body: Buffer.from(body),
  });

function client(transport) {
  const c = new OekofenClient({ transport });
  c.configure({ host: '192.168.1.50', port: 4321, password: PASSWORD });
  return c;
}

test('the URL is the format of the device; the password is encoded in its path', async () => {
  const urls = [];
  const c = client(async (url) => {
    urls.push(url);
    return { status: 200, headers: {}, body: json(modern()) };
  });
  c.configure({ host: '192.168.1.50', port: 4321, password: 'a/b c' });
  assert.equal(c.url('?'), 'http://192.168.1.50:4321/a%2Fb%20c/all?');
  c.configure({ host: 'fe80::1', port: 4321, password: 'x' });
  assert.equal(c.url('??'), 'http://[fe80::1]:4321/x/all??');
  c.configure({ host: '192.168.1.50', port: 4321, password: PASSWORD });
  const { root, metadata } = await c.read('?');
  assert.equal(metadata, true);
  assert.ok(root.pe1);
  assert.deepEqual(urls, [`http://192.168.1.50:4321/${PASSWORD}/all?`]);
});

test('statuses: refused, too fast, 429, 5xx, other; never the URL in the error', async () => {
  const cases = [
    [answer(401, 'Unauthorized'), 'refused'],
    [answer(403), 'refused'],
    [answer(404), 'refused'],
    [answer(401, 'Wait at least 2500ms during requests'), 'too_fast'],
    [answer(429, '', { 'retry-after': '120' }), 'rate_limited'],
    [answer(503), 'unavailable'],
    [answer(302), 'http'],
    [answer(200, '<html>'), 'bad_response'],
    [answer(200, ''), 'empty'],
  ];
  for (const [transport, kind] of cases) {
    const err = await client(transport)
      .read('?')
      .then(
        () => undefined,
        (e) => e,
      );
    assert.equal(err?.kind, kind);
    assert.ok(!err.message.includes(PASSWORD) && !err.message.includes('192.168'));
    assert.ok(!errorReason(err).includes(PASSWORD));
    if (kind === 'rate_limited') {
      assert.equal(err.retryAfter, 120_000);
    }
  }
});

test('nothing is sent without an address or a password', async () => {
  let calls = 0;
  const c = new OekofenClient({
    transport: async () => {
      calls += 1;
    },
  });
  c.configure({ host: '192.168.1.50', port: 4321, password: '' });
  await assert.rejects(c.read('?'), { kind: 'no_config' });
  assert.equal(calls, 0);
});

test('two requests are never closer than 3 s, failures included', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const at = [];
  const c = new OekofenClient({
    transport: async () => {
      at.push(Date.now());
      return { status: 503, headers: {}, body: Buffer.alloc(0) };
    },
  });
  c.configure({ host: '192.168.1.50', port: 4321, password: PASSWORD });
  const first = c.read('?').catch(() => {});
  const second = c.read('?').catch(() => {});
  await first;
  for (let i = 0; i < 10; i += 1) {
    t.mock.timers.tick(500);
    await new Promise((resolve) => setImmediate(resolve));
  }
  await second;
  assert.deepEqual(at, [0, 3000]);
});

test('a socket error keeps its code only (Node puts the address in its message)', () => {
  const err = networkError(
    Object.assign(new Error('connect ECONNREFUSED 192.168.1.50:4321'), { code: 'ECONNREFUSED' }),
  );
  assert.equal(err.kind, 'network');
  assert.equal(err.message, 'connection refused');
  assert.equal(errorReason(new Error(`GET http://x/${PASSWORD}/all?`)), 'internal error');
});

/** A server on 127.0.0.1, closed after the test. */
async function loopback(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('httpGet: the path is sent as written ("?" and "??" kept), the body read as bytes', async (t) => {
  const paths = [];
  const base = await loopback(t, (req, res) => {
    paths.push(req.url);
    res.end(Buffer.from('{"a":"°C"}', 'latin1'));
  });
  const { status, body } = await httpGet(`${base}/${PASSWORD}/all?`);
  assert.equal(status, 200);
  assert.deepEqual([...body], [...Buffer.from('{"a":"°C"}', 'latin1')]);
  await httpGet(`${base}/a%2Fb/all??`);
  assert.deepEqual(paths, [`/${PASSWORD}/all?`, '/a%2Fb/all??']);
  assert.equal(requestOptions('http://[fe80::1]:4321/x/all?').hostname, 'fe80::1');
});

test('httpGet: an answer too large is cut and refused', async (t) => {
  const base = await loopback(t, (req, res) => {
    res.write(Buffer.alloc(64 * 1024, 0x20));
    res.end(Buffer.alloc(64 * 1024, 0x20));
  });
  await assert.rejects(httpGet(`${base}/x/all?`, { maxBytes: 100 * 1024 }), { kind: 'size' });
});

test('httpGet: a boiler that never answers times out', async (t) => {
  const base = await loopback(t, () => {});
  const err = await httpGet(`${base}/${PASSWORD}/all?`, { timeout: 200 }).catch((e) => e);
  assert.equal(err.kind, 'timeout');
  assert.ok(!err.message.includes(PASSWORD));
});
