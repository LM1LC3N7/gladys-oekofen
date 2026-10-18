# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for ÖkoFEN pellet boilers and heat
pumps, read only, through their local JSON interface: a Node.js service (Node
22+, ESM, no build step) that runs in its own sandboxed Docker container and
talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.
`TODO.md` holds the status, the decisions and the v2 notes.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "alarm"   # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only
src/handlers.js                   SDK handlers -> OekofenApp (shared with the tests)
src/app.js                        lifecycle, polling, errors, alarms, devices, badges
src/client.js                     the JSON interface: URL (holds the password), 3 s gap, statuses
src/http.js                       bounded GET, errors without secrets
src/oekofen.js                    the answer: charsets, repairs, values, messages (pure)
src/devices.js                    components -> Gladys devices and states (pure)
src/config.js                     config_schema normalized (address parsing)
src/store.js                      /data: 429 pause, refused password stop
src/publisher.js                  states and scene events within Gladys' limits
gladys-assistant-integration.json manifest
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, against the SDK's fake Gladys and a fake boiler
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **Read only.** No feature is writable, `onSetValue` refuses every command,
  no switch or thermostat category. A v2 with commands goes behind an option
  off by default (see `TODO.md`).
- **The URL holds the password.** Build it in `src/client.js` only; never log
  it, never put it in an error message or a status.
- **The answer is untrusted.** Bounded size, own keys only (`Object.hasOwn`),
  no object built from its keys with a prototype, linear parsing.
- **Careful reads.** One request at a time, 3 s minimum between two, never
  faster than the interval after an error.
- **External ids are forever.** `ext:<selector>:oekofen:<component>` and the
  feature roles (frozen in `test/fixtures/roles.json`). A republished device
  never loses a feature.
- **The container rootfs is read-only.** Write only under `/data`.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md`. Never write a version heading.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`.
  `test/manifest.test.js` ties the manifest to the code.
- **User-facing text** is bilingual (English and French), docs kept in sync.
  A `secret` field is never called encrypted.
- **Files** are UTF-8 without BOM (`test/encoding.test.js`); write invisible
  characters as code points in the source, never as literal characters.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (loopback only).
