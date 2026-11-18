# Navigation du widget « Affectation »

Six pages, une seule visible à la fois. Les flèches pleines sont des boutons de la page ; les pointillés sont les boutons « Précédent / Suivant » du bandeau d'étapes (atteignables seulement si la recherche ou le choix d'élève existe).

```mermaid
flowchart TD
    P1["<b>Accueil</b><br/>deux recherches côte à côte :<br/>un élève · un établissement avec ULIS"]
    P2["<b>Résultats élèves</b><br/>Nom · Prénom · Naissance · Affectation en cours<br/>boutons Affecter / Dossier par ligne"]
    P3["<b>Affectations de l'élève</b><br/>liste des lignes, ✎ modifier, 🗑 supprimer<br/>formulaire d'affectation (ajout / modification)"]
    PC["<b>Création de fiche</b><br/>nom, prénom, naissance, coordonnées<br/>fiches proches affichées pendant la saisie"]
    PD["<b>Dossier</b><br/>lecture seule ; bouton Modifier<br/>tous les champs → Valider / Annuler"]
    PE["<b>Dispositif ULIS</b><br/>effectifs, coordonnées, ERS…<br/>élèves présents, triables"]

    P1 -->|"Entrée / Rechercher (élève)"| P2
    P1 -->|"clic sur une suggestion élève"| PD
    P1 -->|"clic sur une suggestion établissement<br/>ou Rechercher (1 résultat)"| PE
    P1 -->|"Rechercher (plusieurs établissements)<br/>puis clic dans la liste"| PE
    P2 -->|"Affecter"| P3
    P2 -->|"Dossier"| PD
    P2 -->|"clic sur l'établissement"| PE
    P2 -->|"Créer une nouvelle fiche"| PC
    P2 -->|"Nouvelle recherche"| P1
    PC -->|"Créer la fiche et continuer<br/>ou fiche existante → Affecter"| P3
    PC -->|"Annuler"| P2
    P3 -->|"Dossier"| PD
    P3 -->|"clic sur l'établissement"| PE
    P3 -->|"Revenir à la page de résultats"| P2
    P3 -->|"Autre élève"| P1
    PD -->|"Affecter"| P3
    PD -->|"clic sur l'établissement (historique)"| PE
    PD -->|"Revenir à … (accueil, résultats,<br/>affectations ou dispositif, selon l'origine)"| P1
    PE -->|"clic sur un élève"| PD
    PE -->|"Revenir à … (accueil, résultats,<br/>affectations ou dossier, selon l'origine)"| P1
    P1 -.->|"Suivant (si une recherche existe)"| P2
    P2 -.->|"Précédent"| P1
    P2 -.->|"Suivant (si un élève est choisi)"| P3
    P3 -.->|"Précédent"| P2
```

Le bouton de retour de la page Dossier et de la page Dispositif porte le nom de la page d'où l'on vient : le schéma les résume par une seule flèche.

## Page Dispositif

- Informations : effectifs calculés (présents, liste d'attente, autres situations) et, quand elles existent dans `Etablissements_avec_ULIS`, les colonnes UAI, adresse, code postal, commune, téléphone, courriel, directeur, ERS, capacité, effectif saisi.
- Élèves présents : ceux dont la ligne de scolarité en cours (la plus récente dont la date est passée) désigne cet établissement, avec la situation « En ULIS » et hors liste d'attente. Un interrupteur ajoute la liste d'attente et les autres situations.
- Tri : élève (nom, prénom), classe (ordre des choix de `Niveau_saisi`), première notification, fin de droits ; un second clic inverse l'ordre ; une date absente reste toujours en dernier.

## Fenêtres (pop-ups)

| Où | Déclencheur | Fenêtre | Issue |
|---|---|---|---|
| Affectations | corbeille ou « Supprimer cette affectation » | Supprimer cette affectation ? | Oui : `RemoveRecord` · Non : rien |
| Affectations | « Enregistrer » une affectation modifiée | Enregistrer ces modifications ? (avant → après) | Oui : `UpdateRecord` · Revenir : formulaire conservé |
| Dossier | « Valider » | Enregistrer ces modifications ? (avant → après, avertissement si état civil) | Oui : un seul `UpdateRecord` sur `Individus` · Revenir : champs conservés |
| Dossier | quitter ou « Annuler » avec des champs modifiés | Abandonner les modifications en cours ? | Oui : changements perdus, la navigation continue · Non : on reste |

La nouvelle affectation (ajout) et la création de fiche s'enregistrent sans fenêtre. Fermer l'onglet avec une édition non validée déclenche aussi l'avertissement du navigateur (selon le contexte d'iframe de Grist).

## Sorties gardées de la page Dossier

Toutes les sorties passent par la même garde : retour (quelle que soit l'origine), « Affecter », clic sur un établissement de l'historique. Si l'édition est ouverte mais inchangée, on sort sans fenêtre.
