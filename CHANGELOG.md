# Changelog

## [Non publié]

- Page Vœux : Vœu 1 et Vœu 2 deviennent des champs avec recherche (loupe), la liste de niveau n+1 est élargie, étiquettes « Sortant (CM2) », « Sortant (3e) » et « Restant » avec une bordure de couleur sur la ligne.

- Dossier d'un élève exclu : l'ERS de référence est celui du dernier établissement connu (« dernier établissement »). Pas de colonne ERS dans les listes de résultats.
- Loupe visible dans les champs de recherche (élève, établissement, dispositifs, élèves exclus, affectation, accueil ERS) : les règles de base des icônes du DSFR n'étaient pas chargées, l'icône n'apparaissait pas.
- Bandeau « COPIE DE TEST » (rouge, très visible, fixe en haut de page) quand le nom du document contient « test », « copie », « copy » ou « essai » (ou que l'adresse du widget porte `?test=1`), pour ne pas saisir de données réelles dans une copie.
- Recherche d'élève (suggestions et liste des résultats) : un élève exclu est indiqué « Exclu(e) » avec son dernier établissement, au lieu d'une affectation vide.
- Dossier élève : les courriels de l'ERS de référence sont des liens `mailto:`.
- Page dossier de l'élève : bloc « ERS de référence » (secteur, nom de l'ERS, courriels de la table des établissements) pour l'établissement de l'affectation en cours ; absent si l'élève n'a pas d'affectation en cours ou si rien n'est renseigné.
- Vœux n+1 : la situation « Maintien en ULIS » garde le niveau actuel (pas de +1) ; une situation de sortie (retour en classe ordinaire, sortie du dispositif) ne demande aucun vœu d'établissement ; un maintien en 3e (3e, 3G, 3PM) est signalé par une alerte sur la ligne et en tête de page, sans bloquer l'enregistrement.
- Entrée ERS (enseignant référent) : si la table `Acces_ERS` ne renvoie qu'une ligne à l'utilisateur, le widget s'ouvre sur sa page : établissements de ses secteurs, établissements hors secteur où il a récupéré des élèves (table `Suivis_ERS`), recherche d'un élève et bouton « C'est mon élève », élèves qu'il ne gère pas grisés dans la page des vœux, demande d'accusé (ligne dans `Accuses_ERS`, l'envoi par mail relève d'un workflow n8n à venir). Essais : `?ers=adresse` choisit une ligne, `?coordo=1` force l'affichage complet. Affichage seulement : la protection reste les règles d'accès Grist.
- Page « Vœux ULIS n+1 » d'un établissement (clic sur un établissement de la liste des vœux) : une ligne par élève présent, niveau n+1 (suivant par défaut, repère « Redoublement »), coche « Reste dans l'établissement » (vœu 1 = établissement, situation En ULIS), vœux 1 et 2, situation, et une seule validation confirmée pour tout l'établissement, écrite dans `Voeux_ERS`. Pas encore de restriction par ERS.
- Nouvelle page « Vœux ULIS n+1 » (bouton sur l'accueil) : mêmes filtres que « Tous les dispositifs » (secteur, type, ERS, occupation), plus une colonne « Vœux » (élèves présents sans vœu pour la rentrée visée, lue dans la table `Voeux_ERS`) et un filtre « il manque des vœux / tous saisis ». Pas encore de restriction par ERS.
- Sécurité : politique de sécurité de contenu (CSP) activée dans `index.html` : seuls les fichiers du dépôt s'exécutent, et le seul appel réseau autorisé est l'autocomplétion d'adresse (data.geopf.fr).
- Sécurité : l'API de plugin Grist est maintenant chargée depuis une copie datée du dépôt (`vendor/grist/`, empreinte SHA-256 notée dans `VERSION`) et non plus depuis docs.getgrist.com : plus aucun script tiers exécuté avec l'accès complet au document.
- Sécurité : quand Grist ouvre le widget en lecture seule (`readonly=true`), les boutons qui écrivent disparaissent (Modifier le dossier, Nouvelle affectation, Ajouter un élève, Créer une fiche, notes, crayons et corbeilles) et l'interrupteur de liste d'attente est désactivé. Sans le paramètre, rien n'est masqué ; la règle d'accès de Grist reste la vraie protection.
- Sécurité : script `scripts/vendor-grist-api.sh` pour copier une version datée de l'API de plugin Grist dans `vendor/grist/` (télécharge le fichier depuis l'instance Grist ; pas encore activé dans `index.html`, voir docs/audit-securite-accessibilite.md).
- Accueil : les deux blocs du bas (« Élèves exclus » et « Tous les dispositifs ») sont plus écartés des recherches au-dessus (48 px, identiques dans les deux colonnes ; chacun reste aligné sur sa colonne).
- Dossier : une ligne d'historique en situation « Exclusion » porte une pastille rouge bien visible (dans l'historique du dossier et dans la liste des affectations).
- Élèves exclus : la colonne « Établissement » devient « Dernière affectation » (la ligne d'exclusion n'a généralement pas d'établissement : on affiche la ligne la plus récente qui en porte un, et sa classe si l'exclusion n'en a pas). Sur l'accueil, le bloc « Élèves exclus » passe sous la recherche d'un élève.
- Nouveau module « Élèves exclus », accessible depuis l'accueil : liste des élèves dont la dernière ligne de scolarité est en situation « Exclusion », même datée d'une année scolaire précédente tant qu'ils n'ont pas de nouvelle affectation (nom, établissement, classe, date d'effet), avec recherche et tris. Un clic sur le nom ouvre le dossier, un clic sur l'établissement son dispositif, et le bouton de retour ramène à la liste. Un élève qui a ensuite une ligne plus récente (retour, nouvelle affectation) n'en fait plus partie.
- Dispositif : les courriels et numéros de téléphone de l'établissement sont cliquables (`mailto:` / `tel:`), avec l'icône enveloppe ou téléphone du DSFR. Seuls les jetons strictement reconnus deviennent des liens (pas de paramètre `?cc=…` dans un courriel) ; le reste s'affiche en texte.
- Dispositif : les informations de l'établissement sont présentées en tableau, deux couples libellé / valeur par ligne (effectifs en pleine largeur, une seule colonne sur écran étroit). Une information dont la formule Grist est en erreur (par exemple « Coordonnateur CDOEA : erreur AttributeError ») n'est plus affichée.
- Année scolaire : la règle de la formule `Actuellement_en_ULIS` (dernière ligne de l'élève, datée de l'année scolaire en cours — depuis le 1er septembre —, situation « En ULIS » ou vide) est reprise partout où l'application recalcule elle-même : repli sans la colonne, et groupe « Autres situations » des dispositifs, qui n'affiche plus les scolarités d'années scolaires passées.
- Dossier et suggestions de recherche : l'affectation « En cours » suit la même règle que les effectifs des dispositifs, la colonne `Actuellement_en_ULIS` de Scolarite. Une scolarité ancienne (par exemple de 2023) que Grist ne marque plus comme actuelle n'est plus affichée « En cours » ; l'élève apparaît « sans affectation en cours ». Sans cette colonne, l'ancienne règle (ligne datée la plus récente) sert de secours.
- Tous les dispositifs : la recherche et les cinq filtres sont réunis en deux lignes de trois champs (la recherche d'abord), alignés ; l'aide sous le champ de recherche est retirée (l'introduction de la page dit déjà « nom, commune ou UAI »).
- Dispositif : le bouton « Ajouter un élève » (et son panneau) passe sous le tableau des élèves, comme les autres boutons d'action ; il reste visible quand le tableau est vide.
- Démarrage plus rapide : la lecture d'Individus se fait en même temps que celle des métadonnées, la table des établissements est lue une seule fois, et Scolarité est préchargée en arrière-plan ; les suggestions de recherche s'affichent aussitôt avec la dernière lecture de la scolarité, rafraîchie en arrière-plan.
- Dispositif : les interrupteurs « Liste d'attente (n) » et « Autres situations (n) » sont sur la même ligne (retour à la ligne seulement si l'écran est étroit) ; leurs libellés, et celui des interrupteurs de chaque ligne du tableau, ne se coupent plus en deux. Correction à 320 px : la liste d'informations de l'établissement ne fait plus déborder la page (libellé au-dessus de la valeur, valeurs longues à la ligne).
- Accueil : le bouton « Tous les dispositifs » passe en bouton principal (bleu plein), comme les deux boutons « Rechercher » : chaque bloc n'a qu'une action.
- Page « Tous les dispositifs » : la colonne « Places libres » est retirée (l'information est déjà dans la pastille d'occupation de la colonne « Effectif », qui reste triable).
- Calendrier de saisie des dates : la fenêtre suit son champ quand la page défile (position recalculée au défilement et au redimensionnement ; masquée si le champ sort de l'écran) au lieu de rester fixée là où elle s'est ouverte.
- La page « Établissements par secteur » devient « Tous les dispositifs » (titre, bouton d'accès de l'accueil, boutons de retour) et gagne une barre de recherche (nom, commune, UAI, type) qui s'ajoute aux filtres et se conserve au retour depuis un dispositif.
- Démarrage : si la table des affectations a été renommée (identifiant différent de `Scolarite`), le widget la reconnaît à ses colonnes (`Affectation`, `Date_effet`, `Niveau_saisi`, `Situation`, `Liste_d_attente`) et lit comme écrit dans cette table. Les autres tables (`Individus`, `Etablissements_avec_ULIS`…) restent cherchées par leur nom.
- Démarrage : si la colonne « élève » de `Scolarite` (`Eleve_Identite_`) a été renommée, le widget reprend l'unique colonne de données qui référence `Individus` ; sinon, le message d'erreur liste les colonnes présentes de la table pour faciliter le diagnostic.
- Audit sécurité et accessibilité (`docs/audit-securite-accessibilite.md`). Accessibilité : hiérarchie des titres corrigée (sections en `h2`, titres d'alerte en paragraphe, titre de modale en `h2`), `aria-controls` orphelin retiré. Sécurité : suppression du dernier `innerHTML` (le garde-fou de chargement devient `src/garde.js`, ce qui permet une CSP stricte), `referrer` désactivé ; politique CSP proposée et testée mais non activée.
- Résultats de recherche d'élèves : le bouton « Affecter » est retiré (doublon avec le dossier) ; il ne reste que « Dossier », d'où l'on affecte.
- Mise en page : plus d'espace entre le texte d'introduction de l'accueil et les deux blocs de recherche, et avant le pied de page. Correction : le libellé du bouton retour du dossier et celui de « Supprimer cette affectation » (formulaire) étaient réduits à leur icône.
- Dossier : « Affecter » harmonisé avec « Modifier » et « Ajouter une note » (bouton secondaire avec icône ; épingle de lieu du DSFR, feuille `icons-map` ajoutée).
- Toute écriture est confirmée : en plus des modifications, les ajouts (nouvelle affectation, nouvelle note, création de fiche) ouvrent une fenêtre de récapitulatif (« Oui, ajouter » / « Revenir au formulaire ») avant d'écrire dans Grist. Les suppressions et le basculement en liste d'attente avaient déjà leur confirmation.
- En-tête : titre « 🫏 ANESH » cliquable (retour à l'accueil, avec la garde de sortie si une modification de dossier est en cours), acronyme développé visible, plus d'espace avant le contenu.
- Pied de page discret : « ANESH is not AGESH · Licence ouverte 2.0 · CDOEA 31 » (le slogan « Aucune Notification d'Élève Sans Historique » est en infobulle).
- Dossier incomplet : l'absence de niveau est signalée pour les élèves réellement affectés (établissement renseigné, hors liste d'attente) : dans les résultats, le dossier et le panneau du dispositif.
- Dossier : la liste des notes a une colonne « Action » avec un crayon (modifier le texte et le type, avec confirmation avant → après) et une corbeille (confirmation, annulable dans le panneau Activité de Grist), comme les affectations. Le bouton « Affecter » est placé juste sous l'historique des affectations.
- Harmonisation des boutons d'action : crayon et corbeille de fin de ligne produits par une même fonction (affectations et notes) ; « Affecter » toujours en bouton principal ; boutons « retour » tous en tertiaire petit avec flèche.
- Suggestions de recherche d'élève (accueil et « Ajouter un élève ») : la scolarité actuelle est affichée en condensé après l'identité (« Établissement · niveau · situation », ou « sans affectation en cours »).
- Dossier : le bouton « Modifier » est placé après les informations de la fiche, juste avant l'historique des affectations ; « Ajouter une note » est placé sous le tableau des notes (son formulaire s'ouvre dessous).
- Page par secteur : menu et colonne « ERS » homogènes, au format « Secteur 011 (NOM Prénom) » (code sur 3 chiffres extrait de `Secteur_ERS`, nom de l'ERSH), un seul choix par secteur d'ERS, toujours limité au secteur choisi.
- Pop-up d'accueil : le mode de consultation est lu dans le paramètre `readonly` que Grist ajoute à l'adresse du widget (`true` en vue intégrée `?embed=true` et pour les lecteurs, `false` pour les éditeurs) ; la table `Droits_widget` ne sert plus que de repli si le paramètre est absent.
- Dossier : bouton « Ajouter une note » (texte libre, type facultatif si la colonne `Type` de `Notes_sur_l_eleve` est un choix). La note est écrite dans `Notes_sur_l_eleve`, liée à l'élève par `Individu` (et par `Eleve` si la clé le permet) ; les colonnes calculées ne sont jamais écrites ; `Cree_le` est renseignée si elle est modifiable. Le bouton n'apparaît que si la table de notes existe.
- Interface : passage au vouvoiement de tous les textes affichés (aides, messages d'erreur, infobulles, pop-ups, message de secours), conformément à l'usage dans l'administration.
- Pop-up d'accueil réservé à ceux qui consultent : le widget lit la table `Droits_widget` (une ligne), que les règles d'accès Grist ne rendent lisible qu'aux éditeurs ; s'il y trouve une ligne, le pop-up n'est pas affiché. Table absente ou illisible : le pop-up s'affiche pour tout le monde.
- Pop-up d'accueil « Avant de commencer » : demande de ne pas utiliser les flèches précédent / suivant du navigateur (utiliser les boutons « Revenir à… »). Affichée une fois par session de navigation (`sessionStorage`).
- Dispositif : un interrupteur « Liste d'attente » par élève permet de le mettre en liste d'attente ou de le remettre présent directement depuis la liste. Une fenêtre de confirmation précède l'écriture (`UpdateRecord` de `Liste_d_attente` sur sa ligne d'affectation en cours) ; « Non » ne change rien. Les élèves dans une autre situation (sortie, exclusion…) n'ont pas d'interrupteur.
- Occupation des dispositifs : pastille avec texte et couleur (vert « n places libres », jaune « Presque plein · n libre » dès 85 % de `Places_max`, orange « Plein », rouge « Dépassement +n »), dans la page par secteur et dans les effectifs du dispositif. Page par secteur : colonne « Places libres » triable, filtre « Occupation », places libres dans le récapitulatif.
- Accueil : le bloc « Par secteur » est aligné sous la recherche d'établissement (colonne de droite).
- Effectifs et listes d'élèves par établissement : « présent » suit désormais la colonne `Actuellement_en_ULIS` de Scolarite (la même que celle qui alimente `Effectif` dans Etablissements_avec_ULIS), au lieu d'un recalcul à partir de la date et de la situation, qui comptait des dizaines d'élèves en trop. Sans cette colonne, l'ancien calcul sert de secours.
- Dispositif : deux bascules distinctes, « Liste d'attente (n) » et « Autres situations (n) », à la place de l'option unique ; les compteurs portent sur tout l'établissement.
- Page par secteur : le menu « Secteur » ne propose que 1, 2 et 3 (le numéro est lu dans `Secteur_CDOEA`, à défaut dans sa colonne calculée puis dans `Secteur`) ; le menu « ERS » ne propose que les ERS du secteur choisi et se remet sur « Tous » si l'ERS retenu n'en fait plus partie. Une ligne signale les établissements dont le numéro de secteur n'est pas reconnu.
- Page par secteur : le filtre « Secteur » propose tous les secteurs (repli sur `Secteur_ERS_Secteurs_CDOEA` quand `Secteur_CDOEA` est vide, idem pour l'ERS) et le filtre « Type » propose toujours École, Collège et Lycée.
- Page par secteur : tri par clic sur chaque colonne (un second clic inverse l'ordre), conservé au retour depuis un dispositif.
- Coordonnées du dispositif : colonnes réelles d'`Etablissements_ERS` (code postal, téléphone, courriel du secteur et de l'ERSH).
- Anti-cache : les modules et la feuille de style sont appelés avec `?v=…` (à changer à chaque publication, dans `index.html` et dans les imports de `src/app.js`) ; un message s'affiche si le widget ne se charge pas.
- Dispositif : bouton « Ajouter un élève » (recherche d'une fiche avec suggestions, ou création d'une fiche) ; l'élève arrive sur le formulaire de nouvelle affectation prérempli avec l'établissement, niveaux limités à son type.
- Accueil : nouvelle page « Établissements par secteur », avec filtres type, secteur, ERS et fins de droits ; effectifs sur places et alertes par établissement ; le retour depuis un dispositif conserve les filtres.
- Alertes de fin de droits : panneau récapitulatif, pastilles avec texte (« Échue depuis 5 mois », « Fin dans 2 mois ») dans le dispositif, le dossier et la page par secteur ; bouton « Trier par fin de droits ». Seuil : 120 jours (`FIN_DROITS_ALERTE_JOURS`).
- Dossiers incomplets : pastille et alerte quand le nom, le prénom ou la date de naissance manque (résultats, dispositif, dossier).
- Création de fiche : message d'erreur explicite si la fiche créée est introuvable à la relecture (au lieu d'un faux « Fiche créée »).
- Accueil refait : deux recherches côte à côte, « Un élève » et « Un établissement avec ULIS » (nom, commune ou UAI, avec suggestions). Un clic sur une suggestion mène directement au dossier de l'élève ou à la page du dispositif ; Entrée ou « Rechercher » affiche la liste des résultats (plusieurs établissements : liste de boutons).
- Nouvelle page « Dispositif ULIS » : effectifs (présents sur `Places_max`, liste d'attente, autres situations ; l'`Effectif` calculé par Grist est signalé s'il diffère du décompte), informations de l'établissement lues dans `Etablissements_avec_ULIS` (`Uai`, `Commune`, `Secteur_ERS`, `Uai_ERSH`, `Secteur_CDOEA`, `Uai_Coordo_CDOEA`, `Nombre_de_dispositifs`, `Ouverture`) et coordonnées (adresse, code postal, téléphone, courriel, directeur) cherchées dans la table liée par `Uai` (`Etablissements_ERS`) quand ces colonnes existent ; liste des élèves présents (ligne de scolarité en cours = cet établissement, situation « En ULIS », hors liste d'attente) triable par nom, classe, première notification et fin de droits. Un clic sur un élève ouvre son dossier, avec retour au dispositif (tri conservé).
- Le nom de l'établissement est cliquable (ouvre le dispositif) dans les résultats, l'historique du dossier et la liste des affectations ; le bouton de retour porte le nom de la page d'origine.
- Badge « Liste d'attente » à côté de « En cours » sur la ligne actuelle (dossier, affectations, résultats).
- Dossier ouvert depuis l'accueil ou le dispositif : bouton de retour adapté (« Revenir à l'accueil », « Revenir au dispositif »).
- Dossier : un seul bouton « Modifier » ouvre tous les champs modifiables à la fois ; une seule barre « Valider / Annuler » (collante, en bas de l'écran) et une seule fenêtre de confirmation « avant → après » listant les seuls champs réellement saisis (un champ laissé tel quel n'est ni normalisé ni écrit) ; une seule écriture dans `Individus`. Remplace les crayons par champ.
- Dossier : fenêtre « Abandonner les modifications en cours ? » dès qu'on quitte la page (retour, Affecter) ou qu'on annule avec des champs modifiés ; avertissement du navigateur à la fermeture de l'onglet.
- Documentation : schéma de la navigation complète (`docs/navigation.md`).
- Dossier modifiable (champs : nom, prénom, date de naissance, adresse, code postal et commune, représentants légaux, début et fin de notification). Validation des saisies, confirmation « avant → après » avant toute écriture, blocage si le changement créerait un doublon de clé, avertissement sur la clé de rapprochement pour l'état civil. Les coordonnées et dates de notification s'écrivent dans les colonnes `*_manuel` (prioritaires sur la MDPH ; champ vidé = retour à la valeur MDPH). Suggestions BAN dans l'édition de l'adresse (voir Confidentialité).
- Affectations : « Modifier » devient un crayon, à côté de la corbeille.

- Dossier : page dédiée (comme la création), accessible depuis les résultats et depuis l'étape 3, avec retour vers la page d'origine.
- Tableaux : retour à la ligne autorisé dans les cellules et remplissage réduit, pour tout afficher sans défilement horizontal, même dans un widget étroit.

- Navigation : le bouton qui ramène à la liste des résultats s'appelle « Revenir à la page de résultats » (étape 3 et page de création) au lieu de « Précédent : Choisir ou créer la fiche de l'élève ».

- Création d'une fiche : page dédiée (hors étapes), avec affichage des fiches proches pendant la saisie et blocage du bouton Créer si la fiche existe déjà (même clé).
- Résultats : colonne « Affectation en cours » (établissement, niveau, situation) entre la date de naissance et les actions.
- Infobulles au survol de tous les boutons d'action et champs de saisie.

- Affectations : corbeille à la fin de chaque ligne, après « Modifier » (même fenêtre de confirmation) ; fenêtres de confirmation redessinées (entête, tableau avant → après, pied de page) ; boutons d'action de ligne côte à côte.

- Modification d'une affectation : fenêtre de confirmation listant seulement les champs changés (« avant → après ») ; aucune écriture si rien n'a changé. Les nouvelles affectations s'enregistrent sans fenêtre.

- Modification d'une affectation : bouton « Supprimer cette affectation », avec fenêtre de confirmation (la ligne visée est rappelée, Échap ou « Non, garder » annulent) ; l'annulation reste possible via le panneau Activité de Grist.

- Étape 3 : bouton « Dossier » aligné avec l'identité. Performance : lectures de tables mémorisées 30 s (vidées à chaque écriture), partagées entre recherche, dossier et affectation, et lancées en parallèle pour le dossier.

- Étape 3 : bouton « Dossier » sous le nom de l'élève (ouvre ou referme le dossier). Libellés d'établissement : une parenthèse répétée en fin de nom (« (TOULOUSE) (Toulouse) ») est réduite à une seule.

- Dossier : notes de l'élève (`Notes_sur_l_eleve`) sous l'historique des affectations (la case NB n'est pas affichée : elle ne servait qu'à signaler une note dans la table).

- Recherche : un seul champ (nom, prénom, date de naissance, dans n'importe quel ordre) ; suggestions « NOM Prénom, né(e) le … » dès 2 caractères ; un clic mène à la page des résultats avec cette fiche et les boutons Affecter / Dossier ; création pré-remplie si rien ne correspond.
- Résultats : boutons « Affecter » et « Dossier » ; le dossier (lecture seule) montre état civil, coordonnées, notification ULIS et historique des affectations. Les données personnelles ne s'affichent qu'à l'écran.

- Établissements : plus de parenthèse en double après le nom (la commune n'est ajoutée que si le libellé n'a pas déjà de parenthèse) ; type déduit du libellé si la colonne `Type` n'est pas reconnue ; message explicite quand le type reste inconnu.

- Champs date : calendrier intégré qui s'ouvre au clic n'importe où dans le champ (le sélecteur natif n'est pas ouvrable par programme dans l'iframe de Grist) ; mois et année au choix, « Aujourd'hui » et « Effacer », Échap pour fermer.

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
