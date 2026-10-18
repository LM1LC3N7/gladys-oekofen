// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, button, device and feature names,
// mode labels), in English and French.
// -----------------------------------------------------------------------------

/** The text of `texts` in `language`, English otherwise. */
export const word = (texts, language) => texts[language] ?? texts.en;

export const both = (en, fr) => ({ en, fr });

/** Two messages one after the other, in each language. */
export const join = (...messages) =>
  both(messages.map((m) => m.en).join(' '), messages.map((m) => m.fr).join(' '));

/** "25 min" / "3 h", for the pauses. */
export function age(ms) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 120) {
    return both(`${seconds} s`, `${seconds} s`);
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) {
    return both(`${minutes} min`, `${minutes} min`);
  }
  const hours = Math.round(minutes / 60);
  return both(`${hours} h`, `${hours} h`);
}

/** Device names, by component kind (a number follows, but for `system`). */
export const DEVICE_NAMES = {
  system: both('ÖkoFEN installation', 'Installation ÖkoFEN'),
  pe: both('ÖkoFEN boiler', 'Chaudière ÖkoFEN'),
  hk: both('ÖkoFEN heating circuit', 'Circuit de chauffage ÖkoFEN'),
  ww: both('ÖkoFEN hot water', 'Eau chaude ÖkoFEN'),
  pu: both('ÖkoFEN buffer tank', 'Ballon tampon ÖkoFEN'),
  sk: both('ÖkoFEN solar collector', 'Capteur solaire ÖkoFEN'),
  se: both('ÖkoFEN solar yield meter', 'Compteur solaire ÖkoFEN'),
  wp: both('ÖkoFEN heat pump', 'Pompe à chaleur ÖkoFEN'),
};

const OFF = both('Off', 'Arrêt');
const AUTO = both('Auto', 'Auto');
const ON = both('On', 'Marche');

/** Mode labels, by component kind and index (the boiler's own label otherwise). */
export const MODE_LABELS = {
  system: [OFF, AUTO, both('Hot water only', 'Eau chaude seule')],
  pe: [OFF, AUTO, ON],
  hk: [OFF, AUTO, both('Comfort', 'Confort'), both('Setback', 'Réduit')],
  ww: [OFF, AUTO, both('On (forced)', 'Marche forcée')],
  sk: [OFF, ON],
  wp: [OFF, AUTO, ON],
};

export const modeFallback = (index) => both(`Mode ${index}`, `Mode ${index}`);

export const MESSAGES = {
  none: both('No message', 'Aucun message'),
  fault: (name) => both(`${name}: fault`, `${name} : défaut`),
  countRose: (count) =>
    both(
      `${count} active alarm${count > 1 ? 's' : ''}`,
      `${count} alarme${count > 1 ? 's' : ''} active${count > 1 ? 's' : ''}`,
    ),
};

/** The reason of a failure, in each language (never the English reason in French). */
export function reasonOf(err) {
  const status = err?.status ? ` (HTTP ${err.status})` : '';
  switch (err?.kind) {
    case 'timeout':
      return both('no answer in time', 'pas de réponse à temps');
    case 'network':
      return both(
        'the boiler cannot be reached on the network',
        'la chaudière est injoignable sur le réseau',
      );
    case 'unavailable':
      return both(
        `the boiler answered an error${status}`,
        `la chaudière a répondu une erreur${status}`,
      );
    case 'bad_response':
    case 'empty':
    case 'size':
      return both('the answer is not the expected JSON', "la réponse n'est pas le JSON attendu");
    case 'too_fast':
      return both(
        'the boiler asked to wait between two reads',
        'la chaudière a demandé d’attendre entre deux lectures',
      );
    default:
      return both(`unexpected answer${status}`, `réponse inattendue${status}`);
  }
}

export const T = {
  noConfig: both(
    'Enter the IP address of the boiler, the port and the password of its JSON interface (shown on the Touch display, Network settings).',
    "Saisissez l'adresse IP de la chaudière, le port et le mot de passe de son interface JSON (affichés sur l'écran Touch, Réglages réseau).",
  ),
  addressPath: both(
    'The address field holds a path: enter only the IP address (and the port), and the password in its own field. Remove the rest: it may hold the password.',
    "Le champ adresse contient un chemin : saisissez seulement l'adresse IP (et le port), et le mot de passe dans son propre champ. Retirez le reste : il peut contenir le mot de passe.",
  ),
  addressInvalid: both(
    'The address is not a valid IP address or host name.',
    "L'adresse n'est pas une adresse IP ou un nom d'hôte valide.",
  ),
  connecting: both('Reading the boiler…', 'Lecture de la chaudière…'),
  connected: (count) =>
    both(
      `Connected: ${count} component${count > 1 ? 's' : ''} read (read only).`,
      `Connecté : ${count} composant${count > 1 ? 's' : ''} lu${count > 1 ? 's' : ''} (lecture seule).`,
    ),
  noComponent: both(
    'The boiler answered, but with no known component (pe, hk, ww, pu, sk, se, wp). Check the JSON interface on the Touch display.',
    "La chaudière a répondu, mais sans composant connu (pe, hk, ww, pu, sk, se, wp). Vérifiez l'interface JSON sur l'écran Touch.",
  ),
  refused: (wait) =>
    both(
      `The boiler refused the password (or the JSON interface is off). New try in ${wait.en}, or at once when you change the address or the password. "Test the connection" also tries again once the refresh interval has passed since the last read.`,
      `La chaudière a refusé le mot de passe (ou l'interface JSON est désactivée). Nouvel essai dans ${wait.fr}, ou aussitôt quand vous changez l'adresse ou le mot de passe. « Tester la connexion » réessaie aussi une fois l'intervalle de rafraîchissement écoulé depuis la dernière lecture.`,
    ),
  waiting: (wait) =>
    both(
      `Waiting before the next read of the boiler (${wait.en}).`,
      `Attente avant la prochaine lecture de la chaudière (${wait.fr}).`,
    ),
  rateLimited: (wait) =>
    both(
      `The boiler asked to slow down (HTTP 429): pause of ${wait.en}.`,
      `La chaudière a demandé de ralentir (HTTP 429) : pause de ${wait.fr}.`,
    ),
  unreachable: (reason, wait) =>
    both(
      `Boiler not read: ${reason.en}. New try in ${wait.en}.`,
      `Chaudière non lue : ${reason.fr}. Nouvel essai dans ${wait.fr}.`,
    ),
  test: {
    wait: (wait) =>
      both(
        `The boiler refuses reads too close together: next read possible in ${wait.en}.`,
        `La chaudière refuse les lectures trop rapprochées : prochaine lecture possible dans ${wait.fr}.`,
      ),
  },
  busy: both(
    'A read is in progress, try again in a moment.',
    'Une lecture est en cours, réessayez dans un instant.',
  ),
};
