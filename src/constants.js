// -----------------------------------------------------------------------------
// Constants of the ÖkoFEN JSON interface and of the integration.
//
// The interface values come from dominikamann/oekofen-pellematic-compact
// 4.4.0 (Apache-2.0, see THIRD_PARTY_NOTICES.md): the URL format
// `http://<ip>:<port>/<password>/all?` (`??` on some old firmware), the port
// shown by the Touch display (4321 by default), the minimum delay of 2.5 s
// between two requests (the boiler answers 401 "Wait at least 2500ms during
// requests" otherwise) and its slowness (10 s read timeout).
// -----------------------------------------------------------------------------

/** The manifest action keys. */
export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
};

/** The manifest scene trigger keys. */
export const SCENE_TRIGGERS = {
  ALARM: 'boiler_alarm',
};

/** The JSON interface. */
export const INTERFACE = {
  defaultPort: 4321,
  /** `?`: modern firmware; `??`: some old firmware (v3.10d and before) give metadata only there. */
  suffixes: { modern: '?', old: '??' },
};

/** Gladys values (server/utils/constants.js of the core). */
export const GLADYS = {
  ON: 1,
  OFF: 0,
};

/** The poll interval of the configuration, in seconds. */
export const POLL_INTERVAL = { default: 60, min: 60, max: 3600 };

export const SECOND = 1_000;
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export const TIMINGS = {
  /** A read of the boiler: it answers slowly (the reference waits 10 s). */
  requestTimeout: 15_000,
  /**
   * Two requests are never closer than this, whatever asks for them (the
   * boiler wants 2.5 s at least; the reference keeps 3 s).
   */
  minRequestGap: 3_000,
  /** Pauses after failures, never shorter than the poll interval. */
  backoff: [MINUTE, 2 * MINUTE, 5 * MINUTE, 10 * MINUTE, 15 * MINUTE],
  /** After a refused password: a new try after 10 min, 1 h, then every 6 h. */
  refusedRetry: [10 * MINUTE, HOUR, 6 * HOUR],
  /** 429: a pause between 60 s and 6 h, Retry-After when given. */
  rateLimitMin: MINUTE,
  rateLimitMax: 6 * HOUR,
  rateLimitDefault: 5 * MINUTE,
  /** The test button and the Discovery scan read the boiler at most every 30 s. */
  testCooldown: 30_000,
  /** States flushed to Gladys every second; unchanged ones again every 30 min. */
  flushInterval: 1_000,
  stateHeartbeat: 30 * MINUTE,
};

export const LIMITS = {
  /** Gladys accepts 300 states per minute. */
  statesPerMinute: 280,
  statesPerRequest: 100,
  sceneEventsPerMinute: 280,
  queuedEvents: 200,
  /** The biggest answer read: a full answer is 5 to 35 KB, json.properties adds a few. */
  responseBytes: 256 * 1024,
  /** Components read (pe1, hk1, ww1…), all kinds together. */
  components: 40,
  /** Boiler messages read (error_1 to error_5 on the boilers seen). */
  messages: 10,
  /** Alarm keys remembered in /data (the reference's MessageLog keeps 200). */
  seenAlarms: 200,
  /** Scene events fired by one read at most. */
  eventsPerRead: 5,
  /** A text state. */
  textLength: 160,
  /** A name given on the Touch display (heating circuit, hot water). */
  nameLength: 40,
};
