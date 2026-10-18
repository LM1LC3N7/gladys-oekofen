// -----------------------------------------------------------------------------
// The components -> Gladys devices and states (src/devices.js). Pure.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  ROLES,
  buildDevice,
  parseDeviceId,
  parseFeatureId,
  rolesOf,
  statesOf,
} from '../src/devices.js';
import { componentsOf } from '../src/oekofen.js';
import { BARE, modern } from './fixtures/oekofen.js';

const gladys = createFakeGladys({});
const byId = (root) => Object.fromEntries(componentsOf(root).map((c) => [c.id, c]));
const stateMap = (component, language = 'fr') =>
  Object.fromEntries(
    statesOf(component, language).map(({ role, ...v }) => [role, v.state ?? v.text]),
  );

/** The core's units per category (server/utils/constants.js), for the categories used. */
const CORE_UNITS = {
  'temperature-sensor': ['celsius', 'fahrenheit', 'kelvin'],
  duration: [
    'microseconds',
    'milliseconds',
    'seconds',
    'minutes',
    'hours',
    'days',
    'weeks',
    'months',
    'years',
  ],
};

test('every feature is read only, with a unit the core lists for its category', () => {
  for (const [kind, roles] of Object.entries(ROLES)) {
    for (const [role, spec] of Object.entries(roles)) {
      const { feature } = spec;
      assert.ok(feature.category && feature.type, `${kind}.${role}`);
      if (feature.unit !== undefined) {
        assert.ok(
          CORE_UNITS[feature.category]?.includes(feature.unit),
          `${kind}.${role}: ${feature.unit} not allowed in ${feature.category}`,
        );
      }
      assert.notEqual(feature.category, 'switch', `${kind}.${role}: never a switch`);
      assert.notEqual(feature.category, 'thermostat', `${kind}.${role}: never a thermostat`);
    }
  }
  const device = buildDevice(gladys, byId(modern()).pe1, 'fr');
  for (const feature of device.features) {
    assert.equal(feature.read_only, true, feature.external_id);
    assert.equal(feature.has_feedback, false);
  }
});

test('the boiler: names, ids, features and values', () => {
  const pe1 = byId(modern()).pe1;
  const device = buildDevice(gladys, pe1, 'fr');
  assert.equal(device.name, 'Chaudière ÖkoFEN 1');
  assert.equal(device.external_id, 'ext:test-integration:oekofen:pe1');
  assert.deepEqual(device.params, [{ name: 'component', value: 'pe1' }]);
  assert.deepEqual(
    device.features.map((f) => f.external_id.split(':').at(-1)),
    [
      'status',
      'fault',
      'boiler-temperature',
      'boiler-setpoint',
      'combustion-temperature',
      'modulation',
      'power',
      'pellet-stock',
      'hopper-level',
      'pellets-today',
      'pellets-yesterday',
      'burner-starts',
      'burner-hours',
      'mode',
    ],
  );
  assert.deepEqual(stateMap(pe1), {
    status: 'Leistungsbrand',
    fault: 0,
    'boiler-temperature': 63.3,
    'boiler-setpoint': 65,
    'combustion-temperature': 432.1,
    modulation: 75,
    power: 12,
    'pellet-stock': 2852,
    'hopper-level': 41,
    'pellets-today': 30,
    'pellets-yesterday': 40,
    'burner-starts': 3525,
    'burner-hours': 7209,
    mode: 'Auto',
  });
  const temperature = device.features.find((f) => f.external_id.endsWith(':boiler-temperature'));
  assert.deepEqual(
    [temperature.category, temperature.type, temperature.unit],
    ['temperature-sensor', 'probe', 'celsius'],
  );
  const fault = byId(modern({ state: 2048 })).pe1;
  assert.equal(stateMap(fault).fault, 1);
});

test('heating circuits, hot water, buffer, solar: values and modes in both languages', () => {
  const c = byId(modern());
  assert.equal(
    buildDevice(gladys, c.hk1, 'fr').name,
    'Circuit de chauffage ÖkoFEN 1 (Erdgeschoss)',
  );
  assert.equal(buildDevice(gladys, c.hk2, 'en').name, 'ÖkoFEN heating circuit 2');
  assert.deepEqual(stateMap(c.hk1), {
    status: 'Heizbetrieb aktiv',
    'flow-temperature': 60.3,
    'flow-setpoint': 60.9,
    'room-temperature': 21.5,
    'room-setpoint': 22,
    pump: 1,
    mode: 'Confort',
  });
  assert.equal(stateMap(c.hk1, 'en').mode, 'Comfort');
  // An absent room sensor (int16 marker): the feature exists, no value is sent.
  assert.ok(rolesOf(c.hk2).includes('room-temperature'));
  assert.equal(stateMap(c.hk2)['room-temperature'], undefined);
  assert.equal(stateMap(c.hk2).mode, 'Arrêt');
  assert.deepEqual(stateMap(c.ww1), {
    status: 'Zeit innerhalb Zeitprogramm · Anforderung Aus',
    temperature: 52.6,
    'temperature-bottom': 48.1,
    setpoint: 37,
    pump: 0,
    mode: 'Auto',
  });
  assert.deepEqual(stateMap(c.pu1), {
    status: 'Quellentemp unterhalb Puffertemp · Anforderung Ein',
    'top-temperature': 63.6,
    'middle-temperature': 51.2,
    'top-setpoint': 60.9,
    pump: 40,
  });
  assert.deepEqual(stateMap(c.sk1), {
    status: 'Solar aktiv',
    'collector-temperature': 45.2,
    'store-temperature': 49.8,
    pump: 100,
    mode: 'Marche',
  });
  assert.deepEqual(stateMap(c.se1), {
    'flow-temperature': 45.5,
    'return-temperature': 39.8,
    power: 3.4,
    'energy-today': 8.7,
    'energy-total': 12345.6,
  });
});

test('old firmware: bare values in tenths, string booleans and indices', () => {
  const c = byId(BARE);
  assert.deepEqual(stateMap(c.pe1), {
    status: 'Leistungsbrand',
    fault: 0,
    'boiler-temperature': 64,
    'boiler-setpoint': 70,
    modulation: 55,
    'pellet-stock': 1500,
  });
  assert.deepEqual(stateMap(c.hk1), {
    'flow-temperature': 45.5,
    'flow-setpoint': 46,
    pump: 1,
    mode: 'Auto',
  });
});

test('a mode unknown to us shows the boiler label, else "Mode n"', () => {
  const root = {
    hk1: { mode_auto: { val: 7, format: '0:Aus|7:Party' } },
    hk2: { mode_auto: 9 },
  };
  const c = byId(root);
  assert.equal(stateMap(c.hk1).mode, 'Party');
  assert.equal(stateMap(c.hk2).mode, 'Mode 9');
});

test('a republished device never loses a feature', () => {
  const hk1 = byId(modern()).hk1;
  const shrunk = { ...hk1, section: { L_flowtemp_act: hk1.section.L_flowtemp_act } };
  const created = new Set(rolesOf(hk1));
  const device = buildDevice(gladys, shrunk, 'fr', created);
  assert.deepEqual(
    device.features.map((f) => f.external_id.split(':').at(-1)),
    rolesOf(hk1),
  );
  // A role unknown for the kind is never added back.
  assert.ok(!rolesOf(shrunk, new Set(['bogus', 'power'])).includes('bogus'));
});

test('external ids parse back, only for known roles', () => {
  assert.deepEqual(parseFeatureId('ext:sel:oekofen:hk2:flow-temperature'), {
    id: 'hk2',
    kind: 'hk',
    role: 'flow-temperature',
  });
  assert.deepEqual(parseFeatureId('ext:sel:oekofen:system:alarm'), {
    id: 'system',
    kind: 'system',
    role: 'alarm',
  });
  assert.equal(parseFeatureId('ext:sel:oekofen:hk2:power'), undefined);
  assert.equal(parseFeatureId('ext:sel:oekofen:xx1:status'), undefined);
  assert.equal(parseFeatureId('ext:sel:oekofen:pe1:__proto__'), undefined);
  assert.equal(parseDeviceId('ext:sel:oekofen:wp1'), 'wp1');
  assert.equal(parseDeviceId('ext:sel:other:wp1'), undefined);
});

test('no role key is reused across a rename: the published keys are frozen', () => {
  // The feature keys are forever: this list fails when one is renamed.
  const keys = Object.fromEntries(
    Object.entries(ROLES).map(([kind, roles]) => [kind, Object.keys(roles)]),
  );
  const frozen = JSON.parse(
    readFileSync(new URL('./fixtures/roles.json', import.meta.url), 'utf8'),
  );
  for (const [kind, roles] of Object.entries(frozen)) {
    for (const role of roles) {
      assert.ok(keys[kind].includes(role), `${kind}.${role} was renamed or removed`);
    }
  }
});
