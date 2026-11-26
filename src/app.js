import { statutsEleves, banUrl, cellText, cle, filterOptions, formatDateFr, isInvalidCell, isFormulaError, elevesExclus, isoToSec, ligneActuelle, niveauxPour, typeEtab, libelleEtab, norm, normSearch, parseBan, searchIndividus, rechercheLibre, libelleEleve, secToIso, tableToRows, toIndividus, elevesDuDispositif, trierEleves, effectifsParEtab, alerteFinDroits, libelleAlerteFin, infosManquantes, occupation } from './lib.js?v=20261126l';
import { attachSuggest } from './suggest.js?v=20261126l';
import { initAccessibilite } from './accessibilite.js?v=20261126l';
import { activerCalendriers } from './calendrier.js?v=20261126l';
document.documentElement.dataset.pret = '1'; // modules chargés : sinon index.html affiche un message d'aide

activerCalendriers(); // clic n'importe où dans un champ date : calendrier intégré (showPicker est refusé dans l'iframe Grist)

/* ------------------------------------------------------------------ */
/* Configuration : noms des tables et colonnes du document Grist       */
/* ------------------------------------------------------------------ */
const T_INDIVIDUS = 'Individus';
let T_SCOLARITE = 'Scolarite'; // identifiant de la table des affectations ; repris par détection si la table a été renommée
const COL = {
  eleve: 'Eleve_Identite_', // référence Scolarite -> Individus
  affectation: 'Affectation', // référence vers Etablissements_avec_ULIS (colonne de données)
  dateEffet: 'Date_effet',
  niveau: 'Niveau_saisi', // Choice
  situation: 'Situation', // Choice
  attente: 'Liste_d_attente', // Bascule
};
const SITUATION_PAR_DEFAUT = 'En ULIS';
const COL_ACTUEL = 'Actuellement_en_ULIS'; // formule Grist de Scolarite : « en ULIS aujourd'hui »
// Alerte « fin de droits » : une fin passée est signalée en rouge, une fin dans les N prochains jours en orange.
// 120 jours (≈ 4 mois) laissent le temps de préparer un renouvellement ; à ajuster ici.
const FIN_DROITS_ALERTE_JOURS = 120;
// Occupation d'un dispositif : « presque plein » dès 85 % de la capacité (`Places_max`) ; plein à 100 % ; dépassement au-delà.
const SEUIL_PRESQUE_PLEIN = 0.85;
// Niveaux proposés selon le type de l'établissement choisi (colonne `Type` de Etablissements_avec_ULIS :
// ECO, CLG, LYC ou Autre). Un type absent de cette table (« Autre », vide) laisse tous les niveaux.
// Seuls les niveaux qui existent dans les choix de `Niveau_saisi` sont proposés.
const COL_TYPE_ETAB = 'Type';
const NIVEAUX_PAR_TYPE = {
  ECO: ['GS', 'CP', 'CE1', 'CE2', 'CM1', 'CM2'],
  CLG: ['6G', '5G', '4G', '3G'],
  LYC: ['Lycée', '2GT', '2G', '2PRO', '1PRO', 'TPRO', '3PM', 'CAP1', 'CAP2', 'CAP3', 'BTS-SE-1', 'A2D'],
};
const LIBELLE_TYPE = { ECO: 'une école', CLG: 'un collège', LYC: 'un lycée' };
const MANUEL_TYPES = ['Text', 'Date', 'Int', 'Numeric', 'Bool', 'Choice']; // types de colonnes `*_manuel` gérés
// Ordre d'affichage des champs facultatifs (les autres colonnes `*_manuel` suivent, dans l'ordre du tableau).
const MANUEL_ORDRE = [/debut/i, /fin/i, /repr|legal/i, /adresse/i, /^cp|postal/i, /commune/i];
const rangManuel = (c) => {
  const i = MANUEL_ORDRE.findIndex((r) => r.test(c.colId));
  return i < 0 ? MANUEL_ORDRE.length : i;
};
const MANUEL_MULTILIGNE = /adresse|repr|legal/i; // champs texte affichés sur plusieurs lignes
// Suggestions d'adresses normées (Base Adresse Nationale, Géoplateforme de l'IGN). Le texte tapé dans le champ
// adresse est envoyé à ce service public : passer à `false` pour désactiver sans toucher au reste.
const ADRESSE_SUGGESTIONS = true;

const STEPS = [
  { title: 'Accueil', next: "Choisir ou créer la fiche de l'élève" },
  { title: "Choisir ou créer la fiche de l'élève", next: 'Saisir ou modifier une affectation' },
  { title: 'Saisir ou modifier une affectation', next: null },
];

/* ------------------------------------------------------------------ */
/* État                                                                */
/* ------------------------------------------------------------------ */
const state = {
  step: 1,
  champsManuels: [], // colonnes `*_manuel` d'Individus proposées à la création
  searched: false, // une recherche a été faite : l'étape 2 est atteignable
  individus: [],
  etabs: [], // [{id, label, type}]
  etabType: new Map(), // id d'établissement -> type (ECO, CLG, LYC…)
  etabLabel: new Map(),
  niveaux: [],
  situations: [],
  results: { total: 0, rows: [] },
  query: { nom: '', prenom: '' },
  eleve: null,
  scol: [],
  editingId: null, // null = création
  editingLigne: null,
};

/* ------------------------------------------------------------------ */
/* Utilitaires DOM                                                     */
/* ------------------------------------------------------------------ */
const $ = (sel) => document.querySelector(sel);

/** Crée un élément ; les textes passent par textContent / createTextNode (jamais innerHTML). */
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function notify(kind, text) {
  const box = $('#notice');
  box.replaceChildren(
    h('div', { class: `fr-alert fr-alert--${kind} fr-alert--sm fr-mb-2w`, role: kind === 'error' ? 'alert' : 'status' }, h('p', {}, text)),
  );
}
const clearNotice = () => $('#notice').replaceChildren();

function setFieldError(inputId, message) {
  const input = $(`#${inputId}`);
  const group = input.closest('.fr-input-group, .fr-select-group');
  const errId = `${inputId}-error`;
  group.classList.add(group.classList.contains('fr-select-group') ? 'fr-select-group--error' : 'fr-input-group--error');
  group.append(h('p', { id: errId, class: 'fr-error-text' }, message));
  input.setAttribute('aria-describedby', errId);
  input.setAttribute('aria-invalid', 'true');
}
function clearFieldErrors(root) {
  root.querySelectorAll('.fr-error-text').forEach((e) => e.remove());
  root.querySelectorAll('.fr-input-group--error, .fr-select-group--error').forEach((g) => {
    g.classList.remove('fr-input-group--error', 'fr-select-group--error');
  });
  root.querySelectorAll('[aria-invalid]').forEach((i) => {
    i.removeAttribute('aria-invalid');
    i.removeAttribute('aria-describedby');
  });
}

/** Une étape est atteignable si ce qu'elle suppose existe : une recherche faite (2), un élève choisi (3). */
function reachable(step) {
  if (step === 1) return true;
  if (step === 2) return state.searched;
  return Boolean(state.eleve);
}

function navButton(target, direction) {
  const prev = direction === 'prev';
  return h(
    'button',
    {
      type: 'button',
      class: `fr-btn fr-btn--tertiary fr-btn--sm fr-btn--icon-${prev ? 'left' : 'right'} fr-icon-arrow-${prev ? 'left' : 'right'}-s-line`,
      disabled: !reachable(target),
      title: prev ? (target === 2 ? 'Revenir à la liste des fiches trouvées par la dernière recherche' : 'Revenir à l\'étape précédente') : 'Passer à l\'étape suivante',
      onclick: () => {
        clearNotice();
        goto(target);
      },
    },
    prev && target === 2 ? 'Revenir à la page de résultats' : `${prev ? 'Précédent' : 'Suivant'} : ${STEPS[target - 1].title}`,
  );
}

function renderStepper() {
  const n = state.step;
  const s = STEPS[n - 1];
  if (n === 1) {
    $('#stepper').replaceChildren(
      h(
        'div',
        { class: 'fr-stepper' },
        h('h1', { class: 'fr-stepper__title' }, 'Accueil'),
        h('p', { class: 'fr-stepper__details' }, "Recherchez un élève pour consulter son dossier ou saisir son affectation, ou un établissement pour voir son dispositif ULIS."),
      ),
      ...(reachable(2) ? [h('nav', { 'aria-label': 'Navigation entre les étapes', class: 'step-nav fr-mb-2w' }, navButton(2, 'next'))] : []),
    );
    return;
  }
  $('#stepper').replaceChildren(
    h(
      'div',
      { class: 'fr-stepper' },
      h('h1', { class: 'fr-stepper__title' }, h('span', { class: 'fr-stepper__state' }, `Étape ${n} sur ${STEPS.length}`), s.title),
      h('div', { class: 'fr-stepper__steps', 'data-fr-current-step': n, 'data-fr-steps': STEPS.length }),
      s.next ? h('p', { class: 'fr-stepper__details' }, h('span', { class: 'fr-text--bold' }, 'Étape suivante : '), s.next) : null,
    ),
    h(
      'nav',
      { 'aria-label': 'Navigation entre les étapes', class: 'step-nav fr-mb-2w' },
      n > 1 ? navButton(n - 1, 'prev') : null,
      n < STEPS.length ? navButton(n + 1, 'next') : null,
    ),
  );
}

/** Affiche une seule page à la fois (étapes 1 à 3, création, dossier). */
function masquerPages() {
  if (state.edition && state.edition.fermer) { // la garde de sortie est déjà passée : on referme la saisie hors dossier
    const ed = state.edition;
    state.edition = null;
    ed.fermer();
  }
  for (let i = 1; i <= STEPS.length; i += 1) $(`#step-${i}`).hidden = true;
  $('#step-create').hidden = true;
  $('#step-dossier').hidden = true;
  $('#step-dispo').hidden = true;
  $('#step-secteur').hidden = true;
  $('#step-exclus').hidden = true;
  $('#step-voeux').hidden = true;
  $('#step-ajout').hidden = true;
  $('#step-ers').hidden = true;
}

function goto(step, { focus = true } = {}) {
  if (step === 1 && state.ers) return openErsAccueil({ focus });
  if (state.edition) return gardeSortie(() => goto(step, { focus }));
  state.step = step;
  masquerPages();
  $(`#step-${step}`).hidden = false;
  renderStepper();
  if (focus) $(`#h-step-${step}`).focus();
}

/* ------------------------------------------------------------------ */
/* Chargement des données et des métadonnées Grist                     */
/* ------------------------------------------------------------------ */
async function loadMeta() {
  const [tables, cols] = await Promise.all([
    grist.docApi.fetchTable('_grist_Tables'),
    grist.docApi.fetchTable('_grist_Tables_column'),
  ]);
  const tableIdById = new Map(tables.id.map((id, i) => [id, tables.tableId[i]]));
  const colById = new Map();
  cols.id.forEach((id, i) => {
    colById.set(id, {
      colId: cols.colId[i],
      tableId: tableIdById.get(cols.parentId[i]),
      type: cols.type[i],
      visibleCol: cols.visibleCol[i],
      widgetOptions: cols.widgetOptions[i],
      label: cols.label ? cols.label[i] : '',
      isFormula: Boolean(cols.isFormula && cols.isFormula[i]),
      pos: cols.parentPos ? cols.parentPos[i] : i,
    });
  });
  const need = (tableId, colId) => {
    const c = [...colById.values()].find((x) => x.tableId === tableId && x.colId === colId);
    if (!c) {
      const presentes = [...colById.values()].filter((x) => x.tableId === tableId && !x.colId.startsWith('gristHelper_')).map((x) => x.colId);
      throw new Error(`Colonne introuvable : ${tableId}.${colId}${presentes.length ? ` (colonnes présentes : ${presentes.join(', ')})` : ` (la table ${tableId} est introuvable ou vide de colonnes)`}`);
    }
    return c;
  };
  const choicesOf = (c) => {
    try {
      return JSON.parse(c.widgetOptions || '{}').choices || [];
    } catch {
      return [];
    }
  };

  for (const col of ['Nom', 'Prenom', 'Date_de_naissance', 'Cle']) need(T_INDIVIDUS, col);
  // Table des affectations renommée : on la reconnaît à ses colonnes (une seule table doit toutes les avoir).
  const colonnesDe = (tid) => new Set([...colById.values()].filter((x) => x.tableId === tid).map((x) => x.colId));
  if (![...colById.values()].some((x) => x.tableId === T_SCOLARITE)) {
    const signature = [COL.affectation, COL.dateEffet, COL.niveau, COL.situation, COL.attente];
    const candidates = [...new Set([...colById.values()].map((x) => x.tableId))].filter((tid) => tid && signature.every((c) => colonnesDe(tid).has(c)));
    if (candidates.length === 1) T_SCOLARITE = candidates[0];
  }
  // Colonne « élève » de Scolarite : si elle a été renommée, on reprend l'unique colonne de données qui référence Individus.
  if (![...colById.values()].some((x) => x.tableId === T_SCOLARITE && x.colId === COL.eleve)) {
    const candidates = [...colById.values()].filter((x) => x.tableId === T_SCOLARITE && x.type === `Ref:${T_INDIVIDUS}` && !x.isFormula);
    if (candidates.length === 1) COL.eleve = candidates[0].colId;
  }
  for (const col of Object.values(COL)) need(T_SCOLARITE, col);

  // Champs facultatifs de la création d'un élève : colonnes de données d'Individus finissant par `_manuel` ou `_manuelle`.
  state.champsManuels = [...colById.values()]
    .filter((c) => c.tableId === T_INDIVIDUS && /_manuel(le)?$/i.test(c.colId) && !c.isFormula && MANUEL_TYPES.includes(c.type))
    .sort((a, b) => rangManuel(a) - rangManuel(b) || a.pos - b.pos)
    .map((c) => ({ colId: c.colId, type: c.type, label: prettyLabel(c), choices: choicesOf(c) }));
  renderManualFields();

  state.niveaux = choicesOf(need(T_SCOLARITE, COL.niveau));
  state.situations = choicesOf(need(T_SCOLARITE, COL.situation));

  const aff = need(T_SCOLARITE, COL.affectation);
  if (!aff.type.startsWith('Ref:')) throw new Error(`${T_SCOLARITE}.${COL.affectation} n'est pas une colonne Référence`);
  const refTable = aff.type.slice(4);
  state.etabTable = refTable;
  state.colById = colById;
  state.etabCols = [...colById.values()].filter((c) => c.tableId === refTable).sort((a, b) => a.pos - b.pos);
  const visible = colById.get(aff.visibleCol)?.colId;
  const t = await lireTable(refTable); // mise en mémoire : la page « Tous les dispositifs » la réutilise sans nouvel appel
  const etabs = t.id.map((id, i) => {
    const base = visible && t[visible] ? cellText(t[visible][i]) : `#${id}`;
    const commune = t.Commune ? cellText(t.Commune[i]) : '';
    const label = libelleEtab(base, commune);
    const brut = t[COL_TYPE_ETAB] ? cellText(t[COL_TYPE_ETAB][i]).trim() : '';
    return { id, type: typeEtab(brut, label), typeBrut: brut, label };
  });
  etabs.sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  state.etabs = etabs;
  state.etabLabel = new Map(etabs.map((e) => [e.id, e.label]));
  state.etabType = new Map(etabs.map((e) => [e.id, e.type]));
  state.etabTypeBrut = new Map(etabs.map((e) => [e.id, e.typeBrut]));
}

/**
 * Lecture d'une table avec mémoire de 30 s : fetchTable ramène TOUTES les colonnes (formules comprises) de TOUTES les
 * lignes, ce qui est le gros du temps d'attente. Les requêtes identiques en cours sont partagées ; toute écriture vide la mémoire.
 */
const CACHE_MS = 30000;
const cache = new Map();
function lireTable(tableId) {
  const hit = cache.get(tableId);
  if (hit && Date.now() - hit.ts < CACHE_MS) return hit.promise;
  const promise = grist.docApi.fetchTable(tableId);
  cache.set(tableId, { ts: Date.now(), promise });
  promise.catch(() => cache.delete(tableId)); // un échec n'est pas mémorisé
  return promise;
}
const viderCache = () => cache.clear();

/**
 * Lecture « d'abord le connu » pour les données de confort (scolarité affichée dans les suggestions de recherche) : on
 * répond tout de suite avec la dernière lecture, même ancienne, et on la rafraîchit en arrière-plan si elle a plus de 30 s.
 * Sans lecture préalable, comportement identique à lireTable.
 */
function lireTableRapide(tableId) {
  const hit = cache.get(tableId);
  if (!hit) return lireTable(tableId);
  if (Date.now() - hit.ts >= CACHE_MS) {
    const frais = grist.docApi.fetchTable(tableId);
    frais.then(
      () => cache.set(tableId, { ts: Date.now(), promise: frais }),
      () => {}, // échec silencieux : on garde la lecture précédente
    );
  }
  return hit.promise;
}

async function refreshIndividus() {
  state.individus = toIndividus(await lireTable(T_INDIVIDUS));
}

const triScol = (a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id;

/**
 * Toutes les lignes de Scolarite. Si la table a la colonne `Actuellement_en_ULIS` (formule de Grist, la même que celle de
 * `Effectif` dans Etablissements_avec_ULIS), `actuel` la reprend : c'est elle qui décide qui est présent dans un dispositif.
 */
function lignesDe(tScol) {
  const actuel = tScol[COL_ACTUEL] ? new Map(tScol.id.map((id, i) => [id, tScol[COL_ACTUEL][i] === true])) : null;
  return tableToRows(tScol, Object.values(COL)).map((r) => ({ eleve: r[COL.eleve], ...mapLigne(r), ...(actuel ? { actuel: actuel.get(r.id) === true } : {}) }));
}

function mapLigne(r) {
  return {
    id: r.id,
    date: secToIso(r[COL.dateEffet]),
    dateBrute: typeof r[COL.dateEffet] === 'number' ? '' : cellText(r[COL.dateEffet]), // texte non reconnu comme date
    affectation: typeof r[COL.affectation] === 'number' ? r[COL.affectation] : 0,
    affectationInvalide: isInvalidCell(r[COL.affectation]) ? cellText(r[COL.affectation]) : '', // texte sans correspondance
    niveau: cellText(r[COL.niveau]),
    situation: cellText(r[COL.situation]),
    attente: r[COL.attente] === true,
  };
}

/** Lignes de Scolarite d'un élève, de la plus récente à la plus ancienne. */
function lignesScolarite(t, eleveId) {
  return lignesDe(t).filter((l) => l.eleve === eleveId).sort(triScol);
}

/** Affectation en cours de plusieurs élèves en une seule passe : Map(id d'élève -> ligne en cours). */
function enCoursDe(t, ids) {
  const groupes = new Map();
  for (const l of lignesDe(t)) {
    if (!ids.has(l.eleve)) continue;
    if (!groupes.has(l.eleve)) groupes.set(l.eleve, []);
    groupes.get(l.eleve).push(l);
  }
  const today = new Date().toISOString().slice(0, 10);
  return new Map([...groupes].map(([e, l]) => [e, ligneActuelle(l.sort(triScol), today)]));
}

/** Élèves exclus parmi `ids` : Map(id d'élève -> { ligne, derniere }), `derniere` = dernière affectation connue. */
function exclusDe(t, ids) {
  const lignes = lignesDe(t).filter((l) => ids.has(l.eleve));
  return new Map(elevesExclus(lignes, new Date().toISOString().slice(0, 10)).map((x) => [x.eleve, x]));
}

async function refreshScolarite(eleveId = state.eleve.id) {
  state.scol = lignesScolarite(await lireTable(T_SCOLARITE), eleveId);
}

/* ------------------------------------------------------------------ */
/* Étape 1 : recherche                                                 */
/* ------------------------------------------------------------------ */
async function lancerRecherche(query, { ouvrir = null } = {}) {
  clearNotice();
  clearFieldErrors($('#form-search'));
  if (norm(query).length < 2 && !/\d{4}/.test(query)) {
    setFieldError('q', 'Saisissez au moins 2 lettres du nom ou du prénom, ou une année de naissance.');
    $('#q').focus();
    return;
  }
  try {
    await refreshIndividus(); // données à jour : d'autres utilisateurs peuvent avoir créé des fiches
  } catch (err) {
    notify('error', `Lecture d'Individus impossible : ${err.message}`);
    return;
  }
  state.query = { texte: query };
  state.searched = true;
  state.eleve = null; // nouvelle recherche : l'élève précédent n'est plus sélectionné
  $('#form-scol').hidden = true;
  state.results = rechercheLibre(state.individus, query);
  await renderResults();
  goto(2);
}

$('#form-search').addEventListener('submit', (e) => {
  e.preventDefault();
  lancerRecherche($('#q').value.trim());
});

/** Scolarité actuelle en condensé : « Établissement · niveau · situation », ou « sans affectation en cours ». */
function scolariteCondensee(l) {
  if (!l) return 'sans affectation en cours';
  const etab = typeof affectationCell(l) === 'string' && affectationCell(l) !== '—' ? affectationCell(l) : l.affectationInvalide || '';
  const texte = [etab, l.niveau, l.situation].filter(Boolean).join(' · ');
  return (texte || 'affectation en cours') + (l.attente ? " (liste d'attente)" : '');
}

/** « Exclu(e) » avec le dernier établissement connu, pour les listes de résultats. */
function texteExclu(x) {
  const etab = x.derniere ? state.etabLabel.get(x.derniere.affectation) || '' : '';
  return `exclu(e)${etab ? ` de ${etab}` : ''}`;
}

/** Suggestions d'élèves : « NOM Prénom, né(e) le … — scolarité actuelle ». */
async function suggestionsEleves(query) {
  const { rows } = rechercheLibre(state.individus, query, 8);
  let enCours = new Map();
  let exclus = new Map();
  try {
    const t = await lireTableRapide(T_SCOLARITE);
    const ids = new Set(rows.map((r) => r.id));
    enCours = enCoursDe(t, ids);
    exclus = exclusDe(t, ids);
  } catch {
    /* la scolarité est un confort : les suggestions restent utilisables sans elle */
  }
  return rows.map((r) => ({ value: String(r.id), label: `${libelleEleve(r)} — ${!enCours.get(r.id) && exclus.has(r.id) ? texteExclu(exclus.get(r.id)) : scolariteCondensee(enCours.get(r.id))}`, row: r }));
}

// Recherche prédictive : « NOM Prénom, né(e) le … — scolarité actuelle » dès 2 caractères ; un clic ouvre directement l'élève.
attachSuggest($('#q'), {
  minChars: 2,
  fetchItems: suggestionsEleves,
  onPick: (item) => {
    // Un clic sur une suggestion ouvre directement le dossier ; Entrée ou « Rechercher » affiche la liste des résultats.
    $('#q').value = `${item.row.nom} ${item.row.prenom}`;
    openDossier(item.row, 'accueil');
  },
});

/* ------------------------------------------------------------------ */
/* Étape 2 : choisir ou créer                                          */
/* ------------------------------------------------------------------ */
/** Pastilles de la ligne en cours : « En cours », et « Liste d'attente » si l'élève n'est pas encore affecté. */
function badgesEnCours(l) {
  return [
    h('p', { class: 'fr-badge fr-badge--success fr-badge--sm fr-badge--no-icon' }, 'En cours'),
    l.attente ? [' ', h('p', { class: 'fr-badge fr-badge--info fr-badge--sm fr-badge--no-icon', title: "L'élève est sur liste d'attente pour cet établissement (pas encore affecté)" }, "Liste d'attente")] : null,
  ];
}

/** Situation d'une ligne d'historique ; une exclusion porte une pastille rouge bien visible (texte, jamais la couleur seule). */
function celluleSituation(l) {
  if (/^exclu/i.test((l.situation || '').trim())) return h('p', { class: 'fr-badge fr-badge--error fr-badge--no-icon', title: "Cette ligne est une exclusion" }, l.situation.trim());
  return l.situation || '—';
}

/** Cellule « Affectation en cours » : établissement, puis niveau et situation en petit. */
function celluleEnCours(l, retour, exclu = null) {
  if (!l && exclu) {
    const d = exclu.derniere;
    const niveau = exclu.ligne.niveau || (d && d.niveau) || '';
    return [h('p', { class: 'fr-badge fr-badge--error fr-badge--sm fr-badge--no-icon' }, 'Exclu(e)'), d ? [h('br'), lienEtab(d, retour)] : null, niveau ? [h('br'), h('span', { class: 'fr-text--sm fr-hint-text' }, niveau)] : null];
  }
  if (!l) return '—';
  const detail = [l.niveau, l.situation].filter(Boolean).join(' · ');
  return [lienEtab(l, retour), detail || l.attente ? h('br') : null, detail ? h('span', { class: 'fr-text--sm fr-hint-text' }, detail) : null, l.attente ? [' ', h('p', { class: 'fr-badge fr-badge--info fr-badge--sm fr-badge--no-icon' }, "Liste d'attente")] : null];
}

async function renderResults() {
  const { total, rows } = state.results;
  const box = $('#results');
  if (total === 0) {
    box.replaceChildren(h('div', { class: 'fr-alert fr-alert--info fr-alert--sm' }, h('p', {}, 'Aucune fiche ne correspond : vous pouvez la créer.')));
    return;
  }
  let enCours = new Map();
  let exclus = new Map();
  try {
    const t = await lireTable(T_SCOLARITE);
    enCours = enCoursDe(t, new Set(rows.map((r) => r.id)));
    exclus = exclusDe(t, new Set(rows.map((r) => r.id)));
  } catch {
    /* l'affectation en cours est un confort : la liste reste utilisable sans elle */
  }
  const more = total > rows.length ? `${total} fiches correspondent, les ${rows.length} premières sont affichées : précisez la recherche.` : '';
  box.replaceChildren(
    h('p', { role: 'status' }, `${total} fiche${total > 1 ? 's' : ''} trouvée${total > 1 ? 's' : ''}. ${more}`),
    h(
      'div',
      { class: 'fr-table fr-table--no-caption' },
      h(
        'div',
        { class: 'fr-table__wrapper' },
        h(
          'div',
          { class: 'fr-table__container' },
          h(
            'div',
            { class: 'fr-table__content' },
            h(
              'table',
              {},
              h('caption', {}, 'Fiches trouvées dans Individus'),
              h('thead', {}, h('tr', {}, ['Nom', 'Prénom', 'Date de naissance', 'Affectation en cours', 'Action'].map((t) => h('th', { scope: 'col' }, t)))),
              h(
                'tbody',
                {},
                rows.map((r) =>
                  h(
                    'tr',
                    {},
                    h('td', {}, r.nom || '—'),
                    h('td', {}, r.prenom || '—'),
                    h('td', { class: 'nowrap' }, formatDateFr(r.ddn) || 'non renseignée', badgeIncomplet(r, enCours.get(r.id)) ? [h('br'), badgeIncomplet(r, enCours.get(r.id))] : null),
                    h('td', {}, celluleEnCours(enCours.get(r.id), retourResultats(), exclus.get(r.id) || null)),
                    h(
                      'td',
                      {},
                      h(
                        'ul',
                        { class: 'actions-ligne' },
                        h(
                          'li',
                          {},
                          h(
                            'button',
                            { class: 'fr-btn fr-btn--sm fr-btn--secondary', type: 'button', onclick: () => openDossier(r), 'aria-label': `Dossier de ${r.nom} ${r.prenom}`, title: "Consulter le dossier de cet élève (lecture seule) sans changer de page" },
                            'Dossier',
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

function prefillCreate() {
  const mots = String(state.query.texte || '').split(/\s+/).filter(Boolean);
  const dm = mots.map((m) => /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(m)).find(Boolean);
  const txt = mots.filter((m) => !/^[\d/.\-]+$/.test(m));
  $('#c-nom').value = txt[0] || '';
  $('#c-prenom').value = txt.slice(1).join(' ');
  $('#c-ddn').value = dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : '';
  state.champsManuels.forEach((f, i) => {
    const el = $(`#c-m-${i}`);
    if (f.type === 'Bool') el.checked = false;
    else el.value = '';
  });
}

/* ------------------------------------------------------------------ */
/* Page dédiée à la création d'une fiche                               */
/* ------------------------------------------------------------------ */
/** Sortie de la page de création : retour au dispositif si on venait de là, sinon aux résultats ou à l'accueil. */
function sortirCreation() {
  clearNotice();
  const c = state.createCtx;
  state.createCtx = null;
  if (c && state.dispo && state.dispo.etabId === c.etabId) {
    openDispositif(c.etabId, state.dispo.retour, { garder: true });
    return;
  }
  goto(state.searched ? 2 : 1);
}

/** `{ etabId }` : création depuis la page d'un dispositif ; l'affectation dans cet établissement est ensuite proposée. */
function gotoCreate(arg) {
  if (state.edition) return gardeSortie(() => gotoCreate(arg));
  state.createCtx = arg && typeof arg.etabId === 'number' ? { etabId: arg.etabId } : null;
  clearNotice();
  state.step = 0;
  masquerPages();
  $('#step-create').hidden = false;
  $('#stepper').replaceChildren(
    h(
      'div',
      { class: 'fr-stepper' },
      h('h1', { class: 'fr-stepper__title' }, 'Créer une fiche élève'),
      h('p', { class: 'fr-stepper__details' }, "Vérifiez d'abord qu'elle n'existe pas déjà : les fiches proches s'affichent pendant la saisie.", state.createCtx ? ` Ensuite, vous saisirez l'affectation de l'élève à ${state.etabLabel.get(state.createCtx.etabId) || 'cet établissement'}.` : ''),
    ),
    h(
      'nav',
      { 'aria-label': 'Navigation', class: 'step-nav fr-mb-2w' },
      h(
        'button',
        { type: 'button', class: 'fr-btn fr-btn--tertiary fr-btn--sm fr-btn--icon-left fr-icon-arrow-left-s-line', title: 'Quitter la création sans rien enregistrer', onclick: sortirCreation },
        state.createCtx ? 'Revenir au dispositif' : state.searched ? 'Revenir à la page de résultats' : `Précédent : ${STEPS[0].title}`,
      ),
    ),
  );
  prefillCreate();
  majProches();
  $('#c-nom').focus();
}

/** Fiches déjà présentes ressemblant à la saisie : évite de créer un doublon par inattention. */
function majProches() {
  const nom = $('#c-nom').value.trim();
  const prenom = $('#c-prenom').value.trim();
  const iso = $('#c-ddn').value;
  const zone = $('#create-proches');
  const envoyer = $('#form-create button[type="submit"]');
  const exact = nom && prenom && iso ? state.individus.find((r) => r.cle === cle(nom, prenom, iso)) : null;
  envoyer.disabled = Boolean(exact);
  if (norm(nom).length < 2) {
    zone.replaceChildren();
    return;
  }
  const { total, rows } = rechercheLibre(state.individus, `${nom} ${prenom}`.trim(), 5);
  if (total === 0) {
    zone.replaceChildren();
    return;
  }
  zone.replaceChildren(
    h(
      'div',
      { class: `fr-alert fr-alert--${exact ? 'error' : 'warning'} fr-mb-2w` },
      h('h3', { class: 'fr-alert__title' }, exact ? 'Cette fiche existe déjà' : `${total} fiche${total > 1 ? 's' : ''} proche${total > 1 ? 's' : ''} déjà dans Individus`),
      h('p', {}, exact ? 'Utilisez la fiche existante plutôt que d\'en créer une seconde.' : "Si c'est le même élève, utilisez sa fiche. Sinon, poursuivez la saisie."),
      h(
        'ul',
        { class: 'fr-mt-1w' },
        rows.map((r) =>
          h(
            'li',
            {},
            libelleEleve(r),
            ' ',
            h('button', { class: 'fr-btn fr-btn--sm fr-btn--secondary fr-ml-1w', type: 'button', title: "C'est le même élève : utiliser cette fiche existante au lieu d'en créer une", onclick: () => chooseEleve(r, { affecterA: state.createCtx ? state.createCtx.etabId : null }) }, 'Affecter'),
          ),
        ),
      ),
      total > rows.length ? h('p', { class: 'fr-text--sm' }, `Les ${rows.length} premières sont affichées : précisez le nom ou le prénom.`) : null,
    ),
  );
}
for (const id of ['c-nom', 'c-prenom', 'c-ddn']) $(`#${id}`).addEventListener('input', majProches);
$('#btn-cancel-create').addEventListener('click', sortirCreation);

$('#btn-show-create').addEventListener('click', gotoCreate);
$('#btn-back-1').addEventListener('click', backToSearch);
$('#btn-back-1b').addEventListener('click', backToSearch);

/* ------------------------------------------------------------------ */
/* Dossier : vue simplifiée en lecture seule                           */
/* ------------------------------------------------------------------ */
const T_NOTES = 'Notes_sur_l_eleve';

/** Notes de l'élève (Notes_sur_l_eleve), de la plus récente à la plus ancienne ; [] si la table est absente. */
async function lireNotes(row) {
  let t;
  try {
    t = await lireTable(T_NOTES);
  } catch {
    return [];
  }
  let garde = (i) => t.Individu && t.Individu[i] === row.id;
  if (!t.Individu) {
    // repli : la note pointe vers Eleves_ULIS, rapproché d'Individus par la clé
    const e = await lireTable('Eleves_ULIS');
    const ids = new Set(e.id.filter((_, i) => e.Cle && e.Cle[i] === row.cle));
    garde = (i) => ids.has(t.Eleve[i]);
  }
  return t.id
    .map((id, i) => ({
      id,
      i,
      date: typeof t.Cree_le?.[i] === 'number' ? secToIso(t.Cree_le[i]) : '',
      type: cellText(t.Type?.[i]),
      note: cellText(t.Note?.[i]),
    }))
    .filter((n) => garde(n.i) && n.note)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
}

const dateOuTexte = (v) => formatDateFr(secToIso(v)) || cellText(v) || '—';

function tableSimple(legende, entetes, lignes) {
  return h(
    'div',
    { class: 'fr-table fr-table--no-caption' },
    h(
      'div',
      { class: 'fr-table__wrapper' },
      h(
        'div',
        { class: 'fr-table__container' },
        h(
          'div',
          { class: 'fr-table__content' },
          h(
            'table',
            {},
            h('caption', {}, legende),
            h('thead', {}, h('tr', {}, entetes.map((t) => h('th', { scope: 'col' }, t)))),
            h('tbody', {}, lignes.map((l) => h('tr', {}, l.map((c) => h('td', {}, c))))),
          ),
        ),
      ),
    ),
  );
}

/** Liste « libellé : valeur » (état civil, coordonnées, notification). */
const LIBELLE_OCCUPATION = { libre: 'Places libres', presque: 'Presque plein', plein: 'Plein', depassement: 'Dépassement' };

/** Pastille d'occupation (texte + couleur) : « 3 places libres », « Presque plein · 1 libre », « Plein », « Dépassement +2 ». */
function badgeOccupation(presents, places) {
  const o = occupation(presents, places, SEUIL_PRESQUE_PLEIN);
  if (!o) return null;
  const pluriel = (n) => `${n} place${n > 1 ? 's' : ''}`;
  const texte = { libre: `${pluriel(o.libres)} libre${o.libres > 1 ? 's' : ''}`, presque: `Presque plein · ${o.libres} libre${o.libres > 1 ? 's' : ''}`, plein: 'Plein', depassement: `Dépassement +${-o.libres}` }[o.niveau];
  const couleur = { libre: 'success', presque: 'new', plein: 'warning', depassement: 'error' }[o.niveau];
  return h('p', { class: `fr-badge fr-badge--${couleur} fr-badge--sm fr-badge--no-icon`, title: `${presents} élève${presents > 1 ? 's' : ''} présent${presents > 1 ? 's' : ''} pour ${pluriel(places)} (${LIBELLE_OCCUPATION[o.niveau].toLowerCase()})` }, texte);
}

/** Pastille « Dossier incomplet » (avec la liste de ce qui manque) ; `null` si nom, prénom et date de naissance sont renseignés. */
/** Élève réellement affecté (établissement renseigné, hors liste d'attente) et son niveau, pour l'alerte « dossier incomplet ». */
const affectationPour = (l) => ({ affecte: !!l && l.affectation > 0 && !l.attente, niveau: l ? l.niveau : '' });

function badgeIncomplet(row, ligne = null) {
  const m = infosManquantes(row, ligne ? affectationPour(ligne) : null);
  if (!m.length) return null;
  return h('p', { class: 'fr-badge fr-badge--warning fr-badge--sm fr-badge--no-icon', title: `Information manquante : ${m.join(', ')}` }, 'Dossier incomplet');
}

/** Pastille d'alerte de fin de droits (texte + couleur) ; `null` si la fin est lointaine ou inconnue. */
function badgeFin(finIso) {
  const a = alerteFinDroits(finIso, new Date().toISOString().slice(0, 10), FIN_DROITS_ALERTE_JOURS);
  if (!a || a.niveau === 'ok') return null;
  return h(
    'p',
    {
      class: `fr-badge fr-badge--${a.niveau === 'expiree' ? 'error' : 'warning'} fr-badge--sm fr-badge--no-icon`,
      title: a.niveau === 'expiree' ? 'La fin de droits est dépassée : vérifier le renouvellement de la notification' : `La fin de droits approche (alerte ${Math.round(FIN_DROITS_ALERTE_JOURS / 30)} mois avant l'échéance)`,
    },
    libelleAlerteFin(a),
  );
}

function listeInfos(infos) {
  return h(
    'dl',
    { class: 'dossier-infos' },
    infos.flatMap(([k, v]) => [h('dt', { class: 'fr-text--bold' }, k), h('dd', {}, v || '—')]),
  );
}

/**
 * Courriels et téléphones cliquables (`mailto:` / `tel:`) quand la valeur s'y prête. Seuls des jetons strictement reconnus
 * deviennent des liens (pas de `?cc=…` dans un courriel, que des chiffres et un « + » dans un numéro) ; le reste reste du texte.
 */
const RE_COURRIEL = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const RE_TEL = /^\+?\d{9,15}$/;
function lienContact(libelle, valeur) {
  if (!valeur || typeof valeur !== 'string') return valeur;
  const courriel = /courriel|mail/i.test(libelle);
  const tel = /t[eé]l[eé]phone|t[eé]l\b/i.test(libelle);
  if (!courriel && !tel) return valeur;
  const morceaux = (courriel ? valeur.split(/[\s,;]+/) : valeur.split(/\s*[;,/]\s*|\s+ou\s+/)).filter(Boolean);
  const liens = morceaux.map((m) => {
    if (courriel && RE_COURRIEL.test(m)) {
      return h('a', { class: 'fr-link fr-link--icon-left fr-icon-mail-line', href: `mailto:${m}`, title: `Écrire à ${m}` }, m);
    }
    const chiffres = m.replace(/[\s.\-()]/g, '');
    if (tel && RE_TEL.test(chiffres)) {
      return h('a', { class: 'fr-link fr-link--icon-left fr-icon-phone-line', href: `tel:${chiffres}`, title: `Appeler le ${m}` }, m);
    }
    return m;
  });
  if (!liens.some((x) => typeof x !== 'string')) return valeur;
  return liens.flatMap((x, i) => (i ? [h('br'), x] : [x]));
}

/**
 * Informations d'un établissement en tableau, deux couples « libellé / valeur » par ligne (une seule colonne sur écran
 * étroit). Une entrée `[libelle, valeur, true]` occupe toute la largeur (texte long).
 */
function tableauInfos(infos, legende) {
  const cellules = (k, v) => [h('th', { scope: 'row' }, k), v];
  const lignes = [];
  let attente = null;
  for (const [k, v, pleine] of infos) {
    const valeur = v || '—';
    if (pleine) {
      if (attente) { lignes.push(h('tr', {}, cellules(attente[0], h('td', { colspan: 3 }, attente[1])))); attente = null; }
      lignes.push(h('tr', {}, cellules(k, h('td', { colspan: 3 }, valeur))));
    } else if (attente) {
      lignes.push(h('tr', {}, cellules(attente[0], h('td', {}, attente[1])), cellules(k, h('td', {}, valeur))));
      attente = null;
    } else {
      attente = [k, valeur];
    }
  }
  if (attente) lignes.push(h('tr', {}, cellules(attente[0], h('td', { colspan: 3 }, attente[1]))));
  return h(
    'div',
    { class: 'fr-table fr-table--no-caption infos-etab' },
    h('div', { class: 'fr-table__wrapper' }, h('div', { class: 'fr-table__container' }, h('div', { class: 'fr-table__content' },
      h('table', {}, h('caption', {}, legende), h('tbody', {}, lignes)),
    ))),
  );
}

/* ------------------------------------------------------------------ */
/* Dossier : modification globale (un bouton Modifier) avec confirmation */
/* ------------------------------------------------------------------ */
const colManuelle = (re, types) => state.champsManuels.find((f) => re.test(f.colId) && types.includes(f.type));
const AVERT_ETAT_CIVIL =
  "Attention : le nom, le prénom et la date de naissance forment la clé de rapprochement de l'élève. Les liens qui passent par cette clé (Eleves_ULIS, notes, notifications) peuvent se rompre.";
const AIDE_EDITION =
  'Ce que vous saisissez dans les coordonnées et les dates de notification prime sur la valeur qui vient de la MDPH. Champ vidé : retour à la valeur de la MDPH.';

/** Champs modifiables du dossier. `valeur` = ce qui s'affiche aujourd'hui (pré-remplissage) ; null si la colonne manque. */
function champsDossier(row, ind) {
  const cpVille = /^(\d{5})\s*(.*)$/.exec(ind.cpVille || '') || [];
  const valeurManuelle = (f, repli) => {
    const v = ind.manuel[f.colId];
    if (f.type === 'Date') return typeof v === 'number' ? secToIso(v) : repli;
    return v !== undefined && v !== null && v !== '' ? String(v) : repli;
  };
  const manuel = (re, types, label, type, repli, extra = {}) => {
    const f = colManuelle(re, types);
    return f ? { colId: f.colId, colType: f.type, label, type, valeur: valeurManuelle(f, repli), ...extra } : null;
  };
  return {
    nom: { colId: 'Nom', colType: 'Text', label: 'Nom', type: 'text', requis: true, valeur: row.nom, normalise: (v) => v.toUpperCase(), etatCivil: true },
    prenom: { colId: 'Prenom', colType: 'Text', label: 'Prénom', type: 'text', requis: true, valeur: row.prenom, etatCivil: true },
    ddn: { colId: 'Date_de_naissance', colType: 'Date', label: 'Date de naissance', type: 'date', requis: true, valeur: row.ddn || '', naissance: true, etatCivil: true },
    adr: manuel(/adresse/i, ['Text'], 'Adresse', 'text', ind.adresse, { ban: true }),
    cp: manuel(/^cp|postal/i, ['Text', 'Int', 'Numeric'], 'Code postal', 'text', cpVille[1] || '', { cp: true }),
    commune: manuel(/commune/i, ['Text'], 'Commune', 'text', (cpVille[2] || '').trim(), { commune: true, normalise: (v) => v.toUpperCase() }),
    rep: manuel(/repr|legal/i, ['Text'], 'Représentant(s) légal(aux)', 'text', ind.representants),
    debut: manuel(/debut/i, ['Date'], 'Début de la dernière notification', 'date', secToIso(ind.debut)),
    fin: manuel(/^fin/i, ['Date'], 'Fin de droits', 'date', secToIso(ind.fin)),
  };
}

/** Ligne « libellé : valeur » du dossier. Les champs listés s'ouvrent quand on clique sur « Modifier ». */
function ligneModifiable(libelle, valeur, champs, ctx) {
  const modifiables = (champs || []).filter(Boolean);
  const span = h('span', { class: 'dossier-valeur' }, valeur || '—');
  const zone = h('div', { class: 'dossier-champs', hidden: true });
  if (modifiables.length) ctx.lignes.push({ span, zone, champs: modifiables });
  return [libelle, [span, zone]];
}

function afficherValeur(champ, v) {
  if (champ.type === 'date') return formatDateFr(v) || '—';
  return v || '—';
}

/** Ouvre tous les champs modifiables en même temps. */
const msgSaisieEnCours = () => (state.edition && state.edition.fermer ? "Validez ou annulez d'abord la saisie en cours." : "Validez ou annulez d'abord la modification du dossier en cours.");

function entrerEdition(ctx) {
  if (state.edition) {
    if (state.edition.fermer) notify('warning', msgSaisieEnCours());
    return;
  }
  clearNotice();
  const champsEls = [];
  for (const l of ctx.lignes) {
    l.zone.replaceChildren(
      ...l.champs.map((c) => {
        const id = `edit-${c.colId}`;
        const input = h('input', {
          class: 'fr-input',
          id,
          type: c.type === 'date' ? 'date' : 'text',
          autocomplete: 'off',
          value: c.valeur || '',
          inputmode: c.cp ? 'numeric' : null,
          maxlength: c.cp ? 5 : null,
          title: `Saisir : ${c.label}`,
        });
        champsEls.push({ c, id, input });
        return h('div', { class: 'fr-input-group fr-mb-1w' }, h('label', { class: l.champs.length === 1 ? 'fr-sr-only fr-label' : 'fr-label', for: id }, c.label), input);
      }),
    );
    l.zone.hidden = false;
    l.span.hidden = true;
  }
  const adr = champsEls.find((x) => x.c.ban);
  if (adr && ADRESSE_SUGGESTIONS) {
    attachSuggest(adr.input, {
      minChars: 4,
      delay: 350,
      fetchItems: async (query, signal) => {
        const r = await fetch(banUrl(query), { signal, credentials: 'omit', referrerPolicy: 'no-referrer', headers: { accept: 'application/json' } });
        if (!r.ok) throw new Error(`BAN : HTTP ${r.status}`);
        return parseBan(await r.json());
      },
      onPick: (a) => {
        adr.input.value = a.adresse;
        const cpEl = champsEls.find((x) => x.c.cp);
        const comEl = champsEls.find((x) => x.c.commune);
        if (cpEl) cpEl.input.value = a.cp;
        if (comEl) comEl.input.value = a.commune;
      },
    });
  }
  state.edition = { champsEls, ctx, dirty: () => champsEls.some(({ c, input }) => input.value !== (c.valeur || '')) };
  ctx.ui.modifier.hidden = true;
  ctx.ui.aide.hidden = false;
  ctx.ui.barre.hidden = false;
  champsEls[0].input.focus();
}

/** Referme les champs sans rien écrire. */
function annulerEdition() {
  const ed = state.edition;
  if (!ed) return;
  state.edition = null;
  if (ed.fermer) { // saisie hors dossier (formulaire d'affectation, page des vœux) : elle sait se refermer toute seule
    ed.fermer();
    return;
  }
  clearFieldErrors($('#dossier'));
  for (const l of ed.ctx.lignes) {
    l.zone.replaceChildren();
    l.zone.hidden = true;
    l.span.hidden = false;
  }
  ed.ctx.ui.modifier.hidden = false;
  ed.ctx.ui.aide.hidden = true;
  ed.ctx.ui.barre.hidden = true;
}

/**
 * Garde de sortie : s'il y a une modification non validée, une fenêtre demande confirmation avant d'exécuter `suite`.
 * Sans modification en cours (ou champs inchangés), `suite` s'exécute tout de suite.
 */
function gardeSortie(suite) {
  const ed = state.edition;
  if (!ed) return suite();
  if (!ed.dirty()) {
    annulerEdition();
    return suite();
  }
  ouvrirModale({
    titre: 'Abandonner les modifications en cours ?',
    corps: [
      h('p', { class: 'fr-mb-1w' }, ed.message || "Vous avez modifié des champs du dossier sans les valider : ces changements seront perdus."),
      h('p', { class: 'fr-text--sm fr-mb-0' }, 'Rien n\'a été écrit dans Grist.'),
    ],
    actions: [
      { id: 'dlg-oui', libelle: 'Oui, abandonner', info: 'Perdre les modifications non validées et continuer', secondaire: true, onClick: () => { annulerEdition(); suite(); } },
      { id: 'dlg-non', libelle: 'Non, continuer la modification', info: 'Fermer cette fenêtre et rester sur la page', onClick: () => (ed.focus ? ed.focus() : ed.champsEls[0]?.input.focus()) },
    ],
    focus: 'dlg-non', // le choix par défaut est de ne rien perdre
  });
}

window.addEventListener('beforeunload', (e) => {
  if (state.edition && state.edition.dirty()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

function validerEdition(ctx) {
  const { row } = ctx;
  const { champsEls } = state.edition;
  clearFieldErrors($('#dossier'));
  const nouveau = {};
  let ok = true;
  for (const { c, id, input } of champsEls) {
    // champ non touché : on garde la valeur d'origine telle quelle (pas de normalisation, pas de validation)
    if (input.value === (c.valeur || '')) {
      nouveau[c.colId] = c.valeur || '';
      continue;
    }
    let v = input.value.trim().replace(/\s+/g, ' ');
    if (c.normalise) v = c.normalise(v);
    if (c.requis && !v) {
      setFieldError(id, 'Ce champ est obligatoire.');
      ok = false;
    } else if (c.type === 'date' && v) {
      const today = new Date().toISOString().slice(0, 10);
      if (isoToSec(v) === null) {
        setFieldError(id, 'Cette date est invalide.');
        ok = false;
      } else if (c.naissance && (v > today || v < '1990-01-01')) {
        setFieldError(id, v > today ? 'La date de naissance ne peut pas être dans le futur.' : "Cette date de naissance semble erronée (avant 1990).");
        ok = false;
      }
    } else if (c.cp && v && !/^\d{5}$/.test(v)) {
      setFieldError(id, 'Un code postal compte 5 chiffres.');
      ok = false;
    } else if (c.requis && c.type === 'text' && norm(v).length === 0) {
      setFieldError(id, 'Saisissez au moins une lettre.');
      ok = false;
    }
    nouveau[c.colId] = v;
  }
  if (!ok) {
    $('#dossier .fr-input-group--error input')?.focus();
    return;
  }

  // changements réels uniquement
  const changes = champsEls.filter(({ c }) => (nouveau[c.colId] || '') !== (c.valeur || ''));
  if (changes.length === 0) {
    annulerEdition();
    notify('info', 'Aucune modification à enregistrer.');
    return;
  }
  const modifs = changes.map(({ c }) => [c.label, afficherValeur(c, c.valeur), afficherValeur(c, nouveau[c.colId])]);

  // doublon : une autre fiche ne doit pas avoir la même clé nom|prénom|date
  const etatCivil = changes.filter(({ c }) => c.etatCivil);
  if (etatCivil.length) {
    const n = { nom: row.nom, prenom: row.prenom, ddn: row.ddn || '' };
    if ('Nom' in nouveau) n.nom = nouveau.Nom;
    if ('Prenom' in nouveau) n.prenom = nouveau.Prenom;
    if ('Date_de_naissance' in nouveau) n.ddn = nouveau.Date_de_naissance;
    const conflit = state.individus.find((r) => r.id !== row.id && r.cle === cle(n.nom, n.prenom, n.ddn));
    if (conflit) {
      setFieldError(etatCivil[0].id, 'Une autre fiche a déjà ce nom, ce prénom et cette date de naissance : utilisez-la plutôt que de créer un doublon.');
      etatCivil[0].input.focus();
      return;
    }
  }

  confirmerModification(modifs, () => ecrireIndividu(row, champsEls, nouveau, ctx), etatCivil.length ? AVERT_ETAT_CIVIL : '');
}

async function ecrireIndividu(row, champsEls, nouveau, ctx) {
  const valeurs = {};
  for (const { c } of champsEls) {
    const v = nouveau[c.colId];
    if ((v || '') === (c.valeur || '')) continue; // inchangé : on n'écrit rien
    if (c.colType === 'Date') valeurs[c.colId] = v ? isoToSec(v) : null;
    else if (c.colType === 'Int' || c.colType === 'Numeric') valeurs[c.colId] = v === '' ? null : Number(v);
    else valeurs[c.colId] = v;
  }
  try {
    viderCache();
    await grist.docApi.applyUserActions([['UpdateRecord', T_INDIVIDUS, row.id, valeurs]]);
    await refreshIndividus();
    const frais = state.individus.find((r) => r.id === row.id) || row;
    if (state.results) state.results.rows = state.results.rows.map((r) => (r.id === row.id ? frais : r));
    if (state.eleve && state.eleve.id === row.id) {
      state.eleve = frais;
      $('#eleve-resume').textContent = `${frais.nom} ${frais.prenom}, né(e) le ${formatDateFr(frais.ddn) || '(date non renseignée)'}`;
    }
    state.edition = null; // l'écriture a réussi : plus rien à protéger
    await openDossier(frais, ctx.origine);
    notify('success', 'Modification enregistrée.');
  } catch (err) {
    notify('error', `Enregistrement impossible : ${err.message}`);
  }
}

/* ------------------------------------------------------------------ */
/* Dossier : ajout d'une note                                          */
/* ------------------------------------------------------------------ */
/** Colonnes de Notes_sur_l_eleve (par identifiant) ; vide si la table n'existe pas dans le document. */
function colonnesNotes() {
  return new Map([...state.colById.values()].filter((c) => c.tableId === T_NOTES).map((c) => [c.colId, c]));
}

/** Bouton « Ajouter une note » et son panneau ; `null` si la table de notes ou sa colonne Note manque. */
function elementsNote(ctx) {
  const cols = colonnesNotes();
  if (!cols.has('Note') || cols.get('Note').isFormula) return { bouton: null, panneau: null };
  const panneau = h('div', { id: 'dossier-note', class: 'fr-mb-3w', hidden: true });
  const bouton = h('button', { class: 'fr-btn fr-btn--secondary fr-btn--icon-left fr-icon-add-line', type: 'button', id: 'btn-note', title: "Écrire une note dans le dossier de l'élève (table Notes_sur_l_eleve)", onclick: () => ouvrirPanneauNote(ctx, panneau, cols) }, 'Ajouter une note');
  const actions = (n) =>
    actionsLigne({
      modifier: { onclick: () => ouvrirPanneauNote(ctx, panneau, cols, n), aria: `Modifier la note du ${formatDateFr(n.date) || 'dossier'}`, title: 'Modifier le texte (et le type) de cette note' },
      supprimer: { onclick: () => demanderSuppressionNote(ctx, n), aria: `Supprimer la note du ${formatDateFr(n.date) || 'dossier'}` },
    });
  return { bouton, panneau, actions };
}

function ouvrirPanneauNote(ctx, panneau, cols, existante = null) {
  if (state.edition) {
    notify('warning', msgSaisieEnCours());
    return;
  }
  const typeCol = cols.get('Type');
  let choix = [];
  if (typeCol && !typeCol.isFormula && typeCol.type === 'Choice') {
    try {
      choix = JSON.parse(typeCol.widgetOptions || '{}').choices || [];
    } catch {
      choix = [];
    }
  }
  const fermer = () => {
    panneau.hidden = true;
    panneau.replaceChildren();
    $('#btn-note')?.focus();
  };
  const form = h(
    'form',
    { novalidate: true, class: 'ajout-eleve' },
    h('h3', { class: 'fr-h6', id: 'h-note', tabindex: '-1' }, existante ? 'Modifier la note' : 'Nouvelle note'),
    h('div', { class: 'fr-input-group fr-mb-2w' }, h('label', { class: 'fr-label', for: 'note-texte' }, 'Note', h('span', { class: 'fr-hint-text' }, "Texte libre, ajouté à l'historique des notes de l'élève.")), h('textarea', { class: 'fr-input', id: 'note-texte', rows: 4, required: true }, existante ? existante.note : '')),
    choix.length
      ? h('div', { class: 'fr-select-group fr-mb-2w' }, h('label', { class: 'fr-label', for: 'note-type' }, 'Type de note (facultatif)'), h('select', { class: 'fr-select', id: 'note-type' }, h('option', { value: '' }, '— aucun —'), choix.map((c) => h('option', { value: c }, c))))
      : h('span'),
    h(
      'ul',
      { class: 'fr-btns-group fr-btns-group--inline' },
      h('li', {}, h('button', { class: 'fr-btn', type: 'submit', title: existante ? 'Enregistrer la modification (une confirmation montre ce qui change)' : 'Enregistrer cette note dans Notes_sur_l_eleve' }, existante ? 'Enregistrer la modification' : 'Enregistrer la note')),
      h('li', {}, h('button', { class: 'fr-btn fr-btn--tertiary', type: 'button', title: 'Fermer ce panneau sans rien enregistrer', onclick: fermer }, 'Annuler')),
    ),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    const texte = $('#note-texte').value.trim();
    if (!texte) {
      setFieldError('note-texte', 'Saisissez le texte de la note.');
      $('#note-texte').focus();
      return;
    }
    const type = $('#note-type')?.value || '';
    if (!existante) return confirmerAjout('Ajouter cette note ?', [['Note', texte], ...($('#note-type') ? [['Type', type || '—']] : [])], () => ecrireNote(ctx, cols, texte, type));
    const modifs = [];
    if (texte !== existante.note) modifs.push(['Note', existante.note, texte]);
    if ($('#note-type') && type !== (existante.type || '')) modifs.push(['Type', existante.type || '—', type || '—']);
    if (modifs.length === 0) {
      notify('info', 'Aucune modification à enregistrer.');
      return;
    }
    confirmerModification(modifs, () => modifierNote(ctx, existante, texte, type, cols));
  });
  panneau.replaceChildren(form);
  panneau.hidden = false;
  if (existante && $('#note-type')) $('#note-type').value = existante.type || '';
  $('#note-texte').focus();
  panneau.scrollIntoView?.({ block: 'center' });
}

/** Ajoute la note : seules les colonnes existantes et non calculées sont renseignées ; le lien vers l'élève suit la structure de la table. */
async function ecrireNote(ctx, cols, texte, type) {
  const ecrivable = (id) => cols.has(id) && !cols.get(id).isFormula;
  try {
    const f = { Note: texte };
    let lie = false;
    if (ecrivable('Individu')) {
      f.Individu = ctx.row.id;
      lie = true;
    }
    if (ecrivable('Eleve')) {
      // Eleve pointe vers Eleves_ULIS : rapprochement par la clé nom|prénom|naissance, comme pour la lecture des notes
      try {
        const e = await lireTable('Eleves_ULIS');
        const i = e.Cle ? e.Cle.findIndex((k) => k === ctx.row.cle) : -1;
        if (i >= 0) {
          f.Eleve = e.id[i];
          lie = true;
        }
      } catch {
        /* Eleves_ULIS absente : le lien par Individu suffit s'il existe */
      }
    }
    if (!lie) throw new Error("aucune colonne de la table de notes ne permet de relier la note à l'élève");
    if (ecrivable('Cree_le')) {
      const t = cols.get('Cree_le').type || '';
      f.Cree_le = t.startsWith('DateTime') ? Math.floor(Date.now() / 1000) : isoToSec(new Date().toISOString().slice(0, 10));
    }
    if (type && ecrivable('Type')) f.Type = type;
    viderCache();
    await grist.docApi.applyUserActions([['AddRecord', T_NOTES, null, f]]);
    await openDossier(ctx.row, ctx.origine);
    notify('success', 'Note ajoutée au dossier.');
  } catch (err) {
    notify('error', `Ajout de la note impossible : ${err.message}`);
  }
}

/** Met à jour le texte (et le type, s'il est modifiable) d'une note existante. */
async function modifierNote(ctx, n, texte, type, cols) {
  try {
    const f = { Note: texte };
    if (cols.has('Type') && !cols.get('Type').isFormula) f.Type = type;
    viderCache();
    await grist.docApi.applyUserActions([['UpdateRecord', T_NOTES, n.id, f]]);
    await openDossier(ctx.row, ctx.origine);
    notify('success', 'Note modifiée.');
  } catch (err) {
    notify('error', `Modification de la note impossible : ${err.message}`);
  }
}

function demanderSuppressionNote(ctx, n) {
  if (state.edition) {
    notify('warning', msgSaisieEnCours());
    return;
  }
  ouvrirModale({
    titre: 'Supprimer cette note ?',
    corps: [
      h('div', { class: 'fr-callout fr-callout--sm fr-mb-2w' }, h('p', { class: 'fr-callout__text' }, h('strong', {}, formatDateFr(n.date) || 'Note'), n.type ? ` — ${n.type}` : '', ' — ', n.note.length > 200 ? `${n.note.slice(0, 200)}…` : n.note)),
      h('p', { class: 'fr-text--sm fr-mb-0' }, "Dans Grist, le panneau Activité permet d'annuler la suppression."),
    ],
    actions: [
      { id: 'dlg-oui', libelle: 'Oui, supprimer', info: 'Supprimer définitivement cette note (annulable dans le panneau Activité de Grist)', onClick: () => supprimerNote(ctx, n) },
      { id: 'dlg-non', libelle: 'Non, garder', info: "Fermer cette fenêtre : rien n'est supprimé", secondaire: true },
    ],
    focus: 'dlg-non',
  });
}

async function supprimerNote(ctx, n) {
  try {
    viderCache();
    await grist.docApi.applyUserActions([['RemoveRecord', T_NOTES, n.id]]);
    await openDossier(ctx.row, ctx.origine);
    notify('success', 'Note supprimée.');
  } catch (err) {
    notify('error', `Suppression de la note impossible : ${err.message}`);
  }
}

async function openDossier(row, origine = 2) {
  if (state.edition) return gardeSortie(() => openDossier(row, origine));
  clearNotice();
  const box = $('#dossier');
  let ind;
  let scol;
  let notes = [];
  try {
    const [t, , lues] = await Promise.all([lireTable(T_INDIVIDUS), lireTable(T_SCOLARITE), lireNotes(row)]);
    notes = lues;
    const i = t.id.indexOf(row.id);
    if (i < 0) throw new Error('fiche introuvable');
    const get = (c) => (t[c] ? t[c][i] : undefined);
    ind = {
      adresse: cellText(get('Derniere_notification_ULIS_ADRESSE2')),
      cpVille: cellText(get('Derniere_notification_ULIS_CP_VILLE')),
      representants: cellText(get('Derniere_notification_ULIS_REPRESENTANT_LEGAL1')),
      debut: get('Derniere_notif_ULIS'),
      fin: get('Fin_droits_ULIS'),
      premiere: get('Premiere_notif_ULIS'),
      notif: get('Notification_ULIS') === true,
      manuel: Object.fromEntries(state.champsManuels.map((f) => [f.colId, get(f.colId)])),
    };
    await refreshScolarite(row.id);
    scol = state.scol;
  } catch (err) {
    notify('error', `Lecture du dossier impossible : ${err.message}`);
    return;
  }
  const todayIso = new Date().toISOString().slice(0, 10);
  const enCours = ligneActuelle(scol, todayIso);
  // ERS de référence : celui de l'établissement de l'affectation en cours (secteur, nom et courriels de la table des établissements).
  // Élève exclu : pas d'affectation en cours, on prend l'ERS du dernier établissement connu.
  const exclu = !enCours ? elevesExclus(scol, todayIso)[0] : null;
  const etabErs = enCours && enCours.affectation ? enCours.affectation : exclu && exclu.derniere ? exclu.derniere.affectation : 0;
  const ersRef = await ersDeEtab(etabErs);
  const ctx = { row, origine, lignes: [], ui: {} };
  const ch = champsDossier(row, ind);
  ctx.ui.modifier = h(
    'button',
    { class: 'fr-btn fr-btn--secondary fr-btn--icon-left fr-icon-pencil-line bouton-ecriture', type: 'button', title: "Ouvrir tous les champs modifiables du dossier ; une seule validation, avec confirmation avant écriture", onclick: () => entrerEdition(ctx) },
    'Modifier',
  );
  ctx.ui.aide = h('p', { class: 'fr-hint-text fr-mb-2w', hidden: true }, AIDE_EDITION, ch.adr && ADRESSE_SUGGESTIONS ? " Suggestions d'adresse : Base Adresse Nationale (IGN), le texte tapé est envoyé à ce service public." : '');
  ctx.ui.barre = h(
    'div',
    { class: 'dossier-barre-edition', hidden: true, role: 'group', 'aria-label': 'Valider ou annuler la modification du dossier' },
    h(
      'ul',
      { class: 'fr-btns-group fr-btns-group--inline fr-btns-group--sm fr-btns-group--icon-left' },
      h('li', {}, h('button', { class: 'fr-btn fr-icon-check-line fr-btn--icon-left', type: 'button', title: 'Valider toutes les modifications : une fenêtre montrera ce qui change avant écriture', onclick: () => validerEdition(ctx) }, 'Valider')),
      h('li', {}, h('button', { class: 'fr-btn fr-btn--tertiary fr-icon-close-line fr-btn--icon-left', type: 'button', title: 'Abandonner toutes les modifications en cours', onclick: () => gardeSortie(() => {}) }, 'Annuler')),
    ),
  );
  const note = elementsNote(ctx);
  box.replaceChildren(
    ctx.ui.aide,
    infosManquantes(row, affectationPour(enCours)).length
      ? h('div', { class: 'fr-alert fr-alert--warning fr-alert--sm fr-mb-2w', id: 'dossier-incomplet', role: 'status' }, h('p', { class: 'fr-alert__title' }, 'Dossier incomplet'), h('p', {}, `Information manquante : ${infosManquantes(row, affectationPour(enCours)).join(', ')}. ${infosManquantes(row, affectationPour(enCours)).some((m) => m !== 'niveau') ? 'Utilisez « Modifier » pour la compléter' : "Le niveau se renseigne dans la ligne d'affectation (bouton « Affecter »)"}.`))
      : h('span'),
    h('h2', { class: 'fr-h6' }, 'État civil'),
    listeInfos([
      ligneModifiable('Nom', row.nom, [ch.nom], ctx),
      ligneModifiable('Prénom', row.prenom, [ch.prenom], ctx),
      ligneModifiable('Date de naissance', formatDateFr(row.ddn), [ch.ddn], ctx),
    ]),
    h('h2', { class: 'fr-h6' }, 'Coordonnées'),
    listeInfos([
      ligneModifiable('Adresse', ind.adresse, [ch.adr], ctx),
      ligneModifiable('Code postal et commune', ind.cpVille, ch.cp && ch.commune ? [ch.cp, ch.commune] : [], ctx),
      ligneModifiable('Représentant(s) légal(aux)', ind.representants, [ch.rep], ctx),
    ]),
    ...(ersRef.length
      ? [h('h2', { class: 'fr-h6' }, exclu ? 'ERS de référence (dernier établissement)' : 'ERS de référence'), listeInfos(ersRef.map((x) => ligneModifiable(x.libelle === 'ERSH' ? 'ERS' : x.libelle, lienContact(x.libelle, x.valeur), null, ctx)))]
      : []),
    h('h2', { class: 'fr-h6' }, 'Notification ULIS'),
    listeInfos([
      ligneModifiable('Notification ULIS', ind.notif ? 'Oui' : 'Non', null, ctx),
      ligneModifiable('Première notification', dateOuTexte(ind.premiere), null, ctx),
      ligneModifiable('Début de la dernière', dateOuTexte(ind.debut), [ch.debut], ctx),
      ligneModifiable('Fin de droits', badgeFin(secToIso(ind.fin)) ? [dateOuTexte(ind.fin), ' ', badgeFin(secToIso(ind.fin))] : dateOuTexte(ind.fin), [ch.fin], ctx),
    ]),
    h('div', { class: 'fr-my-2w' }, ctx.ui.modifier),
    h('h2', { class: 'fr-h6' }, 'Historique des affectations'),
    scol.length === 0
      ? h('p', {}, 'Aucune affectation enregistrée.')
      : tableSimple(
          'Affectations, de la plus récente à la plus ancienne',
          ["Date d'effet", 'Affectation', 'Niveau', 'Situation', 'Action'],
          scol.map((l) => [
            [dateLabel(l), ' ', enCours && enCours.id === l.id ? badgesEnCours(l) : null],
            lienEtab(l, retourDossierDe(row, origine)),
            l.niveau || '—',
            celluleSituation(l),
            actionsLigne({
              modifier: { onclick: () => modifierAffectationDepuisDossier(row, l), aria: `Modifier l'affectation du ${dateLabel(l)}`, title: "Modifier cette ligne d'affectation (ouvre la page des affectations de l'élève)" },
              supprimer: { onclick: () => demanderSuppression(l, () => openDossier(row, origine)), aria: `Supprimer l'affectation du ${dateLabel(l)}` },
            }),
          ]),
        ),
    origine !== 3
      ? h('div', { class: 'fr-mt-2w' }, h('button', { class: 'fr-btn fr-btn--secondary fr-btn--icon-left fr-icon-map-pin-2-line', type: 'button', title: 'Passer aux affectations de cet élève pour ajouter ou modifier une ligne', onclick: () => chooseEleve(row) }, 'Affecter'))
      : h('span'),
    h('h2', { class: 'fr-h6 fr-mt-3w' }, 'Notes sur l\'élève'),
    notes.length === 0
      ? h('p', {}, 'Aucune note.')
      : tableSimple(
          "Notes, de la plus récente à la plus ancienne",
          note.actions ? ['Date', 'Type', 'Note', 'Action'] : ['Date', 'Type', 'Note'],
          notes.map((n) => [
            formatDateFr(n.date) || '—',
            n.type || '—',
            h('span', { class: 'note-texte' }, n.note),
            ...(note.actions ? [note.actions(n)] : []),
          ]),
        ),
    note.bouton ? h('div', { class: 'fr-mt-2w' }, note.bouton) : h('span'),
    note.panneau || h('span'),
    ctx.ui.barre,
    h(
      'div',
      { class: 'fr-mt-2w' },
      h('button', { class: 'fr-btn fr-btn--tertiary fr-btn--sm fr-btn--icon-left fr-icon-arrow-left-s-line', type: 'button', title: origine === 3 ? 'Revenir aux affectations de cet élève' : origine === 'dispo' ? 'Revenir à la liste des élèves du dispositif' : origine === 'exclus' ? 'Revenir à la liste des élèves exclus' : origine === 'voeux' ? 'Revenir aux vœux de cet établissement' : origine === 'ers' ? 'Revenir à ma page' : origine === 'accueil' ? "Revenir à l'accueil" : 'Revenir à la liste des fiches trouvées', onclick: () => retourDossier(row, origine) }, libelleRetourDossier(origine)),
    ),
  );
  state.step = 0;
  masquerPages();
  $('#step-dossier').hidden = false;
  $('#stepper').replaceChildren(
    h(
      'div',
      { class: 'fr-stepper' },
      h('h1', { class: 'fr-stepper__title', id: 'h-dossier', tabindex: '-1' }, `Dossier de ${row.nom} ${row.prenom}`),
      h('p', { class: 'fr-stepper__details' }, "Les données personnelles ne s'affichent qu'à l'écran et ne quittent pas Grist. Le bouton Modifier ouvre tous les champs ; une seule validation, avec confirmation avant écriture."),
    ),
    h(
      'nav',
      { 'aria-label': 'Navigation', class: 'step-nav fr-mb-2w' },
      h(
        'button',
        { type: 'button', class: 'fr-btn fr-btn--tertiary fr-btn--sm fr-btn--icon-left fr-icon-arrow-left-s-line', title: 'Quitter le dossier', onclick: () => retourDossier(row, origine) },
        libelleRetourDossier(origine),
      ),
    ),
  );
  $('#h-dossier').focus();
}

const libelleRetourDossier = (origine) => (origine === 3 ? 'Revenir aux affectations' : origine === 'dispo' ? 'Revenir au dispositif' : origine === 'exclus' ? 'Revenir aux élèves exclus' : origine === 'voeux' ? 'Revenir aux vœux' : origine === 'ers' ? 'Revenir à ma page' : origine === 'accueil' ? "Revenir à l'accueil" : 'Revenir à la page de résultats');

function retourDossier(row, origine) {
  clearNotice();
  if (origine === 'dispo' && state.dispo) {
    openDispositif(state.dispo.etabId, state.dispo.retour, { garder: true });
    return;
  }
  if (origine === 'exclus' && state.exclus) {
    openExclus(state.exclus.retour, { garder: true });
    return;
  }
  if (origine === 'ers' && state.ers) {
    openErsAccueil();
    return;
  }
  if (origine === 'voeux' && state.voeuxEtab) {
    openVoeuxEtab(state.voeuxEtab.etabId, state.voeuxEtab.retour);
    return;
  }
  if (origine === 3 && state.eleve) {
    goto(3);
    return;
  }
  goto(origine === 'accueil' ? 1 : 2);
}

$('#btn-dossier-3').addEventListener('click', () => openDossier(state.eleve, 3));

function backToSearch() {
  if (state.edition) return gardeSortie(() => backToSearch());
  clearNotice();
  state.eleve = null;
  $('#form-scol').hidden = true;
  goto(1);
  $('#q').focus();
}

/** « Début notification (manuel) » -> « Début notification » ; « Cp_manuel » -> « Cp ». */
function prettyLabel(c) {
  const base = (c.label || c.colId).replace(/_/g, ' ');
  return base.replace(/\s*\(?\bmanuel(?:le)?\)?\s*$/i, '').trim() || base;
}

/** Construit les champs facultatifs (colonnes `*_manuel`) dans le formulaire de création. */
function renderManualFields() {
  const box = $('#c-manuel');
  if (state.champsManuels.length === 0) {
    box.replaceChildren();
    return;
  }
  const control = (f, i) => {
    const id = `c-m-${i}`;
    if (f.type === 'Bool') {
      return h('div', { class: 'fr-checkbox-group' }, h('input', { type: 'checkbox', id }), h('label', { class: 'fr-label', for: id }, f.label));
    }
    let el;
    if (f.type === 'Choice') {
      el = h('select', { class: 'fr-select', id }, h('option', { value: '' }, '— aucun —'), f.choices.map((c) => h('option', { value: c }, c)));
      return h('div', { class: 'fr-select-group' }, h('label', { class: 'fr-label', for: id }, f.label), el);
    }
    if (f.type === 'Text' && MANUEL_MULTILIGNE.test(f.colId)) el = h('textarea', { class: 'fr-input', id, rows: 2 });
    else if (f.type === 'Date') el = h('input', { class: 'fr-input', id, type: 'date' });
    else if (f.type === 'Int' || f.type === 'Numeric') el = h('input', { class: 'fr-input', id, type: 'number', step: f.type === 'Int' ? '1' : 'any' });
    else el = h('input', { class: 'fr-input', id, type: 'text', autocomplete: 'off' });
    const hint = ADRESSE_SUGGESTIONS && f.type === 'Text' && /adresse/i.test(f.colId) ? 'Suggestions de la Base Adresse Nationale (IGN) : le texte saisi ici est envoyé à ce service public.' : '';
    return h('div', { class: 'fr-input-group' }, h('label', { class: 'fr-label', for: id }, f.label, hint ? h('span', { class: 'fr-hint-text' }, hint) : null), el);
  };
  box.replaceChildren(
    h(
      'fieldset',
      { class: 'fr-fieldset', 'aria-labelledby': 'legend-manuel' },
      h('legend', { class: 'fr-fieldset__legend', id: 'legend-manuel' }, h('span', { class: 'fr-h6' }, 'Informations complémentaires'), h('span', { class: 'fr-hint-text' }, 'Facultatif : à renseigner si vous les connaissez.')),
      state.champsManuels.map((f, i) => h('div', { class: 'fr-fieldset__element' }, control(f, i))),
    ),
  );
  state.champsManuels.forEach((f, i) => {
    const el = $(`#c-m-${i}`);
    if (el) el.title = `Facultatif : ${f.label}. Valeur saisie à la main, prioritaire sur celle qui vient de la MDPH.`;
  });
  if (ADRESSE_SUGGESTIONS) attachAdresse();
}

/** Suggestions d'adresses sur le champ adresse ; le choix remplit aussi le code postal et la commune s'ils existent. */
function attachAdresse() {
  const idx = (re, types) => state.champsManuels.findIndex((f) => re.test(f.colId) && types.includes(f.type));
  const iAdresse = idx(/adresse/i, ['Text']);
  if (iAdresse < 0) return;
  const iCp = idx(/^cp|postal/i, ['Text', 'Int', 'Numeric']);
  const iCommune = idx(/commune/i, ['Text']);
  const set = (i, v) => {
    if (i >= 0) $(`#c-m-${i}`).value = v;
  };
  attachSuggest($(`#c-m-${iAdresse}`), {
    minChars: 4,
    delay: 350, // une requête par pause de frappe, pas une par lettre
    fetchItems: async (query, signal) => {
      const r = await fetch(banUrl(query), { signal, credentials: 'omit', referrerPolicy: 'no-referrer', headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error(`BAN : HTTP ${r.status}`);
      return parseBan(await r.json());
    },
    onPick: (a) => {
      set(iAdresse, a.adresse);
      set(iCp, a.cp);
      set(iCommune, a.commune);
    },
  });
}

/** Lit les champs facultatifs non vides ; renvoie null (et signale l'erreur) si l'un est invalide. */
function collectManual() {
  const out = {};
  let ok = true;
  state.champsManuels.forEach((f, i) => {
    const el = $(`#c-m-${i}`);
    if (f.type === 'Bool') {
      if (el.checked) out[f.colId] = true;
      return;
    }
    const v = el.value.trim();
    if (!v) return;
    if (f.type === 'Date') {
      const sec = isoToSec(v);
      if (sec === null) {
        setFieldError(el.id, 'Cette date est invalide.');
        ok = false;
      } else out[f.colId] = sec;
    } else if (f.type === 'Int' || f.type === 'Numeric') {
      const n = Number(v);
      if (!Number.isFinite(n)) {
        setFieldError(el.id, 'Saisissez un nombre.');
        ok = false;
      } else out[f.colId] = n;
    } else out[f.colId] = v;
  });
  return ok ? out : null;
}

$('#form-create').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearNotice();
  const form = $('#form-create');
  clearFieldErrors(form);
  const nom = $('#c-nom').value.trim();
  const prenom = $('#c-prenom').value.trim();
  const iso = $('#c-ddn').value;

  let ok = true;
  if (!norm(nom)) {
    setFieldError('c-nom', 'Le nom est obligatoire.');
    ok = false;
  }
  if (!norm(prenom)) {
    setFieldError('c-prenom', 'Le prénom est obligatoire.');
    ok = false;
  }
  if (!iso) {
    setFieldError('c-ddn', 'La date de naissance est obligatoire.');
    ok = false;
  } else if (isoToSec(iso) === null) {
    setFieldError('c-ddn', 'Cette date est invalide.');
    ok = false;
  } else if (iso > new Date().toISOString().slice(0, 10)) {
    setFieldError('c-ddn', 'La date de naissance ne peut pas être dans le futur.');
    ok = false;
  }
  const manuel = collectManual();
  if (!manuel) ok = false;
  if (!ok) {
    form.querySelector('[aria-invalid]')?.focus();
    return;
  }

  try {
    await refreshIndividus();
    // Même clé que la formule `Cle` : si elle existe déjà, on ne crée pas de doublon.
    const key = cle(nom, prenom, iso);
    const existant = state.individus.find((r) => r.cle === key);
    if (existant) {
      notify('warning', `Une fiche existe déjà pour ${existant.nom} ${existant.prenom} (${formatDateFr(existant.ddn) || 'sans date'}) : elle est reprise, rien n'a été créé.`);
      await chooseEleve(existant, { keepNotice: true, affecterA: state.createCtx ? state.createCtx.etabId : null });
      return;
    }
    const creer = async () => {
      try {
        viderCache();
        const res = await grist.docApi.applyUserActions([
          ['AddRecord', T_INDIVIDUS, null, { ...manuel, Nom: nom, Prenom: prenom, Date_de_naissance: isoToSec(iso) }],
        ]);
        const id = res.retValues[0];
        await refreshIndividus();
        const cree = state.individus.find((r) => r.id === id);
        if (!cree) throw new Error('la fiche a été créée mais reste introuvable à la relecture : relancez la recherche');
        await chooseEleve(cree, { keepNotice: true, affecterA: state.createCtx ? state.createCtx.etabId : null });
        notify('success', 'Fiche créée dans Individus.');
      } catch (err) {
        notify('error', `Création impossible : ${err.message}`);
      }
    };
    confirmerAjout('Créer cette fiche ?', [['Nom', nom], ['Prénom', prenom], ['Date de naissance', formatDateFr(iso)]], creer);
  } catch (err) {
    notify('error', `Création impossible : ${err.message}`);
  }
});

async function chooseEleve(row, { keepNotice = false, affecterA = null } = {}) {
  if (state.edition) return gardeSortie(() => chooseEleve(row, { keepNotice, affecterA }));
  if (!keepNotice) clearNotice();
  state.eleve = row;
  try {
    await refreshScolarite();
  } catch (err) {
    notify('error', `Lecture de la scolarité impossible : ${err.message}`);
    return;
  }
  $('#eleve-resume').textContent = `${row.nom} ${row.prenom}, né(e) le ${formatDateFr(row.ddn) || '(date non renseignée)'}`;
  $('#form-scol').hidden = true;
  renderScolList();
  state.createCtx = null;
  goto(3);
  if (affecterA) openScolForm(null, { affectation: affecterA }); // ajout depuis un dispositif : l'établissement est déjà choisi
}

/* ------------------------------------------------------------------ */
/* Étape 3 : scolarité                                                 */
/* ------------------------------------------------------------------ */
/** Date d'effet affichable : la date, ou le texte non reconnu comme date, ou « sans date ». */
function dateLabel(l) {
  return formatDateFr(l.date) || (l.dateBrute ? `${l.dateBrute} (date invalide)` : 'sans date');
}

/** Cellule « Affectation » : libellé de l'établissement, ou texte sans correspondance signalé. */
function affectationCell(l) {
  if (l.affectation) return state.etabLabel.get(l.affectation) || `#${l.affectation}`;
  if (l.affectationInvalide) {
    return [l.affectationInvalide, ' ', h('p', { class: 'fr-badge fr-badge--warning fr-badge--sm fr-badge--no-icon' }, 'Non reconnue')];
  }
  return '—';
}

/** Boutons d'action de fin de ligne (crayon et corbeille), identiques pour les affectations et les notes. */
function actionsLigne({ modifier, supprimer }) {
  return h(
    'ul',
    { class: 'actions-ligne' },
    h('li', {}, h('button', { class: 'fr-btn fr-btn--sm fr-btn--tertiary fr-icon-pencil-line', type: 'button', onclick: modifier.onclick, 'aria-label': modifier.aria, title: modifier.title || 'Modifier' }, 'Modifier')),
    h('li', {}, h('button', { class: 'fr-btn fr-btn--sm fr-btn--tertiary fr-icon-delete-line', type: 'button', onclick: supprimer.onclick, title: 'Supprimer', 'aria-label': supprimer.aria }, 'Supprimer')),
  );
}

function renderScolList() {
  const box = $('#scol-list');
  if (state.scol.length === 0) {
    box.replaceChildren(h('div', { class: 'fr-alert fr-alert--info fr-alert--sm' }, h('p', {}, "Aucune affectation enregistrée pour cet élève.")));
    return;
  }
  const todayIso = new Date().toISOString().slice(0, 10);
  const enCours = ligneActuelle(state.scol, todayIso);
  box.replaceChildren(
    h(
      'div',
      { class: 'fr-table fr-table--no-caption' },
      h(
        'div',
        { class: 'fr-table__wrapper' },
        h(
          'div',
          { class: 'fr-table__container' },
          h(
            'div',
            { class: 'fr-table__content' },
            h(
              'table',
              {},
              h('caption', {}, "Affectations de l'élève, de la plus récente à la plus ancienne"),
              h(
                'thead',
                {},
                h('tr', {}, ["Date d'effet", 'Affectation', 'Niveau', 'Situation', "Liste d'attente", 'Action'].map((t) => h('th', { scope: 'col' }, t))),
              ),
              h(
                'tbody',
                {},
                state.scol.map((l) =>
                  h(
                    'tr',
                    {},
                    h(
                      'td',
                      {},
                      dateLabel(l),
                      ' ',
                      enCours && enCours.id === l.id ? badgesEnCours(l) : null,
                    ),
                    h('td', {}, lienEtab(l, retourAffectations())),
                    h('td', {}, l.niveau || '—'),
                    h('td', {}, celluleSituation(l)),
                    h('td', {}, l.attente ? 'Oui' : 'Non'),
                    h(
                      'td',
                      {},
                      actionsLigne({
                        modifier: { onclick: () => openScolForm(l), aria: `Modifier l'affectation du ${dateLabel(l)}`, title: "Modifier cette ligne d'affectation (date, établissement, niveau, situation, liste d'attente)" },
                        supprimer: { onclick: () => demanderSuppression(l), aria: `Supprimer l'affectation du ${dateLabel(l)}` },
                      }),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

function select(id, label, options, value, { hint = '' } = {}) {
  // une valeur actuelle hors liste est ajoutée, sinon l'enregistrement l'effacerait
  if (value && !options.some((o) => String(o.value) === String(value))) options = [...options, { value, label: `${value} (hors liste)` }];
  return h(
    'div',
    { class: 'fr-select-group fr-mb-2w' },
    h('label', { class: 'fr-label', for: id }, label, hint ? h('span', { class: 'fr-hint-text' }, hint) : null),
    h(
      'select',
      { class: 'fr-select', id, name: id },
      h('option', { value: '' }, '— aucune —'),
      options.map(({ value: v, label: l }) => h('option', { value: v, selected: String(v) === String(value) }, l)),
    ),
  );
}

/**
 * Liste de choix avec recherche (« loupe »), motif ARIA 1.2 « combobox + listbox » :
 * on tape des mots (sans accents, dans le désordre), on choisit à la souris ou au clavier
 * (flèches, Entrée, Échap). La valeur choisie est portée par `input.dataset.value`.
 */
function combobox({ id, label, options, value, hint = '', placeholder = 'Rechercher…', onChange = null, compact = false, disabled = false }) {
  const selected = options.find((o) => String(o.value) === String(value));
  const listId = `${id}-list`;
  const input = h('input', {
    class: 'fr-input',
    id,
    type: 'text',
    role: 'combobox',
    autocomplete: 'off',
    placeholder,
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': listId,
    disabled,
  });
  input.value = selected ? selected.label : '';
  input.dataset.value = selected ? String(selected.value) : '';
  const list = h('ul', { class: 'combo-list', id: listId, role: 'listbox', 'aria-label': label, hidden: true });
  const status = h('p', { class: 'fr-sr-only', role: 'status' });
  let shown = [];
  let active = -1;

  const isOpen = () => !list.hidden;
  const close = () => {
    list.hidden = true;
    active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };
  const setActive = (i) => {
    active = i;
    list.querySelectorAll('[role="option"]').forEach((li, k) => li.setAttribute('aria-selected', String(k === i)));
    if (i >= 0) {
      input.setAttribute('aria-activedescendant', `${id}-opt-${i}`);
      list.querySelector(`#${id}-opt-${i}`)?.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };
  const choose = (o) => {
    input.value = o.label;
    input.dataset.value = String(o.value);
    close();
    onChange?.(o.value);
  };
  const open = (query) => {
    const { total, rows } = filterOptions(options, query);
    shown = rows;
    list.replaceChildren(
      ...[
        ...rows.map((o, i) =>
        h(
          'li',
          {
            id: `${id}-opt-${i}`,
            role: 'option',
            'aria-selected': 'false',
            // mousedown (et non click) : le champ ne perd pas le focus avant le choix
            onmousedown: (e) => {
              e.preventDefault();
              choose(o);
            },
          },
          o.label,
        ),
      ),
        total > rows.length ? h('li', { role: 'presentation', class: 'combo-more' }, `${total - rows.length} autres résultats : précisez la recherche.`) : null,
        total === 0 ? h('li', { role: 'presentation', class: 'combo-more' }, 'Aucun résultat.') : null,
      ].filter(Boolean), // replaceChildren(null) écrirait le texte « null »
    );
    list.hidden = false;
    if (compact) {
      // dans un tableau, le conteneur défilant rognerait la liste : on la place à l'écran (position fixe)
      const r = input.getBoundingClientRect();
      Object.assign(list.style, { position: 'fixed', top: `${r.bottom}px`, left: `${r.left}px`, width: `${Math.max(r.width, 260)}px`, zIndex: '1000' });
    }
    input.setAttribute('aria-expanded', 'true');
    setActive(-1);
    status.textContent = total === 0 ? 'Aucun résultat' : `${total} résultat${total > 1 ? 's' : ''}`;
  };

  input.addEventListener('input', () => {
    input.dataset.value = ''; // la saisie invalide le choix précédent
    onChange?.('');
    open(input.value);
  });
  input.addEventListener('focus', () => open(input.dataset.value ? '' : input.value));
  input.addEventListener('click', () => {
    if (!isOpen()) open(input.dataset.value ? '' : input.value);
  });
  input.addEventListener('blur', () => {
    close();
    if (!input.value.trim()) {
      input.dataset.value = '';
      onChange?.('');
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen()) open(input.dataset.value ? '' : input.value);
      else if (shown.length) setActive(Math.min(active + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (isOpen() && shown.length) setActive(Math.max(active - 1, 0));
    } else if (e.key === 'Enter' && isOpen() && active >= 0) {
      e.preventDefault(); // choisir, sans soumettre le formulaire
      choose(shown[active]);
    } else if (e.key === 'Escape' && isOpen()) {
      e.preventDefault();
      close();
    }
  });

  if (compact) window.addEventListener('scroll', close, true);
  const racine = h(
    'div',
    { class: compact ? 'fr-input-group combo combo-compact' : 'fr-input-group combo fr-mb-2w' },
    h('label', { class: compact ? 'fr-label fr-sr-only' : 'fr-label', for: id }, label, hint ? h('span', { class: 'fr-hint-text' }, hint) : null),
    h('div', { class: 'fr-input-wrap fr-icon-search-line' }, input),
    list,
    status,
  );
  /** Change la valeur par programme (sans déclencher onChange). */
  racine.definirValeur = (v) => {
    const o = options.find((x) => String(x.value) === String(v));
    input.value = o ? o.label : '';
    input.dataset.value = o ? String(o.value) : '';
  };
  return racine;
}

$('#btn-new-scol').addEventListener('click', () => openScolForm(null));
$('#btn-back-1b').addEventListener('click', backToSearch);

/** Niveaux proposés pour l'établissement `etabId` (tous si aucun établissement ou type inconnu). */
function niveauxDe(etabId) {
  return niveauxPour(state.etabType.get(Number(etabId)) || '', state.niveaux, NIVEAUX_PAR_TYPE);
}

/** Champ « Niveau » : liste filtrée selon l'établissement de la ligne ; une valeur hors liste est conservée. */
function niveauField(ligne, defauts = {}) {
  const options = niveauxDe(ligne ? ligne.affectation : defauts.affectation || '').map((n) => ({ value: n, label: n }));
  const groupe = select('s-niveau', 'Niveau', options, ligne ? ligne.niveau : '');
  groupe.append(h('p', { class: 'fr-hint-text', id: 's-niveau-note', role: 'status' }));
  return groupe;
}

/**
 * L'utilisateur change d'établissement : la liste des niveaux suit. Si le niveau déjà choisi ne convient pas
 * au nouveau type, il est retiré avec une explication (le garder en silence enregistrerait une incohérence).
 * Quand l'établissement est effacé ou en cours de saisie (`etabId` vide), la liste complète revient et le choix est gardé.
 */
function majNiveaux(etabId) {
  const sel = $('#s-niveau');
  const note = $('#s-niveau-note');
  if (!sel || !note) return;
  const actuel = sel.value;
  const type = etabId ? state.etabType.get(Number(etabId)) || '' : '';
  const liste = niveauxDe(etabId);
  const restreint = liste.length < state.niveaux.length;
  const retire = restreint && actuel && !liste.includes(actuel);
  const conserve = !retire && actuel && !liste.includes(actuel); // valeur hors liste d'une ligne existante
  sel.replaceChildren(
    h('option', { value: '' }, '— aucune —'),
    ...liste.map((n) => h('option', { value: n, selected: n === actuel && !retire }, n)),
    ...(conserve ? [h('option', { value: actuel, selected: true }, `${actuel} (hors liste)`)] : []),
  );
  if (retire) sel.value = '';
  const phrases = [];
  if (restreint && LIBELLE_TYPE[type]) phrases.push(`Niveaux proposés pour ${LIBELLE_TYPE[type]}.`);
  if (etabId && !type) phrases.push(`Type d'établissement non reconnu (colonne ${COL_TYPE_ETAB} : « ${state.etabTypeBrut.get(Number(etabId)) || 'vide'} ») : liste complète.`);
  if (retire) phrases.push(`Le niveau « ${actuel} » a été retiré : il ne correspond pas à ${LIBELLE_TYPE[type] || 'cet établissement'}.`);
  note.textContent = phrases.join(' ');
}

/** Occupation du dispositif d'un établissement aujourd'hui : élèves présents, liste d'attente et places (`Places_max`). */
async function occupationEtab(etabId) {
  const [t, tScol] = await Promise.all([lireTable(state.etabTable), lireTable(T_SCOLARITE)]);
  const i = t.id.indexOf(Number(etabId));
  const places = i >= 0 && t.Places_max && typeof t.Places_max[i] === 'number' ? t.Places_max[i] : null;
  const todayIso = new Date().toISOString().slice(0, 10);
  const n = effectifsParEtab(lignesDe(tScol), todayIso, SITUATION_PAR_DEFAUT).get(Number(etabId)) || { presents: 0, attente: 0 };
  return { places, presents: n.presents, attente: n.attente };
}

let jetonOccupation = 0;
/** Affiche sous le champ Affectation les places libres ou occupées de l'établissement choisi (efface si aucun). */
async function majOccupation(etabId) {
  const zone = $('#s-aff-occup');
  if (!zone) return;
  const jeton = ++jetonOccupation;
  if (!etabId) {
    zone.replaceChildren();
    return;
  }
  let o;
  try {
    o = await occupationEtab(etabId);
  } catch (err) {
    if (jeton === jetonOccupation) zone.replaceChildren(h('p', { class: 'fr-hint-text' }, `Occupation indisponible : ${err.message}`));
    return;
  }
  if (jeton !== jetonOccupation || !$('#s-aff-occup')) return; // un autre choix a été fait entre-temps, ou le formulaire est fermé
  const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;
  const texte = `Dispositif aujourd'hui : ${pluriel(o.presents, 'élève')} présent${o.presents > 1 ? 's' : ''}${o.places !== null ? ` sur ${pluriel(o.places, 'place')}` : ' (nombre de places non renseigné)'}${o.attente ? ` · ${o.attente} en liste d'attente` : ''}`;
  zone.replaceChildren(h('p', { class: 'fr-text--sm fr-mb-0' }, texte, ' ', badgeOccupation(o.presents, o.places)));
}

/** Referme le formulaire d'affectation ; la garde de sortie ne le surveille plus. */
function fermerFormScol() {
  $('#form-scol').hidden = true;
  if (state.edition && state.edition.fermer === fermerFormScol) state.edition = null;
}

/* ------------------------------------------------------------------ */
/* Demande d'affectation à la Division scolaire (table Envoi_ANESH)      */
/* ------------------------------------------------------------------ */
// Une ligne par élève ; `A_envoyer` coché = partira avec le prochain envoi groupé (bouton de Envoi_ANESH_commande).
// `Pret` (formule) vaut vrai quand toutes les informations du courrier sont renseignées ; `Envoye_le` est écrit par l'automatisme.
const T_ENVOI = 'Envoi_ANESH';
const CHAMPS_ENVOI = { Type_Etab: "type d'établissement", Nom: 'nom', Prenom: 'prénom', DDN: 'date de naissance', Etab_UAI: "UAI de l'établissement", Etab_Nom: "nom de l'établissement", Niveau: 'niveau', Etab_Adresse: "adresse de l'établissement", Etab_Cp: "code postal de l'établissement", Etab_Commune: "commune de l'établissement", Etab_Tel: "téléphone de l'établissement", Etab_Email: "e-mail de l'établissement", Resp_Nom: 'représentant légal', Resp_Adresse: 'adresse du représentant légal', Resp_Cp: 'code postal du représentant légal', Resp_Commune: 'commune du représentant légal' };

/** État de la demande de l'élève : null si la table n'existe pas ; sinon { id, aEnvoyer, envoyeLe, pret, manque }. */
async function etatEnvoi(eleveId) {
  const t = await lireTable(T_ENVOI).catch(() => null);
  if (!t || !t.Eleve) return null;
  let i = -1;
  t.id.forEach((id, k) => { if (t.Eleve[k] === eleveId && (i < 0 || id > t.id[i])) i = k; }); // la plus récente
  if (i < 0) return { id: 0, aEnvoyer: false, envoyeLe: null, pret: false, manque: [] };
  const vide = (c) => !t[c] || !String(cellText(t[c][i]) ?? '').trim();
  return {
    id: t.id[i],
    aEnvoyer: Boolean(t.A_envoyer && t.A_envoyer[i]),
    envoyeLe: t.Envoye_le && typeof t.Envoye_le[i] === 'number' && t.Envoye_le[i] > 0 ? t.Envoye_le[i] : null,
    // UAI de l'établissement pour lequel la dernière demande est partie (colonne Envoye_uai, écrite par le workflow n8n) et UAI actuel
    suitUai: Boolean(t.Envoye_uai),
    envoyeUai: t.Envoye_uai ? String(cellText(t.Envoye_uai[i]) ?? '').trim().toUpperCase() : '',
    etabUai: t.Etab_UAI ? String(cellText(t.Etab_UAI[i]) ?? '').trim().toUpperCase() : '',
    pret: Boolean(t.Pret && t.Pret[i]),
    manque: Object.entries(CHAMPS_ENVOI).filter(([c]) => t[c] && vide(c)).map(([, l]) => l),
  };
}

/**
 * Une demande déjà partie bloque une nouvelle demande seulement pour le même établissement. Sans colonne Envoye_uai
 * (ancien document), toute demande envoyée bloque comme avant ; avec la colonne, un autre établissement est autorisé.
 */
const demandeDejaPartie = (etat) => Boolean(etat.envoyeLe) && (!etat.suitUai || (etat.envoyeUai !== '' && etat.envoyeUai === etat.etabUai));

let jetonEnvoi = 0;
/** Affiche sous la case l'état de la demande et la désactive si une demande est déjà partie ou en attente. */
async function majEnvoiForm(eleveId) {
  const jeton = ++jetonEnvoi;
  const groupe = $('#s-ds-groupe');
  if (!groupe) return;
  let etat = null;
  try {
    viderCache();
    etat = await etatEnvoi(eleveId);
  } catch { /* confort : sans lecture, la case reste utilisable */ }
  if (jeton !== jetonEnvoi || !$('#s-ds')) return;
  if (!etat) { groupe.hidden = true; return; } // la table d'envoi n'existe pas dans ce document
  const note = $('#s-ds-etat');
  const case_ = $('#s-ds');
  if (etat.aEnvoyer) {
    case_.disabled = true;
    note.textContent = "Une demande est déjà en attente : elle partira avec le prochain envoi groupé.";
  } else if (etat.envoyeLe && !etat.suitUai) {
    case_.disabled = true;
    note.textContent = `Une demande a déjà été envoyée le ${formatDateFr(secToIso(etat.envoyeLe))} : elle ne peut pas être renvoyée d'ici.`;
  } else if (etat.envoyeLe) {
    note.textContent = `Une demande est déjà partie le ${formatDateFr(secToIso(etat.envoyeLe))}${etat.envoyeUai ? ` pour l'établissement ${etat.envoyeUai}` : ''} : une nouvelle demande ne part que si l'établissement d'arrivée est différent.`;
  } else {
    note.textContent = "La demande part avec le prochain envoi groupé, une fois l'affectation enregistrée et si le dossier est complet.";
  }
}

// Destinataires écrits par le widget sur la ligne d'envoi (colonnes Dest_email et Cc_email) :
// - Division scolaire : table Config_ULISse (Cle, Valeur), ligne « division_scolaire_email » (la future page de config éditera cette table) ;
// - copie : le coordonnateur du secteur de l'établissement d'arrivée, adresse nominative (Coordos.mel_coordo, jamais mel_secteur),
//   par la chaîne Etablissements_avec_ULIS.Secteur_ERS2 → Secteurs_ERS.Secteurs_CDOEA → Coordos.
const T_CONFIG = 'Config_ULISse';
const T_COORDO = 'Coordos';
const CLE_DIVSCO = 'division_scolaire_email';

const codeErs = (v) => {
  const m = /\d+/.exec(String(v ?? ''));
  return m ? m[0].padStart(3, '0') : '';
};

async function resoudreDestinataires(etabId) {
  const res = { dest: '', cc: '', secteur: '', problemes: [] };
  const cfg = await lireTable(T_CONFIG).catch(() => null);
  if (!cfg || !cfg.Cle) res.problemes.push(`la table ${T_CONFIG} est introuvable (colonnes Cle et Valeur)`);
  else {
    const i = cfg.Cle.findIndex((c) => String(c || '').trim() === CLE_DIVSCO);
    res.dest = i >= 0 ? String(cfg.Valeur[i] || '').trim() : '';
    if (!res.dest) res.problemes.push(`l'adresse de la Division scolaire n'est pas renseignée (${T_CONFIG}, ligne « ${CLE_DIVSCO} »)`);
  }
  // chaîne de secteurs : établissement → Secteur_ERS2 (réf. Secteurs_ERS) → Secteurs_CDOEA (réf. Coordos) → mel_coordo (adresse nominative)
  const [et, se, co] = etabId
    ? await Promise.all([lireTable(state.etabTable), lireTable('Secteurs_ERS'), lireTable(T_COORDO)].map((p) => p.catch(() => null)))
    : [null, null, null];
  if (et && se && co && et.Secteur_ERS2 && se.Secteurs_CDOEA && co.mel_coordo) {
    const k = et.id.indexOf(etabId);
    const j = k >= 0 ? se.id.indexOf(et.Secteur_ERS2[k]) : -1;
    if (j >= 0) {
      res.secteur = String(se.Secteurs_ERS ? se.Secteurs_ERS[j] ?? '' : '').trim();
      const c = co.id.indexOf(se.Secteurs_CDOEA[j]);
      if (c >= 0) res.cc = String(co.mel_coordo[c] || '').trim();
    }
  }
  return res;
}

/** Crée ou prépare la ligne d'envoi puis la marque « à envoyer » si le dossier est complet. Renvoie { statut, manque }. */
async function demanderEnvoiDS(eleveId, etabId) {
  viderCache();
  let etat = await etatEnvoi(eleveId);
  if (!etat) return { statut: 'absente', manque: [] };
  if (etat.aEnvoyer) return { statut: 'en_attente', manque: [] };
  if (demandeDejaPartie(etat)) return { statut: 'envoyee', manque: [] };
  const aujourdhui = isoToSec(new Date().toISOString().slice(0, 10));
  if (!etat.id) {
    await grist.docApi.applyUserActions([['AddRecord', T_ENVOI, null, champsExistants(T_ENVOI, { Eleve: eleveId, Saisie_Date: aujourdhui })]]);
  } else {
    await grist.docApi.applyUserActions([['UpdateRecord', T_ENVOI, etat.id, champsExistants(T_ENVOI, { Saisie_Date: aujourdhui })]]);
  }
  viderCache();
  etat = await etatEnvoi(eleveId); // les formules (Pret…) sont recalculées après l'écriture
  if (!etat || !etat.id) return { statut: 'absente', manque: [] };
  if (!etat.pret) return { statut: 'incomplete', manque: etat.manque };
  const dest = await resoudreDestinataires(etabId);
  if (!dest.dest) return { statut: 'sans_dest', manque: dest.problemes };
  // Dest_email / Cc_email : écrits seulement si ce sont des colonnes de données ; si ce sont des formules (adresses calculées
  // par Grist à partir de Config_ULISse et de la chaîne des secteurs), le widget n'y touche pas.
  const donnees = new Set([...state.colById.values()].filter((c) => c.tableId === T_ENVOI && !c.isFormula).map((c) => c.colId));
  const champs = { A_envoyer: true };
  if (donnees.has('Dest_email')) champs.Dest_email = dest.dest;
  if (donnees.has('Cc_email')) champs.Cc_email = dest.cc;
  await grist.docApi.applyUserActions([['UpdateRecord', T_ENVOI, etat.id, champs]]);
  return { statut: 'ok', manque: [], sansCopie: !dest.cc, secteur: dest.secteur };
}

function openScolForm(ligne, defauts = {}) {
  if (state.edition) return gardeSortie(() => openScolForm(ligne, defauts));
  clearNotice();
  state.editingId = ligne ? ligne.id : null;
  state.editingLigne = ligne;
  const defSituation = ligne ? ligne.situation : state.situations.includes(SITUATION_PAR_DEFAUT) ? SITUATION_PAR_DEFAUT : '';
  const form = $('#form-scol');
  form.replaceChildren(
    h('h3', { class: 'fr-h5', id: 'h-scol-form', tabindex: '-1' }, ligne ? "Modifier l'affectation" : 'Nouvelle affectation'),
    h(
      'div',
      { class: 'fr-input-group fr-mb-2w' },
      h('label', { class: 'fr-label', for: 's-date' }, "Date d'effet", h('span', { class: 'fr-hint-text' }, "Jour de la saisie en cours d'année, ou 1er jour de l'année scolaire pour préparer la rentrée.")),
      h('input', { class: 'fr-input', id: 's-date', type: 'date', required: true, value: ligne ? ligne.date : '' }),
    ),
    combobox({
      id: 's-aff',
      label: 'Affectation',
      hint: ligne && ligne.affectationInvalide
        ? `Valeur actuelle non reconnue : « ${ligne.affectationInvalide} ». Elle est conservée tant que vous ne choisissez pas d'établissement.`
        : 'Saisissez quelques mots du nom ou de la commune.',
      placeholder: 'Rechercher un établissement…',
      options: state.etabs.map((e) => ({ value: e.id, label: e.label })),
      value: ligne ? ligne.affectation : defauts.affectation || '',
      onChange: (id) => { majNiveaux(id); majOccupation(id); },
    }),
    h('div', { id: 's-aff-occup', class: 'fr-mb-2w', role: 'status', 'aria-live': 'polite' }),
    niveauField(ligne, defauts),
    select('s-situation', 'Situation', state.situations.map((s) => ({ value: s, label: s })), defSituation),
    h(
      'div',
      { class: 'fr-toggle fr-mb-3w' },
      h('input', { type: 'checkbox', class: 'fr-toggle__input', id: 's-attente', checked: ligne ? ligne.attente : false }),
      h('label', { class: 'fr-toggle__label', for: 's-attente', 'data-fr-checked-label': 'Oui', 'data-fr-unchecked-label': 'Non' }, "Liste d'attente"),
    ),
    h(
      'div',
      { class: 'fr-checkbox-group fr-mb-3w', id: 's-ds-groupe' },
      h('input', { type: 'checkbox', id: 's-ds', name: 's-ds' }),
      h('label', { class: 'fr-label', for: 's-ds' }, "Envoyer la demande d'affectation à la Division scolaire", h('span', { class: 'fr-hint-text', id: 's-ds-etat', role: 'status', 'aria-live': 'polite' }, '')),
    ),
    h(
      'div',
      { class: 'fr-btns-group fr-btns-group--inline fr-btns-group--icon-left' },
      h('button', { class: 'fr-btn', type: 'submit', title: ligne ? 'Enregistrer les modifications (une confirmation montrera ce qui change)' : 'Enregistrer cette nouvelle ligne d\'affectation' }, 'Enregistrer'),
      h('button', { class: 'fr-btn fr-btn--tertiary', type: 'button', title: 'Fermer le formulaire sans rien enregistrer', onclick: () => gardeSortie(() => {}) }, 'Annuler'),
      ligne ? h('button', { class: 'fr-btn fr-btn--tertiary-no-outline fr-icon-delete-line fr-btn--icon-left', type: 'button', id: 's-suppr', title: 'Supprimer cette ligne d\'affectation (une confirmation sera demandée)', onclick: () => demanderSuppression(ligne) }, 'Supprimer cette affectation') : null,
    ),
  );
  const infos = {
    's-date': "Date à partir de laquelle l'affectation s'applique : un clic ouvre le calendrier. L'affectation « en cours » est la dernière ligne datée d'aujourd'hui ou avant.",
    's-aff': "Établissement d'affectation : saisissez quelques mots du nom ou de la commune, puis choisissez dans la liste. Vide, la ligne n'a pas d'établissement (sortie, retour en classe ordinaire…).",
    's-niveau': "Niveau de l'élève ; la liste dépend du type de l'établissement choisi (école, collège, lycée).",
    's-situation': "Situation de l'élève à cette date : en ULIS, sortie, exclusion, hors département…",
    's-ds': "Coche pour que la demande d'affectation parte à la Division scolaire (avec copie au coordonnateur demandeur) au prochain envoi groupé. Impossible si une demande est déjà en attente ou envoyée.",
    's-attente': "À activer si l'élève est sur liste d'attente pour cet établissement (pas encore affecté)",
  };
  for (const [id, texte] of Object.entries(infos)) {
    const el = $(`#${id}`);
    if (el) el.title = texte;
  }
  form.hidden = false;
  majOccupation(ligne ? ligne.affectation : defauts.affectation || '');
  majEnvoiForm(state.eleve.id);
  // garde de sortie : quitter la page avec une saisie non validée demande confirmation
  const instantane = () => JSON.stringify([$('#s-date')?.value, $('#s-aff')?.dataset.value || '', $('#s-niveau')?.value, $('#s-situation')?.value, $('#s-attente')?.checked, $('#s-ds')?.checked]);
  const depart = instantane();
  state.edition = {
    fermer: fermerFormScol,
    dirty: () => !form.hidden && instantane() !== depart,
    focus: () => $('#s-date')?.focus(),
    message: ligne ? "Vous avez modifié cette affectation sans l'enregistrer : ces changements seront perdus." : "Vous avez commencé une nouvelle affectation sans l'enregistrer : elle sera perdue.",
  };
  $('#h-scol-form').focus();
}

/**
 * Fenêtre modale commune (<dialog> natif : focus piégé, Échap pour fermer).
 * `actions` : [{ id, libelle, secondaire, onClick }] ; le bouton `focus` reçoit le focus à l'ouverture.
 */
function ouvrirModale({ titre, icone = 'fr-icon-warning-line', corps, actions, focus }) {
  const dlg = h(
    'dialog',
    { class: 'modale-confirm', 'aria-labelledby': 'dlg-titre' },
    h('div', { class: 'modale-entete' }, h('h2', { class: `fr-h5 fr-mb-0 ${icone} fr-icon--lg modale-titre`, id: 'dlg-titre' }, titre)),
    h('div', { class: 'modale-corps' }, corps),
    h(
      'div',
      { class: 'modale-pied' },
      h(
        'ul',
        { class: 'fr-btns-group fr-btns-group--inline-md fr-btns-group--right fr-btns-group--inline-reverse' },
        actions.map((a) =>
          h(
            'li',
            {},
            h(
              'button',
              {
                class: `fr-btn${a.secondaire ? ' fr-btn--secondary' : ''}`,
                type: 'button',
                id: a.id,
                title: a.info,
                onclick: () => {
                  dlg.close();
                  a.onClick?.();
                },
              },
              a.libelle,
            ),
          ),
        ),
      ),
    ),
  );
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  $(`#${focus}`).focus();
}

/** Depuis le dossier : ouvre la page des affectations de l'élève avec le formulaire de la ligne choisie. */
async function modifierAffectationDepuisDossier(row, ligne) {
  await chooseEleve(row);
  if (state.edition) return; // l'utilisateur a refusé d'abandonner une saisie en cours
  const l = state.scol.find((x) => x.id === ligne.id);
  if (l) openScolForm(l);
}

function demanderSuppression(ligne, apres = null) {
  if (apres && state.edition) {
    notify('warning', msgSaisieEnCours());
    return;
  }
  const cible = typeof affectationCell(ligne) === 'string' ? affectationCell(ligne) : ligne.affectationInvalide || 'sans établissement';
  ouvrirModale({
    titre: 'Supprimer cette affectation ?',
    corps: [
      h(
        'div',
        { class: 'fr-callout fr-callout--sm fr-mb-2w' },
        h('p', { class: 'fr-callout__text' }, h('strong', {}, dateLabel(ligne)), ` — ${cible}`, ligne.niveau ? ` — ${ligne.niveau}` : '', ligne.situation ? ` — ${ligne.situation}` : ''),
      ),
      h('p', { class: 'fr-text--sm fr-mb-0' }, "Dans Grist, le panneau Activité permet d'annuler la suppression."),
    ],
    actions: [
      { id: 'dlg-oui', libelle: 'Oui, supprimer', info: 'Supprimer définitivement cette ligne (annulable dans le panneau Activité de Grist)', onClick: () => supprimerLigne(ligne, apres) },
      { id: 'dlg-non', libelle: 'Non, garder', info: 'Fermer cette fenêtre : rien n\'est supprimé', secondaire: true },
    ],
    focus: 'dlg-non', // le choix par défaut est de ne rien supprimer
  });
}

async function supprimerLigne(ligne, apres = null) {
  try {
    viderCache();
    await grist.docApi.applyUserActions([['RemoveRecord', T_SCOLARITE, ligne.id]]);
    // Depuis un dossier ouvert hors de la page des affectations (exclus, dispositif, ERS, vœux), aucun élève n'est sélectionné :
    // on ne rafraîchit la liste de la page que si elle porte bien l'élève de la ligne supprimée.
    const surPage = Boolean(state.eleve) && state.eleve.id === ligne.eleve;
    if (surPage) await refreshScolarite(state.eleve.id);
    fermerFormScol();
    if (surPage) renderScolList();
    if (apres) await apres(); // suppression depuis le dossier : on y reste, mis à jour
    notify('success', 'Affectation supprimée.');
  } catch (err) {
    notify('error', `Suppression impossible : ${err.message}`);
  }
}

/** Confirmation d'un ajout : récapitulatif des valeurs qui vont être écrites (champ, valeur). */
function confirmerAjout(titre, champs, onOui) {
  ouvrirModale({
    titre,
    icone: 'fr-icon-check-line',
    corps: [
      h(
        'table',
        { class: 'modale-diff' },
        h('caption', { class: 'fr-sr-only' }, 'Valeurs à enregistrer'),
        h('thead', {}, h('tr', {}, ['Champ', 'Valeur'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, champs.map(([champ, valeur]) => h('tr', {}, h('th', { scope: 'row' }, champ), h('td', { class: 'diff-apres' }, valeur)))),
      ),
    ],
    actions: [
      { id: 'dlg-oui', libelle: 'Oui, ajouter', info: 'Écrire ces informations dans Grist', onClick: onOui },
      { id: 'dlg-non', libelle: 'Revenir au formulaire', info: "Fermer cette fenêtre et continuer la saisie : rien n'est enregistré", secondaire: true },
    ],
    focus: 'dlg-oui',
  });
}

/** Confirmation d'une modification : tableau « avant → après » des seuls champs changés. */
function confirmerModification(modifs, onOui, avertissement = '') {
  ouvrirModale({
    titre: 'Enregistrer ces modifications ?',
    icone: 'fr-icon-check-line',
    corps: [
      avertissement ? h('p', { class: 'fr-alert fr-alert--warning fr-alert--sm fr-mb-2w' }, avertissement) : null,
      h(
      'table',
      { class: 'modale-diff' },
      h('caption', { class: 'fr-sr-only' }, 'Modifications à enregistrer'),
      h('thead', {}, h('tr', {}, ['Champ', 'Avant', 'Après'].map((t) => h('th', { scope: 'col' }, t)))),
      h(
        'tbody',
        {},
        modifs.map(([champ, avant, apres]) =>
          h('tr', {}, h('th', { scope: 'row' }, champ), h('td', { class: 'diff-avant' }, avant), h('td', { class: 'diff-apres' }, apres)),
        ),
      ),
    ),
    ],
    actions: [
      { id: 'dlg-oui', libelle: 'Oui, enregistrer', info: 'Écrire ces modifications dans Grist', onClick: onOui },
      { id: 'dlg-non', libelle: 'Revenir au formulaire', info: 'Fermer cette fenêtre et continuer la modification : rien n\'est enregistré', secondaire: true },
    ],
    focus: 'dlg-oui',
  });
}

async function ecrireAffectation(fields, { envoyerDS = false, etabId = 0 } = {}) {
  try {
    const eleveId = state.eleve.id;
    const modif = Boolean(state.editingId);
    if (fields) {
      const action = state.editingId
        ? ['UpdateRecord', T_SCOLARITE, state.editingId, fields]
        : ['AddRecord', T_SCOLARITE, null, { ...fields, [COL.eleve]: eleveId }];
      viderCache();
      await grist.docApi.applyUserActions([action]);
    }
    await refreshScolarite();
    fermerFormScol();
    renderScolList();
    const base = !fields ? '' : modif ? 'Affectation modifiée.' : 'Affectation enregistrée.';
    if (!envoyerDS) {
      notify('success', base);
      return;
    }
    let r;
    try {
      r = await demanderEnvoiDS(eleveId, etabId);
    } catch (err) {
      notify('error', `${base} Mais la demande à la Division scolaire n'a pas pu être enregistrée : ${err.message}`);
      return;
    }
    const msg = {
      ok: r.sansCopie
        ? ['warning', `Demande à la Division scolaire enregistrée (envoi groupé), mais sans copie : aucun coordonnateur trouvé pour le secteur ${r.secteur || 'de cet établissement'} (chaîne Secteur_ERS2 → Secteurs_ERS → Coordos).`]
        : ['success', "Demande à la Division scolaire enregistrée : elle partira avec le prochain envoi groupé, copie au coordonnateur."],
      sans_dest: ['warning', `Demande non envoyée : ${r.manque.join(' ; ')}.`],
      en_attente: ['info', 'Une demande était déjà en attente : rien de plus à faire.'],
      envoyee: ['warning', 'Une demande a déjà été envoyée pour cet élève et cet établissement : elle n\'a pas été renvoyée.'],
      absente: ['warning', `La table ${T_ENVOI} est introuvable : la demande n'a pas été enregistrée.`],
      incomplete: ['warning', `Demande non envoyée : il manque ${r.manque.join(', ')}. Complétez le dossier puis recochez la case.`],
    }[r.statut];
    notify(msg[0], `${base} ${msg[1]}`.trim());
  } catch (err) {
    notify('error', `Enregistrement impossible : ${err.message}`);
  }
}

$('#form-scol').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearNotice();
  const form = $('#form-scol');
  clearFieldErrors(form);
  const iso = $('#s-date').value;
  const affInput = $('#s-aff');
  let ok = true;
  if (!iso || isoToSec(iso) === null) {
    setFieldError('s-date', "La date d'effet est obligatoire.");
    ok = false;
  }
  if (affInput.value.trim() && !affInput.dataset.value) {
    setFieldError('s-aff', 'Choisissez un établissement dans la liste, ou videz le champ.');
    ok = false;
  }
  if (!ok) {
    form.querySelector('[aria-invalid]')?.focus();
    return;
  }
  const fields = {
    [COL.dateEffet]: isoToSec(iso),
    [COL.niveau]: $('#s-niveau').value,
    [COL.situation]: $('#s-situation').value,
    [COL.attente]: $('#s-attente').checked,
  };
  // Affectation : écrite seulement si elle change (une valeur non reconnue n'est pas effacée par un simple enregistrement).
  const aff = Number(affInput.dataset.value) || 0;
  if (!state.editingLigne || aff !== (state.editingLigne.affectation || 0)) fields[COL.affectation] = aff;
  const envoyerDS = Boolean($('#s-ds')?.checked) && !$('#s-ds')?.disabled;
  let texteDS = 'Oui : partira avec le prochain envoi groupé (si le dossier est complet)';
  if (envoyerDS) {
    try {
      const d = await resoudreDestinataires(aff);
      if (!d.dest) {
        notify('error', `Impossible d'envoyer la demande à la Division scolaire : ${d.problemes.join(' ; ')}.`);
        $('#s-ds').focus();
        return;
      }
      texteDS = `Oui : à ${d.dest}, copie ${d.cc || 'aucune (pas de coordonnateur trouvé pour ce secteur)'}`;
    } catch (err) {
      notify('error', `Destinataires illisibles : ${err.message}`);
      return;
    }
  }
  const ligneDS = ["Demande à la Division scolaire", texteDS];
  if (state.editingLigne) {
    const avant = state.editingLigne;
    const dessus = (v) => v || '—';
    const modifs = [];
    if (iso !== (avant.date || '')) modifs.push(["Date d'effet", dateLabel(avant), formatDateFr(iso)]);
    if (aff !== (avant.affectation || 0)) modifs.push(['Affectation', affectationCell(avant) === '—' ? '—' : typeof affectationCell(avant) === 'string' ? affectationCell(avant) : avant.affectationInvalide, aff ? state.etabLabel.get(aff) || `#${aff}` : '—']);
    if ($('#s-niveau').value !== (avant.niveau || '')) modifs.push(['Niveau', dessus(avant.niveau), dessus($('#s-niveau').value)]);
    if ($('#s-situation').value !== (avant.situation || '')) modifs.push(['Situation', dessus(avant.situation), dessus($('#s-situation').value)]);
    if ($('#s-attente').checked !== avant.attente) modifs.push(["Liste d'attente", avant.attente ? 'Oui' : 'Non', $('#s-attente').checked ? 'Oui' : 'Non']);
    if (modifs.length === 0 && !envoyerDS) {
      notify('info', 'Aucune modification à enregistrer.');
      return;
    }
    if (envoyerDS) modifs.push(['Demande à la Division scolaire', 'Non', texteDS]);
    const aEcrire = modifs.length > (envoyerDS ? 1 : 0);
    confirmerModification(modifs, () => ecrireAffectation(aEcrire ? fields : null, { envoyerDS, etabId: aff }));
    return;
  }
  confirmerAjout("Ajouter cette affectation ?", [
    ["Date d'effet", formatDateFr(iso) || '—'],
    ['Affectation', aff ? state.etabLabel.get(aff) || `#${aff}` : '—'],
    ['Niveau', $('#s-niveau').value || '—'],
    ['Situation', $('#s-situation').value || '—'],
    ["Liste d'attente", $('#s-attente').checked ? 'Oui' : 'Non'],
    ...(envoyerDS ? [ligneDS] : []),
  ], () => ecrireAffectation(fields, { envoyerDS, etabId: aff }));
});

/* ------------------------------------------------------------------ */
/* Accueil : recherche d'un établissement ; page du dispositif          */
/* ------------------------------------------------------------------ */
// Le titre ramène à l'accueil (en passant par la garde de sortie si une modification de dossier est en cours).
$('#app-titre').addEventListener('click', () => gardeSortie(() => { clearNotice(); goto(1); }));

const retourAccueil = () => ({ libelle: "Revenir à l'accueil", action: () => goto(1) });
const retourResultats = () => ({ libelle: 'Revenir à la page de résultats', action: () => goto(2) });
const retourAffectations = () => ({ libelle: 'Revenir aux affectations', action: () => goto(3) });
const retourDossierDe = (row, origine) => ({ libelle: 'Revenir au dossier', action: () => openDossier(row, origine) });

/** Nom d'établissement cliquable (ouvre la page du dispositif) ; sans établissement, la cellule habituelle. */
function lienEtab(l, retour) {
  if (!l || !l.affectation) return affectationCell(l || {});
  return h(
    'button',
    {
      type: 'button',
      class: 'fr-link lien-etab',
      title: "Ouvrir le dispositif de cet établissement : élèves présents, effectifs, coordonnées",
      onclick: () => openDispositif(l.affectation, retour),
    },
    state.etabLabel.get(l.affectation) || `#${l.affectation}`,
  );
}

const optionsEtab = () => state.etabs.map((e) => ({ value: e.id, label: e.label }));

$('#form-etab').addEventListener('submit', (e) => {
  e.preventDefault();
  clearNotice();
  clearFieldErrors($('#form-etab'));
  const box = $('#etab-results');
  box.replaceChildren();
  const q = $('#qe').value.trim();
  if (norm(q).length < 2) {
    setFieldError('qe', "Saisissez au moins 2 lettres du nom, de la commune ou de l'UAI.");
    $('#qe').focus();
    return;
  }
  const { total, rows } = filterOptions(optionsEtab(), q, 20);
  if (total === 0) {
    box.replaceChildren(h('div', { class: 'fr-alert fr-alert--info fr-alert--sm' }, h('p', {}, 'Aucun établissement avec ULIS ne correspond.')));
    return;
  }
  if (total === 1) {
    openDispositif(rows[0].value, retourAccueil());
    return;
  }
  box.replaceChildren(
    h('p', { role: 'status', class: 'fr-mb-1w' }, `${total} établissements correspondent${total > rows.length ? ` (les ${rows.length} premiers sont affichés : précisez la recherche)` : ''} :`),
    h('ul', { class: 'liste-etabs' }, rows.map((r) => h('li', {}, h('button', { type: 'button', class: 'fr-link lien-etab', title: 'Ouvrir le dispositif de cet établissement', onclick: () => openDispositif(r.value, retourAccueil()) }, r.label)))),
  );
});
$('#qe').addEventListener('input', () => $('#etab-results').replaceChildren());

attachSuggest($('#qe'), {
  minChars: 2,
  fetchItems: (query) => filterOptions(optionsEtab(), query, 8).rows,
  onPick: (item) => {
    $('#qe').value = item.label;
    openDispositif(item.value, retourAccueil());
  },
});

// Colonnes de `Etablissements_avec_ULIS` affichées dans la page du dispositif (ignorées si elles n'existent pas).
const INFOS_ETAB = [
  { col: 'Uai', libelle: 'UAI' },
  { col: 'Commune', libelle: 'Commune' },
  { col: 'Secteur_ERS', libelle: 'Secteur ERS' },
  { col: 'Uai_ERSH', libelle: 'ERSH' },
  { col: 'Secteur_CDOEA', libelle: 'Secteur CDOEA' },
  { col: 'Uai_Coordo_CDOEA', libelle: 'Coordonnateur CDOEA' },
  { col: 'Nombre_de_dispositifs', libelle: 'Nombre de dispositifs' },
  { col: 'Ouverture', libelle: 'Dispositif en ouverture' },
];
const COL_PLACES = 'Places_max'; // capacité calculée par Grist
const COL_EFFECTIF_GRIST = 'Effectif'; // décompte de Grist, comparé au nôtre
// Coordonnées : la table liée par `Uai` (Etablissements_ERS) ; colonnes repérées par leur nom ou leur libellé.
const INFOS_UAI = [
  { re: /adresse/i, libelle: 'Adresse' },
  { re: /(^|[^a-z])cp([^a-z]|$)|postal/i, libelle: 'Code postal' },
  { re: /t[eé]l/i, libelle: 'Téléphone professionnel' },
  // Etablissements_ERS a deux courriels (« Mail SECTEUR » et « Mail ac. (ERSH) ») : on les distingue.
  { re: /(mail|courriel).*secteur/i, libelle: "Courriel du secteur (référent)" },
  { re: /(mail|courriel).*(ersh|ac\.)/i, libelle: "Courriel de l'ERSH" },
  { re: /mail|courriel/i, libelle: 'Courriel' },
  { re: /direct|chef/i, libelle: "Directeur ou chef d'établissement" },
];

async function valeurColonne(col, v) {
  if (v === null || v === undefined || v === '') return '';
  if (isInvalidCell(v)) return cellText(v);
  const t = col.type || '';
  if (t === 'Date' || t.startsWith('DateTime')) return typeof v === 'number' ? formatDateFr(secToIso(v)) : cellText(v);
  if (t === 'Bool') return v ? 'Oui' : 'Non';
  if (t.startsWith('Ref:') || t.startsWith('RefList:')) {
    const ids = (Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'number');
    if (!ids.length) return '';
    const tab = await lireTable(t.slice(t.indexOf(':') + 1));
    const vis = state.colById.get(col.visibleCol)?.colId;
    return ids.map((id) => {
      const i = tab.id.indexOf(id);
      return i >= 0 && vis && tab[vis] ? cellText(tab[vis][i]) : `#${id}`;
    }).join(', ');
  }
  return cellText(v);
}

/** Informations de l'établissement : { infos: [{ libelle, valeur }], places, effectifGrist, coords }. */
async function infosEtab(etabId) {
  const t = await lireTable(state.etabTable);
  const i = t.id.indexOf(etabId);
  const vide = { infos: [], places: null, effectifGrist: null, coords: 0 };
  if (i < 0) return vide;
  const colDe = (id) => state.etabCols.find((c) => c.colId === id && t[id]);
  const infos = [];
  for (const { col, libelle } of INFOS_ETAB) {
    const c = colDe(col);
    // une formule en erreur n'a rien à montrer : la ligne est omise plutôt qu'affichée « erreur AttributeError »
    if (c && !isFormulaError(t[col][i])) infos.push({ libelle, valeur: await valeurColonne(c, t[col][i]) });
  }
  let coords = 0;
  const uai = colDe('Uai');
  if (uai && uai.type.startsWith('Ref:')) {
    const tableUai = uai.type.slice(4);
    const tabU = await lireTable(tableUai);
    const refId = t.Uai[i];
    const j = typeof refId === 'number' ? tabU.id.indexOf(refId) : -1;
    const colsU = [...state.colById.values()].filter((c) => c.tableId === tableUai).sort((x, y) => x.pos - y.pos);
    const pris = new Set();
    for (const { re, libelle } of INFOS_UAI) {
      const c = colsU.find((x) => !pris.has(x.colId) && tabU[x.colId] && x.type !== 'Attachments' && re.test(`${x.colId} ${x.label || ''}`));
      if (!c) continue;
      pris.add(c.colId);
      coords += 1;
      if (j >= 0 && isFormulaError(tabU[c.colId][j])) continue;
      infos.push({ libelle, valeur: j >= 0 ? await valeurColonne(c, tabU[c.colId][j]) : '' });
    }
  }
  const nombre = (id) => {
    const v = colDe(id) ? t[id][i] : null;
    return typeof v === 'number' ? v : null;
  };
  return { infos, places: nombre(COL_PLACES), effectifGrist: nombre(COL_EFFECTIF_GRIST), coords };
}

/** ERS de référence d'un établissement : secteur, nom, courriels (lignes `{ libelle, valeur }`). Vide si rien n'est renseigné. */
const INFOS_ERS_REF = ['Secteur ERS', 'ERSH', 'Courriel du secteur (référent)', "Courriel de l'ERSH"];
async function ersDeEtab(etabId) {
  try {
    if (!etabId) return [];
    return (await infosEtab(etabId)).infos.filter((x) => x.valeur && INFOS_ERS_REF.includes(x.libelle));
  } catch {
    return []; // l'ERS est un plus : sa lecture ne doit jamais empêcher d'afficher la page
  }
}
async function chargerDispositif(etabId) {
  const [tScol, tInd, etab] = await Promise.all([lireTable(T_SCOLARITE), lireTable(T_INDIVIDUS), infosEtab(etabId)]);
  state.individus = toIndividus(tInd);
  const lignes = lignesDe(tScol);
  return { lignes, tInd, etab, parId: new Map(state.individus.map((r) => [r.id, r])), idx: new Map(tInd.id.map((id, i) => [id, i])) };
}

async function openDispositif(etabId, retour, { garder = false } = {}) {
  if (state.edition) return gardeSortie(() => openDispositif(etabId, retour, { garder }));
  clearNotice();
  let data;
  try {
    data = await chargerDispositif(etabId);
  } catch (err) {
    notify('error', `Lecture du dispositif impossible : ${err.message}`);
    return;
  }
  const prec = garder && state.dispo && state.dispo.etabId === etabId ? state.dispo : null;
  state.dispo = { etabId, retour, data, tri: prec ? prec.tri : { cle: 'nom', dir: 1 }, inclureAttente: prec ? prec.inclureAttente : false, ajout: false };
  const label = state.etabLabel.get(etabId) || `#${etabId}`;
  state.step = 0;
  masquerPages();
  $('#step-dispo').hidden = false;
  $('#stepper').replaceChildren(
    h(
      'div',
      { class: 'fr-stepper' },
      h('h1', { class: 'fr-stepper__title', id: 'h-dispo', tabindex: '-1' }, `Dispositif ULIS : ${label}`),
      h('p', { class: 'fr-stepper__details' }, "Élèves présents d'après leur affectation en cours dans Scolarite. Un clic sur un nom ouvre le dossier."),
    ),
    h(
      'nav',
      { 'aria-label': 'Navigation', class: 'step-nav fr-mb-2w' },
      h('button', { type: 'button', class: 'fr-btn fr-btn--tertiary fr-btn--sm fr-btn--icon-left fr-icon-arrow-left-s-line', title: 'Quitter la page du dispositif', onclick: () => { clearNotice(); retour.action(); } }, retour.libelle),
    ),
  );
  rendreDispositif();
  $('#h-dispo').focus();
}

function enteteTri(libelle, cle, onTri, tri = state.dispo.tri) {
  const actif = tri.cle === cle;
  return h(
    'th',
    { scope: 'col', 'aria-sort': actif ? (tri.dir === 1 ? 'ascending' : 'descending') : 'none' },
    h(
      'button',
      { type: 'button', class: 'fr-link btn-tri', 'data-tri': cle, title: `Trier par ${libelle.toLowerCase()} ; un second clic inverse l'ordre`, onclick: () => onTri(cle) },
      libelle,
      h('span', { 'aria-hidden': 'true' }, actif ? (tri.dir === 1 ? ' ▲' : ' ▼') : ''),
    ),
  );
}

/** Libellés des informations manquantes d'un élève de la liste du dispositif (niveau exigé seulement pour un élève affecté). */
function manquesDispo(e) {
  return infosManquantes(e.row, { affecte: e.statut === 'present', niveau: e.niveau });
}

/** Nom affiché d'un élève du dispositif ; une fiche sans nom ni prénom reste repérable par son numéro. */
function nomDispo(e) {
  return `${e.nom} ${e.prenom}`.trim() || `Fiche sans nom (n° ${e.row.id})`;
}

/** Pastille de la liste du dispositif : indique ce qui manque sur cet élève. */
function badgeManques(e) {
  const m = manquesDispo(e);
  if (!m.length) return null;
  return h('p', { class: 'fr-badge fr-badge--warning fr-badge--sm fr-badge--no-icon', title: `Information manquante : ${m.join(', ')}` }, `Manque : ${m.join(', ')}`);
}

/** Panneau d'alerte des dossiers incomplets du dispositif : un lien par élève concerné, avec ce qui manque. */
function panneauIncomplets(eleves) {
  const liste = eleves.map((e) => ({ e, m: manquesDispo(e) })).filter((x) => x.m.length);
  if (!liste.length) return h('span');
  const n = liste.length;
  return h(
    'div',
    { class: 'fr-alert fr-alert--warning fr-alert--sm fr-mb-2w', id: 'dispo-incomplets', role: 'status' },
    h('p', { class: 'fr-alert__title' }, n > 1 ? `${n} dossiers incomplets` : 'Dossier incomplet'),
    h(
      'ul',
      { class: 'fr-mb-1w' },
      liste.map(({ e, m }) =>
        h(
          'li',
          {},
          h('button', { type: 'button', class: 'fr-link lien-etab', title: 'Ouvrir le dossier de cet élève pour le compléter', onclick: () => openDossier(e.row, 'dispo') }, nomDispo(e)),
          ` : il manque ${m.join(', ')}`,
        ),
      ),
    ),
    h('p', { class: 'fr-text--sm fr-mb-0' }, 'Ouvrez le dossier pour compléter.'),
  );
}

/** Panneau d'alerte sur les fins de droits des élèves affichés (rouge si l'une est échue, orange sinon). */
function panneauAlertes(eleves, d, onTri) {
  const todayIso = new Date().toISOString().slice(0, 10);
  let echues = 0;
  let proches = 0;
  for (const e of eleves) {
    const a = alerteFinDroits(e.fin, todayIso, FIN_DROITS_ALERTE_JOURS);
    if (a && a.niveau === 'expiree') echues += 1;
    else if (a && a.niveau === 'proche') proches += 1;
  }
  if (!echues && !proches) return h('span');
  const mois = Math.round(FIN_DROITS_ALERTE_JOURS / 30);
  const texte = [echues ? `${echues} fin${echues > 1 ? 's' : ''} de droits échue${echues > 1 ? 's' : ''}` : null, proches ? `${proches} dans les ${mois} mois` : null].filter(Boolean).join(' · ');
  return h(
    'div',
    { class: 'fr-mb-2w', id: 'dispo-alertes' },
    h('div', { class: `fr-alert fr-alert--${echues ? 'error' : 'warning'} fr-alert--sm`, role: 'status' }, h('p', { class: 'fr-alert__title' }, 'Fins de droits à surveiller'), h('p', {}, texte)),
    h('button', { class: 'fr-btn fr-btn--sm fr-btn--secondary fr-mt-1w', type: 'button', title: 'Classer les élèves par fin de droits, les plus anciennes en premier', onclick: () => onTri('fin', true) }, 'Trier par fin de droits'),
  );
}

/** Panneau « Ajouter un élève » : recherche (suggestions) ou création de fiche, puis formulaire d'affectation prérempli. */
function panneauAjout(d) {
  const label = state.etabLabel.get(d.etabId) || 'cet établissement';
  const res = h('div', { id: 'dispo-ajout-res', class: 'fr-mt-2w' });
  const input = h('input', { class: 'fr-input', id: 'dispo-q', type: 'text', autocomplete: 'off', title: "Saisissez une partie du nom, du prénom ou de la date de naissance de l'élève à ajouter. Les suggestions apparaissent dès 2 caractères." });
  const form = h(
    'form',
    { id: 'form-ajout', novalidate: true },
    h(
      'div',
      { class: 'fr-input-group' },
      h('label', { class: 'fr-label', for: 'dispo-q' }, 'Rechercher l\'élève à ajouter', h('span', { class: 'fr-hint-text' }, `Un clic sur une suggestion ouvre le formulaire d'affectation de l'élève à ${label}.`)),
      input,
    ),
    h(
      'ul',
      { class: 'fr-btns-group fr-btns-group--inline fr-mt-2w' },
      h('li', {}, h('button', { class: 'fr-btn', type: 'submit', title: 'Chercher les fiches correspondantes' }, 'Rechercher')),
      h('li', {}, h('button', { class: 'fr-btn fr-btn--secondary', type: 'button', id: 'dispo-creer', title: "L'élève n'a pas encore de fiche : ouvrir la page de création, puis revenir ici pour l'affecter", onclick: () => gotoCreate({ etabId: d.etabId }) }, 'Créer une nouvelle fiche')),
      h('li', {}, h('button', { class: 'fr-btn fr-btn--tertiary', type: 'button', title: 'Fermer ce panneau', onclick: () => { d.ajout = false; rendreDispositif(); $('#dispo-ajouter')?.focus(); } }, 'Annuler')),
    ),
    res,
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    const q = input.value.trim();
    if (norm(q).length < 2 && !/\d{4}/.test(q)) {
      setFieldError('dispo-q', 'Saisissez au moins 2 lettres du nom ou du prénom, ou une année de naissance.');
      input.focus();
      return;
    }
    const { total, rows } = rechercheLibre(state.individus, q, 20);
    if (total === 0) {
      res.replaceChildren(h('div', { class: 'fr-alert fr-alert--info fr-alert--sm' }, h('p', {}, 'Aucune fiche ne correspond : vous pouvez la créer.')));
    } else if (total === 1) {
      ajouterAuDispositif(rows[0]);
    } else {
      res.replaceChildren(
        h('p', { role: 'status', class: 'fr-mb-1w' }, `${total} fiches correspondent${total > rows.length ? ` (les ${rows.length} premières sont affichées : précisez la recherche)` : ''} :`),
        h('ul', { class: 'liste-etabs' }, rows.map((r) => h('li', {}, h('button', { type: 'button', class: 'fr-link lien-etab', title: `Ajouter cet élève : ouvrir son formulaire d'affectation à ${label}`, onclick: () => ajouterAuDispositif(r) }, libelleEleve(r))))),
      );
    }
  });
  input.addEventListener('input', () => res.replaceChildren());
  return h('div', { id: 'dispo-ajout', class: 'fr-mb-3w ajout-eleve' }, form);
}

/** Élève choisi dans le panneau : étape 3 avec le formulaire de nouvelle affectation, établissement prérempli. */
function ajouterAuDispositif(row) {
  return chooseEleve(row, { affecterA: state.dispo.etabId });
}

/** Interrupteur « liste d'attente » d'un élève de la liste : demande confirmation, puis écrit dans sa ligne d'affectation en cours. */
function basculeAttenteEleve(e) {
  const id = `attente-${e.ligneId}`;
  return h(
    'div',
    { class: 'fr-toggle' },
    h('input', {
      type: 'checkbox',
      class: 'fr-toggle__input',
      id,
      checked: e.attente,
      disabled: lectureSeule(),
      'aria-label': `Liste d'attente pour ${e.nom} ${e.prenom}`,
      onchange: (ev) => {
        const vers = ev.target.checked;
        ev.target.checked = !vers; // l'état ne change qu'après confirmation et écriture
        demanderBasculeAttente(e, vers);
      },
    }),
    h('label', { class: 'fr-toggle__label', for: id, 'data-fr-checked-label': 'Oui', 'data-fr-unchecked-label': 'Non', title: e.attente ? "Retirer cet élève de la liste d'attente (il redevient présent)" : "Mettre cet élève en liste d'attente (il ne compte plus parmi les présents)" }, 'Liste d\'attente'),
  );
}

function demanderBasculeAttente(e, vers) {
  const d = state.dispo;
  const etab = state.etabLabel.get(d.etabId) || 'cet établissement';
  ouvrirModale({
    titre: vers ? "Mettre cet élève en liste d'attente ?" : "Retirer cet élève de la liste d'attente ?",
    corps: [
      h('div', { class: 'fr-callout fr-callout--sm fr-mb-2w' }, h('p', { class: 'fr-callout__text' }, h('strong', {}, `${e.nom} ${e.prenom}`.trim()), ` — ${etab}`, e.niveau ? ` — ${e.niveau}` : '')),
      h('p', {}, vers ? "L'élève ne sera plus compté parmi les présents de ce dispositif." : "L'élève sera compté parmi les présents de ce dispositif."),
      h('p', { class: 'fr-text--sm fr-mb-0' }, "Seule la case « Liste d'attente » de sa ligne d'affectation en cours change ; Grist garde l'historique (panneau Activité)."),
    ],
    actions: [
      { id: 'dlg-oui', libelle: vers ? "Oui, mettre en liste d'attente" : "Oui, retirer de la liste d'attente", info: "Enregistrer ce changement dans Scolarite", onClick: () => basculerAttente(d, e, vers) },
      { id: 'dlg-non', libelle: 'Non, ne rien changer', info: "Fermer cette fenêtre : rien n'est modifié", secondaire: true },
    ],
    focus: 'dlg-non',
  });
}

async function basculerAttente(d, e, vers) {
  try {
    viderCache();
    await grist.docApi.applyUserActions([['UpdateRecord', T_SCOLARITE, e.ligneId, { [COL.attente]: vers }]]);
    d.data = await chargerDispositif(d.etabId);
    if (state.dispo === d) rendreDispositif();
    notify('success', `${`${e.nom} ${e.prenom}`.trim()} ${vers ? "est en liste d'attente." : "n'est plus en liste d'attente."}`);
  } catch (err) {
    notify('error', `Modification impossible : ${err.message}`);
  }
}

/** Bascule DSFR d'affichage des élèves de la liste d'attente (option conservée au retour). */
function basculeDispo(id, cle, libelle, aide) {
  const d = state.dispo;
  return h(
    'div',
    { class: 'fr-toggle fr-mb-1w' },
    h('input', { type: 'checkbox', class: 'fr-toggle__input', id, checked: d[cle], onchange: (e) => { d[cle] = e.target.checked; rendreDispositif(); $(`#${id}`)?.focus(); } }),
    h('label', { class: 'fr-toggle__label', for: id, 'data-fr-checked-label': 'Oui', 'data-fr-unchecked-label': 'Non', title: aide }, libelle),
  );
}

function rendreDispositif() {
  const d = state.dispo;
  const { lignes, tInd, etab, parId, idx } = d.data;
  const todayIso = new Date().toISOString().slice(0, 10);
  const { rows, presents, attente, autres } = elevesDuDispositif(lignes, d.etabId, todayIso, { inclureAttente: d.inclureAttente, situationPresent: SITUATION_PAR_DEFAUT });
  const eleves = [];
  for (const { eleve, ligne, statut } of rows) {
    const row = parId.get(eleve);
    const i = idx.get(eleve);
    if (!row || i === undefined) continue; // fiche supprimée d'Individus
    eleves.push({
      row,
      ligneId: ligne.id,
      statut,
      nom: row.nom,
      prenom: row.prenom,
      niveau: ligne.niveau,
      situation: ligne.situation,
      attente: ligne.attente,
      premiere: secToIso(tInd.Premiere_notif_ULIS ? tInd.Premiere_notif_ULIS[i] : undefined),
      fin: secToIso(tInd.Fin_droits_ULIS ? tInd.Fin_droits_ULIS[i] : undefined),
    });
  }
  const tries = trierEleves(eleves, d.tri.cle, d.tri.dir, state.niveaux);
  const onTri = (cle, croissant = false) => {
    d.tri = { cle, dir: !croissant && d.tri.cle === cle ? -d.tri.dir : 1 };
    rendreDispositif();
    $(`#dispo [data-tri="${cle}"]`)?.focus();
  };
  const typeLibelle = { ECO: 'École', CLG: 'Collège', LYC: 'Lycée' }[state.etabType.get(d.etabId)] || state.etabTypeBrut.get(d.etabId) || '';
  const effectifs = [`${presents} élève${presents > 1 ? 's' : ''} présent${presents > 1 ? 's' : ''}${etab.places !== null ? ` sur ${etab.places} places` : ''}`, attente ? `${attente} en liste d'attente` : null, autres ? `${autres} dans une autre situation` : null].filter(Boolean).join(' · ');
  const box = $('#dispo');
  box.replaceChildren(
    h('h2', { class: 'fr-h6' }, "Informations sur l'établissement"),
    tableauInfos([
      ['Effectifs', badgeOccupation(presents, etab.places) ? [effectifs, ' ', badgeOccupation(presents, etab.places)] : effectifs, true],
      etab.effectifGrist !== null && etab.effectifGrist !== presents ? ['Effectif calculé par Grist', `${etab.effectifGrist} (colonne ${COL_EFFECTIF_GRIST}, différent du décompte ci-dessus)`, true] : null,
      typeLibelle ? ['Type', typeLibelle] : null,
      ...etab.infos.map((x) => [x.libelle, lienContact(x.libelle, x.valeur)]),
    ].filter(Boolean), "Informations sur l'établissement"),
    etab.coords === 0
      ? h('p', { class: 'fr-hint-text fr-mb-2w' }, "Coordonnées : aucune colonne reconnue (code postal, téléphone, courriel) dans la table liée par Uai.")
      : h('span'),
    h('h2', { class: 'fr-h6 fr-mt-2w' }, 'Élèves du dispositif'),
    panneauAlertes(eleves, d, onTri),
    panneauIncomplets(eleves),
    h(
      'div',
      { class: 'toggles-ligne fr-mb-2w' },
      basculeDispo('dispo-attente', 'inclureAttente', `Liste d'attente (${attente})`, "Afficher aussi, dans la liste, les élèves en liste d'attente pour cet établissement"),
    ),
    eleves.length === 0
      ? h('p', {}, d.inclureAttente ? "Aucun élève à afficher avec cette option." : "Aucun élève présent dans ce dispositif.")
      : h(
          'div',
          { class: 'fr-table fr-table--no-caption' },
          h(
            'div',
            { class: 'fr-table__wrapper' },
            h(
              'div',
              { class: 'fr-table__container' },
              h(
                'div',
                { class: 'fr-table__content' },
                h(
                  'table',
                  {},
                  h('caption', {}, `Élèves du dispositif, triés par ${{ nom: 'nom', classe: 'classe', premiere: 'date de première notification', fin: 'fin de droits' }[d.tri.cle]}`),
                  h('thead', {}, h('tr', {},
                    enteteTri('Élève', 'nom', onTri),
                    enteteTri('Classe', 'classe', onTri),
                    h('th', { scope: 'col' }, 'Situation'),
                    h('th', { scope: 'col' }, "Liste d'attente"),
                    enteteTri('Première notification', 'premiere', onTri),
                    enteteTri('Fin de droits', 'fin', onTri),
                  )),
                  h(
                    'tbody',
                    {},
                    tries.map((e) =>
                      h(
                        'tr',
                        {},
                        h('td', {}, h('button', { type: 'button', class: 'fr-link lien-etab', 'aria-label': `Dossier de ${nomDispo(e)}`, title: "Ouvrir le dossier de cet élève", onclick: () => openDossier(e.row, 'dispo') }, nomDispo(e)), badgeManques(e) ? [h('br'), badgeManques(e)] : null),
                        h('td', {}, e.niveau || '—'),
                        h('td', {}, e.situation || '—', e.attente ? [' ', h('p', { class: 'fr-badge fr-badge--info fr-badge--sm fr-badge--no-icon' }, "Liste d'attente")] : null),
                        h('td', {}, e.statut === 'autre' ? '—' : basculeAttenteEleve(e)),
                        h('td', { class: 'nowrap' }, formatDateFr(e.premiere) || '—'),
                        h('td', {}, h('span', { class: 'nowrap' }, formatDateFr(e.fin) || '—'), badgeFin(e.fin) ? [h('br'), badgeFin(e.fin)] : null),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
    h(
      'div',
      { class: 'fr-mt-2w fr-mb-2w' },
      h(
        'button',
        {
          type: 'button',
          id: 'dispo-ajouter',
          class: 'fr-btn fr-btn--secondary fr-btn--icon-left fr-icon-add-line',
          'aria-expanded': String(d.ajout),
          title: "Ajouter un élève à ce dispositif : vous choisissez l'élève (ou vous créez sa fiche), puis le formulaire d'affectation s'ouvre avec cet établissement",
          onclick: () => {
            d.ajout = !d.ajout;
            rendreDispositif();
            (d.ajout ? $('#dispo-q') : $('#dispo-ajouter'))?.focus();
          },
        },
        'Ajouter un élève',
      ),
    ),
    d.ajout ? panneauAjout(d) : h('span'),
  );
  if (d.ajout) {
    attachSuggest($('#dispo-q'), {
      minChars: 2,
      fetchItems: suggestionsEleves,
      onPick: (item) => ajouterAuDispositif(item.row),
    });
  }
}

/* ------------------------------------------------------------------ */
/* Page « Tous les dispositifs »                                         */
/* ------------------------------------------------------------------ */
const TYPE_LIBELLE = { ECO: 'École', CLG: 'Collège', LYC: 'Lycée' };
const retourSecteur = () =>
  state.secteur && state.secteur.voeux
    ? { libelle: 'Revenir aux vœux ULIS n+1', action: () => openSecteur(state.secteur.retour, { garder: true, voeux: true }) }
    : { libelle: 'Revenir à tous les dispositifs', action: () => openSecteur(state.secteur.retour, { garder: true }) };

/** Année de la rentrée visée par les vœux : de septembre à décembre, l'année suivante ; de janvier à août, l'année en cours. */
function anneeCible(d = new Date()) {
  return d.getMonth() >= 8 ? d.getFullYear() + 1 : d.getFullYear();
}
const T_VOEUX = 'Voeux_ERS';
// Entrée ERS : tables (à créer dans le document) et colonnes lues ou écrites.
const T_ACCES_ERS = 'Acces_ERS'; // Email, Nom, Secteurs_ERS (codes séparés par des virgules : « 011, 012 »)
const T_SUIVIS_ERS = 'Suivis_ERS'; // Eleve (Réf. Individus), Ers_email, Date_suivi, Actif
const T_ACCUSES_ERS = 'Accuses_ERS'; // Ers_email, Date_demande, Etat
const T_ALERTES_ERS = 'Alertes_ERS'; // Eleve (Ref Individus), Ers_origine, Ers_demandeur, Date_alerte, Etat (Nouvelle / Vue)

async function chargerSecteur({ voeux = false } = {}) {
  const [t, tScol, tInd] = await Promise.all([lireTable(state.etabTable), lireTable(T_SCOLARITE), lireTable(T_INDIVIDUS)]);
  // Vœux n+1 déjà saisis pour la rentrée visée : ensemble des élèves concernés (table `Voeux`, colonnes Eleve et Annee_cible).
  let avecVoeu = new Set();
  let prevusParEtab = new Map(); // vœux 1 enregistrés vers chaque établissement pour la rentrée (hors sorties) : élèves à prévoir dans les effectifs
  if (voeux) {
    const tv = await lireTable(T_VOEUX).catch(() => null);
    if (!tv || !tv.Eleve) throw new Error(`la table ${T_VOEUX} est introuvable ou n'a pas de colonne Eleve`);
    const cible = String(anneeCible());
    tv.id.forEach((_, i) => {
      if (!tv.Annee_cible || String(tv.Annee_cible[i]).trim() === cible) avecVoeu.add(tv.Eleve[i]);
    });
    prevusParEtab = lireVoeuxExistants(tv).prevus;
  }
  const idxInd = new Map(tInd.id.map((id, i) => [id, i]));
  const todayIso = new Date().toISOString().slice(0, 10);
  const lignes = lignesDe(tScol);
  const eff = effectifsParEtab(lignes, todayIso, SITUATION_PAR_DEFAUT);
  const texte = (col, i) => (t[col] ? cellText(t[col][i]).trim() : '');
  // Secteur_CDOEA et Secteur_ERS (colonnes de données) ne sont remplis que pour une partie des établissements :
  // à défaut, on prend les colonnes calculées à partir de la table Secteurs_ERS, renseignées pour tous.
  const colDe = (id) => state.etabCols.find((c) => c.colId === id && t[id]);
  const cdoeaCalc = colDe('Secteur_ERS_Secteurs_CDOEA');
  const ersCalc = colDe('Secteur_ERS_Secteurs_ERS');
  const etabs = [];
  for (const e of state.etabs) {
    const i = t.id.indexOf(e.id);
    const places = t.Places_max && typeof t.Places_max[i] === 'number' ? t.Places_max[i] : null;
    const n = eff.get(e.id) || { presents: 0, attente: 0, ids: [] };
    let finEchues = 0;
    let finProches = 0;
    for (const id of n.ids) {
      const i2 = idxInd.get(id);
      const a = i2 === undefined || !tInd.Fin_droits_ULIS ? null : alerteFinDroits(secToIso(tInd.Fin_droits_ULIS[i2]), todayIso, FIN_DROITS_ALERTE_JOURS);
      if (a && a.niveau === 'expiree') finEchues += 1;
      else if (a && a.niveau === 'proche') finProches += 1;
    }
    let secteur = texte('Secteur_CDOEA', i);
    if (!secteur && cdoeaCalc) secteur = (await valeurColonne(cdoeaCalc, t[cdoeaCalc.colId][i])).trim();
    // Numéro de secteur CDOEA (1, 2 ou 3) : premier nombre trouvé dans la colonne de données, puis dans la colonne calculée, puis dans `Secteur`.
    const nombreDans = (v) => {
      const m = /\d+/.exec(v || '');
      return m ? Number(m[0]) : null;
    };
    const secteurNum = nombreDans(texte('Secteur_CDOEA', i)) ?? nombreDans(secteur) ?? nombreDans(texte('Secteur', i));
    // Code du secteur d'ERS sur 3 chiffres (« SECTEUR 011 (06-01) BELLEVUE… » et « 11 » donnent tous deux « 011 »)
    const ers = codeErs(texte('Secteur_ERS', i)) || (ersCalc ? codeErs(t[ersCalc.colId][i]) : '') || codeErs(texte('Uai_Code_secteur', i));
    etabs.push({
      id: e.id,
      label: e.label,
      type: TYPE_LIBELLE[e.type] || e.typeBrut || 'Autre',
      commune: texte('Commune', i),
      uai: texte('Uai', i),
      secteur,
      secteurNum,
      ers,
      ersh: texte('Uai_ERSH', i).replace(/\s+/g, ' ').trim(),
      places,
      presents: n.presents,
      sansVoeu: n.ids.filter((id) => !avecVoeu.has(id)).length,
      prevus: prevusParEtab.get(e.id) || 0,
      ids: n.ids,
      attente: n.attente,
      finEchues,
      finProches,
    });
  }
  return { etabs, avecVoeu, lignes, aSecteur: Boolean(t.Secteur_CDOEA || cdoeaCalc), aErs: Boolean(t.Secteur_ERS || ersCalc) };
}

async function openSecteur(retour = retourAccueil(), { garder = false, voeux = false } = {}) {
  if (state.edition) return gardeSortie(() => openSecteur(retour, { garder, voeux }));
  clearNotice();
  let data;
  try {
    data = await chargerSecteur({ voeux });
  } catch (err) {
    notify('error', `Lecture des ${voeux ? 'vœux' : 'établissements'} impossible : ${err.message}`);
    return;
  }
  const prec = garder && state.secteur ? state.secteur : null;
  state.secteur = { voeux, retour, data, tri: prec ? prec.tri : undefined, filtres: prec ? prec.filtres : { q: '', secteur: '', type: '', ers: '', commune: '', occup: '', voeux: '' } };
  state.step = 0;
  masquerPages();
  $('#step-secteur').hidden = false;
  $('#stepper').replaceChildren(
    h(
      'div',
      { class: 'fr-stepper' },
      h('h1', { class: 'fr-stepper__title', id: 'h-secteur', tabindex: '-1' }, voeux ? `Vœux ULIS n+1 (rentrée ${anneeCible()})` : 'Tous les dispositifs'),
      h('p', { class: 'fr-stepper__details' }, voeux ? "Établissements avec ULIS : recherchez par nom, commune ou UAI, ou filtrez par secteur CDOEA, commune, type, ERS et occupation. La colonne « Vœux » indique combien d'élèves présents n'ont pas encore de vœu pour la rentrée. Un clic sur un établissement ouvre les vœux de ses élèves." : "Établissements avec ULIS : recherchez par nom, commune ou UAI, ou filtrez par secteur CDOEA, commune, type, ERS et occupation. Un clic sur un établissement ouvre son dispositif."),
    ),
    h(
      'nav',
      { 'aria-label': 'Navigation', class: 'step-nav fr-mb-2w' },
      h('button', { type: 'button', class: 'fr-btn fr-btn--tertiary fr-btn--sm fr-btn--icon-left fr-icon-arrow-left-s-line', title: 'Quitter cette page', onclick: () => { clearNotice(); retour.action(); } }, retour.libelle),
    ),
  );
  rendreSecteur();
  $('#h-secteur').focus();
}

function rendreSecteur() {
  const sc = state.secteur;
  const { etabs, aSecteur, aErs } = sc.data;
  const f = sc.filtres;
  const SECTEURS = ['1', '2', '3'];
  // Occupation : deux choix seulement ; « presque plein » compte encore comme places disponibles, « dépassement » comme plein
  const OCCUP_GROUPES = { dispo: ['libre', 'presque'], plein: ['plein', 'depassement'] };
  if (f.occup && !OCCUP_GROUPES[f.occup]) f.occup = ''; // valeur d'un ancien choix
  const communes = [...new Set(etabs.map((e) => e.commune).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  const dansSecteur = (e) => !f.secteur || String(e.secteurNum) === f.secteur;
  // Les ERS proposés dépendent du secteur choisi ; un ERS qui n'en fait plus partie est abandonné.
  // Menu ERS : « Secteur 011 (NOM Prénom) », un seul choix par secteur d'ERS, limité au secteur choisi
  const parCode = new Map();
  for (const e of etabs.filter(dansSecteur)) {
    if (!e.ers) continue;
    if (!parCode.get(e.ers)) parCode.set(e.ers, e.ersh);
  }
  const ersProposes = [...parCode.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'fr', { numeric: true }))
    .map(([code, nom]) => [code, nom ? `Secteur ${code} (${nom})` : `Secteur ${code}`]);
  if (f.ers && !parCode.has(f.ers)) f.ers = '';
  const tri = sc.tri || (sc.tri = { cle: 'label', dir: 1 });
  const clesTri = { label: (e) => e.label, type: (e) => e.type, commune: (e) => e.commune, secteur: (e) => e.secteur, ers: (e) => e.ers, effectif: (e) => e.presents, fins: (e) => e.finEchues * 1000 + e.finProches, voeux: (e) => e.sansVoeu };
  const onTri = (cle) => {
    sc.tri = { cle, dir: tri.cle === cle ? -tri.dir : 1 };
    rendreSecteur();
    $(`#secteur [data-tri="${cle}"]`)?.focus();
  };
  const jetons = normSearch(f.q || '').split(/\s+/).filter(Boolean);
  const correspond = (e) => !jetons.length || jetons.every((t) => normSearch(`${e.label} ${e.commune} ${e.uai} ${e.type}`).includes(t));
  const liste0 = etabs.filter((e) => correspond(e) && dansSecteur(e) && (!f.type || e.type === f.type) && (!f.ers || e.ers === f.ers) && (!f.commune || e.commune === f.commune) && (!f.voeux || (f.voeux === 'manque' ? e.sansVoeu > 0 : e.presents > 0 && e.sansVoeu === 0)) && (!f.occup || OCCUP_GROUPES[f.occup].includes((occupation(e.presents, e.places, SEUIL_PRESQUE_PLEIN) || {}).niveau)));
  const val = clesTri[tri.cle];
  const liste = [...liste0].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    const vide = (v) => v === '' || v === null || v === undefined;
    if (vide(x) !== vide(y)) return vide(x) ? 1 : -1; // une valeur absente reste en dernier, quel que soit le sens
    const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'fr', { numeric: true });
    return c * tri.dir || a.label.localeCompare(b.label, 'fr', { numeric: true });
  });
  const selecteur = (id, cle, libelle, options, aide) =>
    h(
      'div',
      { class: 'fr-select-group fr-col-12 fr-col-md-4' },
      h('label', { class: 'fr-label', for: id }, libelle),
      h(
        'select',
        { class: 'fr-select', id, title: aide, onchange: (e) => { f[cle] = e.target.value; rendreSecteur(); $(`#${id}`)?.focus(); } },
        h('option', { value: '', selected: !f[cle] }, 'Tous'),
        options.map((o) => {
          const [valeur, texte] = Array.isArray(o) ? o : [o, o];
          return h('option', { value: valeur, selected: valeur === f[cle] }, texte);
        }),
      ),
    );
  const totalPresents = liste.reduce((n, e) => n + e.presents, 0);
  const totalPlaces = liste.reduce((n, e) => n + (e.places || 0), 0);
  const colonnes = [['Établissement', 'label'], ['Type', 'type'], ['Commune', 'commune'], ...(aSecteur ? [['Secteur', 'secteur']] : []), ...(aErs ? [['ERS', 'ers']] : []), ['Effectif', 'effectif'], sc.voeux ? ['Vœux', 'voeux'] : ['Fins de droits', 'fins']];
  const recherche = h('input', {
    class: 'fr-input',
    id: 'f-q',
    type: 'search',
    autocomplete: 'off',
    value: f.q || '',
    title: "Saisissez une partie du nom, de la commune ou de l'UAI : la liste se réduit au fil de la frappe",
    oninput: (e) => {
      f.q = e.target.value;
      rendreSecteur();
      const champ = $('#f-q');
      champ.focus();
      champ.setSelectionRange(champ.value.length, champ.value.length);
    },
  });
  $('#secteur').replaceChildren(
    h(
      'div',
      { class: 'fr-grid-row fr-grid-row--gutters fr-mb-2w' },
      h(
        'div',
        { class: 'fr-input-group fr-col-12 fr-col-md-4' },
        h('label', { class: 'fr-label', for: 'f-q' }, 'Rechercher un dispositif'),
        h('div', { class: 'fr-input-wrap fr-icon-search-line' }, recherche),
      ),
      ...(sc.voeux && state.ers ? [] : [
        aSecteur ? selecteur('f-secteur', 'secteur', 'Secteur CDOEA', SECTEURS, 'Ne garder que les établissements du secteur CDOEA 1, 2 ou 3') : null,
        selecteur('f-commune', 'commune', 'Commune', communes, 'Ne garder que les établissements de cette commune'),
        selecteur('f-type', 'type', "Type d'établissement", ['École', 'Collège', 'Lycée', ...(etabs.some((e) => e.type === 'Autre') ? ['Autre'] : [])], 'Ne garder que les écoles, collèges ou lycées'),
        aErs ? selecteur('f-ers', 'ers', 'ERS', ersProposes, f.secteur ? `ERS du secteur ${f.secteur} seulement (secteur d'enseignant référent)` : "Ne garder que les établissements de cet ERS (secteur d'enseignant référent)") : null,
        selecteur('f-occup', 'occup', 'Occupation', [['dispo', 'Places disponibles'], ['plein', 'Dispositif plein']], 'Ne garder que les établissements dont le dispositif a encore des places, ou ceux dont le dispositif est plein'),
        sc.voeux
          ? selecteur('f-voeux', 'voeux', 'Vœux n+1', [['manque', 'Il manque des vœux'], ['complet', 'Tous les vœux saisis']], 'Ne garder que les établissements où il manque encore des vœux, ou ceux où tous les élèves présents en ont un')
          : null,
      ]),
    ),
    sc.voeux ? h('button', { type: 'button', class: 'fr-btn fr-btn--secondary fr-mb-2w bouton-ecriture', id: 'btn-ajout-eleve', title: "Ouvrir le module d'ajout d'élèves", onclick: () => openAjoutEleves({ libelle: 'Revenir aux vœux ULIS n+1', action: () => openSecteur(sc.retour, { garder: true, voeux: true }) }) }, 'Nouveaux élèves et élèves hors secteur') : null,
    etabs.some((e) => e.secteurNum === null) ? h('p', { class: 'fr-hint-text', id: 'secteur-inconnu' }, `${etabs.filter((e) => e.secteurNum === null).length} établissement(s) sans numéro de secteur reconnu : ils n'apparaissent pas quand un secteur est choisi.`) : h('span'),
    h('p', { role: 'status' }, `${liste.length} établissement${liste.length > 1 ? 's' : ''} · ${totalPresents} élève${totalPresents > 1 ? 's' : ''} présent${totalPresents > 1 ? 's' : ''}${totalPlaces ? ` sur ${totalPlaces} places (${totalPlaces - totalPresents >= 0 ? `${totalPlaces - totalPresents} libre${totalPlaces - totalPresents > 1 ? 's' : ''}` : `dépassement de ${totalPresents - totalPlaces}`})` : ''}`),
    liste.length === 0
      ? h('div', { class: 'fr-alert fr-alert--info fr-alert--sm' }, h('p', {}, 'Aucun établissement ne correspond à ces filtres.'))
      : h(
          'div',
          { class: 'fr-table fr-table--no-caption' },
          h(
            'div',
            { class: 'fr-table__wrapper' },
            h(
              'div',
              { class: 'fr-table__container' },
              h(
                'div',
                { class: 'fr-table__content' },
                h(
                  'table',
                  {},
                  h('caption', {}, 'Établissements avec ULIS du secteur'),
                  h('thead', {}, h('tr', {}, colonnes.map(([lib, cle]) => enteteTri(lib, cle, onTri, tri)))),
                  h(
                    'tbody',
                    {},
                    liste.map((e) =>
                      h(
                        'tr',
                        {},
                        h('td', {}, h('button', { type: 'button', class: 'fr-link lien-etab', title: sc.voeux ? "Ouvrir les vœux des élèves de cet établissement" : 'Ouvrir le dispositif de cet établissement', onclick: () => (sc.voeux ? openVoeuxEtab(e.id, retourSecteur()) : openDispositif(e.id, retourSecteur())) }, e.label)),
                        h('td', {}, e.type),
                        h('td', {}, e.commune || '—'),
                        aSecteur ? h('td', {}, e.secteurNum !== null ? String(e.secteurNum) : e.secteur || '—') : null,
                        aErs ? h('td', {}, e.ers ? `Secteur ${e.ers}` : '—', e.ersh ? [h('br'), h('span', { class: 'fr-text--sm fr-hint-text' }, e.ersh)] : null) : null,
                        h('td', { class: 'nowrap' }, `${e.presents}${e.places !== null ? ` / ${e.places}` : ''}`, e.attente ? [' ', h('p', { class: 'fr-badge fr-badge--info fr-badge--sm fr-badge--no-icon', title: "Élèves sur liste d'attente pour cet établissement" }, `${e.attente} en attente`)] : null, badgeOccupation(e.presents, e.places) ? [h('br'), badgeOccupation(e.presents, e.places)] : null),
                        sc.voeux
                          ? h('td', {}, e.presents === 0 ? '—' : e.sansVoeu === 0 ? h('p', { class: 'fr-badge fr-badge--success fr-badge--sm fr-badge--no-icon' }, 'Complets') : h('p', { class: 'fr-badge fr-badge--warning fr-badge--sm fr-badge--no-icon', title: "Élèves présents sans vœu pour la rentrée visée" }, `${e.sansVoeu} sans vœu`))
                          : h('td', {}, e.finEchues || e.finProches ? [e.finEchues ? h('p', { class: 'fr-badge fr-badge--error fr-badge--sm fr-badge--no-icon', title: 'Élèves présents dont la fin de droits est dépassée' }, `${e.finEchues} échue${e.finEchues > 1 ? 's' : ''}`) : null, e.finEchues && e.finProches ? ' ' : null, e.finProches ? h('p', { class: 'fr-badge fr-badge--warning fr-badge--sm fr-badge--no-icon', title: 'Élèves présents dont la fin de droits approche' }, `${e.finProches} proche${e.finProches > 1 ? 's' : ''}`) : null] : '—'),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
  );
}


/* ------------------------------------------------------------------ */
/* Vœux ULIS n+1 : page d'un établissement                             */
/* ------------------------------------------------------------------ */
/** « Maintien en ULIS » : l'élève reste dans son niveau (pas de +1). */
const estMaintien = (situation) => /^maintien/i.test(String(situation || '').trim());
/** Niveau de 3e (« 3e », « 3ème », « 3eme »…) : un maintien y est signalé car il n'est pas de droit. */
const estCm2 = (niveau) => /^cm\s*2/i.test(String(niveau || '').trim());
/** « Sortant » : élève en CM2 ou en 3e, qui quitte son établissement à la rentrée ; sinon « restant ». */
const sortantDe = (niveau) => (estCm2(niveau) ? 'CM2' : est3e(niveau) ? '3e' : '');
const est3e = (niveau) => /^3(g|pm|e|è|\s|$)/i.test(String(niveau || '').trim());
/** Situation qui sort du dispositif (retour en classe ordinaire, sortie) : pas de vœu d'établissement ULIS à saisir. */
const estSortie = (situation) => /^(sortie|retour)|ordinaire/i.test(String(situation || '').trim());
const niveauSuivant = (niveau) => {
  const i = state.niveaux.indexOf(niveau);
  return i >= 0 && i + 1 < state.niveaux.length ? state.niveaux[i + 1] : niveau;
};
const alerteMaintien3e = (niveau, situation) => estMaintien(situation) && est3e(niveau);

/** Colonnes de `Voeux_ERS` réellement présentes : on n'écrit que celles-là. */
function colonnesVoeux() {
  const m = new Map();
  for (const c of state.colById.values()) if (c.tableId === T_VOEUX) m.set(c.colId, c);
  return m;
}

/* ------------------------------------------------------------------ */
/* Modèle de saisie d'un élève : page d'un établissement et module d'ajout */
/* ------------------------------------------------------------------ */
const NOTIF_VALEURS = ['Non saisi', 'Oui', 'Non'];
const NOTIF_DEFAUT = 'Non saisi';
const ORIENTATIONS = [['', 'Non saisi'], ['reste', "Reste en ULIS dans l'établissement"], ['change', "Change d'ULIS"], ['sort', 'Sort du dispositif']];
const MOUVEMENTS = [['', 'Non saisi'], ['maintien', 'Maintien'], ['passage', 'Passage']];
const COL_NOTIF = 'Notifie_rentree'; // texte : Oui / Non / Non saisi
const COL_REMARQUES = 'Remarques'; // texte libre (vœu 2, rapprochement de fratrie, soins…)
const dateRentree = () => `01/09/${anneeCible()}`;

const situationSortie = () => state.situations.find((s) => estSortie(s) && /dispositif/i.test(s)) || state.situations.find(estSortie) || 'Sortie du dispositif';
const situationMaintien = () => state.situations.find(estMaintien) || 'Maintien en ULIS';
/** Situation écrite dans Voeux_ERS : déduite de l'orientation et du choix maintien / passage (plus de menu « Situation »). */
const situationDe = (cur) => (cur.orient === 'sort' ? situationSortie() : cur.mouvement === 'maintien' ? situationMaintien() : SITUATION_PAR_DEFAUT);
/** Niveau proposé : le niveau actuel en cas de maintien, le suivant en cas de passage ; vide (« à saisir ») si le niveau actuel est inconnu. */
const niveauPour = (mouvement, niveau) => (!mouvement || !niveau ? '' : mouvement === 'maintien' ? niveau : niveauSuivant(niveau));

/** État de saisie d'un élève à partir de son vœu déjà enregistré (ou vide). */
function etatDepuisVoeu(ex, etabId, niveau) {
  if (!ex) return { notifie: NOTIF_DEFAUT, mouvement: '', niveau1: '', orient: '', voeu1: 0, remarques: '' };
  const orient = estSortie(ex.situation) ? 'sort' : !ex.voeu1 ? '' : etabId && ex.voeu1 === etabId ? 'reste' : 'change';
  const mouvement = estMaintien(ex.situation) || (ex.niveau && niveau && ex.niveau === niveau) ? 'maintien' : ex.niveau ? 'passage' : '';
  return { notifie: !ex.notifie || ex.notifie === 'Non choisi' ? NOTIF_DEFAUT : ex.notifie, mouvement, niveau1: ex.niveau, orient, voeu1: ex.voeu1, remarques: ex.remarques };
}

const CHAMPS_VOEUX = ['notifie', 'mouvement', 'niveau1', 'orient', 'voeu1', 'remarques'];
const voeuxChange = (e) => (Boolean(e.ajoute) && !e.enregistre) || CHAMPS_VOEUX.some((k) => e.cur[k] !== e.initial[k]);

/** Lit Voeux_ERS : vœux déjà saisis pour la rentrée visée (par élève) et nombre de vœux 1 par établissement (« prévus »). */
function lireVoeuxExistants(tv) {
  const existants = new Map();
  const prevus = new Map();
  if (!tv || !tv.Eleve) return { existants, prevus };
  const cible = String(anneeCible());
  tv.id.forEach((id, i) => {
    if (tv.Annee_cible && String(tv.Annee_cible[i]).trim() !== cible) return;
    const num = (c) => (tv[c] && typeof tv[c][i] === 'number' && tv[c][i] > 0 ? tv[c][i] : 0);
    const texte = (c) => (tv[c] ? cellText(tv[c][i]).trim() : '');
    const ex = { id, niveau: texte('Niveau_n1'), voeu1: num('Voeu_1'), voeu2: num('Voeu_2'), situation: texte('Situation'), statut: texte('Statut'), notifie: texte(COL_NOTIF), remarques: texte(COL_REMARQUES), saisiPar: texte('Saisi_par').toLowerCase() };
    existants.set(tv.Eleve[i], ex);
    if (ex.voeu1 && !estSortie(ex.situation)) prevus.set(ex.voeu1, (prevus.get(ex.voeu1) || 0) + 1);
  });
  return { existants, prevus };
}

async function chargerVoeuxEtab(etabId) {
  if (state.ers && !state.ers.data) await chargerErs();
  const base = await chargerDispositif(etabId);
  const tv = await lireTable(T_VOEUX).catch(() => null);
  if (!tv || !tv.Eleve) throw new Error(`la table ${T_VOEUX} est introuvable ou n'a pas de colonne Eleve`);
  const todayIso = new Date().toISOString().slice(0, 10);
  const { existants, prevus } = lireVoeuxExistants(tv);
  const eleves = elevesDuDispositif(base.lignes, etabId, todayIso, { situationPresent: SITUATION_PAR_DEFAUT }).rows
    .filter((x) => base.parId.has(x.eleve))
    .map((x) => {
      const row = base.parId.get(x.eleve);
      const niveau = (x.ligne.niveau || '').trim();
      const ex = existants.get(x.eleve) || null;
      const initial = etatDepuisVoeu(ex, etabId, niveau);
      return { row, niveau, ex, initial, cur: { ...initial }, gere: gereParErs(etabId, x.eleve) };
    })
    .sort((a, b) => `${a.row.nom} ${a.row.prenom}`.localeCompare(`${b.row.nom} ${b.row.prenom}`, 'fr'));
  // élèves attendus en plus : un vœu enregistré vers cet établissement, sans y être présents aujourd'hui
  await refreshIndividus();
  const parId = new Map(state.individus.map((r) => [r.id, r]));
  const presents = new Set(eleves.map((e) => e.row.id));
  const attendus = [...existants]
    .filter(([id, ex]) => ex.voeu1 === etabId && !estSortie(ex.situation) && !presents.has(id) && parId.has(id))
    .map(([id, ex]) => ({ row: parId.get(id), ex }))
    .sort((a, b) => `${a.row.nom} ${a.row.prenom}`.localeCompare(`${b.row.nom} ${b.row.prenom}`, 'fr'));
  return { eleves, existants, attendus, prevus: prevus.get(etabId) || 0 };
}

/** Groupe de boutons radio DSFR compact (choix unique). */
function groupeRadios(id, legende, choix, courant, onChange, disabled = false) {
  return h(
    'fieldset',
    { class: 'fr-fieldset fr-fieldset--sm cellule-radios', id, 'aria-label': legende },
    choix.map(([valeur, libelle], k) =>
      h(
        'div',
        { class: 'fr-fieldset__element' },
        h(
          'div',
          { class: 'fr-radio-group fr-radio-group--sm' },
          h('input', { type: 'radio', name: id, id: `${id}-${k}`, value: valeur, checked: valeur === courant, disabled, onchange: () => onChange(valeur) }),
          h('label', { class: 'fr-label', for: `${id}-${k}` }, libelle),
        ),
      ),
    ),
  );
}

/**
 * Fabrique les lignes du tableau de saisie. `ctx` : `etabId` (page d'un établissement, sinon module d'ajout), `ajout`,
 * `optionsEtab()` (établissements proposés pour le vœu), `maj()` (rafraîchit le pied de page), `retirer(e)` (module d'ajout).
 */
function fabriqueLigneVoeux(ctx) {
  const cols = colonnesVoeux();
  const aNotif = cols.has(COL_NOTIF) && Boolean(ctx.ajout); // notification : nouveaux élèves et élèves hors secteur seulement
  const aRem = cols.has(COL_REMARQUES);
  return (e, i) => {
    const pre = `${ctx.prefixe || 'v'}${i}`;
    const nom = `${e.row.nom} ${e.row.prenom}`.trim() || 'Sans nom';
    const ro = lectureSeule() || !e.gere;
    const bloque = Boolean(ctx.ajout) && e.cur.notifie === 'Non'; // pas de notification ULIS à la rentrée : le reste de la ligne est sans objet
    const roSuite = ro || bloque;
    const niv = h('select', { class: 'fr-select', id: `${pre}-niv`, 'aria-label': `Niveau n+1 de ${nom}`, disabled: roSuite, hidden: !e.cur.mouvement && !e.cur.niveau1 }, [h('option', { value: '', selected: !e.cur.niveau1 }, 'À saisir'), ...state.niveaux.map((n) => h('option', { value: n, selected: n === e.cur.niveau1 }, n))]);
    const alerte = h('p', { class: 'fr-badge fr-badge--error fr-badge--sm fr-badge--no-icon', id: `${pre}-alerte`, title: "Un maintien en 3e n'est pas de droit : à examiner en commission", hidden: true }, 'Maintien en 3e : pas de droit');
    const v1 = combobox({ id: `${pre}-v1`, label: `Vœu de ${nom}`, options: ctx.optionsEtab(), value: e.cur.voeu1 || '', placeholder: 'Aucun vœu', compact: true, disabled: roSuite, onChange: (v) => { e.cur.voeu1 = Number(v) || 0; rafraichir(); } });
    const texteReste = h('span', { class: 'fr-text--sm', id: `${pre}-v1-auto`, hidden: true }, state.etabLabel.get(ctx.etabId) || `#${ctx.etabId}`);
    const rafraichir = () => {
      niv.hidden = !e.cur.mouvement && !e.cur.niveau1;
      alerte.hidden = !alerteMaintien3e(e.niveau, situationDe(e.cur));
      if (!ctx.ajout) {
        v1.hidden = e.cur.orient !== 'change';
        texteReste.hidden = e.cur.orient !== 'reste';
      }
      ctx.maj();
    };
    const mouvement = groupeRadios(`${pre}-mvt`, `Maintien ou passage de ${nom}`, MOUVEMENTS, e.cur.mouvement, (v) => {
      e.cur.mouvement = v;
      e.cur.niveau1 = niveauPour(v, e.niveau);
      niv.value = e.cur.niveau1;
      rafraichir();
    }, roSuite);
    niv.addEventListener('change', () => { e.cur.niveau1 = niv.value; rafraichir(); });
    const orient = ctx.ajout ? null : groupeRadios(`${pre}-ori`, `Orientation N+1 de ${nom}`, ORIENTATIONS, e.cur.orient, (v) => {
      e.cur.orient = v;
      if (v === 'reste') e.cur.voeu1 = ctx.etabId;
      else if (v === 'sort') e.cur.voeu1 = 0;
      else if (e.cur.voeu1 === ctx.etabId) e.cur.voeu1 = 0;
      v1.definirValeur(e.cur.voeu1 && v !== 'reste' ? e.cur.voeu1 : '');
      rafraichir();
    }, ro);
    const notif = aNotif ? groupeRadios(`${pre}-notif`, `${nom} : sera notifié ULIS au ${dateRentree()}`, NOTIF_VALEURS.map((v) => [v, v]), e.cur.notifie, (v) => {
      const avant = e.cur.notifie;
      e.cur.notifie = v;
      if (v === 'Non') Object.assign(e.cur, { mouvement: '', niveau1: '', voeu1: 0 });
      if ((v === 'Non') !== (avant === 'Non') && ctx.rerender) ctx.rerender(`${pre}-notif-${NOTIF_VALEURS.indexOf(v)}`);
      else ctx.maj();
    }, ro) : null;
    const rem = aRem ? h('input', { class: 'fr-input', id: `${pre}-rem`, type: 'text', autocomplete: 'off', value: e.cur.remarques || '', 'aria-label': `Remarques pour ${nom}`, disabled: ro }) : null;
    if (rem) rem.addEventListener('input', () => { e.cur.remarques = rem.value; ctx.maj(); });
    if (!ctx.ajout) { v1.hidden = e.cur.orient !== 'change'; texteReste.hidden = e.cur.orient !== 'reste'; }
    alerte.hidden = !alerteMaintien3e(e.niveau, situationDe(e.cur));
    return h(
      'tr',
      { class: [e.gere ? '' : 'ligne-grisee', e.niveau ? (sortantDe(e.niveau) ? 'ligne-sortant' : 'ligne-restant') : ''].filter(Boolean).join(' ') || null },
      h('td', {},
        ctx.ajout ? nom : h('button', { type: 'button', class: 'fr-link lien-etab', title: 'Ouvrir le dossier de cet élève', onclick: () => openDossier(e.row, 'voeux') }, nom),
        e.ajoute ? [h('br'), h('span', { class: 'fr-badge fr-badge--new fr-badge--sm fr-badge--no-icon', title: e.origine ? 'Élève actuellement dans un autre dispositif ULIS, appelé dans un nouvel établissement' : "Élève pas encore affecté en ULIS, ajouté à la saisie" }, e.origine ? `Vient de : ${state.etabLabel.get(e.origine) || `#${e.origine}`}` : 'Pas encore affecté en ULIS'), ' ', e.enregistre ? (e.gere && !lectureSeule() ? h('button', { type: 'button', class: 'fr-btn fr-btn--tertiary fr-btn--sm bouton-ecriture', title: 'Supprimer le vœu enregistré de cet élève pour la rentrée', onclick: () => supprimerVoeu(e) }, 'Supprimer le vœu') : null) : h('button', { type: 'button', class: 'fr-btn fr-btn--tertiary fr-btn--sm', title: "Retirer cet élève de la saisie (rien n'est enregistré)", onclick: () => ctx.retirer(e) }, 'Retirer')] : null,
        e.ex ? [h('br'), h('span', { class: 'fr-badge fr-badge--success fr-badge--sm fr-badge--no-icon', title: 'Un vœu est déjà enregistré pour cette rentrée' }, e.ex.statut || 'Enregistré')] : null),
      aNotif ? h('td', {}, notif) : null,
      h('td', {}, e.niveau || '—', e.niveau ? [h('br'), sortantDe(e.niveau) ? h('span', { class: 'fr-badge fr-badge--warning fr-badge--sm fr-badge--no-icon', title: `Élève en ${sortantDe(e.niveau)} : il quitte son établissement à la rentrée` }, `Sortant (${sortantDe(e.niveau)})`) : h('span', { class: 'fr-badge fr-badge--green-emeraude fr-badge--sm fr-badge--no-icon', title: 'Élève qui peut rester dans son établissement à la rentrée' }, 'Restant')] : null),
      h('td', {}, mouvement, niv, alerte),
      ctx.ajout ? null : h('td', {}, orient),
      h('td', {}, v1, texteReste, ctx.ajout ? null : h('span', { class: 'fr-text--sm', id: `${pre}-v1-vide` }, e.cur.orient === 'sort' ? '—' : '')),
      aRem ? h('td', {}, rem, e.ex && e.ex.voeu2 ? h('span', { class: 'fr-hint-text' }, `Ancien vœu 2 : ${state.etabLabel.get(e.ex.voeu2) || `#${e.ex.voeu2}`}`) : null) : null,
    );
  };
}

/** En-têtes du tableau de saisie. */
function entetesVoeux(ajout) {
  const cols = colonnesVoeux();
  return [
    'Élève',
    ...(cols.has(COL_NOTIF) && ajout ? [`L'élève sera notifié ULIS au ${dateRentree()}`] : []),
    'Classe actuelle',
    'Niveau n+1',
    ...(ajout ? [] : ['Orientation N+1']),
    'Vœu',
    ...(cols.has(COL_REMARQUES) ? ['Remarques (Voeu 2, rapprochement de fratrie, soins...)'] : []),
  ];
}

function tableVoeux(eleves, ctx, legende) {
  const ligne = fabriqueLigneVoeux(ctx);
  return h(
    'div',
    { class: 'fr-table fr-table--no-caption' },
    h('div', { class: 'fr-table__wrapper' }, h('div', { class: 'fr-table__container' }, h('div', { class: 'fr-table__content' },
      h('table', {},
        h('caption', {}, legende),
        h('thead', {}, h('tr', {}, entetesVoeux(ctx.ajout).map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, eleves.map(ligne)),
      ),
    ))),
  );
}

/** Colonnes attendues dans Voeux_ERS et absentes : leurs champs ne sont pas affichés. */
function noteColonnesVoeux() {
  const cols = colonnesVoeux();
  const manque = [COL_NOTIF, COL_REMARQUES].filter((c) => !cols.has(c));
  return manque.length ? h('p', { class: 'fr-hint-text', id: 'voeux-colonnes-manquantes' }, `Colonne${manque.length > 1 ? 's' : ''} à créer dans ${T_VOEUX} (type Texte) pour afficher et enregistrer ces champs : ${manque.join(', ')}.`) : null;
}

async function openVoeuxEtab(etabId, retour) {
  if (state.edition) return gardeSortie(() => openVoeuxEtab(etabId, retour));
  clearNotice();
  if (state.ers && state.ers.data) {
    const e = state.ers.data.etabs.find((x) => x.id === etabId);
    if (!e || !state.ers.codes.has(e.ers)) {
      notify('error', "Cet établissement n'est pas dans votre secteur.");
      return;
    }
  }
  let data;
  try {
    data = await chargerVoeuxEtab(etabId);
  } catch (err) {
    notify('error', `Lecture des vœux impossible : ${err.message}`);
    return;
  }
  state.voeuxEtab = { etabId, retour, data };
  const label = state.etabLabel.get(etabId) || `#${etabId}`;
  state.step = 0;
  masquerPages();
  $('#step-voeux').hidden = false;
  $('#stepper').replaceChildren(
    h(
      'div',
      { class: 'fr-stepper' },
      h('h1', { class: 'fr-stepper__title', id: 'h-voeux', tabindex: '-1' }, `Vœux ULIS n+1 : ${label}`),
      h('p', { class: 'fr-stepper__details' }, `Élèves présents d'après leur affectation en cours, pour la rentrée ${anneeCible()}. Renseignez chaque élève, puis validez une seule fois pour tout l'établissement.`),
    ),
    h(
      'nav',
      { 'aria-label': 'Navigation', class: 'step-nav fr-mb-2w' },
      h('button', { type: 'button', class: 'fr-btn fr-btn--tertiary fr-btn--sm fr-btn--icon-left fr-icon-arrow-left-s-line', title: 'Quitter cette page : les modifications non validées sont perdues', onclick: () => { clearNotice(); retour.action(); } }, retour.libelle),
    ),
  );
  rendreVoeuxEtab();
  state.edition = {
    fermer: () => {},
    dirty: () => !$('#step-voeux').hidden && Boolean(state.voeuxEtab) && state.voeuxEtab.data.eleves.some((e) => e.gere && voeuxChange(e)),
    focus: () => $('#h-voeux')?.focus(),
    message: "Vous avez modifié des vœux sans les valider : ces changements seront perdus.",
  };
  $('#h-voeux').focus();
}

/** Pied de page commun (nombre de modifications, bouton de validation, alerte « maintien en 3e »). */
function majPiedVoeux(eleves, { ajout = false } = {}) {
  const n = eleves.filter((e) => e.gere && voeuxChange(e)).length;
  $('#voeux-etat').textContent = n ? `${n} modification${n > 1 ? 's' : ''} à valider` : 'Aucune modification à valider';
  $('#btn-valider-voeux').disabled = n === 0;
  const na = eleves.filter((e) => alerteMaintien3e(e.niveau, situationDe(e.cur))).length;
  const panneau = $('#voeux-alerte-globale');
  panneau.hidden = na === 0;
  panneau.querySelector('p:last-child').textContent = `${na} élève${na > 1 ? 's' : ''} en 3e avec un maintien en ULIS : ce maintien n'est pas de droit et sera examiné en commission.`;
}

function rendreVoeuxEtab() {
  const { etabId, data } = state.voeuxEtab;
  const eleves = data.eleves;
  const maj = () => majPiedVoeux(eleves);
  const ctx = { etabId, optionsEtab: () => state.etabs.filter((x) => x.id !== etabId).map((x) => ({ value: x.id, label: x.label })), maj };
  const nb = eleves.length;
  $('#voeux').replaceChildren(...[
    h('div', { class: 'fr-alert fr-alert--warning fr-alert--sm fr-mb-2w', id: 'voeux-alerte-globale', role: 'status', hidden: true }, h('p', { class: 'fr-alert__title' }, 'Maintien en 3e'), h('p', {})),
    h('p', { role: 'status' }, `${nb} élève${nb > 1 ? 's' : ''} présent${nb > 1 ? 's' : ''} · ${data.prevus} vœu${data.prevus > 1 ? 'x' : ''} enregistré${data.prevus > 1 ? 's' : ''} vers cet établissement pour la rentrée (élèves de l'établissement et nouveaux élèves)`),
    noteColonnesVoeux(),
    eleves.length === 0
      ? h('div', { class: 'fr-alert fr-alert--info fr-alert--sm' }, h('p', {}, "Aucun élève n'est présent dans ce dispositif."))
      : tableVoeux(eleves, ctx, `Vœux des élèves, rentrée ${anneeCible()}`),
    data.attendus.length === 0 ? null : h('div', { class: 'fr-mt-4w', id: 'voeux-attendus' },
      h('h2', { class: 'fr-h5' }, `Élèves attendus en plus à la rentrée (${data.attendus.length})`),
      h('p', { class: 'fr-hint-text' }, "Élèves avec un vœu vers cet établissement, pas encore affectés ici. Pour les modifier : « Nouveaux élèves et élèves hors secteur » depuis l'accueil."),
      h('div', { class: 'fr-table fr-table--no-caption' }, h('div', { class: 'fr-table__wrapper' }, h('div', { class: 'fr-table__container' }, h('div', { class: 'fr-table__content' },
        h('table', {}, h('caption', {}, 'Élèves attendus en plus'),
          h('thead', {}, h('tr', {}, ['Élève', 'Niveau n+1', 'Notifié ULIS', 'Remarques', ...(lectureSeule() ? [] : ['Action'])].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', {}, data.attendus.map(({ row, ex }) => h('tr', {}, h('td', {}, `${row.nom} ${row.prenom}`.trim()), h('td', {}, ex.niveau || '—'), h('td', {}, ex.notifie || '—'), h('td', {}, ex.remarques || '—'), lectureSeule() ? null : h('td', {}, h('button', { type: 'button', class: 'fr-btn fr-btn--tertiary fr-btn--sm bouton-ecriture', title: 'Supprimer le vœu enregistré de cet élève pour la rentrée', onclick: () => supprimerVoeu({ row, ex }, () => openVoeuxEtab(etabId, state.voeuxEtab.retour)) }, 'Supprimer le vœu'))))),
        ))))),
    ),
    h(
      'div',
      { class: 'fr-mt-3w bouton-ecriture' },
      h('p', { id: 'voeux-etat', role: 'status', class: 'fr-hint-text' }),
      h('button', { type: 'button', class: 'fr-btn', id: 'btn-valider-voeux', title: "Enregistrer d'un coup les vœux modifiés de tout cet établissement, après une confirmation", onclick: () => validerVoeux(eleves, { ajout: false }) }, "Valider les vœux de l'établissement"),
    ),
  ].filter(Boolean));
  maj();
}

/** Contrôles puis fenêtre de confirmation, communs à la page d'un établissement et au module d'ajout. */
function validerVoeux(eleves, { ajout }) {
  clearNotice();
  const modifies = eleves.filter((e) => e.gere && voeuxChange(e));
  const nomDe = (e) => `${e.row.nom} ${e.row.prenom}`.trim();
  const liste = (l) => l.map(nomDe).join(', ');
  const nonNotifie = (e) => ajout && e.cur.notifie === 'Non'; // notification « Non » : pas de vœu à saisir
  const sansVoeu = modifies.filter((e) => !nonNotifie(e) && (ajout || e.cur.orient === 'change') && !(e.cur.voeu1 > 0));
  if (sansVoeu.length) {
    notify('error', `Choisissez le vœu de : ${liste(sansVoeu)}.`);
    return;
  }
  const sansNiveau = modifies.filter((e) => !nonNotifie(e) && (ajout || e.cur.mouvement) && e.cur.orient !== 'sort' && !e.cur.niveau1);
  if (sansNiveau.length) {
    notify('error', `Choisissez maintien ou passage, puis le niveau n+1 de : ${liste(sansNiveau)}.`);
    return;
  }
  if (!modifies.length) return;
  const nomEtab = (id) => (id ? state.etabLabel.get(id) || `#${id}` : '—');
  const cols = colonnesVoeux();
  ouvrirModale({
    titre: `Valider ${modifies.length} vœu${modifies.length > 1 ? 'x' : ''} pour la rentrée ${anneeCible()}`,
    icone: 'fr-icon-check-line',
    corps: [
      modifies.some((e) => alerteMaintien3e(e.niveau, situationDe(e.cur))) ? h('p', { class: 'fr-error-text' }, "Attention : au moins un maintien en 3e, qui n'est pas de droit. Il sera enregistré et signalé à la commission.") : null,
      h(
        'table',
        { class: 'modale-diff' },
        h('caption', { class: 'fr-sr-only' }, 'Vœux à enregistrer'),
        h('thead', {}, h('tr', {}, ['Élève', ...(cols.has(COL_NOTIF) && ajout ? ['Notifié ULIS'] : []), 'Niveau n+1', 'Orientation', 'Vœu', ...(cols.has(COL_REMARQUES) ? ['Remarques'] : [])].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, modifies.map((e) => h('tr', {},
          h('th', { scope: 'row' }, nomDe(e)),
          ...(cols.has(COL_NOTIF) && ajout ? [h('td', { class: 'diff-apres' }, e.cur.notifie)] : []),
          h('td', { class: 'diff-apres' }, e.cur.orient === 'sort' || !e.cur.niveau1 ? '—' : e.cur.niveau1),
          h('td', { class: 'diff-apres' }, ajout ? 'Entrée en ULIS' : (ORIENTATIONS.find(([v]) => v === e.cur.orient) || ['', 'Non saisi'])[1]),
          h('td', { class: 'diff-apres' }, nomEtab(e.cur.voeu1)),
          ...(cols.has(COL_REMARQUES) ? [h('td', { class: 'diff-apres' }, e.cur.remarques || '—')] : []),
        ))),
      ),
    ],
    actions: [
      { id: 'dlg-oui', libelle: 'Oui, valider', info: 'Écrire ces vœux dans Grist', onClick: () => ecrireVoeux(modifies, { ajout }) },
      { id: 'dlg-non', libelle: 'Revenir à la saisie', info: "Fermer cette fenêtre : rien n'est enregistré", secondaire: true },
    ],
    focus: 'dlg-oui',
  });
}

async function ecrireVoeux(aEcrire, { ajout }) {
  const cols = colonnesVoeux();
  const typeAnnee = cols.get('Annee_cible') ? cols.get('Annee_cible').type : '';
  const annee = /^(Int|Numeric)/.test(typeAnnee) ? anneeCible() : String(anneeCible());
  const actions = aEcrire.map((e) => {
    // Voeu_2 n'est plus saisi (remplacé par les remarques) : la colonne reste telle qu'elle est
    const f = { Niveau_n1: e.cur.niveau1, Voeu_1: e.cur.voeu1, Situation: situationDe(e.cur), ...(ajout ? { [COL_NOTIF]: e.cur.notifie } : {}), [COL_REMARQUES]: e.cur.remarques || '' };
    if (ajout && e.cur.notifie === 'Non') { delete f.Situation; f.Niveau_n1 = ''; f.Voeu_1 = 0; } // non notifié : ni niveau, ni vœu, ni situation
    const champs = Object.fromEntries(Object.entries(f).filter(([k]) => cols.has(k)));
    if (e.ex) return ['UpdateRecord', T_VOEUX, e.ex.id, champs];
    return ['AddRecord', T_VOEUX, null, { Eleve: e.row.id, ...(cols.has('Annee_cible') ? { Annee_cible: annee } : {}), ...(cols.has('Statut') ? { Statut: 'Saisi' } : {}), ...champs }];
  });
  const nVoeux = actions.length;
  if (ajout && champsExistants(T_ALERTES_ERS, { Ers_origine: 1 }).Ers_origine) {
    for (const e of aEcrire) {
      if (!reprisAutreErs(e.ex)) continue;
      actions.push(['AddRecord', T_ALERTES_ERS, null, champsExistants(T_ALERTES_ERS, { Eleve: e.row.id, Ers_origine: e.ex.saisiPar, Ers_demandeur: state.ers.email, Date_alerte: Math.floor(Date.now() / 1000), Etat: 'Nouvelle' })]);
    }
  }
  try {
    viderCache();
    await grist.docApi.applyUserActions(actions);
    state.edition = null; // l'écriture a réussi : plus rien à protéger
    const msg = `${nVoeux} vœu${nVoeux > 1 ? 'x' : ''} enregistré${nVoeux > 1 ? 's' : ''}.`;
    if (ajout) {
      const retour = state.ajout.retour;
      state.ajout = null;
      await openAjoutEleves(retour);
    } else {
      const { etabId, retour } = state.voeuxEtab;
      await openVoeuxEtab(etabId, retour);
    }
    notify('success', msg);
  } catch (err) {
    notify('error', `Enregistrement impossible : ${err.message}`);
  }
}

/* ------------------------------------------------------------------ */
/* Module d'ajout d'élèves (depuis l'accueil de l'ERS)                 */
/* ------------------------------------------------------------------ */
async function chargerAjout() {
  const base = state.ers ? (state.ers.data || (await chargerErs())) : await chargerSecteur({ voeux: true });
  const tv = await lireTable(T_VOEUX).catch(() => null);
  if (!tv || !tv.Eleve) throw new Error(`la table ${T_VOEUX} est introuvable ou n'a pas de colonne Eleve`);
  const { existants } = lireVoeuxExistants(tv);
  const todayIso = new Date().toISOString().slice(0, 10);
  const presentsAilleurs = new Map();
  for (const x of statutsEleves(base.lignes, todayIso, SITUATION_PAR_DEFAUT)) if (x.statut === 'present') presentsAilleurs.set(x.eleve, x.ligne);
  // élèves « ajoutés » déjà enregistrés : un vœu pour la rentrée, mais pas présents dans un dispositif (de mon secteur en mode ERS)
  await refreshIndividus();
  const parId = new Map(state.individus.map((r) => [r.id, r]));
  const secteur = state.ers ? new Set(base.etabs.filter((e) => state.ers.codes.has(e.ers)).map((e) => e.id)) : null;
  const deja = [];
  for (const [eleveId, ex] of existants) {
    const row = parId.get(eleveId);
    const ligne = presentsAilleurs.get(eleveId) || null;
    if (!row) continue;
    if (ligne && (secteur ? secteur.has(ligne.affectation) : ex.voeu1 === ligne.affectation)) continue; // en mode ERS : hors de mes dispositifs ; sinon : élèves dont le vœu change d'établissement
    deja.push({ row, ex, ligne });
  }
  deja.sort((a, b) => `${a.row.nom} ${a.row.prenom}`.localeCompare(`${b.row.nom} ${b.row.prenom}`, 'fr'));
  // alertes : un autre ERS a repris un élève de ma liste
  const alertes = [];
  const ta = state.ers ? await lireTable(T_ALERTES_ERS).catch(() => null) : null;
  if (ta && ta.Eleve && ta.Ers_origine) {
    const moi = state.ers.email.toLowerCase();
    ta.id.forEach((id, i) => {
      if (String(ta.Ers_origine[i]).trim().toLowerCase() !== moi || (ta.Etat && String(ta.Etat[i]) === 'Vue')) return;
      const row = parId.get(ta.Eleve[i]);
      alertes.push({ id, nom: row ? `${row.nom} ${row.prenom}`.trim() : `élève #${ta.Eleve[i]}`, par: ta.Ers_demandeur ? String(ta.Ers_demandeur[i]) : '' });
    });
  }
  return { existants, presentsAilleurs, etabs: base.etabs, deja, alertes };
}

async function openAjoutEleves(retour) {
  if (state.edition) return gardeSortie(() => openAjoutEleves(retour));
  clearNotice();
  let data;
  try {
    data = await chargerAjout();
  } catch (err) {
    notify('error', `Ouverture impossible : ${err.message}`);
    return;
  }
  const eleves = data.deja.map(({ row, ex, ligne }) => {
    const niveau = ligne ? (ligne.niveau || '').trim() : '';
    const initial = etatDepuisVoeu(ex, null, niveau);
    return { row, niveau, ex, initial, cur: { ...initial }, gere: true, ajoute: true, enregistre: true, origine: ligne ? ligne.affectation : 0 };
  });
  state.ajout = { retour, data, eleves, secteurSeul: Boolean(state.ers) };
  state.step = 0;
  masquerPages();
  $('#step-ajout').hidden = false;
  $('#stepper').replaceChildren(
    h(
      'div',
      { class: 'fr-stepper' },
      h('h1', { class: 'fr-stepper__title', id: 'h-ajout', tabindex: '-1' }, `Nouveaux élèves et élèves hors secteur (rentrée ${anneeCible()})`),
      h('p', { class: 'fr-stepper__details' }, "Élèves pas encore en ULIS, ou venant d'un autre dispositif : chaque élève ajouté s'inscrit sous le précédent, avec le vœu d'établissement à saisir. Validez une seule fois pour tous."),
    ),
    h(
      'nav',
      { 'aria-label': 'Navigation', class: 'step-nav fr-mb-2w' },
      h('button', { type: 'button', class: 'fr-btn fr-btn--tertiary fr-btn--sm fr-btn--icon-left fr-icon-arrow-left-s-line', title: 'Quitter cette page : les élèves non validés sont perdus', onclick: () => { clearNotice(); retour.action(); } }, retour.libelle),
    ),
  );
  state.edition = {
    fermer: () => {},
    dirty: () => !$('#step-ajout').hidden && Boolean(state.ajout) && state.ajout.eleves.some(voeuxChange),
    focus: () => $('#h-ajout')?.focus(),
    message: 'Vous avez ajouté des élèves sans les valider : ils seront perdus.',
  };
  rendreAjout();
  $('#h-ajout').focus();
}

/** Supprime le vœu enregistré d'un élève de la liste (après confirmation) : la ligne de Voeux_ERS disparaît. */
function supprimerVoeu(e, apres = null) {
  const nom = `${e.row.nom} ${e.row.prenom}`.trim();
  ouvrirModale({
    titre: `Supprimer le vœu de ${nom} ?`,
    icone: 'fr-icon-delete-line',
    corps: [h('p', {}, `Le vœu enregistré pour la rentrée ${anneeCible()} sera supprimé de Grist. ${nom} ne figurera plus dans cette liste ni dans les effectifs prévus.`)],
    actions: [
      { id: 'dlg-oui', libelle: 'Oui, supprimer', info: 'Supprimer la ligne dans Voeux_ERS', onClick: async () => {
        try {
          viderCache();
          await grist.docApi.applyUserActions([['RemoveRecord', T_VOEUX, e.ex.id]]);
          state.edition = null;
          await (apres ? apres() : openAjoutEleves(state.ajout.retour));
          notify('success', `Vœu de ${nom} supprimé.`);
        } catch (err) {
          notify('error', `Suppression impossible : ${err.message}`);
        }
      } },
      { id: 'dlg-non', libelle: 'Annuler', info: "Fermer cette fenêtre : rien n'est supprimé", secondaire: true },
    ],
    focus: 'dlg-non',
  });
}

/** Vœu déjà saisi par un autre ERS : l'ajout le « reprend » et alerte cet ERS. Hors mode ERS : pas d'alerte. */
const reprisAutreErs = (ex) => Boolean(state.ers && ex && ex.saisiPar && ex.saisiPar !== state.ers.email.toLowerCase());

function ajouterEleveAjout(row) {
  const a = state.ajout;
  if (a.eleves.some((e) => e.row.id === row.id)) {
    notify('info', `${`${row.nom} ${row.prenom}`.trim()} est déjà dans la liste.`);
    return;
  }
  const ex = a.data.existants.get(row.id) || null;
  const ligne = a.data.presentsAilleurs.get(row.id) || null; // déjà dans un dispositif : on l'appelle dans un autre
  const niveau = ligne ? (ligne.niveau || '').trim() : '';
  const initial = etatDepuisVoeu(ex, null, niveau);
  a.eleves.push({ row, niveau, ex, initial, cur: { ...initial, orient: 'change' }, gere: true, ajoute: true, origine: ligne ? ligne.affectation : 0 });
  rendreAjout();
  $(`#a${a.eleves.length - 1}-v1`)?.focus();
  const autre = reprisAutreErs(ex);
  notify(autre ? 'warning' : 'success', autre ? `${`${row.nom} ${row.prenom}`.trim()} figure déjà dans la liste d'un autre ERS (${ex.saisiPar}) : il en sera alerté à la validation.` : `${`${row.nom} ${row.prenom}`.trim()} ajouté : choisissez son vœu et son niveau n+1 puis validez.`);
}

function rendreAjout() {
  const a = state.ajout;
  const modeErs = Boolean(state.ers);
  const secteurIds = new Set(modeErs ? a.data.etabs.filter((e) => state.ers.codes.has(e.ers)).map((e) => e.id) : []);
  // le vœu d'un élève déjà saisi est vidé s'il sort de la liste proposée
  for (const e of a.eleves) if (modeErs && a.secteurSeul && e.cur.voeu1 && !secteurIds.has(e.cur.voeu1)) e.cur.voeu1 = 0;
  const ctx = {
    ajout: true,
    prefixe: 'a',
    optionsEtab: () => state.etabs.filter((x) => !modeErs || !a.secteurSeul || secteurIds.has(x.id)).map((x) => ({ value: x.id, label: x.label })),
    maj: () => majPiedVoeux(a.eleves, { ajout: true }),
    retirer: (e) => { a.eleves = a.eleves.filter((x) => x !== e); rendreAjout(); },
    rerender: (focusId) => { rendreAjout(); $(`#${focusId}`)?.focus(); },
  };
  const alertes = a.data.alertes || [];
  $('#ajout').replaceChildren(...[
    alertes.length === 0 ? null : h('div', { class: 'fr-alert fr-alert--warning fr-mb-2w', id: 'ajout-alertes', role: 'status' },
      h('h3', { class: 'fr-alert__title' }, `${alertes.length} élève${alertes.length > 1 ? 's' : ''} de votre liste repris par un autre ERS`),
      h('ul', {}, alertes.map((x) => h('li', {}, `${x.nom}${x.par ? ` : repris par ${x.par}` : ''}`))),
      h('button', { type: 'button', class: 'fr-btn fr-btn--sm fr-btn--secondary bouton-ecriture', id: 'btn-alertes-vues', title: 'Marquer ces alertes comme lues', onclick: async () => {
        try { await grist.docApi.applyUserActions(alertes.map((x) => ['UpdateRecord', T_ALERTES_ERS, x.id, { Etat: 'Vue' }])); a.data.alertes = []; rendreAjout(); } catch (err) { notify('error', `Impossible de marquer les alertes comme lues : ${err.message}`); }
      } }, "J'ai vu"),
    ),
    h('div', { class: 'fr-alert fr-alert--warning fr-alert--sm fr-mb-2w', id: 'voeux-alerte-globale', role: 'status', hidden: true }, h('p', { class: 'fr-alert__title' }, 'Maintien en 3e'), h('p', {})),
    !modeErs ? null : h('div', { class: 'fr-checkbox-group fr-mb-2w' },
      h('input', { type: 'checkbox', id: 'ajout-secteur', checked: a.secteurSeul, onchange: (ev) => { a.secteurSeul = ev.target.checked; rendreAjout(); $('#ajout-secteur')?.focus(); } }),
      h('label', { class: 'fr-label', for: 'ajout-secteur', title: 'Limite le menu des vœux aux établissements de votre secteur' }, 'Établissement de mon secteur', h('span', { class: 'fr-hint-text' }, 'Décochez pour proposer tous les établissements du département.'))),
    h('h2', { class: 'fr-h6' }, 'Rechercher un élève'),
    h('div', { class: 'fr-input-group' }, h('label', { class: 'fr-label', for: 'ajout-q' }, 'Nom, prénom ou année de naissance', h('span', { class: 'fr-hint-text' }, 'Les suggestions apparaissent dès 2 caractères ; un clic sur une suggestion ajoute l’élève sous les précédents.')), h('div', { class: 'fr-input-wrap fr-icon-search-line' }, h('input', { class: 'fr-input', id: 'ajout-q', type: 'text', autocomplete: 'off' }))),
    noteColonnesVoeux(),
    a.eleves.length === 0
      ? h('div', { class: 'fr-alert fr-alert--info fr-alert--sm fr-mt-2w' }, h('p', {}, "Aucun élève ajouté pour l'instant."))
      : h('div', { class: 'fr-mt-2w' }, tableVoeux(a.eleves, ctx, `Élèves ajoutés, rentrée ${anneeCible()}`)),
    h(
      'div',
      { class: 'fr-mt-3w bouton-ecriture' },
      h('p', { id: 'voeux-etat', role: 'status', class: 'fr-hint-text' }),
      h('button', { type: 'button', class: 'fr-btn', id: 'btn-valider-voeux', title: 'Enregistrer les élèves ajoutés, après une confirmation', onclick: () => validerVoeux(a.eleves, { ajout: true }) }, 'Valider les élèves ajoutés'),
    ),
  ].filter(Boolean));
  attachSuggest($('#ajout-q'), {
    minChars: 2,
    fetchItems: async (q) => { await refreshIndividus(); return suggestionsEleves(q); },
    onPick: (item) => ajouterEleveAjout(item.row),
  });
  ctx.maj();
}


/* ------------------------------------------------------------------ */
/* Entrée ERS (enseignant référent)                                    */
/* ------------------------------------------------------------------ */
/**
 * Mode ERS : la table Acces_ERS ne renvoie à un ERS que sa propre ligne (règle d'accès Grist sur l'e-mail) ; une seule
 * ligne lue = mode ERS, plusieurs (coordonnateur, administrateur) = affichage complet. Pour essayer : `?ers=adresse@…`
 * choisit une ligne, `?coordo=1` force l'affichage complet. Ce choix n'est qu'un affichage : la protection des données
 * est celle des règles d'accès Grist.
 */
async function chargerAccesErs() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('coordo') === '1') return null;
  const t = await grist.docApi.fetchTable(T_ACCES_ERS).catch(() => null);
  if (!t || !t.Email || t.id.length === 0) return null;
  const voulu = (params.get('ers') || '').trim().toLowerCase();
  let i = -1;
  if (voulu) i = t.Email.findIndex((x) => String(x).trim().toLowerCase() === voulu);
  else if (t.id.length === 1) i = 0;
  if (i < 0) return null;
  const codes = new Set(String(t.Secteurs_ERS ? cellText(t.Secteurs_ERS[i]) : '').split(/[^0-9]+/).filter(Boolean).map((c) => c.padStart(3, '0')));
  return { email: String(t.Email[i]).trim(), nom: t.Nom ? cellText(t.Nom[i]).trim() : '', codes, data: null };
}

async function chargerErs() {
  const data = await chargerSecteur({ voeux: true });
  const ts = await lireTable(T_SUIVIS_ERS).catch(() => null);
  const moi = state.ers.email.toLowerCase();
  const suivis = new Set();
  if (ts && ts.Eleve && ts.Ers_email) ts.id.forEach((_, i) => { if (String(ts.Ers_email[i]).trim().toLowerCase() === moi && (!ts.Actif || ts.Actif[i] !== false)) suivis.add(ts.Eleve[i]); });
  const etabParEleve = new Map();
  for (const x of statutsEleves(data.lignes, new Date().toISOString().slice(0, 10), SITUATION_PAR_DEFAUT)) if (x.statut === 'present') etabParEleve.set(x.eleve, x.ligne.affectation);
  state.ers.data = { ...data, suivis, etabParEleve, suiviTable: Boolean(ts && ts.Eleve && ts.Ers_email) };
  return state.ers.data;
}

/** Un élève est géré par l'ERS connecté s'il est dans un établissement de ses secteurs, ou s'il l'a « récupéré ». Hors mode ERS : toujours. */
function gereParErs(etabId, eleveId) {
  if (!state.ers || !state.ers.data) return true;
  const e = state.ers.data.etabs.find((x) => x.id === etabId);
  return Boolean((e && state.ers.codes.has(e.ers)) || state.ers.data.suivis.has(eleveId));
}

async function openErsAccueil({ focus = true } = {}) {
  if (state.edition) return gardeSortie(() => openErsAccueil({ focus }));
  clearNotice();
  try {
    await chargerErs();
  } catch (err) {
    notify('error', `Lecture de vos établissements impossible : ${err.message}`);
    return;
  }
  const { etabs, avecVoeu } = state.ers.data;
  const codes = [...state.ers.codes].sort();
  const miens = etabs.filter((e) => state.ers.codes.has(e.ers));
  state.step = 0;
  masquerPages();
  $('#step-ers').hidden = false;
  $('#stepper').replaceChildren(
    h(
      'div',
      { class: 'fr-stepper' },
      h('h1', { class: 'fr-stepper__title', id: 'h-ers', tabindex: '-1' }, `Vœux ULIS n+1 (rentrée ${anneeCible()})`),
      h('p', { class: 'fr-stepper__details' }, `${state.ers.nom ? `${state.ers.nom} · ` : ''}${codes.length ? `Secteur${codes.length > 1 ? 's' : ''} ${codes.join(', ')}` : 'Aucun secteur renseigné'}`),
    ),
  );
  const retourAccueil = { libelle: 'Revenir à ma page', action: () => openErsAccueil() };
  const tableau =
    miens.length === 0
      ? h('div', { class: 'fr-alert fr-alert--info fr-alert--sm' }, h('p', {}, 'Aucun établissement.'))
      : h(
          'div',
          { class: 'fr-table fr-table--no-caption' },
          h('div', { class: 'fr-table__wrapper' }, h('div', { class: 'fr-table__container' }, h('div', { class: 'fr-table__content' },
            h('table', {},
              h('caption', {}, 'Établissements de mes secteurs'),
              h('thead', {}, h('tr', {}, ['Établissement', 'Commune', 'Élèves présents', 'Prévus à la rentrée', 'Vœux'].map((t) => h('th', { scope: 'col' }, t)))),
              h('tbody', {}, miens.map((e) => {
                const n = e.ids.filter((id) => !avecVoeu.has(id)).length;
                return h('tr', {}, h('td', {}, h('button', { type: 'button', class: 'fr-link lien-etab', title: 'Ouvrir les vœux des élèves de cet établissement', onclick: () => openVoeuxEtab(e.id, retourAccueil) }, e.label)), h('td', {}, e.commune || '—'), h('td', {}, String(e.presents)), h('td', {}, String(e.prevus || 0)), h('td', {}, e.presents === 0 ? '—' : n === 0 ? h('p', { class: 'fr-badge fr-badge--success fr-badge--sm fr-badge--no-icon' }, 'Complets') : h('p', { class: 'fr-badge fr-badge--warning fr-badge--sm fr-badge--no-icon' }, `${n} sans vœu`)));
              })),
            ),
          ))),
        );
  $('#ers').replaceChildren(
    h('h2', { class: 'fr-h5' }, 'Mes établissements'),
    h('p', { class: 'fr-hint-text' }, 'Les dispositifs ULIS de vos secteurs.'),
    tableau,
    h('h2', { class: 'fr-h5 fr-mt-4w' }, 'Nouveaux élèves et élèves hors secteur'),
    h('p', { class: 'fr-hint-text' }, "Élèves à saisir qui ne sont pas dans un dispositif de mon secteur (nouveaux élèves, ou déjà en ULIS ailleurs) : liste, recherche, ajout, et notification ULIS au 01/09."),
    h('button', { class: 'fr-btn fr-btn--secondary bouton-ecriture', type: 'button', id: 'btn-ajout-eleve', title: "Ouvrir le module d'ajout d'élèves", onclick: () => openAjoutEleves(retourAccueil) }, 'Nouveaux élèves et élèves hors secteur'),
    h('h2', { class: 'fr-h5 fr-mt-4w' }, 'Mon accusé'),
    h('p', { class: 'fr-hint-text' }, `Récapitulatif de mes vœux (PDF et Excel) pour la rentrée ${anneeCible()}, envoyé à ${state.ers.email}.`),
    h('button', { class: 'fr-btn fr-btn--secondary bouton-ecriture', type: 'button', id: 'btn-accuse', title: 'Demander l\'envoi du récapitulatif de mes vœux par mail', onclick: demanderAccuse }, 'Recevoir mon accusé'),
  );
  if (focus) $('#h-ers').focus();
}

function champsExistants(tableId, champs) {
  const cols = new Set([...state.colById.values()].filter((c) => c.tableId === tableId).map((c) => c.colId));
  return Object.fromEntries(Object.entries(champs).filter(([k]) => cols.has(k)));
}

function demanderAccuse() {
  ouvrirModale({
    titre: 'Recevoir mon accusé',
    icone: 'fr-icon-mail-line',
    corps: [h('p', {}, `Une demande d'accusé récapitulatif de vos vœux pour la rentrée ${anneeCible()} sera enregistrée pour ${state.ers.email}.`)],
    actions: [
      { id: 'dlg-oui', libelle: 'Oui, demander', info: 'Enregistrer la demande dans Grist', onClick: ecrireAccuse },
      { id: 'dlg-non', libelle: 'Annuler', info: "Fermer cette fenêtre : rien n'est enregistré", secondaire: true },
    ],
    focus: 'dlg-oui',
  });
}

async function ecrireAccuse() {
  try {
    const champs = champsExistants(T_ACCUSES_ERS, { Ers_email: state.ers.email, Date_demande: Math.floor(Date.now() / 1000), Etat: 'À envoyer' });
    if (!champs.Ers_email) throw new Error(`la table ${T_ACCUSES_ERS} est introuvable (colonne Ers_email)`);
    await grist.docApi.applyUserActions([['AddRecord', T_ACCUSES_ERS, null, champs]]);
    notify('success', "Demande d'accusé enregistrée.");
  } catch (err) {
    notify('error', `Demande impossible : ${err.message}`);
  }
}

$('#btn-secteur').addEventListener('click', () => openSecteur(retourAccueil()));
$('#btn-voeux').addEventListener('click', () => openSecteur(retourAccueil(), { voeux: true }));

/* ------------------------------------------------------------------ */
/* Élèves exclus                                                       */
/* ------------------------------------------------------------------ */
const retourExclus = () => ({ libelle: 'Revenir aux élèves exclus', action: () => openExclus(state.exclus.retour, { garder: true }) });

async function chargerExclus() {
  const [tScol, tInd] = await Promise.all([lireTable(T_SCOLARITE), lireTable(T_INDIVIDUS)]);
  state.individus = toIndividus(tInd);
  const parId = new Map(state.individus.map((r) => [r.id, r]));
  const todayIso = new Date().toISOString().slice(0, 10);
  return elevesExclus(lignesDe(tScol), todayIso)
    .filter((x) => parId.has(x.eleve))
    .map((x) => ({
    row: parId.get(x.eleve),
    ligne: x.ligne,
    derniere: x.derniere, // dernière affectation connue : la ligne d'exclusion n'a généralement pas d'établissement
    etab: x.derniere ? state.etabLabel.get(x.derniere.affectation) || `#${x.derniere.affectation}` : '',
    niveau: x.ligne.niveau || (x.derniere ? x.derniere.niveau : ''),
  }));
}

async function openExclus(retour = retourAccueil(), { garder = false } = {}) {
  if (state.edition) return gardeSortie(() => openExclus(retour, { garder }));
  clearNotice();
  let rows;
  try {
    rows = await chargerExclus();
  } catch (err) {
    notify('error', `Lecture des élèves exclus impossible : ${err.message}`);
    return;
  }
  const prec = garder && state.exclus ? state.exclus : null;
  state.exclus = { retour, rows, tri: prec ? prec.tri : { cle: 'date', dir: -1 }, q: prec ? prec.q : '' };
  state.step = 0;
  masquerPages();
  $('#step-exclus').hidden = false;
  $('#stepper').replaceChildren(
    h(
      'div',
      { class: 'fr-stepper' },
      h('h1', { class: 'fr-stepper__title', id: 'h-exclus', tabindex: '-1' }, 'Élèves exclus'),
      h('p', { class: 'fr-stepper__details' }, "Élèves dont la dernière ligne de scolarité est une exclusion, tant qu'ils n'ont pas de nouvelle affectation (y compris d'une année scolaire précédente). Un clic sur un nom ouvre le dossier, un clic sur la dernière affectation le dispositif de cet établissement."),
    ),
    h(
      'nav',
      { 'aria-label': 'Navigation', class: 'step-nav fr-mb-2w' },
      h('button', { type: 'button', class: 'fr-btn fr-btn--tertiary fr-btn--sm fr-btn--icon-left fr-icon-arrow-left-s-line', title: 'Quitter cette page', onclick: () => { clearNotice(); retour.action(); } }, retour.libelle),
    ),
  );
  rendreExclus();
  $('#h-exclus').focus();
}

function rendreExclus() {
  const ex = state.exclus;
  const tri = ex.tri;
  const cles = {
    nom: (x) => `${x.row.nom} ${x.row.prenom}`,
    etab: (x) => x.etab,
    niveau: (x) => x.niveau,
    date: (x) => x.ligne.date,
  };
  const onTri = (cle) => {
    ex.tri = { cle, dir: tri.cle === cle ? -tri.dir : cle === 'date' ? -1 : 1 };
    rendreExclus();
    $(`#exclus [data-tri="${cle}"]`)?.focus();
  };
  const jetons = normSearch(ex.q || '').split(/\s+/).filter(Boolean);
  const correspond = (x) => !jetons.length || jetons.every((t) => normSearch(`${x.row.nom} ${x.row.prenom} ${x.etab}`).includes(t));
  const val = cles[tri.cle];
  const liste = ex.rows.filter(correspond).sort((a, b) => {
    const u = val(a);
    const v = val(b);
    const vide = (z) => z === '' || z === null || z === undefined;
    if (vide(u) !== vide(v)) return vide(u) ? 1 : -1; // valeur absente : toujours en dernier
    return String(u).localeCompare(String(v), 'fr', { numeric: true }) * tri.dir || cles.nom(a).localeCompare(cles.nom(b), 'fr');
  });
  const recherche = h('input', {
    class: 'fr-input',
    id: 'x-q',
    type: 'search',
    autocomplete: 'off',
    value: ex.q || '',
    title: "Saisissez une partie du nom, du prénom ou de l'établissement : la liste se réduit au fil de la frappe",
    oninput: (e) => {
      ex.q = e.target.value;
      rendreExclus();
      const champ = $('#x-q');
      champ.focus();
      champ.setSelectionRange(champ.value.length, champ.value.length);
    },
  });
  $('#exclus').replaceChildren(
    h(
      'div',
      { class: 'fr-grid-row fr-grid-row--gutters fr-mb-2w' },
      h('div', { class: 'fr-input-group fr-col-12 fr-col-md-4' }, h('label', { class: 'fr-label', for: 'x-q' }, 'Rechercher un élève exclu'), h('div', { class: 'fr-input-wrap fr-icon-search-line' }, recherche)),
    ),
    h('p', { role: 'status' }, `${liste.length} élève${liste.length > 1 ? 's' : ''} exclu${liste.length > 1 ? 's' : ''}${liste.length !== ex.rows.length ? ` sur ${ex.rows.length}` : ''}`),
    liste.length === 0
      ? h('div', { class: 'fr-alert fr-alert--info fr-alert--sm' }, h('p', {}, ex.rows.length ? 'Aucun élève exclu ne correspond à cette recherche.' : "Aucun élève n'est actuellement exclu : aucune dernière ligne de scolarité n'est en situation « Exclusion »."))
      : h(
          'div',
          { class: 'fr-table fr-table--no-caption' },
          h(
            'div',
            { class: 'fr-table__wrapper' },
            h(
              'div',
              { class: 'fr-table__container' },
              h(
                'div',
                { class: 'fr-table__content' },
                h(
                  'table',
                  {},
                  h('caption', {}, 'Élèves exclus'),
                  h('thead', {}, h('tr', {}, [['Élève', 'nom'], ['Dernière affectation', 'etab'], ['Classe', 'niveau'], ['Exclu depuis le', 'date']].map(([lib, cle]) => enteteTri(lib, cle, onTri, tri)))),
                  h(
                    'tbody',
                    {},
                    liste.map((x) =>
                      h(
                        'tr',
                        {},
                        h('td', {}, h('button', { type: 'button', class: 'fr-link lien-etab', 'aria-label': `Dossier de ${x.row.nom} ${x.row.prenom}`, title: "Ouvrir le dossier de cet élève", onclick: () => openDossier(x.row, 'exclus') }, `${x.row.nom} ${x.row.prenom}`.trim() || 'Sans nom'), badgeIncomplet(x.row) ? [h('br'), badgeIncomplet(x.row)] : null),
                        h('td', {}, x.derniere ? lienEtab(x.derniere, retourExclus()) : '—'),
                        h('td', {}, x.niveau || '—'),
                        h('td', { class: 'nowrap' }, formatDateFr(x.ligne.date) || '—'),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
  );
}

$('#btn-exclus').addEventListener('click', () => openExclus(retourAccueil()));

/* ------------------------------------------------------------------ */
/* Démarrage                                                           */
/* ------------------------------------------------------------------ */
/**
 * Pop-up d'accueil : les flèches « précédent / suivant » du navigateur ne pilotent pas le widget (elles agissent sur la
 * page Grist qui l'entoure, surtout en mode intégré). Affichée une fois par session de navigation ; si le navigateur
 * refuse le stockage de session, elle s'affiche à chaque ouverture.
 */
/**
 * Mode de consultation : Grist ajoute `readonly=true|false` à l'adresse du widget (avec `access`, `language`…). `true` pour
 * l'URL intégrée `?embed=true` et pour les lecteurs, `false` pour les éditeurs. Si le paramètre manque (autre hôte, ancienne
 * version), repli sur la table `Droits_widget` (une ligne), que les règles d'accès rendent lisible aux seuls éditeurs ; table
 * absente, illisible ou vide : lecteur, le cas le plus prudent.
 */
const T_DROITS = 'Droits_widget';
/**
 * Lecture seule déclarée par Grist (`readonly=true` dans l'adresse) : on masque alors les boutons d'écriture. Volontairement
 * limité au cas explicite : sans le paramètre, rien n'est masqué (un éditeur ne doit jamais perdre ses boutons par erreur) ;
 * la protection réelle reste la règle d'accès de Grist, qui refuse l'écriture.
 */
function lectureSeule() {
  return document.body.classList.contains('lecture-seule');
}
/**
 * Gros bandeau d'avertissement sur une copie de test, pour ne pas y saisir de données réelles : le nom du document contient
 * « test », ou l'adresse du widget porte `?test=1`. Le nom du document vient de Grist ; rien n'est lu ni écrit.
 */
const VERSION_APP = '20261126l';
// getDocName renvoie l'identifiant du document (pas son titre) : on reconnaît donc les copies de test par leur identifiant
const DOCS_TEST = ['1MPYgKupd8VcTMBQr2DtdJ'];

async function afficherBandeauTest() {
  let test = false;
  let nom = '';
  try {
    test = new URLSearchParams(window.location.search).get('test') === '1';
    if (grist.docApi && typeof grist.docApi.getDocName === 'function') nom = String(await grist.docApi.getDocName());
    if (!test) test = DOCS_TEST.includes(nom) || /test|copie|copy|essai/i.test(nom);
  } catch {
    /* le nom du document est un confort : sans lui, pas de bandeau */
  }
  // Ligne discrète en bas de page : nom du document lu par le widget et version chargée (aide à diagnostiquer un bandeau absent)
  if (!document.getElementById('pied-info')) document.querySelector('.app-pied').append(h('p', { id: 'pied-info', class: 'fr-text--xs fr-hint-text fr-mb-0' }, `Document : ${nom || 'nom non lu'} · version ${VERSION_APP}`));
  if (!test || document.getElementById('bandeau-test')) return;
  document.body.prepend(h('div', { id: 'bandeau-test', role: 'status' }, h('p', { class: 'bandeau-test-titre' }, 'COPIE DE TEST'), h('p', { class: 'bandeau-test-texte' }, 'Ce n\'est pas le document réel : n\'y saisissez aucune donnée réelle.')));
}

function appliquerLectureSeule() {
  try {
    if (new URLSearchParams(window.location.search).get('readonly') === 'true') document.body.classList.add('lecture-seule');
  } catch {
    /* adresse illisible : on ne masque rien */
  }
}

async function estEditeur() {
  try {
    const ro = new URLSearchParams(window.location.search).get('readonly');
    if (ro === 'true') return false;
    if (ro === 'false') return true;
  } catch {
    /* adresse illisible : repli ci-dessous */
  }
  try {
    const t = await grist.docApi.fetchTable(T_DROITS);
    return Array.isArray(t.id) && t.id.length > 0;
  } catch {
    return false;
  }
}

function accueilNavigation() {
  const CLE = 'affectation-accueil-vu';
  try {
    if (sessionStorage.getItem(CLE)) return;
    sessionStorage.setItem(CLE, '1');
  } catch {
    /* stockage indisponible : on affiche quand même */
  }
  ouvrirModale({
    titre: 'Avant de commencer',
    icone: 'fr-icon-information-line',
    corps: [
      h('p', {}, h('strong', {}, 'N\'utilisez pas les flèches « précédent » et « suivant » de votre navigateur.')),
      h('p', {}, "Elles ne pilotent pas cette page : elles vous feraient quitter la page Grist, ou perdre votre recherche et une modification en cours."),
      h('p', { class: 'fr-mb-0' }, "Pour revenir en arrière, utilisez les boutons « Revenir à… » en haut de chaque page."),
    ],
    actions: [{ id: 'dlg-ok', libelle: "J'ai compris", info: 'Fermer ce message et commencer' }],
    focus: 'dlg-ok',
  });
}

async function init() {
  initAccessibilite();
  grist.ready({ requiredAccess: 'full' });
  appliquerLectureSeule();
  await afficherBandeauTest();
  goto(1, { focus: false });
  estEditeur().then((editeur) => {
    if (!editeur) accueilNavigation(); // les éditeurs connaissent l'outil : le message vise ceux qui consultent
  });
  try {
    // Individus ne dépend pas des métadonnées : on lance sa lecture en même temps, au lieu de l'enchaîner après elles.
    const individus = lireTable(T_INDIVIDUS);
    await loadMeta();
    lireTable(T_SCOLARITE).catch(() => {}); // préchargée en arrière-plan : suggestions et pages dispositifs seront prêtes
    state.individus = toIndividus(await individus);
    state.ers = await chargerAccesErs();
    if (state.ers) await openErsAccueil({ focus: false });
  } catch (err) {
    notify('error', `Initialisation impossible : ${err.message}`);
  }
}
init();
