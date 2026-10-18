// -----------------------------------------------------------------------------
// Answers of the ÖkoFEN JSON interface, shaped like those of the reference's
// fixtures (dominikamann/oekofen-pellematic-compact, tests/fixtures), with
// made-up values. Times are the boiler's local time.
// -----------------------------------------------------------------------------

export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const NOW = Date.UTC(2026, 9, 18, 8, 0, 0);

export const HOST = '192.168.1.50';
export const PORT = 4321;
export const PASSWORD = 'Zx9q';
export const CONFIG = { host: HOST, port: PORT, password: PASSWORD };

const t = (val, text, extra = {}) => ({
  val,
  unit: '°C',
  factor: 0.1,
  min: -32768,
  max: 32767,
  text,
  ...extra,
});

/** A modern answer (metadata objects), German labels as most boilers send them. */
export function modern({
  errors = 0,
  messages = {},
  state = 16,
  statetext = 'Leistungsbrand',
} = {}) {
  return {
    system: {
      system_info: 'system global variables',
      L_ambient: t(-69, 'Außentemperatur'),
      L_errors: { val: errors, factor: 1, min: -32768, max: 32767, text: 'Fehler' },
      L_usb_stick: { val: 0, format: '0:Aus|1:Ein', text: 'Usb Stick erkannt' },
      mode: { val: 1, format: '0:Aus|1:Auto|2:Warmwasser', text: 'Betriebsart' },
    },
    hk1: {
      hk_info: 'heating circuit data',
      L_roomtemp_act: t(215, 'Raumtemperatur'),
      L_roomtemp_set: t(220, 'RT Soll'),
      L_flowtemp_act: t(603, 'VL Ist'),
      L_flowtemp_set: t(609, 'VL Soll'),
      L_state: { val: 32, factor: 1, text: 'Status' },
      L_statetext: 'Heizbetrieb aktiv',
      L_pump: { val: 1, format: '0:Aus|1:Ein', text: 'HK Pumpe' },
      mode_auto: { val: 2, format: '0:Aus|1:Auto|2:Heizen|3:Absenken', text: 'Betriebsart' },
      name: { val: 'Erdgeschoss', text: 'Name' },
      temp_heat: t(220, 'Raumtemp Heizen', { min: 100, max: 400 }),
    },
    hk2: {
      hk_info: 'heating circuit data',
      L_roomtemp_act: t(-32768, 'Raumtemperatur'),
      L_flowtemp_act: t(301, 'VL Ist'),
      L_flowtemp_set: t(0, 'VL Soll'),
      L_statetext: 'Aus',
      L_pump: { val: 0, format: '0:Aus|1:Ein', text: 'HK Pumpe' },
      mode_auto: { val: 0, format: '0:Aus|1:Auto|2:Heizen|3:Absenken', text: 'Betriebsart' },
    },
    pu1: {
      pu_info: 'accu data',
      L_tpo_act: t(636, 'Einschaltfühler'),
      L_tpo_set: t(609, 'TPO Soll'),
      L_tpm_act: t(512, 'TPM'),
      L_pump: { val: 40, unit: '%', factor: 1, text: 'Pumpe' },
      L_statetext: 'Quellentemp unterhalb Puffertemp|Anforderung Ein',
    },
    ww1: {
      ww_info: 'domestic hot water data',
      L_temp_set: t(370, 'Wassertemp Soll'),
      L_ontemp_act: t(526, 'Ein Temperatur'),
      L_offtemp_act: t(481, 'Aus Temperatur'),
      L_pump: { val: 0, format: '0:Aus|1:Ein', text: 'Pumpe' },
      L_statetext: 'Zeit innerhalb Zeitprogramm|Anforderung Aus',
      mode_auto: { val: 1, format: '0:Aus|1:Auto|2:Ein', text: 'Betriebsart' },
    },
    sk1: {
      sk_info: 'solar data',
      L_koll_temp: t(452, 'Kollektortemp'),
      L_spu: t(498, 'Speichertemp'),
      L_pump: { val: 100, unit: '%', factor: 1, text: 'Pumpe' },
      L_statetext: 'Solar aktiv',
      mode: { val: 1, format: '0:Aus|1:Ein', text: 'Modus' },
    },
    se1: {
      se_info: 'solar gain',
      L_flow_temp: t(455, 'Vorlauf'),
      L_ret_temp: t(398, 'Rücklauf'),
      L_pwr: { val: 34, unit: 'kW', factor: 0.1, text: 'Leistung' },
      L_day: { val: 87, unit: 'kWh', factor: 0.1, text: 'Ertrag heute' },
      L_total: { val: 123456, unit: 'kWh', factor: 0.1, text: 'Ertrag gesamt' },
    },
    pe1: {
      pe_info: 'pellematic data',
      L_temp_act: t(633, 'Kesseltemperatur'),
      L_temp_set: t(650, 'KT Soll'),
      L_frt_temp_act: t(4321, 'Feuerraumtemperatur'),
      L_modulation: { val: 75, unit: '%', factor: 1, min: -32768, max: 32767, text: 'Modulation' },
      L_cfg_power: { val: 16, factor: 1, min: 8, max: 56, text: 'Kesselleistung' },
      L_state: { val: state, factor: 1, text: 'PE Kesselstatus' },
      L_statetext: statetext,
      L_starts: { val: 3525, factor: 1, text: 'Brennerstarts' },
      L_runtime: { val: 7209, unit: 'h', factor: 1, text: 'Brennerlaufzeit' },
      L_storage_fill: { val: 2852, unit: 'kg', factor: 1, text: 'Füllstand Lager' },
      L_storage_popper: { val: 41, unit: 'kg', factor: 1, text: 'Füllstand Zwischenbehälter' },
      storage_fill_today: {
        val: 30,
        unit: 'kg',
        factor: 1,
        min: -32768,
        max: 32767,
        text: 'Heute',
      },
      storage_fill_yesterday: {
        val: 40,
        unit: 'kg',
        factor: 1,
        min: -32768,
        max: 32767,
        text: 'Gestern',
      },
      mode: { val: 1, format: '0:Aus|1:Auto|2:Ein', text: 'Betriebsart' },
    },
    error: messages,
  };
}

/** Old firmware: bare values, tenths of a degree, strings for some. */
export const BARE = {
  system: { L_ambient: '-12', L_errors: '0', L_usb_stick: 'false' },
  pe1: {
    L_temp_act: 640,
    L_temp_set: '700',
    L_modulation: '55',
    L_state: '4',
    L_statetext: 'Leistungsbrand',
    L_storage_fill: '1500',
  },
  hk1: { L_flowtemp_act: 455, L_flowtemp_set: 460, L_pump: 'true', mode_auto: '1' },
  ww1: { L_ontemp_act: '512', L_temp_set: 500, L_pump: 'false' },
};

export const json = (value) => Buffer.from(JSON.stringify(value), 'utf8');

/** The same answer, encoded in Latin-1 (ISO-8859-1), as many boilers send it. */
export const latin1 = (value) => Buffer.from(JSON.stringify(value), 'latin1');

/**
 * An answer with the defects the reference repairs: `"L_statetext:"` (a quote
 * missing, firmware 4.02) and raw new lines inside a message.
 */
export const BROKEN = Buffer.from(
  '{"system":{"L_errors":{"val":1,"factor":1,"min":-32768,"max":32767}},' +
    '"pe1":{"L_temp_act":{"val":633,"factor":0.1},"L_statetext:"Zündung|Start"},' +
    '"error":{"error_1":"29-01-2026 18:21:32|PE 1 Aschebox in Kürze voll\nBitte in den nächsten\nTagen entleeren[5050]"}}',
  'utf8',
);
