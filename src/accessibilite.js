/**
 * Mini menu flottant d'accessibilité : taille du texte, densité, thème clair/sombre, interligne, liens soulignés,
 * animations réduites, retour en haut. Réglages mémorisés dans le navigateur (localStorage, facultatif : sans stockage
 * disponible, ils valent pour la session). Aucune donnée n'est lue ni envoyée.
 */
const CLE = 'ulisse-accessibilite';
const TAILLES = [87.5, 100, 112.5, 125, 150]; // % de la taille de base
const DEFAUT = { taille: 1, densite: 'normale', theme: 'light', interligne: false, liens: false, calme: false };

function lire() {
  try {
    const v = JSON.parse(localStorage.getItem(CLE) || '{}');
    return { ...DEFAUT, ...v };
  } catch {
    return { ...DEFAUT };
  }
}
function ecrire(r) {
  try {
    localStorage.setItem(CLE, JSON.stringify(r));
  } catch {
    /* stockage indisponible : réglages valables pour la session */
  }
}

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k === 'class' ? 'class' : k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

export function appliquer(r) {
  const html = document.documentElement;
  html.style.fontSize = `${TAILLES[r.taille] ?? 100}%`;
  html.setAttribute('data-fr-scheme', r.theme === 'dark' ? 'dark' : 'light');
  const b = document.body.classList;
  b.toggle('dens-compacte', r.densite === 'compacte');
  b.toggle('dens-aeree', r.densite === 'aeree');
  b.toggle('a11y-interligne', Boolean(r.interligne));
  b.toggle('a11y-liens', Boolean(r.liens));
  b.toggle('a11y-calme', Boolean(r.calme));
}

export function initAccessibilite() {
  if (document.getElementById('a11y-menu')) return;
  let r = lire();
  appliquer(r);
  const maj = (patch) => {
    const focus = document.activeElement && document.activeElement.id; // le panneau est redessiné : on rend le focus au même contrôle
    r = { ...r, ...patch };
    appliquer(r);
    ecrire(r);
    rendre();
    if (focus) document.getElementById(focus)?.focus();
  };
  const haut = () => {
    window.scrollTo({ top: 0, behavior: r.calme ? 'auto' : 'smooth' });
    const titre = document.querySelector('#stepper h1, h1');
    if (titre) {
      titre.setAttribute('tabindex', '-1');
      titre.focus({ preventScroll: true });
    }
  };
  const bouton = h('button', { type: 'button', class: 'fr-btn fr-btn--secondary fr-icon-eye-line fr-btn--icon-left a11y-ouvrir', id: 'a11y-ouvrir', 'aria-expanded': 'false', 'aria-controls': 'a11y-panneau', title: "Ouvrir les réglages d'affichage (taille, densité, thème, retour en haut)" }, 'Affichage');
  const panneau = h('div', { class: 'a11y-panneau', id: 'a11y-panneau', role: 'group', 'aria-label': "Réglages d'affichage", hidden: true });
  const remonter = h('button', { type: 'button', class: 'fr-btn fr-btn--secondary fr-icon-arrow-up-line fr-btn--icon-left a11y-haut', id: 'a11y-haut', title: 'Revenir en haut de la page', hidden: true, onclick: haut }, 'Retour en haut');
  const racine = h('div', { class: 'a11y-menu', id: 'a11y-menu' }, panneau, h('div', { class: 'a11y-barre' }, remonter, bouton));

  const choix = (nom, valeurs, courant, onPick) =>
    h('div', { class: 'a11y-choix', role: 'group', 'aria-label': nom }, valeurs.map(([v, lib, titre]) => h('button', { type: 'button', class: `fr-btn fr-btn--sm ${v === courant ? '' : 'fr-btn--tertiary'}`, 'aria-pressed': String(v === courant), title: titre || lib, onclick: () => onPick(v) }, lib)));
  const interrupteur = (id, lib, cle) =>
    h('div', { class: 'fr-checkbox-group fr-checkbox-group--sm' }, h('input', { type: 'checkbox', id, checked: Boolean(r[cle]), onchange: (e) => maj({ [cle]: e.target.checked }) }), h('label', { class: 'fr-label', for: id }, lib));

  function rendre() {
    panneau.replaceChildren(
      h('p', { class: 'a11y-titre' }, "Réglages d'affichage"),
      h('p', { class: 'a11y-etiq', id: 'a11y-l-taille' }, `Taille du texte : ${TAILLES[r.taille]} %`),
      h('div', { class: 'a11y-choix', role: 'group', 'aria-labelledby': 'a11y-l-taille' },
        h('button', { type: 'button', class: 'fr-btn fr-btn--sm fr-btn--secondary', id: 'a11y-moins', disabled: r.taille === 0, title: 'Réduire le texte', 'aria-label': 'Texte plus petit', onclick: () => maj({ taille: Math.max(0, r.taille - 1) }) }, 'A−'),
        h('button', { type: 'button', class: 'fr-btn fr-btn--sm fr-btn--tertiary', id: 'a11y-norm', title: 'Taille normale', onclick: () => maj({ taille: 1 }) }, 'A'),
        h('button', { type: 'button', class: 'fr-btn fr-btn--sm fr-btn--secondary', id: 'a11y-plus', disabled: r.taille === TAILLES.length - 1, title: 'Agrandir le texte', 'aria-label': 'Texte plus grand', onclick: () => maj({ taille: Math.min(TAILLES.length - 1, r.taille + 1) }) }, 'A+')),
      h('p', { class: 'a11y-etiq' }, 'Densité des tableaux et formulaires'),
      choix('Densité', [['compacte', 'Dense', 'Réduire les espaces : plus de lignes à l’écran'], ['normale', 'Normal'], ['aeree', 'Aéré', 'Augmenter les espaces']], r.densite, (v) => maj({ densite: v })),
      h('p', { class: 'a11y-etiq' }, 'Thème'),
      choix('Thème', [['light', 'Clair'], ['dark', 'Sombre']], r.theme, (v) => maj({ theme: v })),
      interrupteur('a11y-interligne', 'Interligne agrandi', 'interligne'),
      interrupteur('a11y-liens', 'Souligner tous les liens', 'liens'),
      interrupteur('a11y-calme', 'Réduire les animations', 'calme'),
      h('div', { class: 'a11y-actions' },
        h('button', { type: 'button', class: 'fr-btn fr-btn--sm fr-btn--secondary fr-icon-arrow-up-line fr-btn--icon-left', id: 'a11y-haut2', onclick: () => { haut(); } }, 'Retour en haut'),
        h('button', { type: 'button', class: 'fr-btn fr-btn--sm fr-btn--tertiary', id: 'a11y-reset', title: 'Revenir aux réglages d’origine', onclick: () => maj({ ...DEFAUT }) }, 'Réinitialiser')),
    );
  }
  const ouvrir = (oui) => {
    panneau.hidden = !oui;
    bouton.setAttribute('aria-expanded', String(oui));
  };
  bouton.addEventListener('click', () => ouvrir(panneau.hidden));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panneau.hidden) {
      ouvrir(false);
      bouton.focus();
    }
  });
  document.addEventListener('click', (e) => {
    if (!panneau.hidden && e.target.isConnected && !racine.contains(e.target)) ouvrir(false); // cible détachée : le panneau vient d'être redessiné
  });
  window.addEventListener('scroll', () => {
    remonter.hidden = window.scrollY < 300;
  }, { passive: true });
  rendre();
  document.body.append(racine);
}
