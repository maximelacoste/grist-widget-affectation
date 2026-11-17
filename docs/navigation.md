# Navigation du widget « Affectation »

Cinq pages, une seule visible à la fois. Les flèches pleines sont des boutons de la page ; les pointillés sont les boutons « Précédent / Suivant » du bandeau d'étapes (atteignables seulement si la recherche ou le choix d'élève existe).

```mermaid
flowchart TD
    P1["<b>Page 1 — Recherche</b><br/>champ unique : nom, prénom, date de naissance<br/>suggestions « NOM Prénom, né(e) le … »"]
    P2["<b>Page 2 — Résultats</b><br/>Nom · Prénom · Naissance · Affectation en cours<br/>boutons Affecter / Dossier par ligne"]
    P3["<b>Page 3 — Affectations de l'élève</b><br/>liste des lignes, ✎ modifier, 🗑 supprimer<br/>formulaire d'affectation (ajout / modification)"]
    PC["<b>Page Création de fiche</b><br/>nom, prénom, naissance, coordonnées<br/>fiches proches affichées pendant la saisie"]
    PD["<b>Page Dossier</b><br/>lecture seule ; bouton Modifier<br/>tous les champs → Valider / Annuler"]

    P1 -->|"Rechercher (Entrée)"| P2
    P1 -->|"clic sur une suggestion"| P2
    P2 -->|"Affecter"| P3
    P2 -->|"Dossier"| PD
    P2 -->|"Créer une nouvelle fiche"| PC
    P2 -->|"Nouvelle recherche"| P1
    PC -->|"Créer la fiche et continuer"| P3
    PC -->|"fiche existante → Affecter"| P3
    PC -->|"Annuler / Revenir aux résultats"| P2
    PC -.->|"Annuler (aucune recherche faite)"| P1
    P3 -->|"Dossier"| PD
    P3 -->|"Revenir à la page de résultats"| P2
    P3 -->|"Autre élève"| P1
    PD -->|"Affecter (si venu des résultats)"| P3
    PD -->|"Revenir à la page de résultats (origine : résultats)"| P2
    PD -->|"Revenir aux affectations (origine : étape 3)"| P3
    P1 -.->|"Suivant (si une recherche existe)"| P2
    P2 -.->|"Précédent"| P1
    P2 -.->|"Suivant (si un élève est choisi)"| P3
    P3 -.->|"Précédent"| P2
```

## Fenêtres (pop-ups)

| Où | Déclencheur | Fenêtre | Issue |
|---|---|---|---|
| Page 3 | corbeille ou « Supprimer cette affectation » | Supprimer cette affectation ? | Oui : `RemoveRecord` · Non : rien |
| Page 3 | « Enregistrer » une affectation modifiée | Enregistrer ces modifications ? (avant → après) | Oui : `UpdateRecord` · Revenir : formulaire conservé |
| Page Dossier | « Valider » | Enregistrer ces modifications ? (avant → après, avertissement si état civil) | Oui : un seul `UpdateRecord` sur `Individus` · Revenir : champs conservés |
| Page Dossier | quitter ou « Annuler » avec des champs modifiés | Abandonner les modifications en cours ? | Oui : changements perdus, la navigation continue · Non : on reste |

La nouvelle affectation (ajout) et la création de fiche s'enregistrent sans fenêtre. Fermer l'onglet avec une édition non validée déclenche aussi l'avertissement du navigateur (selon le contexte d'iframe de Grist).

## Sorties gardées de la page Dossier

Toutes les sorties passent par la même garde : « Revenir à la page de résultats » (bandeau et pied de page), « Revenir aux affectations », « Affecter ». Si l'édition est ouverte mais inchangée, on sort sans fenêtre.
