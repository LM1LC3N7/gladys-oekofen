// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys and a fake boiler behind the transport. Timers and Date are mocked:
// the tests move the clock.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { OekofenApp } from '../src/app.js';
import { boilerKey } from '../src/config.js';
import { ACTIONS, SCENE_TRIGGERS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import {
  BARE,
  CONFIG,
  HOST,
  HOUR,
  MINUTE,
  NOW,
  PASSWORD,
  PORT,
  SECOND,
  json,
  latin1,
  modern,
} from './fixtures/oekofen.js';
import { fakeBoiler, memoryStore, settle } from './helpers/fakeBoiler.js';

const dev = (id) => `ext:test-integration:oekofen:${id}`;

/** A logger keeping every line, to check that no secret ever reaches the logs. */
const recorder = (logs) =>
  Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')),
    ]),
  );

async function setup(
  t,
  { config = CONFIG, store = memoryStore(), server = fakeBoiler(), create = true, logs = [] } = {},
) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: NOW });
  const gladys = createFakeGladys({ config });
  const app = new OekofenApp({
    gladys,
    logger: recorder(logs),
    transport: server.transport,
    now: () => Date.now(),
    store,
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  const advance = async (ms, step = 5 * SECOND) => {
    for (let elapsed = 0; elapsed < ms; elapsed += step) {
      t.mock.timers.tick(Math.min(step, ms - elapsed));
      await settle();
    }
  };
  if (create) {
    for (const device of gladys.fake.discoveredDevices) {
      await gladys.fake.deviceCreated(device);
    }
    await settle();
  }
  return { gladys, app, server, store, advance, logs };
}

const last = (gladys, id, role) => gladys.fake.lastState(`${dev(id)}:${role}`);
const message = (gladys) => gladys.fake.connectionStatus?.message ?? {};
const badgeOf = (gladys, id) =>
  gladys.fake.transports.filter((b) => b.device_external_id === dev(id)).at(-1);

function assertNoSecret(where, text) {
  assert.ok(!text.includes(PASSWORD), `${where} holds the password`);
  assert.ok(!text.includes(`/${PASSWORD}/`), `${where} holds the URL`);
}

test('without an address or a password, the status asks for them and nothing is requested', async (t) => {
  const { gladys, server } = await setup(t, { config: { host: HOST, password: '' } });
  assert.equal(server.requests.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys).fr, /mot de passe de son interface JSON/);
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /password of its JSON interface/);
  assert.equal(server.requests.length, 0);
});

test('a URL pasted in the address field is refused, never requested nor echoed', async (t) => {
  const pasted = `http://${HOST}:${PORT}/${PASSWORD}/all?`;
  const { gladys, server, logs } = await setup(t, { config: { host: pasted, password: PASSWORD } });
  assert.equal(server.requests.length, 0);
  assert.match(message(gladys).en, /holds a path/);
  assertNoSecret('status', JSON.stringify(gladys.fake.connectionStatuses));
  assertNoSecret('logs', logs.join('\n'));
});

test('start: one read, the components as devices, their states, connected', async (t) => {
  const { gladys, server, store, logs } = await setup(t);
  assert.equal(server.requests.length, 1);
  assert.equal(server.requests[0].url, `http://${HOST}:${PORT}/${PASSWORD}/all?`);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.external_id),
    ['system', 'pe1', 'hk1', 'hk2', 'ww1', 'pu1', 'sk1', 'se1'].map(dev),
  );
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: true,
    message: {
      en: 'Connected: 7 components read (read only).',
      fr: 'Connecté : 7 composants lus (lecture seule).',
    },
  });
  await settle();
  t.mock.timers.tick(SECOND);
  await settle();
  assert.equal(last(gladys, 'pe1', 'boiler-temperature'), 63.3);
  assert.equal(last(gladys, 'pe1', 'status'), 'Leistungsbrand');
  assert.equal(last(gladys, 'hk1', 'flow-temperature'), 60.3);
  assert.equal(last(gladys, 'hk1', 'mode'), 'Confort');
  assert.equal(last(gladys, 'ww1', 'temperature'), 52.6);
  assert.equal(last(gladys, 'system', 'outdoor-temperature'), -6.9);
  assert.equal(last(gladys, 'system', 'alarm'), 0);
  assert.equal(last(gladys, 'system', 'last-message'), 'Aucun message');
  assert.equal(badgeOf(gladys, 'pe1').transport, 'local');
  // No secret anywhere Gladys or the logs see, nor in /data.
  assertNoSecret('logs', logs.join('\n'));
  assertNoSecret('requests to Gladys', JSON.stringify(gladys.fake.requests));
  assertNoSecret('/data', JSON.stringify(store.data));
  assert.equal(store.data.key, boilerKey(HOST, PORT));
});

test('read only: a command is refused and nothing is sent to the boiler', async (t) => {
  const { gladys, server } = await setup(t);
  const device = gladys.fake.discoveredDevices.find((d) => d.external_id === dev('hk1'));
  const before = server.requests.length;
  const ack = await gladys.fake.setValue(device, device.features[0], 1);
  assert.equal(ack.success, false);
  assert.match(JSON.stringify(ack), /read only|lecture seule/);
  assert.equal(server.requests.length, before);
});

test('reads every interval, never closer; a pasted interval below 60 s is raised', async (t) => {
  const { server, advance, app } = await setup(t, { config: { ...CONFIG, poll_interval: 10 } });
  assert.equal(app.config.pollInterval, 60);
  await advance(5 * MINUTE);
  const at = server.requests.map((r) => r.at);
  assert.equal(at.length, 6);
  for (let i = 1; i < at.length; i += 1) {
    assert.ok(at[i] - at[i - 1] >= MINUTE, `reads ${i - 1} and ${i} too close`);
  }
});

test('a refused password stops the reads, spaced new tries, kept across a restart', async (t) => {
  const server = fakeBoiler({ password: 'other' });
  const store = memoryStore();
  const { gladys, advance, app } = await setup(t, { server, store });
  assert.equal(server.requests.length, 1);
  assert.match(message(gladys).fr, /refusé le mot de passe.*10 min/);
  assert.equal(store.data.block.retries, 1);
  await advance(9 * MINUTE);
  assert.equal(server.requests.length, 1, 'no read during the stop');
  await advance(MINUTE + 5 * SECOND);
  assert.equal(server.requests.length, 2);
  assert.match(message(gladys).en, /New try in 60 min/);
  // A restart keeps the stop: no read at once.
  app.stop();
  const again = new OekofenApp({
    gladys: createFakeGladys({ config: CONFIG }),
    transport: server.transport,
    now: () => Date.now(),
    store,
    logger: recorder([]),
  });
  t.after(() => again.stop());
  await again.start(CONFIG);
  assert.equal(server.requests.length, 2);
  // A new password lifts it at once.
  server.password = PASSWORD;
  await again.configUpdated({ ...CONFIG, password: 'new-one' });
  assert.equal(server.requests.length, 3);
  assert.equal(again.blocked, true);
  // The test button retries at once, but only once the interval has passed
  // since the last attempt.
  server.password = 'new-one';
  await advance(30 * SECOND);
  const early = await again.testConnection();
  assert.match(early.en, /next read possible in 30 s/);
  assert.equal(server.requests.length, 3);
  // A retry that fails without an answer keeps the stop (in /data too).
  await advance(30 * SECOND);
  server.failNetwork();
  await again.testConnection();
  assert.equal(server.requests.length, 4);
  assert.equal(again.blocked, true);
  assert.ok(store.data.block, 'the stop is still in /data');
  // During the backoff that follows, the button does not read.
  const during = await again.testConnection();
  assert.match(during.fr, /prochaine lecture possible dans/);
  assert.equal(server.requests.length, 4);
  // A successful read lifts the stop.
  await advance(MINUTE + 5 * SECOND);
  const reply = await again.testConnection();
  assert.match(reply.en, /Connected/);
  assert.equal(server.requests.length, 5);
  assert.equal(again.blocked, false);
  assert.equal(store.data.block, null);
});

test('the backoff ("Wait at least", failures) is kept across a restart: no read at once', async (t) => {
  const server = fakeBoiler();
  const store = memoryStore();
  const { app, advance } = await setup(t, { server, store });
  server.failNetwork();
  server.failNetwork();
  await advance(MINUTE);
  await advance(MINUTE);
  assert.equal(server.requests.length, 3);
  assert.equal(store.data.pause.kind, 'backoff');
  assert.equal(store.data.pause.failures, 2);
  const until = store.data.pause.until;
  // The second failure (at 2 min) waits 2 min.
  assert.equal(until, NOW + 2 * MINUTE + 2 * MINUTE);
  app.stop();
  const again = new OekofenApp({
    gladys: createFakeGladys({ config: CONFIG }),
    transport: server.transport,
    now: () => Date.now(),
    store,
    logger: recorder([]),
  });
  t.after(() => again.stop());
  await again.start(CONFIG);
  assert.equal(server.requests.length, 3, 'no read at the restart');
  assert.match(again.lastMessage.en, /Waiting before the next read/);
  await advance(until - Date.now() - SECOND);
  assert.equal(server.requests.length, 3);
  await advance(5 * SECOND);
  assert.equal(server.requests.length, 4, 'read when the pause ends');
  assert.equal(store.data.pause, null);
});

test('alarms: a slow read after a failed one still fires; a message that comes back does not', async (t) => {
  const A = '01-10-2026 07:00:00|Old message [1]';
  const B = '18-10-2026 09:59:00|PE 1 Pellets Warnung [5054]';
  const C = '18-10-2026 10:30:00|PE 1 Aschebox voll [5050]';
  const server = fakeBoiler({ document: modern({ errors: 1, messages: { error_1: A } }) });
  const store = memoryStore();
  const { gladys, app, advance } = await setup(t, { server, store });
  assert.deepEqual(store.data.alarms.seen, ['2026-10-01 07:00:00|1']);
  // One failed read, then a slow answer (8 s) with a new message: more than
  // two intervals after the last success, it still fires.
  server.failNetwork();
  await advance(MINUTE);
  server.delay = 8 * SECOND;
  server.document = modern({ errors: 2, messages: { error_1: A, error_2: B } });
  await advance(MINUTE + 10 * SECOND);
  server.delay = 0;
  assert.equal(server.requests.length, 3);
  assert.deepEqual(
    gladys.fake.sceneEvents.map((e) => e.data.code),
    ['5054'],
  );
  // B goes away, then comes back: never fired again.
  server.document = modern({ errors: 1, messages: { error_1: A } });
  await advance(MINUTE);
  server.document = modern({ errors: 2, messages: { error_1: A, error_2: B } });
  await advance(MINUTE);
  assert.equal(gladys.fake.sceneEvents.length, 1);
  // A restart remembers what was seen: only the new message fires.
  app.stop();
  const fresh = createFakeGladys({ config: CONFIG });
  const again = new OekofenApp({
    gladys: fresh,
    transport: server.transport,
    now: () => Date.now(),
    store,
    logger: recorder([]),
  });
  t.after(() => again.stop());
  server.document = modern({ errors: 3, messages: { error_1: A, error_2: B, error_3: C } });
  await advance(5 * SECOND);
  await again.start(CONFIG);
  await advance(2 * SECOND);
  assert.deepEqual(
    fresh.fake.sceneEvents.map((e) => e.data.code),
    ['5050'],
  );
});

test('auto: a refused "??" probe is no refused password; "?" is kept', async (t) => {
  const server = fakeBoiler({ document: BARE });
  server.bySuffix['??'] = { status: 404, body: Buffer.from('Not found') };
  const { gladys, app, advance, store } = await setup(t, { server });
  await advance(3 * MINUTE);
  assert.deepEqual(
    server.requests.map((r) => r.suffix),
    ['?', '??', '?', '?'],
  );
  assert.equal(app.blocked, false);
  assert.equal(store.data.block, null);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('the boiler asks to wait or does not answer: never faster than the interval', async (t) => {
  const server = fakeBoiler();
  const { gladys, advance } = await setup(t, { server });
  server.queue.push({ status: 401, body: Buffer.from('Wait at least 2500ms during requests') });
  await advance(MINUTE);
  assert.match(message(gladys).fr, /demandé d’attendre/);
  server.failNetwork();
  server.failNetwork();
  await advance(MINUTE);
  assert.equal(server.requests.length, 3);
  assert.match(message(gladys).fr, /injoignable.*2 min/);
  await advance(2 * MINUTE);
  assert.equal(server.requests.length, 4);
  assert.match(message(gladys).fr, /injoignable.*5 min/);
  assert.equal(badgeOf(gladys, 'pe1').transport, 'unreachable');
  await advance(4 * MINUTE);
  assert.equal(server.requests.length, 4, 'the backoff holds');
  await advance(MINUTE + 5 * SECOND);
  assert.equal(server.requests.length, 5);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(badgeOf(gladys, 'pe1').transport, 'local');
});

test('429: a pause for every path, kept in /data and across a reconnection to Gladys', async (t) => {
  const server = fakeBoiler();
  const store = memoryStore();
  const { gladys, advance } = await setup(t, { server, store });
  server.queue.push({ status: 429, headers: { 'retry-after': '1800' } });
  await advance(MINUTE);
  assert.match(message(gladys).en, /HTTP 429.*30 min/);
  assert.ok(store.data.pause.until >= NOW + 30 * MINUTE);
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /HTTP 429/);
  await gladys.disconnect();
  await gladys.connect();
  await settle();
  await advance(20 * MINUTE);
  assert.equal(server.requests.length, 2, 'no read during the pause');
  // The pause ends 30 min after the 429 (at 1 min): one read then.
  await advance(10 * MINUTE + 5 * SECOND);
  assert.equal(server.requests.length, 3);
  assert.equal(store.data.pause, null);
});

test('a reconnection to Gladys resends the status and the Discovery list', async (t) => {
  const { gladys } = await setup(t);
  const statuses = gladys.fake.connectionStatuses.length;
  const lists = gladys.fake.bodies('POST', '/discovered_device').length;
  await gladys.disconnect();
  await gladys.connect();
  await settle();
  assert.equal(gladys.fake.connectionStatuses.length, statuses + 1);
  assert.equal(gladys.fake.bodies('POST', '/discovered_device').length, lists + 1);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('scene trigger: a new message, a boiler in fault, more errors; never on the first read', async (t) => {
  const server = fakeBoiler({
    document: modern({ errors: 1, messages: { error_1: '01-10-2026 07:00:00|Old message [1]' } }),
  });
  const { gladys, advance } = await setup(t, { server });
  await advance(SECOND);
  assert.equal(gladys.fake.sceneEvents.length, 0, 'never on the first read');
  assert.equal(last(gladys, 'system', 'alarm'), 1);
  server.document = modern({
    errors: 2,
    messages: {
      error_1: '01-10-2026 07:00:00|Old message [1]',
      error_2: '18-10-2026 09:59:00|PE 1 Pellets Warnung [5054]',
    },
  });
  await advance(MINUTE);
  assert.deepEqual(gladys.fake.sceneEvents.at(-1), {
    key: SCENE_TRIGGERS.ALARM,
    data: { message: 'PE 1 Pellets Warnung [5054] (2026-10-18 09:59:00)', code: '5054' },
  });
  assert.equal(
    last(gladys, 'system', 'last-message'),
    'PE 1 Pellets Warnung [5054] (2026-10-18 09:59:00)',
  );
  server.document = modern({ errors: 2, messages: {}, state: 2048, statetext: 'Störung' });
  await advance(MINUTE);
  assert.deepEqual(gladys.fake.sceneEvents.at(-1).data, {
    message: 'Chaudière ÖkoFEN 1 : défaut',
    code: '',
  });
  assert.equal(last(gladys, 'pe1', 'fault'), 1);
  server.document = modern({ errors: 3, messages: {}, state: 2048 });
  await advance(MINUTE);
  assert.deepEqual(gladys.fake.sceneEvents.at(-1).data, { message: '3 alarmes actives', code: '' });
  const count = gladys.fake.sceneEvents.length;
  await advance(MINUTE);
  assert.equal(gladys.fake.sceneEvents.length, count, 'nothing new, no event');
  assert.equal(count, 3);
});

test('a created device missing from an answer keeps its features and gets a degraded badge', async (t) => {
  const server = fakeBoiler();
  const { gladys, advance } = await setup(t, { server });
  const before = gladys.fake.discoveredDevices.find((d) => d.external_id === dev('hk2'));
  const document = modern();
  delete document.hk2;
  delete document.pe1.L_frt_temp_act;
  server.document = document;
  await advance(MINUTE);
  const hk2 = gladys.fake.discoveredDevices.find((d) => d.external_id === dev('hk2'));
  assert.deepEqual(
    hk2.features.map((f) => f.external_id),
    before.features.map((f) => f.external_id),
  );
  const pe1 = gladys.fake.discoveredDevices.find((d) => d.external_id === dev('pe1'));
  assert.ok(pe1.features.some((f) => f.external_id.endsWith(':combustion-temperature')));
  assert.equal(badgeOf(gladys, 'hk2').degraded, true);
  assert.equal(badgeOf(gladys, 'pe1').transport, 'local');
});

test('auto: a bare answer on "?" tries "??" once, kept when it has metadata', async (t) => {
  const server = fakeBoiler({ document: BARE });
  server.bySuffix['??'] = { status: 200, body: json(modern()) };
  const { gladys, advance } = await setup(t, { server });
  await advance(2 * MINUTE);
  assert.deepEqual(
    server.requests.map((r) => r.suffix),
    ['?', '??', '??'],
  );
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('auto: a bare answer on both keeps "?"', async (t) => {
  const server = fakeBoiler({ document: BARE });
  const { advance } = await setup(t, { server });
  await advance(2 * MINUTE);
  assert.deepEqual(
    server.requests.map((r) => r.suffix),
    ['?', '??', '?'],
  );
});

test('a Latin-1 answer gives the same values and accents', async (t) => {
  const server = fakeBoiler({ encode: latin1 });
  const { gladys } = await setup(t, { server });
  t.mock.timers.tick(SECOND);
  await settle();
  assert.equal(last(gladys, 'pu1', 'status'), 'Quellentemp unterhalb Puffertemp · Anforderung Ein');
  assert.equal(last(gladys, 'pe1', 'boiler-temperature'), 63.3);
});

test('the test button and Discovery never read closer than the interval to the last attempt', async (t) => {
  const server = fakeBoiler();
  const { gladys, advance } = await setup(t, { server, config: { ...CONFIG, poll_interval: 300 } });
  const first = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(first.data.message.en, /next read possible in 5 min\. Connected/);
  await advance(31 * SECOND);
  await gladys.fake.scanRequest();
  await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.equal(server.requests.length, 1, 'neither the button nor Discovery read');
  // A failed attempt counts too, and its backoff holds for the button.
  server.failNetwork();
  await advance(270 * SECOND);
  assert.equal(server.requests.length, 2);
  const during = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(during.data.message.en, /next read possible in 5 min\. Boiler not read/);
  assert.equal(server.requests.length, 2);
});

test('the language of the names follows the configuration', async (t) => {
  const { gladys, app } = await setup(t, { config: { ...CONFIG, language: 'en' } });
  assert.equal(
    gladys.fake.discoveredDevices.find((d) => d.external_id === dev('pe1')).name,
    'ÖkoFEN boiler 1',
  );
  await app.configUpdated({ ...CONFIG, language: 'fr' });
  assert.equal(
    gladys.fake.discoveredDevices.find((d) => d.external_id === dev('pe1')).name,
    'Chaudière ÖkoFEN 1',
  );
  assert.ok(HOUR > 0);
});
