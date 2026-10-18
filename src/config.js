// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
//
// The boiler's URL carries its password (`http://<ip>:<port>/<password>/all`,
// the format of the device): the address and the port are asked apart, the
// password in a `secret` field, and the URL is only built by the client, never
// logged nor shown.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { INTERFACE, POLL_INTERVAL } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  port: INTERFACE.defaultPort,
  api_variant: 'auto',
  poll_interval: POLL_INTERVAL.default,
  language: 'fr',
};

export const LANGUAGES = ['fr', 'en'];
export const API_VARIANTS = ['auto', 'modern', 'old'];

const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/**
 * The address typed by the user: `{ host, port }`, `{ error: 'path' }` when
 * it holds a path (a pasted URL, maybe with the password), `{ error:
 * 'invalid' }` when it is no IP address nor host name, `{}` when empty.
 * "http://" and ":port" are accepted (`port` then wins over the port field).
 */
export function parseAddress(raw) {
  let text = String(raw ?? '').trim();
  if (text === '') {
    return {};
  }
  text = text.replace(/^https?:\/\//i, '');
  if (/[/?#@\s]/.test(text)) {
    return { error: 'path' };
  }
  let host = text;
  let port;
  const bracketed = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(text);
  if (bracketed) {
    host = bracketed[1];
    port = bracketed[2];
  } else if (isIP(text) !== 6) {
    const withPort = /^([^:]+):(\d{1,5})$/.exec(text);
    if (withPort) {
      host = withPort[1];
      port = withPort[2];
    } else if (text.includes(':')) {
      return { error: 'invalid' };
    }
  }
  if (isIP(host) === 0 && !HOSTNAME.test(host)) {
    return { error: 'invalid' };
  }
  const portNumber = port === undefined ? undefined : Number(port);
  if (portNumber !== undefined && (portNumber < 1 || portNumber > 65535)) {
    return { error: 'invalid' };
  }
  return { host: host.toLowerCase(), port: portNumber };
}

/**
 * The key of a boiler in /data: a hash of its address and port, never the
 * password (a short password would be easy to find back from its hash).
 */
export const boilerKey = (host, port) =>
  host
    ? createHash('sha256').update(`oekofen:${host}:${port}`, 'utf8').digest('hex').slice(0, 32)
    : '';

const number = (value) =>
  value === undefined || value === null || value === '' ? NaN : Number(value);

const clamp = (value, { min, max }, fallback) =>
  Number.isFinite(value) ? Math.round(Math.max(min, Math.min(max, value))) : fallback;

export function normalizeConfig(raw = {}) {
  const address = parseAddress(raw?.host);
  const typedPort = number(raw?.port);
  const port =
    address.port ??
    (Number.isInteger(typedPort) && typedPort >= 1 && typedPort <= 65535
      ? typedPort
      : DEFAULTS.port);
  // Kept as typed: the Touch display shows it as the device expects it.
  const password = typeof raw?.password === 'string' ? raw.password.trim() : '';
  const language = String(raw?.language ?? DEFAULTS.language)
    .trim()
    .toLowerCase();
  const variant = String(raw?.api_variant ?? DEFAULTS.api_variant).trim();
  return {
    host: address.host ?? '',
    port,
    addressError: address.error,
    password,
    key: boilerKey(address.host, port),
    apiVariant: API_VARIANTS.includes(variant) ? variant : DEFAULTS.api_variant,
    pollInterval: clamp(number(raw?.poll_interval), POLL_INTERVAL, DEFAULTS.poll_interval),
    language: LANGUAGES.includes(language) ? language : DEFAULTS.language,
  };
}
