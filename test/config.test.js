// -----------------------------------------------------------------------------
// The configuration (src/config.js): the address typed by the user, the
// port, the password apart, the bounds.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boilerKey, normalizeConfig, parseAddress } from '../src/config.js';

test('the address: an IP, a host name, http:// and :port accepted', () => {
  assert.deepEqual(parseAddress('192.168.1.50'), { host: '192.168.1.50', port: undefined });
  assert.deepEqual(parseAddress(' http://192.168.1.50:4321 '), {
    host: '192.168.1.50',
    port: 4321,
  });
  assert.deepEqual(parseAddress('Pellematic.local'), { host: 'pellematic.local', port: undefined });
  assert.deepEqual(parseAddress('fe80::1'), { host: 'fe80::1', port: undefined });
  assert.deepEqual(parseAddress('[fe80::1]:8080'), { host: 'fe80::1', port: 8080 });
  assert.deepEqual(parseAddress(''), {});
});

test('a pasted URL (it may hold the password) or a bad address is refused', () => {
  assert.deepEqual(parseAddress('http://192.168.1.50:4321/Zx9q/all?'), { error: 'path' });
  assert.deepEqual(parseAddress('192.168.1.50/Zx9q'), { error: 'path' });
  assert.deepEqual(parseAddress('user@192.168.1.50'), { error: 'path' });
  assert.deepEqual(parseAddress('bad_host!'), { error: 'invalid' });
  assert.deepEqual(parseAddress('192.168.1.50:99999'), { error: 'invalid' });
  assert.deepEqual(parseAddress('a:b:c'), { error: 'invalid' });
});

test('normalizeConfig: defaults, bounds, port from the address first', () => {
  const config = normalizeConfig({});
  assert.equal(config.port, 4321);
  assert.equal(config.pollInterval, 60);
  assert.equal(config.language, 'fr');
  assert.equal(config.apiVariant, 'auto');
  assert.equal(config.key, '');
  assert.equal(normalizeConfig({ poll_interval: 5 }).pollInterval, 60);
  assert.equal(normalizeConfig({ poll_interval: '99999' }).pollInterval, 3600);
  assert.equal(normalizeConfig({ poll_interval: null }).pollInterval, 60);
  assert.equal(normalizeConfig({ port: '0' }).port, 4321);
  assert.equal(normalizeConfig({ host: '10.0.0.2:8000', port: 4321 }).port, 8000);
  assert.equal(normalizeConfig({ api_variant: 'nope', language: 'de' }).apiVariant, 'auto');
  assert.equal(normalizeConfig({ language: 'EN' }).language, 'en');
  assert.equal(normalizeConfig({ password: ' Zx9q ' }).password, 'Zx9q');
  assert.equal(normalizeConfig({ password: 1234 }).password, '');
});

test('the key kept in /data is a hash of the address, never of the password', () => {
  const a = normalizeConfig({ host: '192.168.1.50', password: 'one' });
  const b = normalizeConfig({ host: '192.168.1.50', password: 'two' });
  assert.equal(a.key, b.key);
  assert.equal(a.key, boilerKey('192.168.1.50', 4321));
  assert.match(a.key, /^[0-9a-f]{32}$/);
  assert.notEqual(a.key, normalizeConfig({ host: '192.168.1.51', password: 'one' }).key);
});
