# ÖkoFEN

Unofficial integration, not affiliated with ÖkoFEN. It brings an **ÖkoFEN**
pellet boiler (Pellematic, Pellematic Compact, Smart…) or an ÖkoFEN heat pump
into Gladys, through the **local JSON interface** of its Touch display,
**read only**.

> **Warning: never tested with a real boiler.** This integration was written
> from the Home Assistant integration oekofen-pellematic-compact and tested
> against a fake boiler only. Feedback is welcome.

## What you get

One Gladys device per component the boiler reports:

| Device                      | Features                                                                                                                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ÖkoFEN installation         | Outdoor temperature, mode of the installation, alarm (0/1), active alarms, last message.                                                                                                                                                    |
| ÖkoFEN boiler 1             | Status (the boiler's text), fault (0/1), boiler temperature and setpoint, combustion chamber temperature, modulation (%), estimated power (kW), pellet store, hopper, pellets used today and yesterday (kg), burner starts and hours, mode. |
| ÖkoFEN heating circuit 1…   | Flow temperature and setpoint, room temperature and setpoint (when the circuit has a sensor), pump (0/1), mode (Off, Auto, Comfort, Setback), status.                                                                                       |
| ÖkoFEN hot water 1…         | Water temperature (top and bottom), setpoint, pump, mode (Off, Auto, On forced), status.                                                                                                                                                    |
| ÖkoFEN buffer tank 1…       | Top and middle temperatures, top setpoint, pump (%), status.                                                                                                                                                                                |
| ÖkoFEN solar collector 1…   | Collector and store temperatures, pump (%), mode, status (when present).                                                                                                                                                                    |
| ÖkoFEN solar yield meter 1… | Flow and return temperatures, power (kW), yield today and total (kWh) (when present).                                                                                                                                                       |
| ÖkoFEN heat pump 1…         | Flow, setpoint, return, source inlet and outlet temperatures, COP, mode, status (when present).                                                                                                                                             |

A feature only appears when the boiler sends its value. Temperatures are
probes (kept out of the room average). kg, kW, kWh and % have no unit in
Gladys (the core does not offer them for those categories): the unit is in
the name. The estimated power is the nominal power × the modulation, only
when the boiler gives its nominal power (often with the `json.properties`
file). Solar energy is **not** sent to the Gladys energy dashboard (it would
count it as electricity).

Scene trigger **ÖkoFEN boiler alarm**: when a read shows a new message of the
boiler, a boiler newly in fault, or more errors than the previous read.
Variables: `message` and `code` (empty when unknown). Never at the first read
after a start.

The badge of each device shows "local", or "unreachable" when the boiler
does not answer or refuses the password (with an orange dot when that
component is missing from the last answer).

## Installation

1. On the Touch display of the boiler: **General settings → Network settings
   (IP Config)**, scroll down and **turn on the JSON interface**. Do not turn
   on the compatibility mode. The display shows a URL like
   `http://<ip>:<port>/<password>/all`.
2. In Gladys, install the ÖkoFEN integration and enter the **IP address**,
   the **port** (4321 by default) and the **password** of that URL, each in
   its own field. Do not paste the whole URL in the address field: it holds
   the password (the integration refuses it).
3. Save, then add the devices from the **Discovery** tab.

Give the boiler a fixed IP address (a reserved DHCP lease): the address is no
part of the device ids, but it must stay reachable.

## Read only

This first version **controls nothing**: no lighting, no turning off, no mode
change, no setpoint. A boiler is a flame appliance, and the JSON interface is
only protected by a short password sent in clear on the local network: v1
only reads. Every feature is read only; a command from Gladys (scene,
dashboard, voice assistant) is refused and nothing is sent.

## Password and privacy

- The password is **kept by Gladys in its database, never shown again, and
  sent only to the boiler**, in the URL of each read: that is the format of
  the device. That URL never appears in the logs nor in the status messages.
- The `/data` volume of the integration only keeps a pause asked by the
  boiler and a stop on a refused password, with a hash of the address and the
  port. Never the password, nor a hash of it.
- Everything stays on your local network, over HTTP (the boiler has no HTTPS):
  anyone listening on that network can read the password, as with the app.

## Refresh

The boiler answers slowly and refuses reads too close together: it is read
**every 60 seconds** by default (60 to 3600), one request at a time, never two
less than 3 seconds apart, the **Test the connection** button and Discovery
included (30 seconds at least between two reads asked by hand).

The firmware is detected by itself (`all?`, then `all??` for some old
models); the **Firmware** field forces one or the other. UTF-8, Latin-1
(ISO-8859-1) and mixed answers are read.

## Errors

- **Password refused** (or JSON interface off): the reads stop; a new try
  after 10 min, 1 h, then every 6 h, or at once when you change the address
  or the password or click **Test the connection**. The stop is kept across
  restarts.
- **The boiler asks to wait** (401 "Wait at least 2500ms") or does not
  answer: a new try after 1, 2, 5, 10 then every 15 minutes, never faster
  than the interval.
- **HTTP 429**: a pause of at least 1 minute (Retry-After when given, 6 h at
  most), for every path, kept across restarts.
- An answer too large (over 256 KB) or that is not JSON is refused.

## Limits

- Never tested with a real boiler: the field names come from the reference
  integration and its sample answers.
- The status texts are the boiler's own, in the language of its display.
- The time of the messages is the boiler's, without a time zone.
- No command (see the TODO file of the repository for a v2).

## Credits

- [oekofen-pellematic-compact](https://github.com/dominikamann/oekofen-pellematic-compact)
  by Dominik Amann (Apache-2.0): the JSON interface, the charsets, the
  reading of the values and of the messages are ported to JavaScript.
- See `THIRD_PARTY_NOTICES.md`.

ÖkoFEN and Pellematic are trademarks of ÖkoFEN; this project is not
affiliated with ÖkoFEN.
