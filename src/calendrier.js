/**
 * Petit calendrier intégré pour les champs <input type="date">.
 *
 * Pourquoi : dans Grist, le widget est dans une iframe d'un autre domaine ; les navigateurs y refusent d'ouvrir
 * le sélecteur natif par programme (showPicker), il ne s'ouvre alors que sur l'icône. Ce calendrier s'ouvre au
 * clic n'importe où dans le champ. La saisie au clavier reste possible dans le champ lui-même.
 * Aucune dépendance, aucune requête réseau, texte inséré par textContent.
 */
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const JOURS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

let ouvert = null; // { popup, input }

export function fermerCalendrier({ rendreFocus = false } = {}) {
  if (!ouvert) return;
  const { popup, input } = ouvert;
  ouvert = null;
  popup.remove();
  document.removeEventListener('mousedown', surClicExterieur, true);
  window.removeEventListener('resize', fermerCalendrier);
  if (rendreFocus) input.focus();
}

function surClicExterieur(e) {
  if (!ouvert) return;
  if (ouvert.popup.contains(e.target) || e.target === ouvert.input) return;
  fermerCalendrier();
}

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  n.append(...kids.flat().filter((k) => k != null).map((k) => (k.nodeType ? k : document.createTextNode(String(k)))));
  return n;
}

export function ouvrirCalendrier(input) {
  if (ouvert && ouvert.input === input) return;
  fermerCalendrier();
  const aujourdhui = new Date();
  const courant = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.value || '');
  let annee = courant ? Number(courant[1]) : aujourdhui.getFullYear();
  let mois = courant ? Number(courant[2]) - 1 : aujourdhui.getMonth();
  const selection = courant ? input.value : '';
  const todayIso = iso(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate());

  const popup = el('div', { class: 'calendrier', role: 'dialog', 'aria-label': 'Choisir une date' });

  const choisir = (valeur) => {
    input.value = valeur;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    fermerCalendrier({ rendreFocus: true });
  };

  const dessiner = () => {
    const anMin = Math.min(1990, annee);
    const anMax = Math.max(aujourdhui.getFullYear() + 3, annee);
    const selMois = el('select', { class: 'fr-select', 'aria-label': 'Mois', onchange: (e) => { mois = Number(e.target.value); dessiner(); } },
      MOIS.map((m, i) => el('option', { value: i, selected: i === mois }, m)));
    const selAnnee = el('select', { class: 'fr-select', 'aria-label': 'Année', onchange: (e) => { annee = Number(e.target.value); dessiner(); } },
      Array.from({ length: anMax - anMin + 1 }, (_, i) => anMax - i).map((a) => el('option', { value: a, selected: a === annee }, a)));
    const deplacer = (delta) => {
      const d = new Date(annee, mois + delta, 1);
      annee = d.getFullYear();
      mois = d.getMonth();
      dessiner();
    };

    const premier = (new Date(annee, mois, 1).getDay() + 6) % 7; // lundi = 0
    const nbJours = new Date(annee, mois + 1, 0).getDate();
    const cases = [];
    for (let i = 0; i < premier; i += 1) cases.push(el('span'));
    for (let d = 1; d <= nbJours; d += 1) {
      const v = iso(annee, mois, d);
      cases.push(
        el('button', {
          type: 'button',
          class: `cal-jour${v === selection ? ' cal-selection' : ''}${v === todayIso ? ' cal-aujourdhui' : ''}`,
          'aria-label': `${d} ${MOIS[mois]} ${annee}`,
          'aria-pressed': v === selection ? 'true' : 'false',
          onclick: () => choisir(v),
        }, d),
      );
    }

    popup.replaceChildren(
      el('div', { class: 'cal-entete' },
        el('button', { type: 'button', class: 'cal-nav', 'aria-label': 'Mois précédent', title: 'Mois précédent', onclick: () => deplacer(-1) }, '‹'),
        selMois, selAnnee,
        el('button', { type: 'button', class: 'cal-nav', 'aria-label': 'Mois suivant', title: 'Mois suivant', onclick: () => deplacer(1) }, '›')),
      el('div', { class: 'cal-grille', role: 'group', 'aria-label': `${MOIS[mois]} ${annee}` },
        JOURS.map((j) => el('span', { class: 'cal-jsem', 'aria-hidden': 'true' }, j)), cases),
      el('div', { class: 'cal-pied' },
        el('button', { type: 'button', class: 'fr-btn fr-btn--sm fr-btn--tertiary', title: "Choisir la date d'aujourd'hui", onclick: () => choisir(todayIso) }, "Aujourd'hui"),
        el('button', { type: 'button', class: 'fr-btn fr-btn--sm fr-btn--tertiary', title: 'Vider le champ', onclick: () => choisir('') }, 'Effacer')),
    );
  };

  popup.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      fermerCalendrier({ rendreFocus: true });
    }
  });
  dessiner();
  document.body.append(popup);
  // position : sous le champ, ou au-dessus s'il n'y a pas la place
  const r = input.getBoundingClientRect();
  const h = popup.offsetHeight;
  const sous = r.bottom + 4 + h <= window.innerHeight || r.top - 4 - h < 0;
  popup.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - popup.offsetWidth - 4))}px`;
  popup.style.top = `${sous ? r.bottom + 4 : r.top - 4 - h}px`;
  ouvert = { popup, input };
  document.addEventListener('mousedown', surClicExterieur, true);
  window.addEventListener('resize', fermerCalendrier);
}

/**
 * Active le calendrier sur tous les champs date de la page (délégation : champs créés plus tard compris).
 * Un clic sur l'icône native est laissé au navigateur (zone de droite du champ).
 */
export function activerCalendriers() {
  document.addEventListener('click', (e) => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'date' || input.readOnly || input.disabled) return;
    const r = input.getBoundingClientRect();
    if (e.clientX > r.right - 44) return; // icône native
    ouvrirCalendrier(input);
  });
  document.addEventListener('keydown', (e) => {
    const input = e.target;
    if (e.key === 'Escape') fermerCalendrier({ rendreFocus: true });
    else if (input instanceof HTMLInputElement && input.type === 'date' && e.altKey && e.key === 'ArrowDown') ouvrirCalendrier(input);
  });
}
