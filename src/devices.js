// -----------------------------------------------------------------------------
// The components of the boiler -> Gladys devices, and their states (pure).
//
// One Gladys device per component of the answer, `ext:<selector>:oekofen:<id>`
// with `<id>` the key the boiler gives it (`system`, `pe1`, `hk2`, `ww1`…):
// one integration reads one boiler controller, so the key is unique and does
// not change with the IP address. The features are keyed by their role (the
// last part of their external id): those keys are published forever, never
// rename them. A device already created keeps all its features when it is
// published again.
//
// Read only (v1): every feature is `read_only`, no switch, no setpoint, no
// mode a voice assistant or a scene could change. Temperatures are
// `temperature-sensor/probe` (kept out of the room averages: a boiler or a
// flow temperature is no room temperature). Units are only those the core
// lists for the category (DEVICE_FEATURE_UNITS_BY_CATEGORY): no kg, kW, kWh
// nor % outside their categories, so those values have no unit and say it in
// their name.
//
// Ported in part from dominikamann/oekofen-pellematic-compact 4.4.0
// (Apache-2.0), changed (the field names read, the state of a boiler in
// fault): see THIRD_PARTY_NOTICES.md.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { GLADYS, LIMITS } from './constants.js';
import { DEVICE_NAMES, MESSAGES, MODE_LABELS, both, modeFallback, word } from './i18n.js';
import {
  STATE_FAULT,
  cleanText,
  decodeState,
  field,
  formatLabel,
  readBoolean,
  readIndex,
  readNumber,
  readStateText,
} from './oekofen.js';

// --- Feature shapes ----------------------------------------------------------

const probe = (min, max) => ({
  category: C.TEMPERATURE_SENSOR,
  type: TYPES.TEMPERATURE_SENSOR.PROBE,
  unit: U.CELSIUS,
  min,
  max,
});
const text = { category: C.TEXT, type: TYPES.TEXT.TEXT, min: 0, max: 0, keep_history: false };
const binary = { category: C.UNKNOWN, type: TYPES.SENSOR.BINARY, min: 0, max: 1 };
const decimal = (min, max) => ({ category: C.UNKNOWN, type: TYPES.SENSOR.DECIMAL, min, max });
const integer = (min, max) => ({ category: C.UNKNOWN, type: TYPES.SENSOR.INTEGER, min, max });
const hours = {
  category: C.DURATION,
  type: TYPES.DURATION.DECIMAL,
  unit: U.HOURS,
  min: 0,
  max: 1_000_000,
};

// --- Readers -----------------------------------------------------------------

/** A temperature: tenths of a degree on old firmware without `factor`. */
const temperature = (keys, min, max) => ({
  keys,
  feature: probe(min, max),
  read: (raw) => readNumber(raw, { bareFactor: 0.1, min, max, decimals: 1 }),
});
const amount = (keys, feature, { bareFactor = 1, decimals = 2 } = {}) => ({
  keys,
  feature,
  read: (raw) => readNumber(raw, { bareFactor, min: feature.min, max: feature.max, decimals }),
});
const flag = (keys) => ({ keys, feature: binary, read: readBoolean });
const status = { keys: ['L_statetext'], feature: text, read: readStateText, text: true };
const mode = (keys) => ({ keys, feature: text, mode: true, text: true });

/**
 * The roles of each component kind: the keys read (the first present wins),
 * the feature, the reader. `computed` roles are filled by statesOf.
 */
export const ROLES = {
  system: {
    'outdoor-temperature': temperature(['L_ambient'], -60, 70),
    mode: mode(['mode']),
    // 1 when the boiler counts an error, lists a message, or a boiler is in fault.
    alarm: { computed: true, feature: binary },
    'alarm-count': amount(['L_errors'], integer(0, 1000), { decimals: 0 }),
    'last-message': { computed: true, feature: text, text: true },
  },
  pe: {
    status,
    fault: { keys: ['L_state'], feature: binary, fault: true },
    'boiler-temperature': temperature(['L_temp_act'], -20, 150),
    'boiler-setpoint': temperature(['L_temp_set'], -20, 150),
    'combustion-temperature': temperature(['L_frt_temp_act'], -20, 1500),
    modulation: amount(['L_modulation'], decimal(0, 100), { decimals: 0 }),
    // Nominal power (L_cfg_power, kW) × modulation: only when the boiler gives both.
    power: {
      keys: ['L_cfg_power', 'L_modulation'],
      all: true,
      feature: decimal(0, 1000),
      power: true,
    },
    'pellet-stock': amount(['L_storage_fill'], decimal(0, 1_000_000), { decimals: 1 }),
    'hopper-level': amount(['L_storage_popper', 'L_storage_hopper'], decimal(0, 100_000), {
      decimals: 1,
    }),
    'pellets-today': amount(['L_pellets_today', 'storage_fill_today'], decimal(0, 10_000), {
      decimals: 1,
    }),
    'pellets-yesterday': amount(
      ['L_pellets_yesterday', 'storage_fill_yesterday'],
      decimal(0, 10_000),
      {
        decimals: 1,
      },
    ),
    'burner-starts': amount(['L_starts'], integer(0, 100_000_000), { decimals: 0 }),
    'burner-hours': amount(['L_runtime'], hours, { decimals: 1 }),
    mode: mode(['mode']),
  },
  hk: {
    status,
    'flow-temperature': temperature(['L_flowtemp_act'], -20, 120),
    'flow-setpoint': temperature(['L_flowtemp_set'], -20, 120),
    'room-temperature': temperature(['L_roomtemp_act'], -20, 60),
    'room-setpoint': temperature(['L_roomtemp_set'], -20, 60),
    pump: flag(['L_pump']),
    mode: mode(['mode_auto']),
  },
  ww: {
    status,
    temperature: temperature(['L_ontemp_act'], -20, 120),
    'temperature-bottom': temperature(['L_offtemp_act'], -20, 120),
    setpoint: temperature(['L_temp_set'], -20, 120),
    pump: flag(['L_pump']),
    mode: mode(['mode_auto']),
  },
  pu: {
    status,
    'top-temperature': temperature(['L_tpo_act'], -20, 120),
    'middle-temperature': temperature(['L_tpm_act'], -20, 120),
    'top-setpoint': temperature(['L_tpo_set'], -20, 120),
    pump: amount(['L_pump'], decimal(0, 100), { decimals: 0 }),
  },
  sk: {
    status,
    'collector-temperature': temperature(['L_koll_temp'], -50, 300),
    'store-temperature': temperature(['L_spu'], -20, 120),
    pump: amount(['L_pump'], decimal(0, 100), { decimals: 0 }),
    mode: mode(['mode']),
  },
  se: {
    'flow-temperature': temperature(['L_flow_temp'], -50, 300),
    'return-temperature': temperature(['L_ret_temp'], -50, 300),
    power: amount(['L_pwr'], decimal(0, 1000), { bareFactor: 0.1, decimals: 2 }),
    'energy-today': amount(['L_day'], decimal(0, 100_000), { bareFactor: 0.1, decimals: 1 }),
    'energy-total': amount(['L_total'], decimal(0, 100_000_000), { bareFactor: 0.1, decimals: 1 }),
  },
  wp: {
    status,
    'flow-temperature': temperature(['L_temp_flow_is'], -20, 120),
    'flow-setpoint': temperature(['L_temp_flow_set'], -20, 120),
    'return-temperature': temperature(['L_temp_return_is'], -20, 120),
    'source-in-temperature': temperature(['L_temp_src_in'], -50, 120),
    'source-out-temperature': temperature(['L_temp_src_out'], -50, 120),
    cop: amount(['L_cop'], decimal(0, 20), { decimals: 2 }),
    mode: mode(['mode']),
  },
};

/** Feature names, by role, in the language chosen in the configuration. */
export const FEATURE_NAMES = {
  'outdoor-temperature': both('Outdoor temperature', 'Température extérieure'),
  mode: both('Mode', 'Mode'),
  alarm: both('Alarm', 'Alarme'),
  'alarm-count': both('Active alarms', 'Alarmes actives'),
  'last-message': both('Last message', 'Dernier message'),
  status: both('Status', 'État'),
  fault: both('Fault', 'Défaut'),
  'boiler-temperature': both('Boiler temperature', 'Température chaudière'),
  'boiler-setpoint': both('Boiler setpoint', 'Consigne chaudière'),
  'combustion-temperature': both('Combustion chamber temperature', 'Température foyer'),
  modulation: both('Modulation (%)', 'Modulation (%)'),
  power: both('Power (kW)', 'Puissance (kW)'),
  'pellet-stock': both('Pellet store (kg)', 'Stock de granulés (kg)'),
  'hopper-level': both('Hopper (kg)', 'Trémie (kg)'),
  'pellets-today': both('Pellets used today (kg)', "Granulés consommés aujourd'hui (kg)"),
  'pellets-yesterday': both('Pellets used yesterday (kg)', 'Granulés consommés hier (kg)'),
  'burner-starts': both('Burner starts', 'Démarrages du brûleur'),
  'burner-hours': both('Burner run time', 'Heures de fonctionnement du brûleur'),
  'flow-temperature': both('Flow temperature', 'Température de départ'),
  'flow-setpoint': both('Flow setpoint', 'Consigne de départ'),
  'room-temperature': both('Room temperature (circuit)', 'Température ambiante (circuit)'),
  'room-setpoint': both('Room setpoint', 'Consigne ambiante'),
  pump: both('Pump', 'Circulateur'),
  temperature: both('Water temperature', "Température de l'eau"),
  'temperature-bottom': both('Water temperature (bottom)', "Température de l'eau (bas)"),
  setpoint: both('Setpoint', 'Consigne'),
  'top-temperature': both('Top temperature', 'Température haut'),
  'middle-temperature': both('Middle temperature', 'Température milieu'),
  'top-setpoint': both('Top setpoint', 'Consigne haut'),
  'collector-temperature': both('Collector temperature', 'Température capteur'),
  'store-temperature': both('Store temperature', 'Température stockage'),
  'return-temperature': both('Return temperature', 'Température de retour'),
  'energy-today': both('Solar yield today (kWh)', "Production solaire aujourd'hui (kWh)"),
  'energy-total': both('Solar yield total (kWh)', 'Production solaire totale (kWh)'),
  'source-in-temperature': both('Source inlet temperature', 'Température source entrée'),
  'source-out-temperature': both('Source outlet temperature', 'Température source sortie'),
  cop: both('COP', 'COP'),
};

/** Names that differ by component kind. */
const KIND_NAMES = {
  pu: { pump: both('Pump (%)', 'Circulateur (%)') },
  sk: { pump: both('Pump (%)', 'Circulateur (%)') },
  se: { power: both('Solar power (kW)', 'Puissance solaire (kW)') },
  pe: { power: both('Power, estimated (kW)', 'Puissance estimée (kW)') },
};

export const featureName = (kind, role, language) =>
  word(KIND_NAMES[kind]?.[role] ?? FEATURE_NAMES[role], language);

// --- Ids ---------------------------------------------------------------------

export const kindOf = (id) => (id === 'system' ? 'system' : /^([a-z]{2})\d{1,2}$/.exec(id)?.[1]);

export const deviceIds = (gladys, id) => gladys.externalIds('oekofen', String(id));

/** The component and the role of a feature external id. */
export function parseFeatureId(externalId) {
  const match = /:oekofen:(system|(?:pe|hk|ww|pu|sk|se|wp)[1-9][0-9]?):([a-z0-9-]+)$/.exec(
    String(externalId ?? ''),
  );
  if (!match) {
    return undefined;
  }
  const kind = kindOf(match[1]);
  return Object.hasOwn(ROLES[kind], match[2]) ? { id: match[1], kind, role: match[2] } : undefined;
}

/** The component of a device external id. */
export function parseDeviceId(externalId) {
  const match = /:oekofen:(system|(?:pe|hk|ww|pu|sk|se|wp)[1-9][0-9]?)$/.exec(
    String(externalId ?? ''),
  );
  return match ? match[1] : undefined;
}

// --- Devices -----------------------------------------------------------------

/** The first of `keys` present in the section. */
const firstKey = (section, keys) => keys.find((key) => field(section, key) !== undefined);

/**
 * The roles of a component: those whose keys its section has, those the
 * system computes, plus those of the device already created in Gladys
 * (`created`: its role set), so a republished device never loses a feature.
 */
export function rolesOf(component, created = new Set()) {
  const specs = ROLES[component.kind];
  const roles = new Set();
  for (const [role, spec] of Object.entries(specs)) {
    if (spec.computed) {
      if (component.computed?.[role] !== undefined) {
        roles.add(role);
      }
    } else if (
      spec.all
        ? spec.keys.every((k) => field(component.section, k) !== undefined)
        : firstKey(component.section, spec.keys)
    ) {
      roles.add(role);
    }
  }
  for (const role of created) {
    if (Object.hasOwn(specs, role)) {
      roles.add(role);
    }
  }
  return Object.keys(specs).filter((role) => roles.has(role));
}

/** "Chaudière ÖkoFEN 1", "Circuit de chauffage ÖkoFEN 2 (Étage)". */
export function deviceName(component, language) {
  const base = word(DEVICE_NAMES[component.kind], language);
  if (component.kind === 'system') {
    return base;
  }
  const label = cleanText(readNameField(component.section), LIMITS.nameLength);
  return label ? `${base} ${component.index} (${label})` : `${base} ${component.index}`;
}

function readNameField(section) {
  const raw = field(section, 'name');
  const value = raw !== null && typeof raw === 'object' ? field(raw, 'val') : raw;
  return typeof value === 'string' ? value : undefined;
}

/** The Gladys device of one component. `created`: the roles of the device already in Gladys. */
export function buildDevice(gladys, component, language, created) {
  const ids = deviceIds(gladys, component.id);
  return {
    name: deviceName(component, language),
    external_id: ids.device,
    features: rolesOf(component, created).map((role) => ({
      name: featureName(component.kind, role, language),
      external_id: ids.feature(role),
      read_only: true,
      has_feedback: false,
      keep_history: true,
      ...ROLES[component.kind][role].feature,
    })),
    params: [{ name: 'component', value: component.id }],
  };
}

// --- States ------------------------------------------------------------------

/** The label of a mode: ours by index, else the boiler's own, else "Mode n". */
function modeText(kind, raw, language) {
  const index = readIndex(raw);
  if (index === undefined) {
    return undefined;
  }
  const label = MODE_LABELS[kind]?.[index];
  if (label) {
    return word(label, language);
  }
  return formatLabel(raw, index) ?? word(modeFallback(index), language);
}

/** A boiler in fault (state 11), from `L_state`; undefined when unknown. */
export function inFault(section) {
  const states = decodeState(field(section, 'L_state'));
  return states === undefined ? undefined : states.has(STATE_FAULT);
}

/**
 * The value of one role of a component: `{ state }`, `{ text }`, or
 * undefined (absent, not a number, a sentinel, out of range).
 */
export function valueOf(component, role, language) {
  const spec = ROLES[component.kind][role];
  if (spec.computed) {
    return component.computed?.[role];
  }
  const { section } = component;
  if (spec.fault) {
    const fault = inFault(section);
    return fault === undefined ? undefined : { state: fault ? GLADYS.ON : GLADYS.OFF };
  }
  if (spec.power) {
    const nominal = readNumber(field(section, 'L_cfg_power'), { min: 1, max: 1000 });
    const modulation = readNumber(field(section, 'L_modulation'), { min: 0, max: 100 });
    return nominal === undefined || modulation === undefined
      ? undefined
      : { state: Math.round(nominal * modulation) / 100 };
  }
  const key = firstKey(section, spec.keys);
  if (key === undefined) {
    return undefined;
  }
  const raw = field(section, key);
  if (spec.mode) {
    const label = modeText(component.kind, raw, language);
    return label === undefined ? undefined : { text: label };
  }
  const value = spec.read(raw);
  if (value === undefined) {
    return undefined;
  }
  if (spec.text) {
    return { text: value };
  }
  if (typeof value === 'boolean') {
    return { state: value ? GLADYS.ON : GLADYS.OFF };
  }
  return { state: value };
}

/** The Gladys states of one component: `[{ role, state }]` or `[{ role, text }]`. */
export function statesOf(component, language, roles = rolesOf(component)) {
  const states = [];
  for (const role of roles) {
    const value = valueOf(component, role, language);
    if (value !== undefined) {
      states.push({ role, ...value });
    }
  }
  return states;
}

/** The text of the last message, "Pellets Warnung [5054] (2026-02-04 16:12:43)". */
export function messageText(message, language) {
  if (!message) {
    return word(MESSAGES.none, language);
  }
  const code = message.code ? ` [${message.code}]` : '';
  const time = message.time ? ` (${message.time})` : '';
  return cleanText(`${message.text}${code}${time}`) ?? word(MESSAGES.none, language);
}
