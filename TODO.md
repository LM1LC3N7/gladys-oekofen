# TODO — ÖkoFEN v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm run audit`, `npx github:GladysAssistant/integration-store .`,
  then update README, `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only. No forum topic of its own, no forum post from a module session.

## Status

- [x] **Milestone 1 — core, read only** (2026-10-18): local JSON interface
      (`/<password>/all?`, `??` detected), charsets (UTF-8, Latin-1, mixed),
      JSON repairs, bounded and untrusted answer, one device per component
      (system, pe, hk, ww, pu, sk, se, wp), alarms and the `boiler_alarm`
      scene trigger, careful reads (60 s, 3 s gap, backoff, refused password
      stop, 429 pause, both in `/data`), badges, test button, en/fr, docs,
      cover. Tested against a fake JSON interface only (Node 22 and 24).
- [x] **Review fixes** (2026-10-18, review of 782e5ad): alarms kept in
      `/data` as the reference's MessageLog (no gap rule on messages), manual
      reads spaced by max(30 s, interval) from the last attempt and never
      during a backoff, backoff persisted, a failed `??` probe never blocks,
      the stop lifted only by a successful read, messages sorted before the
      cut, message key time|code, texts, port headers, audit fix.
- [x] **Approval round 1 fixes** (2026-10-18, on 5f6080f): error-count rule
      (rise > 0 and more than the messages that came back), one interval
      after any attempt during a stop, message key with the component prefix
      and a rank.
- [ ] **Milestone 2 — real boiler**: run against a real Pellematic (and a
      heat pump if one can be found), compare with the Touch display (see
      "To check"); turn the answers (anonymized, password removed) into
      fixtures.
- [ ] **Milestone 3 — more values**: weather forecast section, circulator
      (`circ1`), Smart PV (`power`), wireless sensors (`wireless<n>`),
      Stirling, the ash box and maintenance counters, heat pump energy and
      compressor values (once their factors are understood: `L_compressor_act`
      shows factors such as 149 in the reference fixtures).
- [ ] **Milestone 4 — first release**: Docker image build check, Release
      workflow, topic, GHCR package public.

## v2: commands (not in v1)

What a v2 could allow, **behind an option off by default** (`allow_commands`,
like the flame appliances of gladys-edilkamin), never as a switch:

- the mode of a heating circuit (`hk<n>_mode_auto`: Off, Auto, Comfort,
  Setback) and of hot water (`ww<n>_mode_auto`), as `text/select` features;
- the comfort and setback room temperatures (`temp_heat`, `temp_setback`),
  the hot water setpoints (`temp_min_set`, `temp_max_set`), with a safety
  ceiling on hot water (scalding);
- a one-time hot water heating (`heat_once`) as a `button/push`.

Never in a v2: the boiler mode (`pe<n>_mode`, `system mode` Off would stop the
heating, On forces the burner) and anything that lights or stops the burner,
unless Louis decides otherwise.

The reference writes with `GET http://<ip>:<port>/<password>/<component>_<key>=<value>`
(`send_data`): a write is a GET with the password in the path, without
confirmation. A v2 would have to: serialize the writes (one at a time, 3 s
gap, shared with the reads), read the value again before acting and refuse
on an unknown or stale state, validate values strictly against the `min`,
`max` and `format` of the field, answer within Gladys' 5 s ack (refuse when
the 3 s gap would push the write past ~3.5 s), and never announce "not sent"
for a write that may have left.

**Why v1 is read only**: a pellet boiler is a flame appliance; the JSON
interface is plain HTTP on the local network with a short password in the
URL and no write confirmation; the integration was never tested with a real
boiler, so the write behaviour (answer format, delay before the value shows,
what an invalid value does) is unknown. Reading first, with real feedback,
is the safe order.

## To check on a real boiler

- The answer to a wrong password (401? 403? 404? an HTML page?), and to a
  disabled JSON interface; the exact body of the "Wait at least 2500ms" 401.
- The password is sent %-encoded in the path (`encodeURIComponent`): check
  that the boiler accepts it for passwords with special characters (the
  reference puts the URL as typed).
- How long a read takes (the reference waits 10 s; 15 s here), whether a
  read every 60 s is fine for weeks (the reference defaults to 30 s).
- The charset of the answer on French firmware (Latin-1 expected).
- `L_state` of `pe` as an index or a bit mask on the firmware at hand, and
  the fault bit (11); whether `error_N` lists only active messages.
- `L_cfg_power` (nominal power) without `json.properties`: probably absent,
  then no estimated power.
- `L_roomtemp_act` on a circuit without a room sensor (0, or a sentinel?).
- The heat pump (`wp<n>`) factors: the reference's fixtures mix floats with
  `factor` 1 and odd factors.

## Decisions

- **Not a duplicate** (lot 8, wave 2): reserved by Louis in post 275 of the
  forum thread 10385 on 2026-10-18; the reservation checks are the main
  session's.
- **Reference reused: dominikamann/oekofen-pellematic-compact 4.4.0**
  (Apache-2.0, maintained, the HACS integration), cloned read only in
  `_ref/oekofen-pellematic-compact` (tag v4.4.0). Python and Home Assistant:
  ported, credited in the README and `THIRD_PARTY_NOTICES.md`. Only runtime
  dependency: the SDK.
- **Neighbour module**: LM1LC3N7/gladys-edilkamin (flame appliance: its
  review lessons are applied: bounded answers, no prototype pollution,
  spaced reads, status and Discovery sent again at each `connected`, no lost
  feature). Its commands are not ported (read only).
- **Read only** (brief): every feature `read_only`, `onSetValue` refuses
  every command, no switch, no thermostat (a setpoint is a
  `temperature-sensor/probe`, so no voice assistant shows a writable
  thermostat), no scene action, no boolean option.
- **The password in the URL** (the format of the device): asked in a
  `secret` field, address and port apart; the URL is built in
  `src/client.js` only; errors keep only a socket error code (Node's message
  holds the address); an address with a path, `?`, `#`, `@` or a space is
  refused with a status asking to remove it (it may hold the password). A
  `secret` field is not encrypted by Gladys: the docs say "kept by Gladys in
  its database, never shown again, sent only to the boiler".
- **Careful reads**: 60 s by default and at least (the reference defaults to
  30 s and only needs 2.5 s between requests; the brief asks 60 s). One
  request at a time, 3 s minimum gap for every path (polling, test button,
  Discovery, the `??` probe); the test button and Discovery read only when
  max(30 s, interval) has passed since the last attempt (`client.lastRequestAt`,
  failures included) and no pause holds (review I2); during a backoff the
  button shows the status and the time left; after an error never faster
  than the interval. No retry inside
  a cycle (the reference retries once after 3 s on an `IncompleteRead`: not
  ported, the next cycle reads again).
- **Errors**: 401 "Wait at least" = `too_fast` (backoff); other 401, 403,
  404 = refused password (the password is a path segment): a stop with new
  tries after 10 min, 1 h, then every 6 h; a new address or password lifts
  it at once; the test button retries at once, but only once the interval has
  passed since the last attempt; the stop is lifted (also in `/data`) only by
  a successful read (review M6); 429 = pause of Retry-After between 60 s and
  6 h (5 min when absent) for every path; "Wait at least", network, timeout,
  5xx, bad JSON: backoff 1, 2, 5, 10, 15 min, never under the interval. The
  stop and the pause (`{ kind: 'rate' | 'backoff', until, failures }`) are in
  `/data`, capped when read back (6 h for a 429, 1 h for a backoff); after a
  restart the first read waits for the end of the pause (review I3); a
  reconnection to Gladys keeps them.
- **`/data` key without the password**: the stop, the pause and the alarms seen are keyed by
  a hash of address and port only (a 4-character password would be easy to
  find back from its hash). A restart after a password change made outside
  `onConfigUpdated` keeps the stop until its next try or the test button.
- **Charset** (reference `_charset_from_raw`): strict UTF-8; else UTF-8
  when less than 20 % of the non-ASCII characters are broken (broken bytes
  dropped); else Latin-1. A BOM is dropped. No charset option (the reference
  detects it too).
- **JSON repairs** (reference `fetch_data`): `L_statetext:` → `L_statetext":`
  (firmware 4.02) and control characters inside strings escaped, in one
  linear pass (no regex over the whole answer).
- **Untrusted answer**: 256 KB at most (the reference's samples are 5 to
  35 KB), parse errors (deep nesting included) become `bad_response`; only
  own keys are read (`Object.hasOwn`), component keys by a strict pattern,
  40 components and 10 messages at most, texts cleaned of control and
  invisible characters and cut to 160 characters; messages parsed linearly.
- **URL variant** (reference `_detect_api_config`): "auto" reads `?`; with
  metadata it is kept; without, `??` is tried once at the next cycle and
  kept only with metadata; a broken answer or no answer before the first
  success tries the other one at the next cycle. A failed `??` try (a modern
  boiler may answer 404/401/403 there) is never a refused password: back to
  `?`, settled when `?` already answered, read again at the normal interval
  (review I4). "modern" and "old" force one. The choice is not persisted
  (detected again after a restart).
- **External ids**: `ext:<selector>:oekofen:<component key>` (`system`,
  `pe1`…). The boiler sends no serial number; one integration reads one
  controller, so the component key is unique and survives an IP change.
  Feature roles frozen in `test/fixtures/roles.json`.
- **No lost feature**: the roles of a device are those of the answer plus
  those of the device created in Gladys (read from `gladys.devices`); a
  created component missing from an answer is still published with its
  features (degraded "unreachable" badge). A feature appears when its key is
  present, even when its value is a sentinel (no value sent then).
- **Units** (core `DEVICE_FEATURE_UNITS_BY_CATEGORY`): `celsius` on
  `temperature-sensor/probe`, `hours` on `duration/decimal`; kg, kW, kWh and
  % have no category that lists them for these values: no unit, the unit in
  the feature name. Solar kWh and kW are **not** energy-sensor features nor
  `publishEnergyConsumption` (the core would count thermal energy as
  electricity, lesson of wave 3).
- **Estimated power**: `L_cfg_power` (nominal kW, often only with
  `json.properties`) × `L_modulation` / 100, only when both are present.
- **Temperatures as probes** (`temperature-sensor/probe`), the outdoor and
  room temperatures included: a boiler, flow or circuit temperature must not
  enter the room averages; a circuit without a room sensor may read 0.
- **Modes as texts** (`text/text`, read only): our labels for the known
  indices, else the boiler's own `format` label, else "Mode n".
- **Alarms**: `system/alarm` = `L_errors` > 0, a listed message, or a boiler
  in fault (state 11, reference `decode_state`); `alarm-count` = `L_errors`;
  `last-message` = the newest `error_N` (by its time; the messages are sorted
  by time then key number before the cut to 10). Scene events as the
  reference's MessageLog (diagnosis.py, review I1): the message keys seen
  (time|code|component prefix "PE1", "HK2"… when time and code are known,
  else time|code|text; identical keys in one read get a rank `#2`, approval
  round 1: two boilers with the same code at the same time give two alarms)
  and the boilers in
  fault are kept in `/data` (200 keys at most, per boiler); a key never seen
  fires whatever the gap since the previous read; a message that comes back
  never fires again; a boiler fires when it enters a fault (an unknown state
  keeps the known one); the very first read without memory only learns. The
  error count fires only between two consecutive successful reads at most
  two intervals (plus the read timeout) apart, without a new message, when
  the rise (count - previous count, > 0) is more than the messages that came
  back (keys of this read already seen but absent from the previous read;
  nothing subtracted when the previous read had no error section; approval
  round 1). 5 per read at most.
- **Spacing during a stop** (approval round 1): while a refused password
  stops the reads, the next read is never closer than one interval to the
  last attempt, whatever ended it (a failed `??` try goes back to `?`
  without a pause of its own).
- **Logs**: never the password, the URL nor the address; `errorReason` never
  prints an unknown error's message.
- **Template demo files removed** (devices, scenes, widgets, weather and
  their tests): the deletion went through.
- **Version 0.1.0 set by hand** in `package.json`, `package-lock.json`, the
  manifest and the `docker_image` tag: the one-time exception to "versions
  belong to the Release workflow" (the template's 1.0.0 had to be replaced);
  the first patch release gives 0.1.1.
- **LICENSE**: the standard Apache-2.0 text (appendix placeholder, no
  personal name); `THIRD_PARTY_NOTICES.md` credits oekofen-pellematic-compact
  (Apache-2.0, Copyright 2022 Dominik Amann, changes listed; the project has
  no NOTICE file); both copied into the image.
