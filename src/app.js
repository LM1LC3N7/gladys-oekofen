// -----------------------------------------------------------------------------
// The integration: the address and the password of the boiler's JSON
// interface, one read per cycle (60 s by default), the Gladys devices and
// their states, the "boiler alarm" scene trigger, the transport badges.
//
// Read only (v1): a flame appliance is never lit, stopped nor set from here;
// every command Gladys could send is refused.
//
// Careful reads: one request at a time, never two closer than 3 s (src/
// client.js), never faster than the interval after a failure; a refused
// password stops the reads (new try after 10 min, 1 h, then every 6 h, or at
// once on new settings or the test button); a 429 pauses every path for 60 s
// to 6 h. The pause and the stop are kept in /data and bounded. A
// reconnection to Gladys resends what Gladys keeps in memory only (status,
// Discovery list, badges) and keeps the pause, the stop and the client.
// index.js only wires the SDK handlers to this class.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { OekofenClient } from './client.js';
import { normalizeConfig } from './config.js';
import { GLADYS, INTERFACE, LIMITS, SCENE_TRIGGERS, TIMINGS } from './constants.js';
import {
  buildDevice,
  deviceIds,
  deviceName,
  inFault,
  kindOf,
  messageText,
  parseDeviceId,
  parseFeatureId,
  statesOf,
} from './devices.js';
import { errorReason } from './http.js';
import { MESSAGES, T, age, both, reasonOf, word } from './i18n.js';
import { componentsOf, field, messageKey, messagesOf, readNumber } from './oekofen.js';
import { StatePublisher } from './publisher.js';
import { fileStore, normalizeMemory } from './store.js';

/** Errors after which the boiler did not answer at all. */
const OFFLINE = new Set(['network', 'timeout']);

/** Errors after which, in "auto", the other URL variant (`?` / `??`) is tried. */
const TRY_OTHER_VARIANT = new Set(['bad_response', 'empty', 'network', 'timeout']);

const READ_ONLY = both(
  'This integration is read only: nothing can be changed on the boiler from Gladys.',
  'Cette intégration est en lecture seule : rien ne peut être modifié sur la chaudière depuis Gladys.',
);

export class OekofenApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'oekofen' }),
    transport,
    now = Date.now,
    timers = globalThis,
    store = fileStore(),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.store = store;
    this.client = new OekofenClient({ transport, now, timers });
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
    this.config = normalizeConfig();
    this.memory = normalizeMemory(null);
    /** id -> component of the last answer (src/oekofen.js componentsOf, plus `system`) */
    this.components = new Map();
    this.readAt = undefined;
    this.published = undefined;
    /** deviceId -> badge last published (JSON) */
    this.badges = new Map();
    this.timer = undefined;
    this.running = undefined;
    this.generation = 0;
    /** The password was refused: no read until `retryAt`. */
    this.blocked = false;
    this.retries = 0;
    this.retryAt = 0;
    this.offline = false;
    this.failures = 0;
    this.pausedUntil = 0;
    /** 'rate' (429): every path waits; 'backoff': the polling only. */
    this.pauseKind = undefined;
    /** The alarms of the previous read: `{ at, keys, count }`. */
    this.alarms = undefined;
    this.resetVariant();
    this.lastStatus = undefined;
    this.lastTestAt = -Infinity;
    this.started = false;
  }

  // --- Lifecycle -------------------------------------------------------------

  /** `fresh`: the user changed the address or the password, the stop is lifted. */
  async start(raw = {}, { fresh = false } = {}) {
    this.stop();
    await this.running;
    this.config = normalizeConfig(raw);
    this.reset();
    this.memory = normalizeMemory(await this.store.load().catch(() => null), this.now());
    if (this.memory.key !== this.config.key) {
      // Another boiler: the pause and the stop of the previous one are not its own.
      this.memory = { key: this.config.key, pause: null, block: null };
    }
    if (fresh) {
      this.memory.block = null;
    }
    const { pause, block } = this.memory;
    if (pause && pause.until > this.now()) {
      this.pausedUntil = pause.until;
      this.pauseKind = 'rate';
    }
    if (block) {
      this.blocked = true;
      this.retries = block.retries;
      this.retryAt = block.retryAt;
    }
    this.client.configure(this.config);
    await this.saveMemory();
    this.publisher.start();
    const missing = this.configMessage();
    if (missing) {
      await this.setStatus(false, missing);
      return;
    }
    if (this.blocked) {
      await this.setStatus(false, T.refused(age(this.retryAt - this.now())));
      this.scheduleNext();
      return;
    }
    await this.setStatus(false, this.pauseMessage() ?? T.connecting);
    await this.tick();
  }

  stop() {
    this.generation += 1;
    this.clearTimer();
    this.publisher.stop();
  }

  clearTimer() {
    if (this.timer) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /** What the configuration lacks, as a status message; undefined when complete. */
  configMessage() {
    if (this.config.addressError === 'path') {
      return T.addressPath;
    }
    if (this.config.addressError === 'invalid') {
      return T.addressInvalid;
    }
    return this.client.configured ? undefined : T.noConfig;
  }

  get configured() {
    return this.configMessage() === undefined;
  }

  /** A 429 pause holds now (every path waits). */
  get ratePaused() {
    return this.pauseKind === 'rate' && this.now() < this.pausedUntil;
  }

  /** Forgets the components and the failures: a new boiler, or a restart. */
  reset() {
    this.components.clear();
    this.readAt = undefined;
    this.published = undefined;
    this.badges.clear();
    this.alarms = undefined;
    this.blocked = false;
    this.retries = 0;
    this.retryAt = 0;
    this.offline = false;
    this.failures = 0;
    this.pausedUntil = 0;
    this.pauseKind = undefined;
    this.resetVariant();
  }

  /** The URL variant: `?` first; in "auto", `??` is tried when `?` is bare or broken. */
  resetVariant() {
    const variant = this.config?.apiVariant ?? 'auto';
    this.suffix = variant === 'old' ? INTERFACE.suffixes.old : INTERFACE.suffixes.modern;
    this.variantSettled = variant !== 'auto';
    this.variantProbed = false;
  }

  /**
   * Connected to Gladys. The first time, start; after a reconnection (Gladys
   * restarted), resend what Gladys keeps in memory only (Discovery list,
   * status, badges). The pause, the stop and the client stay.
   */
  async connected(raw = {}) {
    if (!this.started) {
      this.started = true;
      await this.start(raw);
      return;
    }
    await this.configUpdated(raw);
    this.published = undefined;
    this.badges.clear();
    const status = this.lastStatus;
    this.lastStatus = undefined;
    if (status) {
      const [connected, message] = JSON.parse(status);
      await this.setStatus(connected, message ?? undefined);
    }
    await this.publishDevices();
    await this.publishBadges();
  }

  /** A new address or password restarts (and lifts the stop); the rest applies at once. */
  async configUpdated(raw = {}) {
    const next = normalizeConfig(raw);
    const previous = this.config;
    if (
      next.host !== previous.host ||
      next.port !== previous.port ||
      next.password !== previous.password ||
      next.addressError !== previous.addressError
    ) {
      return this.start(raw, { fresh: true });
    }
    this.config = next;
    if (next.apiVariant !== previous.apiVariant) {
      this.resetVariant();
    }
    if (next.pollInterval !== previous.pollInterval && this.timer) {
      this.scheduleNext();
    }
    if (next.language !== previous.language) {
      this.published = undefined;
      await this.publishDevices();
      this.queueAll();
      await this.flush();
    }
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  /** The message of the last status (multi-language), or undefined. */
  get lastMessage() {
    return JSON.parse(this.lastStatus ?? '[false,null]')[1] ?? undefined;
  }

  async saveMemory() {
    await this.store
      .save(this.memory)
      .catch((err) => this.logger.warn(`Saving the state to /data failed: ${err.message}`));
  }

  /** The pause and the stop, with the boiler they belong to. */
  async persist() {
    this.memory.key = this.config.key;
    this.memory.pause = this.ratePaused ? { until: this.pausedUntil } : null;
    this.memory.block = this.blocked ? { retries: this.retries, retryAt: this.retryAt } : null;
    await this.saveMemory();
  }

  async flush() {
    await this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
  }

  // --- Polling ---------------------------------------------------------------

  /** The next read: after the pause or the stop, else the interval. */
  scheduleNext() {
    this.clearTimer();
    if (!this.configured) {
      return;
    }
    const now = this.now();
    const interval = this.config.pollInterval * 1000;
    let delay;
    if (this.blocked) {
      delay = Math.max(this.retryAt, this.pausedUntil) - now;
    } else if (now < this.pausedUntil) {
      // Never read again faster than the interval, a pause included.
      delay = Math.max(this.pausedUntil - now, interval);
    } else {
      delay = interval;
    }
    const generation = this.generation;
    this.timer = this.timers.setTimeout(
      () => {
        this.timer = undefined;
        if (generation === this.generation) {
          this.tick().catch((err) => this.logger.error(`ÖkoFEN refresh failed: ${err.message}`));
        }
      },
      Math.max(0, delay),
    );
  }

  /** One run at a time: a tick during a run joins it. */
  tick() {
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = undefined;
      });
    }
    return this.running;
  }

  async run() {
    const generation = this.generation;
    if (!this.configured) {
      return;
    }
    if (this.blocked && this.now() >= this.retryAt) {
      // The spaced new try: one read.
      this.logger.info('ÖkoFEN: trying again after a refused password');
      this.blocked = false;
    }
    if (this.blocked || this.now() < this.pausedUntil) {
      this.scheduleNext();
      return;
    }
    const suffix = this.suffix;
    try {
      const { root, metadata } = await this.client.read(suffix);
      if (generation !== this.generation) {
        return;
      }
      this.settleVariant(suffix, metadata);
      const count = this.ingest(root);
      this.readAt = this.now();
      await this.publishDevices();
      const hadStop = this.retries > 0 || this.pauseKind !== undefined;
      this.failures = 0;
      this.retries = 0;
      this.retryAt = 0;
      this.offline = false;
      if (this.pauseKind === 'backoff' || this.now() >= this.pausedUntil) {
        this.pauseKind = undefined;
        this.pausedUntil = 0;
      }
      if (hadStop || this.memory.block || this.memory.pause) {
        await this.persist();
      }
      if (count === 0) {
        await this.setStatus(false, T.noComponent);
      } else {
        await this.setStatus(true, T.connected(count));
      }
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      if (!this.variantSettled && TRY_OTHER_VARIANT.has(err?.kind)) {
        // "auto": some firmware only answers on the other variant.
        this.suffix =
          suffix === INTERFACE.suffixes.modern ? INTERFACE.suffixes.old : INTERFACE.suffixes.modern;
      }
      await this.failed(err);
    }
    await this.publishBadges();
    await this.flush();
    if (generation === this.generation) {
      this.scheduleNext();
    }
  }

  /**
   * "auto" (as the reference detects it): `?` with metadata is modern
   * firmware, kept. `?` without metadata: `??` is tried once, at the next
   * cycle, and kept only when it gives metadata.
   */
  settleVariant(suffix, metadata) {
    if (this.variantSettled) {
      return;
    }
    if (metadata || this.variantProbed) {
      this.variantSettled = true;
      if (!metadata && suffix === INTERFACE.suffixes.old) {
        this.suffix = INTERFACE.suffixes.modern;
      }
      return;
    }
    this.variantProbed = true;
    this.suffix =
      suffix === INTERFACE.suffixes.modern ? INTERFACE.suffixes.old : INTERFACE.suffixes.modern;
    this.logger.info('ÖkoFEN: answer without metadata, the other URL variant is tried next');
  }

  /** A failure: a stop, a pause, or a backoff. Never a dead integration. */
  async failed(err) {
    const reason = errorReason(err);
    if (err?.kind === 'no_config') {
      await this.setStatus(false, T.noConfig);
      return;
    }
    if (err?.kind === 'refused') {
      const wait = TIMINGS.refusedRetry[Math.min(this.retries, TIMINGS.refusedRetry.length - 1)];
      this.retries += 1;
      this.blocked = true;
      this.offline = true;
      this.retryAt = this.now() + wait;
      this.logger.warn(`ÖkoFEN: ${reason}; one new try in ${Math.round(wait / 60_000)} min`);
      await this.persist();
      await this.setStatus(false, T.refused(age(wait)));
      return;
    }
    let wait;
    let message;
    if (err?.kind === 'rate_limited') {
      wait = this.pause(err);
      message = T.rateLimited(age(wait));
    } else {
      // Never read again faster than the poll interval.
      wait = Math.max(
        this.config.pollInterval * 1000,
        TIMINGS.backoff[Math.min(this.failures, TIMINGS.backoff.length - 1)],
      );
      this.pauseKind = this.ratePaused ? 'rate' : 'backoff';
      this.pausedUntil = Math.max(this.pausedUntil, this.now() + wait);
      this.offline = OFFLINE.has(err?.kind) || this.offline;
      message = T.unreachable(reasonOf(err), age(wait));
    }
    this.failures += 1;
    await this.persist();
    const connected = err?.kind === 'rate_limited' && this.readAt !== undefined;
    await this.setStatus(connected, message);
    this.logger.warn(`ÖkoFEN: ${reason}; next try in ${Math.round(wait / 1000)} s`);
  }

  /** 429: a pause of Retry-After, between 60 s and 6 h, for every path (kept in /data). */
  pause(err) {
    const asked = err.retryAfter ?? TIMINGS.rateLimitDefault;
    const wait = Math.max(TIMINGS.rateLimitMin, Math.min(TIMINGS.rateLimitMax, asked));
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + wait);
    this.pauseKind = 'rate';
    return wait;
  }

  /**
   * One answer: its components kept, the system device computed (alarm, last
   * message), the scene events of the new alarms, the states queued. Returns
   * the number of components (the system aside).
   */
  ingest(root) {
    const components = componentsOf(root);
    const messages = messagesOf(root);
    const systemSection = field(root, 'system');
    const system = {
      id: 'system',
      kind: 'system',
      index: 0,
      section: systemSection !== null && typeof systemSection === 'object' ? systemSection : {},
    };
    const count = readNumber(field(system.section, 'L_errors'), { min: 0, max: 1000, decimals: 0 });
    const faults = components
      .filter((c) => c.kind === 'pe')
      .map((c) => ({ component: c, fault: inFault(c.section) }));
    const known =
      count !== undefined || messages !== undefined || faults.some((f) => f.fault !== undefined);
    const active =
      (count ?? 0) > 0 || (messages?.length ?? 0) > 0 || faults.some((f) => f.fault === true);
    system.computed = {
      alarm: known ? { state: active ? GLADYS.ON : GLADYS.OFF } : undefined,
      'last-message':
        messages === undefined
          ? undefined
          : { text: messageText(messages[0], this.config.language) },
    };
    this.alarmEvents({ messages: messages ?? [], faults, count });

    this.components.clear();
    if (systemSection !== undefined || known) {
      this.components.set('system', system);
    }
    for (const component of components) {
      this.components.set(component.id, component);
    }
    this.queueAll();
    return components.length;
  }

  /**
   * The "boiler alarm" scene events: a message not in the previous read, a
   * boiler newly in fault, or more errors counted without a new message.
   * Never on the first read, nor after a gap of more than two intervals (a
   * pause, an outage: no "change" can be told then).
   */
  alarmEvents({ messages, faults, count }) {
    const now = this.now();
    const keys = new Set(messages.map(messageKey));
    for (const { component, fault } of faults) {
      if (fault) {
        keys.add(`fault:${component.id}`);
      }
    }
    const previous = this.alarms;
    this.alarms = { at: now, keys, count };
    if (
      !previous ||
      now - previous.at > 2 * this.config.pollInterval * 1000 + TIMINGS.minRequestGap
    ) {
      return;
    }
    const language = this.config.language;
    const events = [];
    for (const message of messages) {
      if (!previous.keys.has(messageKey(message))) {
        events.push({ message: messageText(message, language), code: message.code ?? '' });
      }
    }
    for (const { component, fault } of faults) {
      if (fault && !previous.keys.has(`fault:${component.id}`)) {
        events.push({
          message: word(MESSAGES.fault(deviceName(component, language)), language),
          code: '',
        });
      }
    }
    if (
      events.length === 0 &&
      count !== undefined &&
      previous.count !== undefined &&
      count > previous.count
    ) {
      events.push({ message: word(MESSAGES.countRose(count), language), code: '' });
    }
    for (const data of events.slice(0, LIMITS.eventsPerRead)) {
      this.publisher.pushSceneEvent(SCENE_TRIGGERS.ALARM, data);
      this.logger.warn(`ÖkoFEN: new alarm${data.code ? ` (${data.code})` : ''}`);
    }
  }

  // --- Gladys ----------------------------------------------------------------

  /** The devices of this integration already created in Gladys. */
  createdDevices() {
    return (this.gladys.devices ?? []).filter((d) => parseDeviceId(d.external_id) !== undefined);
  }

  /** The roles of the device already created in Gladys for a component. */
  createdRoles(id) {
    const externalId = deviceIds(this.gladys, id).device;
    const device = (this.gladys.devices ?? []).find((d) => d.external_id === externalId);
    return new Set(
      (device?.features ?? [])
        .map((f) => parseFeatureId(f.external_id)?.role)
        .filter((role) => role !== undefined),
    );
  }

  /**
   * The components to publish: those of the last answer, plus those already
   * created in Gladys but missing from it (with the features they have), so
   * the Discovery list never drops a device the user added.
   */
  componentsToPublish() {
    const list = [...this.components.values()];
    for (const device of this.createdDevices()) {
      const id = parseDeviceId(device.external_id);
      if (!this.components.has(id) && list.length < LIMITS.components + 1) {
        const kind = kindOf(id);
        const index = kind === 'system' ? 0 : Number(id.slice(2));
        list.push({ id, kind, index, section: {}, missing: true });
      }
    }
    return list;
  }

  async publishDevices() {
    if (this.readAt === undefined) {
      return;
    }
    const devices = this.componentsToPublish().map((component) =>
      buildDevice(this.gladys, component, this.config.language, this.createdRoles(component.id)),
    );
    const json = JSON.stringify(devices);
    if (json === this.published) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  createdFeatures() {
    return new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  /** Queues the states of every component read (the features created in Gladys only). */
  queueAll(created = this.createdFeatures()) {
    for (const component of this.components.values()) {
      const ids = deviceIds(this.gladys, component.id);
      for (const { role, ...value } of statesOf(component, this.config.language)) {
        const id = ids.feature(role);
        if (created.has(id)) {
          this.publisher.push(id, value);
        }
      }
    }
  }

  badge(id) {
    if (this.blocked || this.offline) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE };
    }
    if (this.readAt !== undefined && !this.components.has(id)) {
      return {
        transport: DEVICE_TRANSPORTS.UNREACHABLE,
        degraded: true,
        message: both(
          'Not in the last answer of the boiler.',
          'Absent de la dernière réponse de la chaudière.',
        ),
      };
    }
    return { transport: DEVICE_TRANSPORTS.LOCAL };
  }

  async publishBadges() {
    const entries = [];
    for (const device of this.createdDevices()) {
      const id = parseDeviceId(device.external_id);
      const entry = { external_id: device.external_id, ...this.badge(id) };
      const json = JSON.stringify(entry);
      if (this.badges.get(device.external_id) !== json) {
        entries.push([device.external_id, json, entry]);
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries.map(([, , entry]) => entry));
      for (const [externalId, json] of entries) {
        this.badges.set(externalId, json);
      }
    } catch (err) {
      this.logger.warn(`Transport badges failed: ${err.message}`);
    }
  }

  /** A device was created (or updated): send its last values at once. */
  async deviceCreated(device) {
    this.badges.delete(device?.external_id);
    const created = this.createdFeatures();
    for (const f of device?.features ?? []) {
      created.add(f.external_id);
    }
    this.queueAll(created);
    await this.flush();
    await this.publishBadges();
  }

  async deviceDeleted(device) {
    this.badges.delete(device?.external_id);
    if (device?.external_id) {
      this.publisher.forget(device.external_id);
    }
  }

  /** The Discovery tab asks for a scan: a fresh read if the last one is old enough. */
  async scan() {
    if (
      this.configured &&
      !this.blocked &&
      this.now() >= this.pausedUntil &&
      (this.readAt === undefined || this.now() - this.readAt >= TIMINGS.testCooldown)
    ) {
      await this.tick();
      return;
    }
    await this.publishDevices();
  }

  /** Every feature is read only: a command is refused, nothing is sent. */
  async setValue() {
    throw new Error(word(READ_ONLY, this.config.language));
  }

  // --- Configuration button --------------------------------------------------

  pauseMessage() {
    return this.ratePaused ? T.rateLimited(age(this.pausedUntil - this.now())) : undefined;
  }

  async testConnection() {
    const missing = this.configMessage();
    if (missing) {
      return missing;
    }
    const paused = this.pauseMessage();
    if (paused) {
      return paused;
    }
    // At most one read per 30 s from this button (the boiler refuses close reads).
    const last = Math.max(this.lastTestAt, this.readAt ?? -Infinity);
    if (this.now() - last < TIMINGS.testCooldown) {
      return this.lastMessage
        ? {
            en: `${T.test.cooldown.en} ${this.lastMessage.en}`,
            fr: `${T.test.cooldown.fr} ${this.lastMessage.fr}`,
          }
        : T.test.cooldown;
    }
    if (this.running) {
      return T.busy;
    }
    this.lastTestAt = this.now();
    // The button is how a refused password is retried at once.
    this.blocked = false;
    this.retryAt = 0;
    if (this.pauseKind === 'backoff') {
      this.pausedUntil = 0;
      this.pauseKind = undefined;
    }
    await this.tick();
    return this.lastMessage ?? T.noConfig;
  }
}
