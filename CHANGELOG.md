# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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

[Unreleased]: https://github.com/LM1LC3N7/gladys-oekofen/commits/main
