# Audit sécurité et accessibilité (18 novembre 2026)

Périmètre : `index.html`, `src/*.js`, `src/style.css`, `scripts/`, dépôt GitHub. Le DSFR vendorisé (`vendor/dsfr`) n'a pas été relu.
Méthode : relecture du code, recherche des constructions à risque, parcours automatisé de 13 écrans (navigateur piloté, jeu de données fictif) avec des règles écrites pour l'occasion, test de la page sous une politique de sécurité de contenu stricte. Pas de test avec un lecteur d'écran ni sur l'instance réelle.

## Sécurité

### Ce qui est sain
- Aucun `innerHTML`, `eval`, `new Function`, `document.write` : tout le texte passe par `textContent` / nœuds texte (fonction `h()`). Le seul `innerHTML` (message de secours) a été supprimé.
- Aucun lien, `href`, `src` ou `style` construit à partir de données : une valeur de cellule ne peut pas injecter de balise ni d'URL.
- Stockage : une seule clé `sessionStorage` (pop-up d'accueil déjà vu). Pas de cookie, pas de `localStorage`.
- Un seul appel réseau sortant : l'autocomplétion d'adresse (voir risque 3), sans cookie ni en-tête Referer.
- Aucun secret, jeton ni donnée réelle dans le dépôt ; les tests et la documentation utilisent des données fictives.

### Risques et recommandations (par ordre d'importance)
1. **Chaîne d'approvisionnement du widget (important).** Le widget tourne avec l'accès `full` au document. Le dépôt est public, déployé par GitHub Pages, et la branche `main` n'est pas protégée : qui prend la main sur le compte GitHub peut publier du code lisant et écrivant tout le document. À faire : double authentification obligatoire, protection de `main` (pull request, pas de poussée forcée), et, si possible, héberger le widget sur l'infrastructure de l'incubateur plutôt que sur Pages.
2. **Script externe `docs.getgrist.com/grist-plugin-api.js`**, exécuté avec ces mêmes droits, sans empreinte (SRI impossible sur un fichier qui change). Recommandation : en copier une version datée dans `vendor/` (comme le DSFR) et la mettre à jour volontairement. Le script `scripts/vendor-grist-api.sh` est prêt (paquet npm `grist-plugin-api`) ; il reste à l'exécuter depuis un poste avec accès à npm, puis à changer la balise `script` de `index.html` après un test sur l'instance.
3. **Adresses envoyées à un service tiers.** Pendant la saisie d'une adresse (création de fiche, modification), le texte tapé part vers `data.geopf.fr` (Géoplateforme de l'IGN, service public). Le nom de l'élève n'est pas envoyé, mais l'adresse d'un élève mineur est une donnée personnelle : à inscrire au registre des traitements / à l'analyse d'impact et à valider avec le DPD.
4. **Droits : seule la règle d'accès Grist protège.** Depuis le 19 novembre, `readonly=true` masque aussi les boutons d'écriture (sans le paramètre, rien n'est masqué) ; ce n'est qu'un confort d'affichage, et Grist refuse l'écriture si le compte n'a pas le droit. À vérifier une fois avec un compte lecteur et avec l'URL `?embed=true` (tentative d'ajout d'une note : elle doit être refusée).
5. **Adresse professionnelle dans l'historique Git public.** Les commits portent `…@ac-toulouse.fr`. Pour les prochains, utiliser l'adresse `noreply` de GitHub (Settings > Emails > « Keep my email addresses private »). Réécrire l'historique existant n'est pas recommandé sans besoin.
6. **Minimisation.** Le widget charge en mémoire toutes les colonnes des tables lues (`fetchTable`). Rien n'est stocké hors de la page, mais le périmètre de lecture est celui de l'accès `full`.

### Politique de sécurité de contenu (CSP)
La page fonctionne sous la politique ci-dessous (testée avec le jeu fictif : aucune violation) :

```
default-src 'none'; script-src 'self' https://docs.getgrist.com; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self'; connect-src https://data.geopf.fr; base-uri 'none'; form-action 'none'
```

Elle n'est **pas activée** : elle n'a pas pu être vérifiée avec le vrai script de Grist sur l'instance, et une règle trop stricte donnerait une page blanche. Pour l'essayer : ajouter `<meta http-equiv="Content-Security-Policy" content="…">` dans `index.html` sur une copie du widget, ouvrir la console, et vérifier l'absence de « Refused to … ». `frame-ancestors` ne peut pas se poser par balise `meta` (GitHub Pages ne permet pas les en-têtes).

## Accessibilité

### Corrigé
- Hiérarchie des titres : les sections du dossier et du dispositif sautaient de `h1` à `h4` ; elles sont maintenant en `h2` (même aspect visuel), les titres d'alerte sont des paragraphes, le titre des fenêtres modales est un `h2`.
- `aria-controls` du bouton « Ajouter un élève » pointait vers un panneau absent quand il est fermé : retiré (`aria-expanded` suffit).
- Boutons dont le libellé était réduit à l'icône : retour du bas du dossier et « Supprimer cette affectation » (corrigés dans la version précédente).

### Contrôlé, sans défaut sur les 13 écrans parcourus
Nom accessible de chaque bouton, lien et champ ; étiquette réelle de chaque champ ; identifiants uniques ; références ARIA valides ; légende et `scope` des tableaux ; un seul `main` et un seul `h1` ; libellé visible contenu dans le nom accessible (2.5.3) ; contraste du texte (≥ 4,5:1, ≥ 3:1 pour le grand texte) ; cibles de 24 px au moins ; pas de défilement horizontal à 320 px (reflow) ; focus placé sur le titre à chaque changement de page ; fenêtres modales natives (`dialog`, focus piégé, Échap, focus initial sur le choix sans risque, focus rendu à la fermeture) ; zones `role="status"` / `role="alert"` pour les messages.

### Points restants (à arbitrer)
- Une cinquantaine d'infobulles `title` : inaccessibles au clavier et au tactile. Aucune information essentielle n'y est seule (les libellés suffisent), mais elles répètent parfois le nom du bouton, que certains lecteurs d'écran lisent deux fois. Option : n'en garder que là où elles apportent un complément.
- Après une action qui recharge le dossier (ajout de note, enregistrement), le focus revient sur le titre du dossier, pas sur l'élément déclencheur : acceptable, mais à confirmer avec un utilisateur de lecteur d'écran.
- Pas de test réel avec NVDA / VoiceOver, ni de contrôle sur l'instance (le DSFR de l'instance peut différer du DSFR vendorisé).
