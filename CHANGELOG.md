# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.2] - 2026-10-23

## [0.1.1] - 2026-10-18

### Added

- ÖkoFEN pellet boilers (Pellematic) and heat pumps through their local JSON
  interface, read only (ported from oekofen-pellematic-compact 4.4.0).
- Address, port and password asked apart (the password in a `secret` field);
  the URL of the device, which holds the password, is never logged nor shown;
  a URL pasted in the address field is refused.
- One device per component: installation (outdoor temperature, mode, alarm,
  active alarms, last message), boiler (status, fault, temperatures,
  modulation, estimated power, pellet store, hopper, daily pellets, burner
  starts and hours, mode), heating circuits, hot water, buffer tank, solar
  collector and solar yield meter, heat pump, when present.
- Scene trigger "ÖkoFEN boiler alarm" (message, code): a new message, a
  boiler newly in fault, or a higher error count; never on the first read.
- Careful reads: every 60 s (60 to 3600), one request at a time, never two
  closer than 3 s; a refused password stops the reads (new try after 10 min,
  1 h, then every 6 h); a 429 pauses every path for 60 s to 6 h; both kept in
  `/data`; other errors back off, never faster than the interval.
- Answers in UTF-8, Latin-1 or mixed; the JSON defects of some firmware
  repaired; old firmware (`all??`, bare values) detected by itself.
- "Test the connection" button; the status, the Discovery list and the badges
  are sent again at each reconnection to Gladys.
- Device and feature names in French or English.

### Fixed

- A new boiler message is no longer missed after a failed or slow read, and
  a message that comes back no longer fires again: the messages seen are kept
  in `/data` (200 at most).
- The test button and Discovery no longer read faster than the refresh
  interval (30 s at least) after the last attempt, nor during a backoff; the
  button retries a refused password at once only once that interval has
  passed, and only a successful read lifts the stop.
- The backoff after errors and "Wait at least" is kept in `/data`: a restart
  no longer reads at once.
- A refused `??` probe (old firmware detection) no longer stops the reads as
  a refused password: the integration goes back to `?`.
- The ten messages kept are the newest (sorted before the cut).
- The "more errors" alarm no longer fires on a shorter list or a read
  without error section, and no longer misses a rise that came with a known
  message listed again.
- Two boilers reporting the same code at the same time now give two alarms.
- While a refused password stops the reads, two reads are never closer than
  the refresh interval.

[Unreleased]: https://github.com/LM1LC3N7/gladys-oekofen/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/LM1LC3N7/gladys-oekofen/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-oekofen/releases/tag/v0.1.1
