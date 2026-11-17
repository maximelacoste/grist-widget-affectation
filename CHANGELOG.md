# Changelog

## [Non publié]

### Modifié
- La recherche ne porte plus que sur le nom et le prénom (la date de naissance reste affichée dans les résultats pour départager les homonymes).
- Création d'une fiche : nom, prénom et date de naissance sont tous obligatoires (la case « date inconnue » disparaît ; une date future est refusée).

### Ajouté
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
