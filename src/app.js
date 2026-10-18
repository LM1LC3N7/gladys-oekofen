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
// to 6 h; other errors back off. The pause (429 or backoff), the stop and
// the alarms already seen are kept in /data and bounded. The test button and
// Discovery read only max(30 s, interval) after the last attempt. A
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
import { MESSAGES, T, age, both, join, reasonOf, word } from './i18n.js';
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
    /**
     * 'rate' (429) or 'backoff' (failures, "Wait at least"): no read before
     * `pausedUntil`, by any path; both kept in /data.
     */
    this.pauseKind = undefined;
    /** The alarms already seen: `{ seen: [message keys], faulted: Set<pe id> }` (kept in /data). */
    this.alarmSeen = undefined;
    this.alarmsChanged = false;
    /** The error count of the previous successful read: `{ at, count }`. */
    this.lastCount = undefined;
    this.resetVariant();
    this.lastStatus = undefined;
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
      // Another boiler: the pause, the stop and the alarms of the previous one are not its own.
      this.memory = { key: this.config.key, pause: null, block: null, alarms: null };
    }
    if (fresh) {
      this.memory.block = null;
    }
    const { pause, block, alarms } = this.memory;
    if (pause && pause.until > this.now()) {
      this.pausedUntil = pause.until;
      this.pauseKind = pause.kind;
      this.failures = pause.failures;
    }
    if (block) {
      this.blocked = true;
      this.retries = block.retries;
      this.retryAt = block.retryAt;
    }
    if (alarms) {
      this.alarmSeen = { seen: [...alarms.seen], faulted: new Set(alarms.faulted) };
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
    if (this.now() < this.pausedUntil) {
      // A pause kept across the restart: the first read waits for its end.
      await this.setStatus(
        false,
        this.pauseMessage() ?? T.waiting(age(this.pausedUntil - this.now())),
      );
      this.scheduleAt(this.pausedUntil);
      return;
    }
    await this.setStatus(false, T.connecting);
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
    this.alarmSeen = undefined;
    this.alarmsChanged = false;
    this.lastCount = undefined;
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

  /** The pause, the stop and the alarms seen, with the boiler they belong to. */
  async persist() {
    this.memory.key = this.config.key;
    this.memory.pause =
      this.pauseKind && this.now() < this.pausedUntil
        ? { kind: this.pauseKind, until: this.pausedUntil, failures: this.failures }
        : null;
    this.memory.block = this.blocked ? { retries: this.retries, retryAt: this.retryAt } : null;
    this.memory.alarms = this.alarmSeen
      ? { seen: [...this.alarmSeen.seen], faulted: [...this.alarmSeen.faulted] }
      : null;
    this.alarmsChanged = false;
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
      // Never closer than one interval to the last attempt, whatever ended it
      // (a failed `??` try goes back to `?` without a pause of its own).
      delay = Math.max(this.retryAt, this.pausedUntil, this.client.lastRequestAt + interval) - now;
    } else if (now < this.pausedUntil) {
      // Never read again faster than the interval, a pause included.
      delay = Math.max(this.pausedUntil - now, interval);
    } else {
      delay = interval;
    }
    this.scheduleAt(now + delay);
  }

  /** The next read at `at` (at once when it is past). */
  scheduleAt(at) {
    this.clearTimer();
    const generation = this.generation;
    this.timer = this.timers.setTimeout(
      () => {
        this.timer = undefined;
        if (generation === this.generation) {
          this.tick().catch((err) => this.logger.error(`ÖkoFEN refresh failed: ${err.message}`));
        }
      },
      Math.max(0, at - this.now()),
    );
  }

  /**
   * One run at a time: a tick during a run joins it. `force`: the test
   * button retrying a refused password before its scheduled new try.
   */
  tick({ force = false } = {}) {
    if (!this.running) {
      this.running = this.run({ force }).finally(() => {
        this.running = undefined;
      });
    }
    return this.running;
  }

  async run({ force = false } = {}) {
    const generation = this.generation;
    if (!this.configured) {
      return;
    }
    // A stop is only lifted by a successful read: while it is tried again,
    // `blocked` stays set (and in /data).
    const retryDue = this.blocked && (force || this.now() >= this.retryAt);
    if ((this.blocked && !retryDue) || this.now() < this.pausedUntil) {
      this.scheduleNext();
      return;
    }
    if (retryDue) {
      this.logger.info('ÖkoFEN: trying again after a refused password');
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
      const hadStop = this.blocked || this.retries > 0 || this.pauseKind !== undefined;
      this.blocked = false;
      this.failures = 0;
      this.retries = 0;
      this.retryAt = 0;
      this.offline = false;
      if (this.pauseKind === 'backoff' || this.now() >= this.pausedUntil) {
        this.pauseKind = undefined;
        this.pausedUntil = 0;
      }
      if (hadStop || this.alarmsChanged || this.memory.block || this.memory.pause) {
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
      this.lastCount = undefined;
      if (
        !this.variantSettled &&
        suffix === INTERFACE.suffixes.old &&
        err?.kind !== 'rate_limited' &&
        (this.variantProbed || err?.kind === 'refused')
      ) {
        // "auto": `??` was only a try. Its failure (a modern boiler may
        // refuse it) is never a refused password: back to `?`, settled when
        // `?` already answered, read again at the normal interval.
        this.suffix = INTERFACE.suffixes.modern;
        this.variantSettled = this.variantProbed;
        this.logger.info(`ÖkoFEN: the old URL variant failed (${errorReason(err)}), back to "?"`);
      } else {
        if (!this.variantSettled && TRY_OTHER_VARIANT.has(err?.kind)) {
          // "auto": some firmware only answers on the other variant.
          this.suffix =
            suffix === INTERFACE.suffixes.modern
              ? INTERFACE.suffixes.old
              : INTERFACE.suffixes.modern;
        }
        await this.failed(err);
      }
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
    this.alarmEvents({
      messages: messages ?? [],
      listed: messages !== undefined,
      faults,
      count,
    });

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
   * The "boiler alarm" scene events, as the reference's MessageLog
   * (diagnosis.py): the keys of the messages already seen and the boilers in
   * fault are kept in /data (200 keys at most). A message never seen fires,
   * whatever the time since the previous read (a failed or slow read never
   * hides it), and a message that comes back never fires again; a boiler
   * fires when it enters a fault. The very first read without memory only
   * learns. A higher error count without a new message fires only between
   * two consecutive successful reads at most two intervals apart, when the
   * rise is more than the known messages that came back in this read.
   */
  alarmEvents({ messages, listed, faults, count }) {
    const now = this.now();
    const language = this.config.language;
    // Identical keys in one read get a rank (`#2`…): two messages, two alarms.
    const ranks = new Map();
    const keys = messages.map((message) => {
      const key = messageKey(message);
      const rank = (ranks.get(key) ?? 0) + 1;
      ranks.set(key, rank);
      return rank === 1 ? key : `${key}#${rank}`;
    });
    const previousCount = this.lastCount;
    // `keys` undefined: this read had no error section.
    this.lastCount = { at: now, count, keys: listed ? new Set(keys) : undefined };
    // Messages that came back: seen before, absent from the previous read
    // (nothing is subtracted when the previous read had no error section).
    const returned = previousCount?.keys
      ? keys.filter((k) => this.alarmSeen?.seen.includes(k) && !previousCount.keys.has(k)).length
      : 0;
    const faulted = new Set();
    for (const { component, fault } of faults) {
      // An unknown state keeps what was known.
      if (fault === true || (fault === undefined && this.alarmSeen?.faulted.has(component.id))) {
        faulted.add(component.id);
      }
    }
    if (!this.alarmSeen) {
      this.alarmSeen = { seen: [...new Set(keys)].slice(-LIMITS.seenAlarms), faulted };
      this.alarmsChanged = true;
      return;
    }
    const { seen } = this.alarmSeen;
    const events = [];
    messages.forEach((message, i) => {
      if (!seen.includes(keys[i])) {
        seen.push(keys[i]);
        events.push({ message: messageText(message, language), code: message.code ?? '' });
      }
    });
    if (seen.length > LIMITS.seenAlarms) {
      seen.splice(0, seen.length - LIMITS.seenAlarms);
    }
    for (const { component } of faults) {
      if (faulted.has(component.id) && !this.alarmSeen.faulted.has(component.id)) {
        events.push({
          message: word(MESSAGES.fault(deviceName(component, language)), language),
          code: '',
        });
      }
    }
    const faultsChanged =
      faulted.size !== this.alarmSeen.faulted.size ||
      [...faulted].some((id) => !this.alarmSeen.faulted.has(id));
    this.alarmSeen.faulted = faulted;
    if (events.length > 0 || faultsChanged) {
      this.alarmsChanged = true;
    }
    const maxGap = 2 * this.config.pollInterval * 1000 + TIMINGS.requestTimeout;
    if (
      events.length === 0 &&
      count !== undefined &&
      previousCount?.count !== undefined &&
      now - previousCount.at <= maxGap &&
      count - previousCount.count > 0 &&
      // Not explained by known messages coming back in this read.
      count - previousCount.count > returned
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

  /**
   * Time left before a read asked by hand (button, Discovery): at least
   * max(30 s, interval) after the last attempt, failed ones included.
   */
  manualWait() {
    const gap = Math.max(TIMINGS.testCooldown, this.config.pollInterval * 1000);
    return Math.max(0, this.client.lastRequestAt + gap - this.now());
  }

  /** The Discovery tab asks for a scan: a fresh read only if the last attempt is old enough. */
  async scan() {
    if (
      this.configured &&
      !this.blocked &&
      this.now() >= this.pausedUntil &&
      this.manualWait() === 0
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
    if (this.running) {
      return T.busy;
    }
    const withLast = (first) => (this.lastMessage ? join(first, this.lastMessage) : first);
    // During a backoff (failures, "Wait at least"), the button never reads.
    if (this.pauseKind === 'backoff' && this.now() < this.pausedUntil) {
      return withLast(T.test.wait(age(this.pausedUntil - this.now())));
    }
    // Never closer than max(30 s, interval) to the last attempt (the boiler
    // refuses close reads); after a refused password this is the only wait
    // before an immediate retry.
    const wait = this.manualWait();
    if (wait > 0) {
      return withLast(T.test.wait(age(wait)));
    }
    // A refused password is retried at once; the stop is lifted only by a
    // successful read (run).
    await this.tick({ force: this.blocked });
    return this.lastMessage ?? T.noConfig;
  }
}
