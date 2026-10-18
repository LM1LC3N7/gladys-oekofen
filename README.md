# gladys-oekofen

[Gladys Assistant](https://gladysassistant.com) external integration for
**ÖkoFEN** pellet boilers (Pellematic) and heat pumps, through their official
local JSON interface, **read only**: boiler state, temperatures, modulation,
power, pellets, alarms, heating circuits, hot water, buffer tank and solar
when present, and a scene trigger on a new alarm. Unofficial, not affiliated
with ÖkoFEN.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> **Work in progress (milestone 1).** Never tested with a real boiler: tested
> against a fake JSON interface only.

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (OekofenApp) ⇄ src/client.js ⇄ http://<ip>:<port>/<password>/all?
                                   ├─ src/oekofen.js    charsets, JSON repairs, values, messages (pure)
                                   ├─ src/devices.js    -> Gladys devices and states (pure)
                                   ├─ src/store.js      /data: 429 pause, stop on a refused password
                                   └─ src/publisher.js  300 states and scene events/min
```

- **Reading**: `GET http://<ip>:<port>/<password>/all?` (the format of the
  device; `??` on some old firmware, chosen as the reference does: `?` with
  metadata is kept, `?` without metadata tries `??` once, a broken answer
  tries the other) every 60 s (60 to 3600), one request at a time, never two
  closer than 3 s (the boiler answers 401 "Wait at least 2500ms" otherwise).
  The URL is built in `src/client.js` only and never logged nor shown; the
  address and the port are asked apart, the password in a `secret` field; an
  address holding a path (a pasted URL) is refused.
- **The answer is untrusted**: read up to 256 KB (`src/http.js`), decoded as
  UTF-8, Latin-1 or a mix (the reference's rule), repaired in one linear
  pass (`"L_statetext:"` of firmware 4.02, raw control characters in
  strings), parsed, then only own keys of the expected shapes are read
  (`Object.hasOwn`, component keys `^(pe|hk|ww|pu|sk|se|wp)[1-9][0-9]?$`, 40 at
  most, 10 messages at most): no prototype pollution. Values: `val` ×
  `factor` (tenths for bare old-firmware temperatures), int16 markers and
  out-of-scale values dropped, then a plausible range per feature.
- **Devices**: `ext:<selector>:oekofen:<component>` (`system`, `pe1`, `hk1`,
  `ww1`, `pu1`, `sk1`, `se1`, `wp1`…: one integration reads one controller,
  the key is stable even when the IP changes). Every feature is read only;
  temperatures are `temperature-sensor/probe` (°C); hours are
  `duration/decimal` (h); kg, kW, kWh, % have no unit (the core lists none
  for their categories). A republished device keeps the features it was
  created with; a created component missing from an answer stays in the
  Discovery list with a degraded badge. The roles are frozen in
  `test/fixtures/roles.json`.
- **Alarms**: `system/alarm` (1 when `L_errors` > 0, a message is listed, or
  a boiler is in fault, state 11), `alarm-count`, `last-message`; the scene
  trigger `boiler_alarm` (`message`, `code`) as the reference's MessageLog:
  the keys of the messages seen (time|code|component, else the text) and the boilers in
  fault are kept in `/data` (200 keys); a key never seen fires whatever the
  gap since the previous read, a message coming back never fires again, the
  very first read without memory only learns. A higher error count without a
  new message fires only between two consecutive reads at most two intervals
  apart. 5 events per read at most.
- **Errors**: 401/403/404 (but "Wait at least") = refused password: a stop,
  new try after 10 min, 1 h, then every 6 h, lifted only by a successful
  read; 429: a pause of Retry-After between 60 s and 6 h for every path;
  others ("Wait at least", network, 5xx, bad JSON): a backoff of 1, 2, 5, 10,
  15 min, never under the interval. The stop and the pause (429 or backoff,
  with the failure count) are kept in `/data` (0600, with a hash of the
  address and port, never the password), capped when read back; after a
  restart the first read waits for the end of the pause. The test button and
  Discovery read only when max(30 s, interval) has passed since the last
  attempt and no pause holds; the button retries a refused password at once
  only then. A failed `??` probe goes back to `?` without any stop. A
  reconnection to Gladys resends the status, the Discovery list and the
  badges, and keeps the pause, the stop and the client.
- **Read only**: `onSetValue` refuses every command; no switch, no
  thermostat, no writable feature, no scene action.

## Development

```bash
npm install
npm test                                        # node --test, no network (loopback only)
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/fixtures/oekofen.js` holds answers shaped like the reference's sample
answers (made-up values): modern, old firmware (bare values), Latin-1,
broken JSON. `test/helpers/fakeBoiler.js` is a fake JSON interface behind the
transport.

## Credits

- [dominikamann/oekofen-pellematic-compact](https://github.com/dominikamann/oekofen-pellematic-compact)
  4.4.0 (Apache-2.0): the JSON interface, the charsets, the repairs, the
  value filters, the state and message formats are ported to JavaScript.
- Notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic lists the repository in the Gladys store
(added at the first real release).

## License

Apache-2.0 (see [LICENSE](LICENSE)); the ported logic is Apache-2.0
(oekofen-pellematic-compact), see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
ÖkoFEN and Pellematic are trademarks of ÖkoFEN; this project is not
affiliated with ÖkoFEN.
