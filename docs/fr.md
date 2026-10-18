# ÖkoFEN

Intégration non officielle, sans lien avec ÖkoFEN. Elle amène dans Gladys une
chaudière à granulés **ÖkoFEN** (Pellematic, Pellematic Compact, Smart…) ou
une pompe à chaleur ÖkoFEN, par l'**interface JSON locale** de son écran
Touch, **en lecture seule**.

> **Attention : jamais testé avec une vraie chaudière.** Cette intégration a
> été écrite à partir de l'intégration Home Assistant oekofen-pellematic-compact
> et testée contre une fausse chaudière seulement. Les retours sont les
> bienvenus.

## Ce que vous obtenez

Un appareil Gladys par composant que la chaudière annonce :

| Appareil                | Fonctionnalités                                                                                                                                                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installation ÖkoFEN     | Température extérieure, mode de l'installation, alarme (0/1), alarmes actives, dernier message.                                                                                                                                                    |
| Chaudière ÖkoFEN 1      | État (texte de la chaudière), défaut (0/1), température chaudière et consigne, température foyer, modulation (%), puissance estimée (kW), stock de granulés, trémie, granulés du jour et de la veille (kg), démarrages et heures du brûleur, mode. |
| Circuit de chauffage 1… | Température de départ et consigne, température ambiante et consigne (si le circuit a une sonde), circulateur (0/1), mode (Arrêt, Auto, Confort, Réduit), état.                                                                                     |
| Eau chaude 1…           | Température de l'eau (haut et bas), consigne, circulateur, mode (Arrêt, Auto, Marche forcée), état.                                                                                                                                                |
| Ballon tampon 1…        | Températures haut et milieu, consigne haut, circulateur (%), état.                                                                                                                                                                                 |
| Capteur solaire 1…      | Température capteur et stockage, circulateur (%), mode, état (s'il est présent).                                                                                                                                                                   |
| Compteur solaire 1…     | Températures départ et retour, puissance (kW), production du jour et totale (kWh) (s'il est présent).                                                                                                                                              |
| Pompe à chaleur 1…      | Températures départ, consigne, retour, source entrée et sortie, COP, mode, état (s'il est présent).                                                                                                                                                |

Chaque fonctionnalité n'apparaît que si la chaudière envoie la valeur. Les
températures sont des sondes (elles n'entrent pas dans la moyenne de la
pièce). Les kg, kW, kWh et % n'ont pas d'unité dans Gladys (le cœur ne les
propose pas pour ces catégories) : l'unité est dans le nom. La puissance
estimée vaut la puissance nominale × la modulation, seulement si la chaudière
donne sa puissance nominale (souvent avec le fichier `json.properties`).
L'énergie solaire n'est **pas** envoyée au tableau de bord énergie de Gladys
(il la compterait comme de l'électricité).

Déclencheur de scène **Alarme de la chaudière ÖkoFEN** : quand une lecture
montre un message de la chaudière jamais vu, une chaudière nouvellement en
défaut, ou plus d'erreurs que la lecture précédente. Variables : `message` et
`code` (vide s'il est inconnu). Les messages déjà vus sont gardés (200 au
plus, dans `/data`) : un message qui revient ne redéclenche pas, et une
lecture lente ou une lecture échouée ne fait pas manquer un nouveau message.
Jamais à la toute première lecture (elle apprend les messages présents).

Le badge de chaque appareil affiche « local », ou « injoignable » quand la
chaudière ne répond pas ou refuse le mot de passe (avec un point orange si ce
composant manque dans la dernière réponse).

## Installation

1. Sur l'écran Touch de la chaudière : **Réglages généraux → Réglages réseau
   (IP Config)**, descendez et **activez l'interface JSON**. N'activez pas le
   mode de compatibilité. L'écran affiche une URL de la forme
   `http://<ip>:<port>/<mot de passe>/all`.
2. Dans Gladys, installez l'intégration ÖkoFEN et saisissez séparément
   l'**adresse IP**, le **port** (4321 par défaut) et le **mot de passe** de
   cette URL. Ne collez pas l'URL entière dans le champ adresse : elle
   contient le mot de passe (l'intégration la refuse).
3. Enregistrez, puis ajoutez les appareils depuis l'onglet **Découverte**.

Donnez une adresse IP fixe à la chaudière (bail DHCP réservé) : l'adresse
n'entre pas dans les identifiants des appareils, mais elle doit rester
joignable.

## Lecture seule

Cette première version **ne commande rien** : ni allumage, ni extinction, ni
changement de mode, ni consigne. Une chaudière est un appareil à flamme, et
l'interface JSON n'est protégée que par un mot de passe court envoyé en clair
sur le réseau local : la v1 lit seulement. Toutes les fonctionnalités sont en
lecture seule ; une commande venue de Gladys (scène, tableau de bord,
assistant vocal) est refusée sans rien envoyer.

## Mot de passe et vie privée

- Le mot de passe est **gardé par Gladys dans sa base, jamais réaffiché, et
  envoyé seulement à la chaudière**, dans l'URL de chaque lecture : c'est le
  format de l'appareil. Cette URL n'apparaît jamais dans les journaux ni dans
  les messages d'état.
- Le volume `/data` de l'intégration garde seulement la pause en cours (429
  ou attente après des erreurs), un arrêt sur mot de passe refusé et les
  messages d'alarme déjà vus, avec une empreinte de l'adresse et du port. Ni
  le mot de passe, ni son empreinte.
- Tout reste sur votre réseau local, en HTTP (la chaudière ne propose pas
  HTTPS) : quiconque écoute ce réseau peut lire le mot de passe, comme avec
  l'application.

## Rafraîchissement

La chaudière répond lentement et refuse les lectures trop rapprochées : elle
est lue **toutes les 60 secondes** par défaut (60 à 3600), une seule requête
à la fois, jamais deux à moins de 3 secondes. Le bouton **Tester la
connexion** et la Découverte ne lisent que si l'intervalle (30 secondes au
moins) est écoulé depuis la dernière tentative, réussie ou non, et qu'aucune
pause n'est en cours ; sinon le bouton affiche l'état et le temps restant.

Le micrologiciel est détecté seul (`all?`, puis `all??` pour certains anciens
modèles) ; le champ **Micrologiciel** force l'un ou l'autre. Les réponses en
UTF-8, en Latin-1 (ISO-8859-1) ou mélangées sont lues.

## Erreurs

- **Mot de passe refusé** (ou interface JSON désactivée) : les lectures
  s'arrêtent ; un nouvel essai après 10 min, 1 h, puis toutes les 6 h, ou
  aussitôt quand vous changez l'adresse ou le mot de passe. **Tester la
  connexion** réessaie aussi, une fois l'intervalle écoulé depuis la dernière
  tentative. L'arrêt n'est levé que par une lecture réussie, et il est gardé
  aux redémarrages.
- **La chaudière demande d'attendre** (401 « Wait at least 2500ms ») ou ne
  répond pas : nouvel essai après 1, 2, 5, 10 puis toutes les 15 minutes,
  jamais plus vite que l'intervalle. Cette attente est gardée aux redémarrages.
- **HTTP 429** : une pause d'au moins 1 minute (Retry-After s'il est donné,
  6 h au plus), pour tous les chemins, gardée aux redémarrages.
- Une réponse trop grande (plus de 256 Ko) ou qui n'est pas du JSON est
  refusée.

## Limites

- Jamais testé avec une vraie chaudière : les noms des champs viennent de
  l'intégration de référence et de ses réponses d'exemple.
- Les textes d'état sont ceux de la chaudière, dans la langue de son écran.
- L'heure des messages est celle de la chaudière, sans fuseau.
- Pas de commande (voir le fichier TODO du dépôt pour une v2).

## Crédits

- [oekofen-pellematic-compact](https://github.com/dominikamann/oekofen-pellematic-compact)
  de Dominik Amann (Apache-2.0) : l'interface JSON, l'encodage, la lecture
  des valeurs et des messages sont portés en JavaScript.
- Voir `THIRD_PARTY_NOTICES.md`.

ÖkoFEN et Pellematic sont des marques d'ÖkoFEN ; ce projet est sans lien avec
ÖkoFEN.
