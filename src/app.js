import {
  cle,
  filterOptions,
  formatDateFr,
  isoToSec,
  ligneEnCours,
  norm,
  searchIndividus,
  secToIso,
  tableToRows,
  toIndividus,
} from './lib.js';

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
  searched: false, // une recherche a été faite : l'étape 2 est atteignable
  individus: [],
  etabs: [], // [{id, label}]
  etabLabel: new Map(),
  niveaux: [],
  situations: [],
  results: { total: 0, rows: [] },
  query: { nom: '', prenom: '', iso: '' },
  eleve: null,
  scol: [],
  editingId: null, // null = création
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
      { 'aria-label': 'Navigation entre les étapes', class: 'fr-btns-group fr-btns-group--inline fr-btns-group--sm fr-mb-2w' },
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

  state.niveaux = choicesOf(need(T_SCOLARITE, COL.niveau));
  state.situations = choicesOf(need(T_SCOLARITE, COL.situation));

  const aff = need(T_SCOLARITE, COL.affectation);
  if (!aff.type.startsWith('Ref:')) throw new Error(`${T_SCOLARITE}.${COL.affectation} n'est pas une colonne Référence`);
  const refTable = aff.type.slice(4);
  const visible = colById.get(aff.visibleCol)?.colId;
  const t = await grist.docApi.fetchTable(refTable);
  const etabs = t.id.map((id, i) => {
    const base = visible && t[visible] ? String(t[visible][i] ?? '') : `#${id}`;
    const commune = t.Commune ? String(t.Commune[i] ?? '') : '';
    return { id, label: commune && !base.includes(commune) ? `${base} (${commune})` : base };
  });
  etabs.sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  state.etabs = etabs;
  state.etabLabel = new Map(etabs.map((e) => [e.id, e.label]));
}

async function refreshIndividus() {
  state.individus = toIndividus(await grist.docApi.fetchTable(T_INDIVIDUS));
}

async function refreshScolarite() {
  const t = await grist.docApi.fetchTable(T_SCOLARITE);
  state.scol = tableToRows(t, Object.values(COL))
    .filter((r) => r[COL.eleve] === state.eleve.id)
    .map((r) => ({
      id: r.id,
      date: secToIso(r[COL.dateEffet]),
      affectation: r[COL.affectation] || 0,
      niveau: r[COL.niveau] || '',
      situation: r[COL.situation] || '',
      attente: Boolean(r[COL.attente]),
    }))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id);
}

/* ------------------------------------------------------------------ */
/* Étape 1 : recherche                                                 */
/* ------------------------------------------------------------------ */
$('#form-search').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearNotice();
  clearFieldErrors($('#form-search'));
  const nom = $('#q-nom').value.trim();
  const prenom = $('#q-prenom').value.trim();
  const iso = $('#q-ddn').value;
  if (norm(nom).length < 2 && norm(prenom).length < 2) {
    setFieldError('q-nom', 'Saisissez au moins 2 lettres du nom ou du prénom.');
    $('#q-nom').focus();
    return;
  }
  try {
    await refreshIndividus(); // données à jour : d'autres utilisateurs peuvent avoir créé des fiches
  } catch (err) {
    notify('error', `Lecture d'Individus impossible : ${err.message}`);
    return;
  }
  state.query = { nom, prenom, iso };
  state.searched = true;
  state.eleve = null; // nouvelle recherche : l'élève précédent n'est plus sélectionné
  $('#form-scol').hidden = true;
  state.results = searchIndividus(state.individus, state.query);
  renderResults();
  $('#form-create').hidden = state.results.total > 0;
  if (state.results.total === 0) prefillCreate();
  goto(2);
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
                        'button',
                        {
                          class: 'fr-btn fr-btn--sm',
                          type: 'button',
                          onclick: () => chooseEleve(r),
                          'aria-label': `Choisir ${r.nom} ${r.prenom}`,
                        },
                        'Choisir',
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
  $('#c-nom').value = state.query.nom;
  $('#c-prenom').value = state.query.prenom;
  $('#c-ddn').value = state.query.iso;
  $('#c-ddn-inconnue').checked = false;
}

$('#btn-show-create').addEventListener('click', () => {
  prefillCreate();
  $('#form-create').hidden = false;
  $('#c-nom').focus();
});
$('#btn-back-1').addEventListener('click', backToSearch);
$('#btn-back-1b').addEventListener('click', backToSearch);

function backToSearch() {
  clearNotice();
  state.eleve = null;
  $('#form-scol').hidden = true;
  goto(1);
  $('#q-nom').focus();
}

$('#form-create').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearNotice();
  const form = $('#form-create');
  clearFieldErrors(form);
  const nom = $('#c-nom').value.trim();
  const prenom = $('#c-prenom').value.trim();
  const iso = $('#c-ddn').value;
  const inconnue = $('#c-ddn-inconnue').checked;

  let ok = true;
  if (!norm(nom)) {
    setFieldError('c-nom', 'Le nom est obligatoire.');
    ok = false;
  }
  if (!norm(prenom)) {
    setFieldError('c-prenom', 'Le prénom est obligatoire.');
    ok = false;
  }
  if (!iso && !inconnue) {
    setFieldError('c-ddn', 'Renseigne la date de naissance, ou coche « date de naissance inconnue ».');
    ok = false;
  }
  if (iso && isoToSec(iso) === null) {
    setFieldError('c-ddn', 'Cette date est invalide.');
    ok = false;
  }
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
      ['AddRecord', T_INDIVIDUS, null, { Nom: nom, Prenom: prenom, Date_de_naissance: iso ? isoToSec(iso) : null }],
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
                      formatDateFr(l.date) || 'sans date',
                      ' ',
                      enCours && enCours.id === l.id ? h('p', { class: 'fr-badge fr-badge--success fr-badge--sm fr-badge--no-icon' }, 'En cours') : null,
                    ),
                    h('td', {}, l.affectation ? state.etabLabel.get(l.affectation) || `#${l.affectation}` : '—'),
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
                          'aria-label': `Modifier l'affectation du ${formatDateFr(l.date) || 'sans date'}`,
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
function combobox({ id, label, options, value, hint = '', placeholder = 'Rechercher…' }) {
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
  };
  const open = (query) => {
    const { total, rows } = filterOptions(options, query);
    shown = rows;
    list.replaceChildren(
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
    );
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    setActive(-1);
    status.textContent = total === 0 ? 'Aucun résultat' : `${total} résultat${total > 1 ? 's' : ''}`;
  };

  input.addEventListener('input', () => {
    input.dataset.value = ''; // la saisie invalide le choix précédent
    open(input.value);
  });
  input.addEventListener('focus', () => open(input.dataset.value ? '' : input.value));
  input.addEventListener('click', () => {
    if (!isOpen()) open(input.dataset.value ? '' : input.value);
  });
  input.addEventListener('blur', () => {
    close();
    if (!input.value.trim()) input.dataset.value = '';
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

function openScolForm(ligne) {
  clearNotice();
  state.editingId = ligne ? ligne.id : null;
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
      hint: 'Tape quelques mots du nom ou de la commune.',
      placeholder: 'Rechercher un établissement…',
      options: state.etabs.map((e) => ({ value: e.id, label: e.label })),
      value: ligne ? ligne.affectation : '',
    }),
    select('s-niveau', 'Niveau', state.niveaux.map((n) => ({ value: n, label: n })), ligne ? ligne.niveau : ''),
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
    [COL.affectation]: Number(affInput.dataset.value) || 0,
    [COL.niveau]: $('#s-niveau').value,
    [COL.situation]: $('#s-situation').value,
    [COL.attente]: $('#s-attente').checked,
  };
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
