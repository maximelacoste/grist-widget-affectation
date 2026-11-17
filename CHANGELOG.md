# Changelog

## [Non publié]

- Affectations : corbeille à la fin de chaque ligne, après « Modifier » (même fenêtre de confirmation) ; fenêtres de confirmation redessinées (entête, tableau avant → après, pied de page) ; boutons d'action de ligne côte à côte.

- Modification d'une affectation : fenêtre de confirmation listant seulement les champs changés (« avant → après ») ; aucune écriture si rien n'a changé. Les nouvelles affectations s'enregistrent sans fenêtre.

- Modification d'une affectation : bouton « Supprimer cette affectation », avec fenêtre de confirmation (la ligne visée est rappelée, Échap ou « Non, garder » annulent) ; l'annulation reste possible via le panneau Activité de Grist.

- Étape 3 : bouton « Dossier » aligné avec l'identité. Performance : lectures de tables mémorisées 30 s (vidées à chaque écriture), partagées entre recherche, dossier et affectation, et lancées en parallèle pour le dossier.

- Étape 3 : bouton « Dossier » sous le nom de l'élève (ouvre ou referme le dossier). Libellés d'établissement : une parenthèse répétée en fin de nom (« (TOULOUSE) (Toulouse) ») est réduite à une seule.

- Dossier : notes de l'élève (`Notes_sur_l_eleve`) sous l'historique des affectations (la case NB n'est pas affichée : elle ne servait qu'à signaler une note dans la table).

- Recherche : un seul champ (nom, prénom, date de naissance, dans n'importe quel ordre) ; suggestions « NOM Prénom, né(e) le … » dès 2 caractères ; un clic mène à la page des résultats avec cette fiche et les boutons Affecter / Dossier ; création pré-remplie si rien ne correspond.
- Résultats : boutons « Affecter » et « Dossier » ; le dossier (lecture seule) montre état civil, coordonnées, notification ULIS et historique des affectations. Les données personnelles ne s'affichent qu'à l'écran.

- Établissements : plus de parenthèse en double après le nom (la commune n'est ajoutée que si le libellé n'a pas déjà de parenthèse) ; type déduit du libellé si la colonne `Type` n'est pas reconnue ; message explicite quand le type reste inconnu.

- Champs date : un clic sur un champ vide ouvre le calendrier (et plus seulement l'icône).

### Modifié
- La recherche ne porte plus que sur le nom et le prénom (la date de naissance reste affichée dans les résultats pour départager les homonymes).
- Création d'une fiche : nom, prénom et date de naissance sont tous obligatoires (la case « date inconnue » disparaît ; une date future est refusée).

### Ajouté
- Niveau selon l'établissement : la liste de `Niveau` suit l'établissement choisi, d'après la colonne `Type` de `Etablissements_avec_ULIS` (ECO : GS à CM2 ; CLG : 6G à 3G ; LYC : Lycée, 2GT, 2G, 2PRO, 1PRO, TPRO, 3PM, CAP1 à CAP3, BTS-SE-1, A2D ; autre type ou aucun établissement : tous les niveaux). Changer d'établissement retire un niveau devenu incompatible, avec une explication lue aux lecteurs d'écran ; un niveau déjà enregistré qui ne figure pas dans la liste reste affiché « (hors liste) ». La correspondance se règle dans `NIVEAUX_PAR_TYPE` (`src/app.js`).
- Recherche : le nom de famille est prédictif. Les noms déjà présents dans `Individus` sont proposés dès 2 lettres (sans accents ni tirets, regroupés, avec le nombre de fiches), au clavier ou à la souris ; la saisie libre reste toujours possible.
- Création d'une fiche : suggestions d'adresses normées de la Base Adresse Nationale (Géoplateforme de l'IGN) dans le champ adresse ; le choix remplit aussi le code postal et la commune. Le texte tapé est envoyé à ce service public (mention affichée sous le champ, voir README) ; désactivable avec `ADRESSE_SUGGESTIONS`, et sans effet bloquant si le service est indisponible.
- Création d'une fiche : champs facultatifs construits à partir des colonnes de données d'`Individus` dont l'identifiant finit par `_manuel` ou `_manuelle` (types Texte, Date, Entier, Numérique, Bascule, Choix), affichées dans l'ordre : début, fin, représentants légaux, adresse, code postal, commune, puis les autres ; seuls les champs renseignés sont écrits.

### Corrigé
- Une `Affectation` contenant un texte sans correspondance (ex. « Sortie du département ») s'affichait `E,InvalidTypedValue,Ref,…` : le texte est maintenant affiché avec le badge « Non reconnue », et un simple enregistrement de la ligne ne l'efface plus (`Affectation` n'est écrite que si elle change).
- Une valeur de `Niveau_saisi` ou `Situation` absente de la liste des choix (ex. niveaux de formation pro) est conservée à l'enregistrement, signalée « (hors liste) ».
- Une `Date_effet` qui n'est pas une date affiche son texte avec « (date invalide) » au lieu de « sans date ».
- La commune n'est plus répétée dans le libellé d'un établissement quand il la contient déjà, à la casse près : « … (FROUZINS) (Frouzins) ».
- Les cellules de `Individus` en erreur ne s'affichent plus comme des tableaux.
- Les boutons « Précédent » / « Suivant » s'affichaient comme des carrés : `fr-btns-group` impose des règles d'icônes de groupe ; remplacé par un bloc flexible (`.step-nav`).
- Le texte « null » apparaissait sous la liste de recherche des établissements.
- Les icônes (flèches de navigation, loupe) s'affichaient comme des carrés pleins : les feuilles d'icônes du DSFR (`icons-arrows`, `icons-system`) n'étaient pas chargées.

### Ajouté
- Navigation entre les étapes : boutons « Précédent » et « Suivant », actifs seulement si l'étape visée est atteignable (recherche faite, élève choisi). Une nouvelle recherche désélectionne l'élève.

### Modifié
- `Affectation` : la liste déroulante devient un champ de recherche avec loupe (mots dans le désordre, sans accents, flèches/Entrée/Échap au clavier), plus adapté aux longues listes d'établissements.

## [0.1.0] - à publier

### Ajouté
- Recherche tolérante dans `Individus` (accents, casse, tirets).
- Création d'une fiche `Individus` avec garde anti-doublon sur la clé `Cle`.
- Liste, création et modification des lignes de `Scolarite` (repère « En cours »).
- Choix de `Niveau_saisi`, `Situation` et du libellé d'`Affectation` lus dans les métadonnées Grist.
- Tests de la normalisation (parité avec la formule Python de `Cle`), des dates et de la recherche.
