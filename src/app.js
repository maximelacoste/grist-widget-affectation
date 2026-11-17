import {
  banUrl,
  cellText,
  cle,
  filterOptions,
  formatDateFr,
  isInvalidCell,
  isoToSec,
  ligneEnCours,
  niveauxPour,
  typeEtab,
  libelleEtab,
  norm,
  normSearch,
  parseBan,
  searchIndividus,
  rechercheLibre,
  libelleEleve,
  secToIso,
  tableToRows,
  toIndividus,
} from './lib.js';
import { attachSuggest } from './suggest.js';

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
  { title: "Rechercher l'élève", next: "Choisir ou créer la fiche de l'élève" },
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

/**
 * Champ date vide : un clic n'importe où dans le champ ouvre le calendrier (par défaut, seule l'icône le fait).
 * Champ rempli : comportement natif conservé, pour corriger jour/mois/année au clavier.
 */
document.addEventListener('click', (e) => {
  const el = e.target;
  if (!(el instanceof HTMLInputElement) || el.type !== 'date' || el.value || el.readOnly || el.disabled) return;
  try {
    el.showPicker();
  } catch {
    /* navigateur sans showPicker, ou iframe non autorisée : le champ reste saisissable au clavier */
  }
});

/** Crée un élément ; les textes passent par textContent / createTextNode (jamais innerHTML). */
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) {
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
      onclick: () => {
        clearNotice();
        goto(target);
      },
    },
    `${prev ? 'Précédent' : 'Suivant'} : ${STEPS[target - 1].title}`,
  );
}

function renderStepper() {
  const n = state.step;
  const s = STEPS[n - 1];
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

function goto(step, { focus = true } = {}) {
  state.step = step;
  for (let i = 1; i <= STEPS.length; i += 1) $(`#step-${i}`).hidden = i !== step;
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

async function refreshIndividus() {
  state.individus = toIndividus(await grist.docApi.fetchTable(T_INDIVIDUS));
}

async function refreshScolarite(eleveId = state.eleve.id) {
  const t = await grist.docApi.fetchTable(T_SCOLARITE);
  state.scol = tableToRows(t, Object.values(COL))
    .filter((r) => r[COL.eleve] === eleveId)
    .map((r) => ({
      id: r.id,
      date: secToIso(r[COL.dateEffet]),
      dateBrute: typeof r[COL.dateEffet] === 'number' ? '' : cellText(r[COL.dateEffet]), // texte non reconnu comme date
      affectation: typeof r[COL.affectation] === 'number' ? r[COL.affectation] : 0,
      affectationInvalide: isInvalidCell(r[COL.affectation]) ? cellText(r[COL.affectation]) : '', // texte sans correspondance
      niveau: cellText(r[COL.niveau]),
      situation: cellText(r[COL.situation]),
      attente: r[COL.attente] === true,
    }))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id);
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
  $('#dossier').hidden = true;
  state.results = rechercheLibre(state.individus, query);
  renderResults();
  $('#form-create').hidden = state.results.total > 0;
  if (state.results.total === 0) prefillCreate();
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
  onPick: async (item) => {
    $('#q').value = `${item.row.nom} ${item.row.prenom}`;
    state.searched = true;
    state.results = { total: 1, rows: [item.row] };
    renderResults();
    $('#form-create').hidden = true;
    await chooseEleve(item.row);
  },
});

/* ------------------------------------------------------------------ */
/* Étape 2 : choisir ou créer                                          */
/* ------------------------------------------------------------------ */
function renderResults() {
  const { total, rows } = state.results;
  const box = $('#results');
  if (total === 0) {
    box.replaceChildren(h('div', { class: 'fr-alert fr-alert--info fr-alert--sm' }, h('p', {}, 'Aucune fiche ne correspond : tu peux la créer.')));
    return;
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
              h('thead', {}, h('tr', {}, ['Nom', 'Prénom', 'Date de naissance', 'Action'].map((t) => h('th', { scope: 'col' }, t)))),
              h(
                'tbody',
                {},
                rows.map((r) =>
                  h(
                    'tr',
                    {},
                    h('td', {}, r.nom),
                    h('td', {}, r.prenom),
                    h('td', {}, formatDateFr(r.ddn) || 'non renseignée'),
                    h(
                      'td',
                      {},
                      h(
                        'ul',
                        { class: 'fr-btns-group fr-btns-group--inline fr-btns-group--sm' },
                        h(
                          'li',
                          {},
                          h(
                            'button',
                            { class: 'fr-btn fr-btn--sm', type: 'button', onclick: () => chooseEleve(r), 'aria-label': `Affecter ${r.nom} ${r.prenom}` },
                            'Affecter',
                          ),
                        ),
                        h(
                          'li',
                          {},
                          h(
                            'button',
                            { class: 'fr-btn fr-btn--sm fr-btn--secondary', type: 'button', onclick: () => openDossier(r), 'aria-label': `Dossier de ${r.nom} ${r.prenom}` },
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

$('#btn-show-create').addEventListener('click', () => {
  prefillCreate();
  $('#form-create').hidden = false;
  $('#c-nom').focus();
});
$('#btn-back-1').addEventListener('click', backToSearch);
$('#btn-back-1b').addEventListener('click', backToSearch);

/* ------------------------------------------------------------------ */
/* Dossier : vue simplifiée en lecture seule                           */
/* ------------------------------------------------------------------ */
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
function listeInfos(infos) {
  return h(
    'dl',
    { class: 'dossier-infos' },
    infos.flatMap(([k, v]) => [h('dt', { class: 'fr-text--bold' }, k), h('dd', {}, v || '—')]),
  );
}

async function openDossier(row) {
  clearNotice();
  const box = $('#dossier');
  let ind;
  let scol;
  try {
    const t = await grist.docApi.fetchTable(T_INDIVIDUS);
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
      idApp: cellText(get('Id_app')),
      nEnr: cellText(get('N_Enr_')),
    };
    scol = await refreshScolarite(row.id).then(() => state.scol);
  } catch (err) {
    notify('error', `Lecture du dossier impossible : ${err.message}`);
    return;
  }
  const todayIso = new Date().toISOString().slice(0, 10);
  const enCours = ligneEnCours(scol, todayIso);
  box.replaceChildren(
    h('h3', { class: 'fr-h5', id: 'h-dossier', tabindex: '-1' }, `Dossier de ${row.nom} ${row.prenom}`),
    h('p', { class: 'fr-hint-text' }, 'Lecture seule. Les données personnelles ne s\'affichent qu\'à l\'écran et ne quittent pas Grist.'),
    h('h4', { class: 'fr-h6' }, 'État civil'),
    listeInfos([
      ['Nom', row.nom],
      ['Prénom', row.prenom],
      ['Date de naissance', formatDateFr(row.ddn)],
      ['Identifiant application', ind.idApp],
      ['N° d\'enregistrement', ind.nEnr],
    ]),
    h('h4', { class: 'fr-h6' }, 'Coordonnées'),
    listeInfos([
      ['Adresse', ind.adresse],
      ['Code postal et commune', ind.cpVille],
      ['Représentant(s) légal(aux)', ind.representants],
    ]),
    h('h4', { class: 'fr-h6' }, 'Notification ULIS'),
    listeInfos([
      ['Notification ULIS', ind.notif ? 'Oui' : 'Non'],
      ['Première notification', dateOuTexte(ind.premiere)],
      ['Début de la dernière', dateOuTexte(ind.debut)],
      ['Fin de droits', dateOuTexte(ind.fin)],
    ]),
    h('h4', { class: 'fr-h6' }, 'Historique des affectations'),
    scol.length === 0
      ? h('p', {}, 'Aucune affectation enregistrée.')
      : tableSimple(
          'Affectations, de la plus récente à la plus ancienne',
          ["Date d'effet", 'Affectation', 'Niveau', 'Situation'],
          scol.map((l) => [
            [dateLabel(l), ' ', enCours && enCours.id === l.id ? h('p', { class: 'fr-badge fr-badge--success fr-badge--sm fr-badge--no-icon' }, 'En cours') : null],
            affectationCell(l),
            l.niveau || '—',
            l.situation || '—',
          ]),
        ),
    h(
      'div',
      { class: 'fr-btns-group fr-btns-group--inline fr-mt-2w' },
      h('button', { class: 'fr-btn', type: 'button', onclick: () => chooseEleve(row) }, 'Affecter'),
      h('button', { class: 'fr-btn fr-btn--tertiary', type: 'button', onclick: () => { box.hidden = true; } }, 'Fermer le dossier'),
    ),
  );
  box.hidden = false;
  $('#h-dossier').focus();
}

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
      await chooseEleve(existant, { keepNotice: true });
      return;
    }
    const res = await grist.docApi.applyUserActions([
      ['AddRecord', T_INDIVIDUS, null, { ...manuel, Nom: nom, Prenom: prenom, Date_de_naissance: isoToSec(iso) }],
    ]);
    const id = res.retValues[0];
    await refreshIndividus();
    const cree = state.individus.find((r) => r.id === id);
    await chooseEleve(cree, { keepNotice: true });
    notify('success', 'Fiche créée dans Individus.');
  } catch (err) {
    notify('error', `Création impossible : ${err.message}`);
  }
});

async function chooseEleve(row, { keepNotice = false } = {}) {
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
  goto(3);
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
                      enCours && enCours.id === l.id ? h('p', { class: 'fr-badge fr-badge--success fr-badge--sm fr-badge--no-icon' }, 'En cours') : null,
                    ),
                    h('td', {}, affectationCell(l)),
                    h('td', {}, l.niveau || '—'),
                    h('td', {}, l.situation || '—'),
                    h('td', {}, l.attente ? 'Oui' : 'Non'),
                    h(
                      'td',
                      {},
                      h(
                        'button',
                        {
                          class: 'fr-btn fr-btn--sm fr-btn--secondary',
                          type: 'button',
                          onclick: () => openScolForm(l),
                          'aria-label': `Modifier l'affectation du ${dateLabel(l)}`,
                        },
                        'Modifier',
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
function niveauField(ligne) {
  const options = niveauxDe(ligne ? ligne.affectation : '').map((n) => ({ value: n, label: n }));
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

function openScolForm(ligne) {
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
      value: ligne ? ligne.affectation : '',
      onChange: (id) => majNiveaux(id),
    }),
    niveauField(ligne),
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
      h('button', { class: 'fr-btn', type: 'submit' }, 'Enregistrer'),
      h('button', { class: 'fr-btn fr-btn--tertiary', type: 'button', onclick: () => { form.hidden = true; } }, 'Annuler'),
    ),
  );
  form.hidden = false;
  $('#h-scol-form').focus();
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
  try {
    const action = state.editingId
      ? ['UpdateRecord', T_SCOLARITE, state.editingId, fields]
      : ['AddRecord', T_SCOLARITE, null, { ...fields, [COL.eleve]: state.eleve.id }];
    await grist.docApi.applyUserActions([action]);
    await refreshScolarite();
    form.hidden = true;
    renderScolList();
    notify('success', state.editingId ? 'Affectation modifiée.' : 'Affectation enregistrée.');
  } catch (err) {
    notify('error', `Enregistrement impossible : ${err.message}`);
  }
});

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
