# grist-widget-affectation

Widget Grist « Affectation » pour le document ULIS centralisé (écosystème Éducation nationale), construit avec le [Système de design de l'État (DSFR)](https://www.systeme-de-design.gouv.fr/).

Une page d'accueil avec deux recherches, puis deux parcours (schéma complet : [docs/navigation.md](docs/navigation.md)) :

- **Un établissement avec ULIS** : la page *Dispositif* affiche effectifs, informations de l'établissement (colonnes de `Etablissements_avec_ULIS` : `Uai`, `Commune`, `Secteur_ERS`, `Uai_ERSH`, `Secteur_CDOEA`, `Uai_Coordo_CDOEA`, `Places_max`… ; coordonnées lues dans la table liée par `Uai`) et élèves présents, triables ; un clic sur un élève ouvre son dossier.
- **Un élève**, en trois étapes :
  1. **Rechercher** (nom, prénom, date de naissance, dans l'ordre voulu), sans tenir compte des accents, de la casse ni des tirets. Une suggestion ouvre directement le dossier.
  2. **Choisir** la fiche trouvée dans `Individus`, ou **en créer une** si aucune ne convient. La création est refusée si la clé `Cle` (même normalisation que la formule Grist) existe déjà.
  3. **Saisir ou modifier** une ligne de `Scolarite` : date d'effet, affectation, niveau, situation, liste d'attente.

## Hypothèses sur le document Grist

| Table | Colonnes utilisées |
|---|---|
| `Individus` | `Nom`, `Prenom`, `Date_de_naissance` (écrites à la création) ; `Cle` (lue) ; `Id_app` (lue) ; `Premiere_notif_ULIS` et `Fin_droits_ULIS` (lues, page Dispositif) |
| `Etablissements_avec_ULIS` | colonne affichée (réf. de `Scolarite.Affectation`), `Commune`, `Type` ; page Dispositif, lues si elles existent : `Uai` (réf. vers `Etablissements_ERS`, dont adresse, code postal, téléphone, courriel, directeur sont cherchés par leur nom), `Secteur_ERS`, `Uai_ERSH`, `Secteur_CDOEA`, `Uai_Coordo_CDOEA`, `Nombre_de_dispositifs`, `Ouverture`, `Places_max`, `Effectif` |
| `Scolarite` | `Eleve_Identite_` (réf. vers `Individus`), `Affectation` (réf. vers `Etablissements_avec_ULIS`), `Date_effet`, `Niveau_saisi` (Choice), `Situation` (Choice), `Liste_d_attente` (Bascule) |

À la création d'une fiche, le formulaire propose aussi, en facultatif, toutes les colonnes de données d'`Individus` dont l'identifiant finit par `_manuel` ou `_manuelle` (début/fin de notification, représentants légaux, adresse, code postal, commune…). Elles sont découvertes dans les métadonnées Grist : ajouter une telle colonne suffit à la voir apparaître.

Le widget **n'écrit jamais** `Cle`, `Annee_scolaire` ni `Cree_le` : ils restent calculés par Grist. Les choix de `Niveau_saisi` et `Situation`, ainsi que le libellé affiché de `Affectation`, sont lus dans les métadonnées Grist : rien n'est codé en dur. Les noms de tables et de colonnes sont regroupés en tête de `src/app.js`.

La `Date_effet` est saisie volontairement, sans valeur par défaut.

## Installation dans Grist

1. Publier le dépôt (GitHub Pages, ou `widgets.maisonlepice.fr` pour les essais).
2. Dans le document, sur une page « Affectation » : ajouter un widget, type **Personnalisé**, saisir l'URL de `index.html`.
3. Niveau d'accès : **accès complet au document** (le widget lit et écrit dans plusieurs tables). Les règles d'accès (ACL) de Grist continuent de s'appliquer à l'utilisateur connecté.

## Développement

```sh
npm install        # installe @gouvfr/dsfr (épinglé) en devDependency
npm run vendor     # copie le DSFR dans vendor/dsfr/ (à committer : le widget est auto-hébergé)
npm test           # tests des fonctions pures (clé, dates, recherche)
npm run serve      # http://localhost:8080 (le widget n'a de sens qu'intégré dans Grist)
```

- Aucun CDN n'est utilisé pour le DSFR. Le seul script distant est `grist-plugin-api.js` (voir le commentaire dans `index.html` pour le servir depuis ton instance).
- Le DSFR est destiné aux sites et services de l'administration : conserver `vendor/dsfr/LICENSE.md`, ne pas reprendre le bloc-marque ni l'en-tête/pied de page d'un site dans le widget.
- Le test `norm()` compare la normalisation JavaScript à des valeurs produites par la formule Python de `Cle` ; à relancer si cette formule change.

## Confidentialité

Le widget charge `Individus` dans le navigateur de l'utilisateur pour chercher (rechargé à chaque recherche). Les noms suggérés viennent de ce chargement local : rien n'est envoyé ailleurs.

**Une exception : les suggestions d'adresse.** Pendant la saisie dans le champ adresse (création d'une fiche, ou modification de l'adresse dans le dossier), le texte tapé (4 caractères au moins, après une pause de frappe) est envoyé à la Base Adresse Nationale (service de géocodage de la Géoplateforme de l'IGN, `data.geopf.fr`) : service public, sans clé ni cookie, sans l'identité de l'élève ni le reste de la fiche, mais l'adresse partielle d'un représentant légal circule. Le champ porte une mention qui le dit. Pour désactiver cette fonction, mettre `ADRESSE_SUGGESTIONS = false` dans `src/app.js` ; la saisie libre fonctionne alors seule, comme elle le fait aussi si le service est indisponible.

## Accessibilité

Composants DSFR, libellés associés à chaque champ, erreurs reliées par `aria-describedby`, zones `status`/`alert`, focus déplacé à chaque changement d'étape. Un audit RGAA complet reste à faire.
