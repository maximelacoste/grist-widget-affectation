import { banUrl, cellText, cle, filterOptions, formatDateFr, isInvalidCell, isoToSec, ligneEnCours, niveauxPour, typeEtab, libelleEtab, norm, normSearch, parseBan, searchIndividus, rechercheLibre, libelleEleve, secToIso, tableToRows, toIndividus, elevesDuDispositif, trierEleves, effectifsParEtab, alerteFinDroits, libelleAlerteFin, infosManquantes } from './lib.js';
import { attachSuggest } from './suggest.js';
import { activerCalendriers } from './calendrier.js';

activerCalendriers(); // clic n'importe où dans un champ date : calendrier intégré (showPicker est refusé dans l'iframe Grist)

/* ------------------------------------------------------------------ */
/* Configuration : noms des tables et colonnes du document Grist       */
/* ------------------------------------------------------------------ */
const T_INDIVIDUS = 'Individus';
const T_SCOLARITE = 'Scolarite';
const COL = {
  eleve: 'Eleve_Identite_', // référence Scolarite -> Individus
  affectation: 'Affectation', // référence vers Etablissements_avec_ULIS (colonne de données)
  dateEffet: 'Date_effet',
  niveau: 'Niveau_saisi', // Choice
  situation: 'Situation', // Choice
  attente: 'Liste_d_attente', // Bascule
};
const SITUATION_PAR_DEFAUT = 'En ULIS';
// Alerte « fin de droits » : une fin passée est signalée en rouge, une fin dans les N prochains jours en orange.
// 120 jours (≈ 4 mois) laissent le temps de préparer un renouvellement ; à ajuster ici.
const FIN_DROITS_ALERTE_JOURS = 120;
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
        h('p', { class: 'fr-stepper__details' }, "Cherche un élève pour consulter son dossier ou saisir son affectation, ou un établissement pour voir son dispositif ULIS."),
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
  for (let i = 1; i <= STEPS.length; i += 1) $(`#step-${i}`).hidden = true;
  $('#step-create').hidden = true;
  $('#step-dossier').hidden = true;
  $('#step-dispo').hidden = true;
  $('#step-secteur').hidden = true;
}

function goto(step, { focus = true } = {}) {
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
    if (!c) throw new Error(`Colonne introuvable : ${tableId}.${colId}`);
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
  const t = await grist.docApi.fetchTable(refTable);
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

async function refreshIndividus() {
  state.individus = toIndividus(await lireTable(T_INDIVIDUS));
}

const triScol = (a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id;

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
  return tableToRows(t, Object.values(COL)).filter((r) => r[COL.eleve] === eleveId).map(mapLigne).sort(triScol);
}

/** Affectation en cours de plusieurs élèves en une seule passe : Map(id d'élève -> ligne en cours). */
function enCoursDe(t, ids) {
  const groupes = new Map();
  for (const r of tableToRows(t, Object.values(COL))) {
    const e = r[COL.eleve];
    if (!ids.has(e)) continue;
    if (!groupes.has(e)) groupes.set(e, []);
    groupes.get(e).push(mapLigne(r));
  }
  const today = new Date().toISOString().slice(0, 10);
  return new Map([...groupes].map(([e, l]) => [e, ligneEnCours(l.sort(triScol), today)]));
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
    setFieldError('q', 'Saisis au moins 2 lettres du nom ou du prénom, ou une année de naissance.');
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

// Recherche prédictive : « NOM Prénom, né(e) le … » dès 2 caractères ; un clic ouvre directement l'élève.
attachSuggest($('#q'), {
  minChars: 2,
  fetchItems: (query) =>
    rechercheLibre(state.individus, query, 8).rows.map((r) => ({ value: String(r.id), label: libelleEleve(r), row: r })),
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

/** Cellule « Affectation en cours » : établissement, puis niveau et situation en petit. */
function celluleEnCours(l, retour) {
  if (!l) return '—';
  const detail = [l.niveau, l.situation].filter(Boolean).join(' · ');
  return [lienEtab(l, retour), detail || l.attente ? h('br') : null, detail ? h('span', { class: 'fr-text--sm fr-hint-text' }, detail) : null, l.attente ? [' ', h('p', { class: 'fr-badge fr-badge--info fr-badge--sm fr-badge--no-icon' }, "Liste d'attente")] : null];
}

async function renderResults() {
  const { total, rows } = state.results;
  const box = $('#results');
  if (total === 0) {
    box.replaceChildren(h('div', { class: 'fr-alert fr-alert--info fr-alert--sm' }, h('p', {}, 'Aucune fiche ne correspond : tu peux la créer.')));
    return;
  }
  let enCours = new Map();
  try {
    enCours = enCoursDe(await lireTable(T_SCOLARITE), new Set(rows.map((r) => r.id)));
  } catch {
    /* l'affectation en cours est un confort : la liste reste utilisable sans elle */
  }
  const more = total > rows.length ? `${total} fiches correspondent, les ${rows.length} premières sont affichées : précise la recherche.` : '';
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
                    h('td', { class: 'nowrap' }, formatDateFr(r.ddn) || 'non renseignée', badgeIncomplet(r) ? [h('br'), badgeIncomplet(r)] : null),
                    h('td', {}, celluleEnCours(enCours.get(r.id), retourResultats())),
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
                            { class: 'fr-btn fr-btn--sm', type: 'button', onclick: () => chooseEleve(r), 'aria-label': `Affecter ${r.nom} ${r.prenom}`, title: "Ouvrir les affectations de cet élève pour en ajouter ou en modifier une" },
                            'Affecter',
                          ),
                        ),
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
      h('p', { class: 'fr-stepper__details' }, "Vérifie d'abord qu'elle n'existe pas déjà : les fiches proches s'affichent pendant la saisie.", state.createCtx ? ` Ensuite, tu saisiras l'affectation de l'élève à ${state.etabLabel.get(state.createCtx.etabId) || 'cet établissement'}.` : ''),
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
      h('p', {}, exact ? 'Utilise la fiche existante plutôt que d\'en créer une seconde.' : "Si c'est le même élève, utilise sa fiche. Sinon, continue la saisie."),
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
      total > rows.length ? h('p', { class: 'fr-text--sm' }, `Les ${rows.length} premières sont affichées : précise le nom ou le prénom.`) : null,
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
/** Pastille « Dossier incomplet » (avec la liste de ce qui manque) ; `null` si nom, prénom et date de naissance sont renseignés. */
function badgeIncomplet(row) {
  const m = infosManquantes(row);
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

/* ------------------------------------------------------------------ */
/* Dossier : modification globale (un bouton Modifier) avec confirmation */
/* ------------------------------------------------------------------ */
const colManuelle = (re, types) => state.champsManuels.find((f) => re.test(f.colId) && types.includes(f.type));
const AVERT_ETAT_CIVIL =
  "Attention : le nom, le prénom et la date de naissance forment la clé de rapprochement de l'élève. Les liens qui passent par cette clé (Eleves_ULIS, notes, notifications) peuvent se rompre.";
const AIDE_EDITION =
  'Ce que tu saisis dans les coordonnées et les dates de notification prime sur la valeur qui vient de la MDPH. Champ vidé : retour à la valeur de la MDPH.';

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
function entrerEdition(ctx) {
  if (state.edition) return;
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
      h('p', { class: 'fr-mb-1w' }, "Tu as modifié des champs du dossier sans les valider : ces changements seront perdus."),
      h('p', { class: 'fr-text--sm fr-mb-0' }, 'Rien n\'a été écrit dans Grist.'),
    ],
    actions: [
      { id: 'dlg-oui', libelle: 'Oui, abandonner', info: 'Perdre les modifications non validées et continuer', secondaire: true, onClick: () => { annulerEdition(); suite(); } },
      { id: 'dlg-non', libelle: 'Non, continuer la modification', info: 'Fermer cette fenêtre et rester sur le dossier', onClick: () => ed.champsEls[0]?.input.focus() },
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
      setFieldError(id, 'Saisis au moins une lettre.');
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
      setFieldError(etatCivil[0].id, 'Une autre fiche a déjà ce nom, ce prénom et cette date de naissance : utilise-la plutôt que de créer un doublon.');
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
  const enCours = ligneEnCours(scol, todayIso);
  const ctx = { row, origine, lignes: [], ui: {} };
  const ch = champsDossier(row, ind);
  ctx.ui.modifier = h(
    'button',
    { class: 'fr-btn fr-btn--secondary fr-btn--icon-left fr-icon-pencil-line', type: 'button', title: "Ouvrir tous les champs modifiables du dossier ; une seule validation, avec confirmation avant écriture", onclick: () => entrerEdition(ctx) },
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
  box.replaceChildren(
    h('div', { class: 'fr-mb-2w' }, ctx.ui.modifier),
    ctx.ui.aide,
    infosManquantes(row).length
      ? h('div', { class: 'fr-alert fr-alert--warning fr-alert--sm fr-mb-2w', id: 'dossier-incomplet', role: 'status' }, h('h5', { class: 'fr-alert__title' }, 'Dossier incomplet'), h('p', {}, `Information manquante : ${infosManquantes(row).join(', ')}. Utilise « Modifier » pour la compléter.`))
      : h('span'),
    h('h4', { class: 'fr-h6' }, 'État civil'),
    listeInfos([
      ligneModifiable('Nom', row.nom, [ch.nom], ctx),
      ligneModifiable('Prénom', row.prenom, [ch.prenom], ctx),
      ligneModifiable('Date de naissance', formatDateFr(row.ddn), [ch.ddn], ctx),
    ]),
    h('h4', { class: 'fr-h6' }, 'Coordonnées'),
    listeInfos([
      ligneModifiable('Adresse', ind.adresse, [ch.adr], ctx),
      ligneModifiable('Code postal et commune', ind.cpVille, ch.cp && ch.commune ? [ch.cp, ch.commune] : [], ctx),
      ligneModifiable('Représentant(s) légal(aux)', ind.representants, [ch.rep], ctx),
    ]),
    h('h4', { class: 'fr-h6' }, 'Notification ULIS'),
    listeInfos([
      ligneModifiable('Notification ULIS', ind.notif ? 'Oui' : 'Non', null, ctx),
      ligneModifiable('Première notification', dateOuTexte(ind.premiere), null, ctx),
      ligneModifiable('Début de la dernière', dateOuTexte(ind.debut), [ch.debut], ctx),
      ligneModifiable('Fin de droits', badgeFin(secToIso(ind.fin)) ? [dateOuTexte(ind.fin), ' ', badgeFin(secToIso(ind.fin))] : dateOuTexte(ind.fin), [ch.fin], ctx),
    ]),
    h('h4', { class: 'fr-h6' }, 'Historique des affectations'),
    scol.length === 0
      ? h('p', {}, 'Aucune affectation enregistrée.')
      : tableSimple(
          'Affectations, de la plus récente à la plus ancienne',
          ["Date d'effet", 'Affectation', 'Niveau', 'Situation'],
          scol.map((l) => [
            [dateLabel(l), ' ', enCours && enCours.id === l.id ? badgesEnCours(l) : null],
            lienEtab(l, retourDossierDe(row, origine)),
            l.niveau || '—',
            l.situation || '—',
          ]),
        ),
    h('h4', { class: 'fr-h6 fr-mt-3w' }, 'Notes sur l\'élève'),
    notes.length === 0
      ? h('p', {}, 'Aucune note.')
      : tableSimple(
          "Notes, de la plus récente à la plus ancienne",
          ['Date', 'Type', 'Note'],
          notes.map((n) => [
            formatDateFr(n.date) || '—',
            n.type || '—',
            h('span', { class: 'note-texte' }, n.note),
          ]),
        ),
    ctx.ui.barre,
    h(
      'div',
      { class: 'fr-btns-group fr-btns-group--inline fr-mt-2w' },
      origine !== 3 ? h('button', { class: 'fr-btn', type: 'button', title: 'Passer aux affectations de cet élève', onclick: () => chooseEleve(row) }, 'Affecter') : null,
      h('button', { class: 'fr-btn fr-btn--tertiary', type: 'button', title: origine === 3 ? 'Revenir aux affectations de cet élève' : origine === 'dispo' ? 'Revenir à la liste des élèves du dispositif' : origine === 'accueil' ? "Revenir à l'accueil" : 'Revenir à la liste des fiches trouvées', onclick: () => retourDossier(row, origine) }, libelleRetourDossier(origine)),
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

const libelleRetourDossier = (origine) => (origine === 3 ? 'Revenir aux affectations' : origine === 'dispo' ? 'Revenir au dispositif' : origine === 'accueil' ? "Revenir à l'accueil" : 'Revenir à la page de résultats');

function retourDossier(row, origine) {
  clearNotice();
  if (origine === 'dispo' && state.dispo) {
    openDispositif(state.dispo.etabId, state.dispo.retour, { garder: true });
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
      h('legend', { class: 'fr-fieldset__legend', id: 'legend-manuel' }, h('span', { class: 'fr-h6' }, 'Informations complémentaires'), h('span', { class: 'fr-hint-text' }, 'Facultatif : à renseigner si tu les connais.')),
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
        setFieldError(el.id, 'Saisis un nombre.');
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
    viderCache();
    const res = await grist.docApi.applyUserActions([
      ['AddRecord', T_INDIVIDUS, null, { ...manuel, Nom: nom, Prenom: prenom, Date_de_naissance: isoToSec(iso) }],
    ]);
    const id = res.retValues[0];
    await refreshIndividus();
    const cree = state.individus.find((r) => r.id === id);
    if (!cree) throw new Error('la fiche a été créée mais reste introuvable à la relecture : relance la recherche');
    await chooseEleve(cree, { keepNotice: true, affecterA: state.createCtx ? state.createCtx.etabId : null });
    notify('success', 'Fiche créée dans Individus.');
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

function renderScolList() {
  const box = $('#scol-list');
  if (state.scol.length === 0) {
    box.replaceChildren(h('div', { class: 'fr-alert fr-alert--info fr-alert--sm' }, h('p', {}, "Aucune affectation enregistrée pour cet élève.")));
    return;
  }
  const todayIso = new Date().toISOString().slice(0, 10);
  const enCours = ligneEnCours(state.scol, todayIso);
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
                    h('td', {}, l.situation || '—'),
                    h('td', {}, l.attente ? 'Oui' : 'Non'),
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
                            {
                              class: 'fr-btn fr-btn--sm fr-btn--tertiary fr-icon-pencil-line',
                              type: 'button',
                              onclick: () => openScolForm(l),
                              'aria-label': `Modifier l'affectation du ${dateLabel(l)}`,
                              title: "Modifier cette ligne d'affectation (date, établissement, niveau, situation, liste d'attente)",
                            },
                            'Modifier',
                          ),
                        ),
                        h(
                          'li',
                          {},
                          h(
                            'button',
                            {
                              class: 'fr-btn fr-btn--sm fr-btn--tertiary fr-icon-delete-line',
                              type: 'button',
                              onclick: () => demanderSuppression(l),
                              title: 'Supprimer',
                              'aria-label': `Supprimer l'affectation du ${dateLabel(l)}`,
                            },
                            'Supprimer',
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
function combobox({ id, label, options, value, hint = '', placeholder = 'Rechercher…', onChange = null }) {
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
        total > rows.length ? h('li', { role: 'presentation', class: 'combo-more' }, `${total - rows.length} autres résultats : précise la recherche.`) : null,
        total === 0 ? h('li', { role: 'presentation', class: 'combo-more' }, 'Aucun résultat.') : null,
      ].filter(Boolean), // replaceChildren(null) écrirait le texte « null »
    );
    list.hidden = false;
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

  return h(
    'div',
    { class: 'fr-input-group combo fr-mb-2w' },
    h('label', { class: 'fr-label', for: id }, label, hint ? h('span', { class: 'fr-hint-text' }, hint) : null),
    h('div', { class: 'fr-input-wrap fr-icon-search-line' }, input),
    list,
    status,
  );
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
    conserve ? h('option', { value: actuel, selected: true }, `${actuel} (hors liste)`) : null,
  );
  if (retire) sel.value = '';
  const phrases = [];
  if (restreint && LIBELLE_TYPE[type]) phrases.push(`Niveaux proposés pour ${LIBELLE_TYPE[type]}.`);
  if (etabId && !type) phrases.push(`Type d'établissement non reconnu (colonne ${COL_TYPE_ETAB} : « ${state.etabTypeBrut.get(Number(etabId)) || 'vide'} ») : liste complète.`);
  if (retire) phrases.push(`Le niveau « ${actuel} » a été retiré : il ne correspond pas à ${LIBELLE_TYPE[type] || 'cet établissement'}.`);
  note.textContent = phrases.join(' ');
}

function openScolForm(ligne, defauts = {}) {
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
        ? `Valeur actuelle non reconnue : « ${ligne.affectationInvalide} ». Elle est conservée tant que tu ne choisis pas d'établissement.`
        : 'Tape quelques mots du nom ou de la commune.',
      placeholder: 'Rechercher un établissement…',
      options: state.etabs.map((e) => ({ value: e.id, label: e.label })),
      value: ligne ? ligne.affectation : defauts.affectation || '',
      onChange: (id) => majNiveaux(id),
    }),
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
      { class: 'fr-btns-group fr-btns-group--inline' },
      h('button', { class: 'fr-btn', type: 'submit', title: ligne ? 'Enregistrer les modifications (une confirmation montrera ce qui change)' : 'Enregistrer cette nouvelle ligne d\'affectation' }, 'Enregistrer'),
      h('button', { class: 'fr-btn fr-btn--tertiary', type: 'button', title: 'Fermer le formulaire sans rien enregistrer', onclick: () => { form.hidden = true; } }, 'Annuler'),
      ligne ? h('button', { class: 'fr-btn fr-btn--tertiary-no-outline fr-icon-delete-line fr-btn--icon-left', type: 'button', id: 's-suppr', title: 'Supprimer cette ligne d\'affectation (une confirmation sera demandée)', onclick: () => demanderSuppression(ligne) }, 'Supprimer cette affectation') : null,
    ),
  );
  const infos = {
    's-date': "Date à partir de laquelle l'affectation s'applique : un clic ouvre le calendrier. L'affectation « en cours » est la dernière ligne datée d'aujourd'hui ou avant.",
    's-aff': "Établissement d'affectation : tape quelques mots du nom ou de la commune, puis choisis dans la liste. Vide, la ligne n'a pas d'établissement (sortie, retour en classe ordinaire…).",
    's-niveau': "Niveau de l'élève ; la liste dépend du type de l'établissement choisi (école, collège, lycée).",
    's-situation': "Situation de l'élève à cette date : en ULIS, sortie, exclusion, hors département…",
    's-attente': "À activer si l'élève est sur liste d'attente pour cet établissement (pas encore affecté)",
  };
  for (const [id, texte] of Object.entries(infos)) {
    const el = $(`#${id}`);
    if (el) el.title = texte;
  }
  form.hidden = false;
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
    h('div', { class: 'modale-entete' }, h('h4', { class: `fr-h5 fr-mb-0 ${icone} fr-icon--lg modale-titre`, id: 'dlg-titre' }, titre)),
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

function demanderSuppression(ligne) {
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
      { id: 'dlg-oui', libelle: 'Oui, supprimer', info: 'Supprimer définitivement cette ligne (annulable dans le panneau Activité de Grist)', onClick: () => supprimerLigne(ligne) },
      { id: 'dlg-non', libelle: 'Non, garder', info: 'Fermer cette fenêtre : rien n\'est supprimé', secondaire: true },
    ],
    focus: 'dlg-non', // le choix par défaut est de ne rien supprimer
  });
}

async function supprimerLigne(ligne) {
  try {
    viderCache();
    await grist.docApi.applyUserActions([['RemoveRecord', T_SCOLARITE, ligne.id]]);
    await refreshScolarite();
    $('#form-scol').hidden = true;
    renderScolList();
    notify('success', 'Affectation supprimée.');
  } catch (err) {
    notify('error', `Suppression impossible : ${err.message}`);
  }
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

async function ecrireAffectation(fields) {
  const form = $('#form-scol');
  try {
    const action = state.editingId
      ? ['UpdateRecord', T_SCOLARITE, state.editingId, fields]
      : ['AddRecord', T_SCOLARITE, null, { ...fields, [COL.eleve]: state.eleve.id }];
    viderCache();
    await grist.docApi.applyUserActions([action]);
    await refreshScolarite();
    form.hidden = true;
    renderScolList();
    notify('success', state.editingId ? 'Affectation modifiée.' : 'Affectation enregistrée.');
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
    setFieldError('s-aff', 'Choisis un établissement dans la liste, ou vide le champ.');
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
  if (state.editingLigne) {
    const avant = state.editingLigne;
    const dessus = (v) => v || '—';
    const modifs = [];
    if (iso !== (avant.date || '')) modifs.push(["Date d'effet", dateLabel(avant), formatDateFr(iso)]);
    if (aff !== (avant.affectation || 0)) modifs.push(['Affectation', affectationCell(avant) === '—' ? '—' : typeof affectationCell(avant) === 'string' ? affectationCell(avant) : avant.affectationInvalide, aff ? state.etabLabel.get(aff) || `#${aff}` : '—']);
    if ($('#s-niveau').value !== (avant.niveau || '')) modifs.push(['Niveau', dessus(avant.niveau), dessus($('#s-niveau').value)]);
    if ($('#s-situation').value !== (avant.situation || '')) modifs.push(['Situation', dessus(avant.situation), dessus($('#s-situation').value)]);
    if ($('#s-attente').checked !== avant.attente) modifs.push(["Liste d'attente", avant.attente ? 'Oui' : 'Non', $('#s-attente').checked ? 'Oui' : 'Non']);
    if (modifs.length === 0) {
      notify('info', 'Aucune modification à enregistrer.');
      return;
    }
    confirmerModification(modifs, () => ecrireAffectation(fields));
    return;
  }
  await ecrireAffectation(fields);
});

/* ------------------------------------------------------------------ */
/* Accueil : recherche d'un établissement ; page du dispositif          */
/* ------------------------------------------------------------------ */
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
    setFieldError('qe', "Saisis au moins 2 lettres du nom, de la commune ou de l'UAI.");
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
    h('p', { role: 'status', class: 'fr-mb-1w' }, `${total} établissements correspondent${total > rows.length ? ` (les ${rows.length} premiers sont affichés : précise la recherche)` : ''} :`),
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
    if (c) infos.push({ libelle, valeur: await valeurColonne(c, t[col][i]) });
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
      infos.push({ libelle, valeur: j >= 0 ? await valeurColonne(c, tabU[c.colId][j]) : '' });
    }
  }
  const nombre = (id) => {
    const v = colDe(id) ? t[id][i] : null;
    return typeof v === 'number' ? v : null;
  };
  return { infos, places: nombre(COL_PLACES), effectifGrist: nombre(COL_EFFECTIF_GRIST), coords };
}

async function chargerDispositif(etabId) {
  const [tScol, tInd, etab] = await Promise.all([lireTable(T_SCOLARITE), lireTable(T_INDIVIDUS), infosEtab(etabId)]);
  state.individus = toIndividus(tInd);
  const lignes = tableToRows(tScol, Object.values(COL)).map((r) => ({ eleve: r[COL.eleve], ...mapLigne(r) }));
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
  state.dispo = { etabId, retour, data, tri: prec ? prec.tri : { cle: 'nom', dir: 1 }, inclure: prec ? prec.inclure : false, ajout: false };
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

function enteteTri(libelle, cle, onTri) {
  const { tri } = state.dispo;
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

/** Panneau d'alerte sur les fins de droits des élèves affichés (rouge si l'une est échue, orange sinon). */
function panneauIncomplets(eleves) {
  const n = eleves.filter((e) => infosManquantes(e.row).length).length;
  if (!n) return h('span');
  return h('div', { class: 'fr-alert fr-alert--warning fr-alert--sm fr-mb-2w', id: 'dispo-incomplets', role: 'status' }, h('h5', { class: 'fr-alert__title' }, 'Dossiers incomplets'), h('p', {}, `${n} élève${n > 1 ? 's' : ''} sans nom, prénom ou date de naissance : ouvre le dossier pour compléter.`));
}

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
    h('div', { class: `fr-alert fr-alert--${echues ? 'error' : 'warning'} fr-alert--sm`, role: 'status' }, h('h5', { class: 'fr-alert__title' }, 'Fins de droits à surveiller'), h('p', {}, texte)),
    h('button', { class: 'fr-btn fr-btn--sm fr-btn--secondary fr-mt-1w', type: 'button', title: 'Classer les élèves par fin de droits, les plus anciennes en premier', onclick: () => onTri('fin', true) }, 'Trier par fin de droits'),
  );
}

/** Panneau « Ajouter un élève » : recherche (suggestions) ou création de fiche, puis formulaire d'affectation prérempli. */
function panneauAjout(d) {
  const label = state.etabLabel.get(d.etabId) || 'cet établissement';
  const res = h('div', { id: 'dispo-ajout-res', class: 'fr-mt-2w' });
  const input = h('input', { class: 'fr-input', id: 'dispo-q', type: 'text', autocomplete: 'off', title: "Tape une partie du nom, du prénom ou de la date de naissance de l'élève à ajouter. Les suggestions apparaissent dès 2 caractères." });
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
      setFieldError('dispo-q', 'Saisis au moins 2 lettres du nom ou du prénom, ou une année de naissance.');
      input.focus();
      return;
    }
    const { total, rows } = rechercheLibre(state.individus, q, 20);
    if (total === 0) {
      res.replaceChildren(h('div', { class: 'fr-alert fr-alert--info fr-alert--sm' }, h('p', {}, 'Aucune fiche ne correspond : tu peux la créer.')));
    } else if (total === 1) {
      ajouterAuDispositif(rows[0]);
    } else {
      res.replaceChildren(
        h('p', { role: 'status', class: 'fr-mb-1w' }, `${total} fiches correspondent${total > rows.length ? ` (les ${rows.length} premières sont affichées : précise la recherche)` : ''} :`),
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

function rendreDispositif() {
  const d = state.dispo;
  const { lignes, tInd, etab, parId, idx } = d.data;
  const todayIso = new Date().toISOString().slice(0, 10);
  const { rows, attente, autres } = elevesDuDispositif(lignes, d.etabId, todayIso, { inclure: d.inclure, situationPresent: SITUATION_PAR_DEFAUT });
  const presents = rows.filter(({ ligne }) => ligne.situation === SITUATION_PAR_DEFAUT && !ligne.attente).length;
  const eleves = [];
  for (const { eleve, ligne } of rows) {
    const row = parId.get(eleve);
    const i = idx.get(eleve);
    if (!row || i === undefined) continue; // fiche supprimée d'Individus
    eleves.push({
      row,
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
    h('h4', { class: 'fr-h6' }, "Informations sur l'établissement"),
    listeInfos([
      ['Effectifs', effectifs],
      etab.effectifGrist !== null && etab.effectifGrist !== presents ? ['Effectif calculé par Grist', `${etab.effectifGrist} (colonne ${COL_EFFECTIF_GRIST}, différent du décompte ci-dessus)`] : null,
      typeLibelle ? ['Type', typeLibelle] : null,
      ...etab.infos.map((x) => [x.libelle, x.valeur]),
    ].filter(Boolean)),
    etab.coords === 0
      ? h('p', { class: 'fr-hint-text fr-mb-2w' }, "Coordonnées : aucune colonne reconnue (code postal, téléphone, courriel) dans la table liée par Uai.")
      : h('span'),
    h('h4', { class: 'fr-h6 fr-mt-2w' }, 'Élèves du dispositif'),
    panneauAlertes(eleves, d, onTri),
    panneauIncomplets(eleves),
    h(
      'div',
      { class: 'fr-mb-2w' },
      h(
        'button',
        {
          type: 'button',
          id: 'dispo-ajouter',
          class: 'fr-btn fr-btn--secondary fr-btn--icon-left fr-icon-add-line',
          'aria-expanded': String(d.ajout),
          'aria-controls': 'dispo-ajout',
          title: "Ajouter un élève à ce dispositif : tu choisis l'élève (ou tu crées sa fiche), puis le formulaire d'affectation s'ouvre avec cet établissement",
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
    h(
      'div',
      { class: 'fr-toggle fr-mb-2w' },
      h('input', { type: 'checkbox', class: 'fr-toggle__input', id: 'dispo-inclure', checked: d.inclure, onchange: (e) => { d.inclure = e.target.checked; rendreDispositif(); $('#dispo-inclure').focus(); } }),
      h('label', { class: 'fr-toggle__label', for: 'dispo-inclure', 'data-fr-checked-label': 'Oui', 'data-fr-unchecked-label': 'Non', title: "Ajouter les élèves en liste d'attente ou dans une autre situation (sortie, exclusion…) dont l'affectation en cours est cet établissement" }, "Inclure la liste d'attente et les autres situations"),
    ),
    eleves.length === 0
      ? h('p', {}, d.inclure ? "Aucun élève n'a cet établissement pour affectation en cours." : "Aucun élève présent dans ce dispositif.")
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
                        h('td', {}, h('button', { type: 'button', class: 'fr-link lien-etab', 'aria-label': `Dossier de ${e.nom} ${e.prenom}`, title: "Ouvrir le dossier de cet élève", onclick: () => openDossier(e.row, 'dispo') }, `${e.nom} ${e.prenom}`.trim() || 'Sans nom'), badgeIncomplet(e.row) ? [h('br'), badgeIncomplet(e.row)] : null),
                        h('td', {}, e.niveau || '—'),
                        h('td', {}, e.situation || '—', e.attente ? [' ', h('p', { class: 'fr-badge fr-badge--info fr-badge--sm fr-badge--no-icon' }, "Liste d'attente")] : null),
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
  );
  if (d.ajout) {
    attachSuggest($('#dispo-q'), {
      minChars: 2,
      fetchItems: (query) => rechercheLibre(state.individus, query, 8).rows.map((r) => ({ value: String(r.id), label: libelleEleve(r), row: r })),
      onPick: (item) => ajouterAuDispositif(item.row),
    });
  }
}

/* ------------------------------------------------------------------ */
/* Page « Établissements par secteur »                                  */
/* ------------------------------------------------------------------ */
const TYPE_LIBELLE = { ECO: 'École', CLG: 'Collège', LYC: 'Lycée' };
const retourSecteur = () => ({ libelle: 'Revenir aux établissements par secteur', action: () => openSecteur(state.secteur.retour, { garder: true }) });

async function chargerSecteur() {
  const [t, tScol, tInd] = await Promise.all([lireTable(state.etabTable), lireTable(T_SCOLARITE), lireTable(T_INDIVIDUS)]);
  const idxInd = new Map(tInd.id.map((id, i) => [id, i]));
  const todayIso = new Date().toISOString().slice(0, 10);
  const lignes = tableToRows(tScol, Object.values(COL)).map((r) => ({ eleve: r[COL.eleve], ...mapLigne(r) }));
  const eff = effectifsParEtab(lignes, todayIso, SITUATION_PAR_DEFAUT);
  const texte = (col, i) => (t[col] ? cellText(t[col][i]).trim() : '');
  const etabs = state.etabs.map((e) => {
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
    return {
      id: e.id,
      label: e.label,
      type: TYPE_LIBELLE[e.type] || e.typeBrut || 'Autre',
      commune: texte('Commune', i),
      secteur: texte('Secteur_CDOEA', i),
      ers: texte('Secteur_ERS', i),
      ersh: texte('Uai_ERSH', i),
      places,
      presents: n.presents,
      attente: n.attente,
      finEchues,
      finProches,
    };
  });
  return { etabs, aSecteur: Boolean(t.Secteur_CDOEA), aErs: Boolean(t.Secteur_ERS) };
}

async function openSecteur(retour = retourAccueil(), { garder = false } = {}) {
  if (state.edition) return gardeSortie(() => openSecteur(retour, { garder }));
  clearNotice();
  let data;
  try {
    data = await chargerSecteur();
  } catch (err) {
    notify('error', `Lecture des établissements impossible : ${err.message}`);
    return;
  }
  const prec = garder && state.secteur ? state.secteur : null;
  state.secteur = { retour, data, filtres: prec ? prec.filtres : { secteur: '', type: '', ers: '', alerte: '' } };
  state.step = 0;
  masquerPages();
  $('#step-secteur').hidden = false;
  $('#stepper').replaceChildren(
    h(
      'div',
      { class: 'fr-stepper' },
      h('h1', { class: 'fr-stepper__title', id: 'h-secteur', tabindex: '-1' }, 'Établissements par secteur'),
      h('p', { class: 'fr-stepper__details' }, "Établissements avec ULIS, filtrés par secteur, type et ERS. Un clic sur un établissement ouvre son dispositif."),
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
  const distinct = (k) => [...new Set(etabs.map((e) => e[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
  const liste = etabs.filter((e) => (!f.secteur || e.secteur === f.secteur) && (!f.type || e.type === f.type) && (!f.ers || e.ers === f.ers) && (!f.alerte || e.finEchues + e.finProches > 0));
  const selecteur = (id, cle, libelle, options, aide) =>
    h(
      'div',
      { class: 'fr-select-group fr-col-12 fr-col-md-4' },
      h('label', { class: 'fr-label', for: id }, libelle),
      h(
        'select',
        { class: 'fr-select', id, title: aide, onchange: (e) => { f[cle] = e.target.value; rendreSecteur(); $(`#${id}`)?.focus(); } },
        h('option', { value: '', selected: !f[cle] }, 'Tous'),
        options.map((o) => h('option', { value: o, selected: o === f[cle] }, o)),
      ),
    );
  const totalPresents = liste.reduce((n, e) => n + e.presents, 0);
  const totalPlaces = liste.reduce((n, e) => n + (e.places || 0), 0);
  const colonnes = ['Établissement', 'Type', 'Commune', ...(aSecteur ? ['Secteur'] : []), ...(aErs ? ['ERS'] : []), 'Effectif', 'Fins de droits'];
  $('#secteur').replaceChildren(
    h(
      'div',
      { class: 'fr-grid-row fr-grid-row--gutters fr-mb-2w' },
      aSecteur ? selecteur('f-secteur', 'secteur', 'Secteur', distinct('secteur'), 'Ne garder que les établissements de ce secteur') : h('span'),
      selecteur('f-type', 'type', "Type d'établissement", distinct('type'), 'Ne garder que les écoles, collèges ou lycées'),
      aErs ? selecteur('f-ers', 'ers', 'ERS', distinct('ers'), "Ne garder que les établissements de cet ERS (secteur d'enseignant référent)") : h('span'),
      selecteur('f-alerte', 'alerte', 'Fins de droits', ['Échues ou proches'], 'Ne garder que les établissements qui ont au moins un élève dont la fin de droits est échue ou proche'),
    ),
    h('p', { role: 'status' }, `${liste.length} établissement${liste.length > 1 ? 's' : ''} · ${totalPresents} élève${totalPresents > 1 ? 's' : ''} présent${totalPresents > 1 ? 's' : ''}${totalPlaces ? ` sur ${totalPlaces} places` : ''}`),
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
                  h('thead', {}, h('tr', {}, colonnes.map((c) => h('th', { scope: 'col' }, c)))),
                  h(
                    'tbody',
                    {},
                    liste.map((e) =>
                      h(
                        'tr',
                        {},
                        h('td', {}, h('button', { type: 'button', class: 'fr-link lien-etab', title: 'Ouvrir le dispositif de cet établissement', onclick: () => openDispositif(e.id, retourSecteur()) }, e.label)),
                        h('td', {}, e.type),
                        h('td', {}, e.commune || '—'),
                        aSecteur ? h('td', {}, e.secteur || '—') : null,
                        aErs ? h('td', {}, e.ers || '—', e.ersh ? [h('br'), h('span', { class: 'fr-text--sm fr-hint-text' }, e.ersh)] : null) : null,
                        h('td', { class: 'nowrap' }, `${e.presents}${e.places !== null ? ` / ${e.places}` : ''}`, e.attente ? [' ', h('p', { class: 'fr-badge fr-badge--info fr-badge--sm fr-badge--no-icon', title: "Élèves sur liste d'attente pour cet établissement" }, `${e.attente} en attente`)] : null),
                        h('td', {}, e.finEchues || e.finProches ? [e.finEchues ? h('p', { class: 'fr-badge fr-badge--error fr-badge--sm fr-badge--no-icon', title: 'Élèves présents dont la fin de droits est dépassée' }, `${e.finEchues} échue${e.finEchues > 1 ? 's' : ''}`) : null, e.finEchues && e.finProches ? ' ' : null, e.finProches ? h('p', { class: 'fr-badge fr-badge--warning fr-badge--sm fr-badge--no-icon', title: 'Élèves présents dont la fin de droits approche' }, `${e.finProches} proche${e.finProches > 1 ? 's' : ''}`) : null] : '—'),
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

$('#btn-secteur').addEventListener('click', () => openSecteur(retourAccueil()));

/* ------------------------------------------------------------------ */
/* Démarrage                                                           */
/* ------------------------------------------------------------------ */
async function init() {
  grist.ready({ requiredAccess: 'full' });
  goto(1, { focus: false });
  try {
    await loadMeta();
    await refreshIndividus();
  } catch (err) {
    notify('error', `Initialisation impossible : ${err.message}`);
  }
}
init();
