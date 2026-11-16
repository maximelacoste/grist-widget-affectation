# grist-widget-affectation

Widget Grist « Affectation » pour le document ULIS centralisé (écosystème Éducation nationale), construit avec le [Système de design de l'État (DSFR)](https://www.systeme-de-design.gouv.fr/).

Parcours en trois étapes :

1. **Rechercher** l'élève (nom, prénom, date de naissance facultative), sans tenir compte des accents, de la casse ni des tirets.
2. **Choisir** la fiche trouvée dans `Individus`, ou **en créer une** si aucune ne convient. La création est refusée si la clé `Cle` (même normalisation que la formule Grist) existe déjà.
3. **Saisir ou modifier** une ligne de `Scolarite` : date d'effet, affectation, niveau, situation, liste d'attente.

## Hypothèses sur le document Grist

| Table | Colonnes utilisées |
|---|---|
| `Individus` | `Nom`, `Prenom`, `Date_de_naissance` (écrites à la création) ; `Cle` (lue) ; `Id_app` (lue) |
| `Scolarite` | `Eleve_Identite_` (réf. vers `Individus`), `Affectation` (réf. vers `Etablissements_avec_ULIS`), `Date_effet`, `Niveau_saisi` (Choice), `Situation` (Choice), `Liste_d_attente` (Bascule) |

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

Le widget charge `Individus` dans le navigateur de l'utilisateur pour chercher (rechargé à chaque recherche). Aucune donnée n'est envoyée ailleurs que dans le document Grist.

## Accessibilité

Composants DSFR, libellés associés à chaque champ, erreurs reliées par `aria-describedby`, zones `status`/`alert`, focus déplacé à chaque changement d'étape. Un audit RGAA complet reste à faire.
