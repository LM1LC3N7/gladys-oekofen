# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported from the project below. The ported parts were rewritten
in JavaScript; they are changed from the original (another language, another
structure, only what this integration needs, read only). None of the original
code is copied as is.

## oekofen-pellematic-compact

- Project:
  [dominikamann/oekofen-pellematic-compact](https://github.com/dominikamann/oekofen-pellematic-compact),
  version 4.4.0, the Home Assistant integration for ÖkoFEN Pellematic
  boilers, by Dominik Amann and its contributors.
- Copyright 2022 Dominik Amann.
- What is ported (in `src/constants.js`, `src/client.js`, `src/oekofen.js`
  and `src/devices.js`): the URL of the local JSON interface
  (`http://<ip>:<port>/<password>/all?`, `??` on some old firmware, and how
  the reference chooses between them), the minimum delay between two
  requests (2.5 s, the boiler's 401 "Wait at least 2500ms"), the detection of
  the charset (UTF-8, ISO-8859-1, or a mix), the repair of the `L_statetext:`
  defect of firmware 4.02 and of the control characters inside strings, the
  reading of the values (`val`, `factor`, bare values of old firmware, tenths
  of a degree), the filters of the int16 "not available" markers and of the
  out-of-scale values, the decoding of the boiler state (`L_state`, index or
  bit mask, fault = 11), the format of the boiler messages (`error_N`), the
  component keys (`pe`, `hk`, `ww`, `pu`, `sk`, `se`, `wp`) and the field
  names read.
- Changes: rewritten in JavaScript for a Gladys external integration; read
  only (the reference's `send_data` and every writable entity are not
  ported); the answer is read with a size limit and as untrusted data; the
  message parsing is linear; no Home Assistant code, no diagnostics module.
- Licence: Apache License 2.0, whose full text is the `LICENSE` file shipped
  with this integration (and copied into its Docker image). The project ships
  no `NOTICE` file.
