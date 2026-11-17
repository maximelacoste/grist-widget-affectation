// Fonctions pures du widget : aucune dépendance à Grist ni au DOM, donc testables sous Node.

/**
 * Reproduit la normalisation de la formule `Cle` d'Individus :
 *   unicodedata.normalize("NFKD", s).encode("ascii", "ignore") puis minuscules,
 *   puis suppression de tout ce qui n'est pas a-z.
 */
export function norm(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/** Normalisation de recherche : comme norm() mais en conservant les chiffres (UAI, numéros). */
export function normSearch(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Filtre pour les listes de choix : chaque mot saisi doit se retrouver dans le libellé
 * (sans accents, casse, ponctuation ; ordre indifférent). Renvoie { total, rows }.
 */
export function filterOptions(options, query, limit = 50) {
  const tokens = String(query ?? '').split(/\s+/).map(normSearch).filter(Boolean);
  const rows = tokens.length
    ? options.filter((o) => {
        const k = normSearch(o.label);
        return tokens.every((t) => k.includes(t));
      })
    : options;
  return { total: rows.length, rows: rows.slice(0, limit) };
}

/** Clé nom|prénom|AAAA-MM-JJ, identique à la colonne formule `Cle` d'Individus. */
export function cle(nom, prenom, iso) {
  return `${norm(nom)}|${norm(prenom)}|${iso || ''}`;
}

/**
 * Une cellule Grist en erreur ou invalide arrive sous forme de tableau, par exemple
 * ['E', 'InvalidTypedValue', 'Ref', 'Sortie du département'] : texte saisi dans une colonne
 * Référence sans correspondance. On le reconnaît pour ne jamais l'afficher tel quel.
 */
export function isInvalidCell(v) {
  return Array.isArray(v) && v[0] === 'E';
}

/** Texte lisible d'une cellule : texte brut d'une valeur invalide, éléments d'une liste, '' si vide. */
export function cellText(v) {
  if (v == null) return '';
  if (Array.isArray(v)) {
    if (v[0] === 'E') return v[1] === 'InvalidTypedValue' ? String(v[3] ?? '') : `erreur ${v[1] ?? ''}`.trim();
    return v.slice(v[0] === 'L' ? 1 : 0).map(cellText).join(', ');
  }
  return String(v);
}

/** Date Grist (secondes depuis l'epoch, UTC) -> 'AAAA-MM-JJ' ; '' si ce n'est pas une date. */
export function secToIso(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  return new Date(v * 1000).toISOString().slice(0, 10);
}

/** 'AAAA-MM-JJ' -> secondes UTC (valeur attendue par Grist pour une colonne Date) ; null si invalide. */
export function isoToSec(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  const sec = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 1000;
  // Date.UTC « déborde » (30 février -> 2 mars) : on refuse les dates qui ne font pas l'aller-retour.
  return Number.isNaN(sec) || secToIso(sec) !== iso ? null : sec;
}

/** 'AAAA-MM-JJ' -> 'JJ/MM/AAAA' ; '' si vide. */
export function formatDateFr(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** Format colonnes de docApi.fetchTable ({id:[..], Col:[..]}) -> tableau de lignes. */
export function tableToRows(t, cols) {
  return t.id.map((id, i) => {
    const row = { id };
    for (const c of cols) row[c] = t[c] ? t[c][i] : undefined;
    return row;
  });
}

/** Lignes brutes de la table Individus -> lignes prêtes pour la recherche. */
export function toIndividus(t) {
  return tableToRows(t, ['Nom', 'Prenom', 'Date_de_naissance', 'Cle', 'Id_app']).map((r) => ({
    id: r.id,
    nom: cellText(r.Nom),
    prenom: cellText(r.Prenom),
    ddn: secToIso(r.Date_de_naissance),
    cle: cellText(r.Cle),
    idApp: r.Id_app,
  }));
}

/**
 * Recherche tolérante (sans accents, casse, espaces ni tirets) :
 * `nom` et `prenom` sont cherchés comme sous-chaînes, `iso` doit être égale si renseignée.
 */
export function searchIndividus(rows, { nom = '', prenom = '', iso = '' }, limit = 50) {
  const n = norm(nom);
  const p = norm(prenom);
  const out = rows.filter(
    (r) => (!n || norm(r.nom).includes(n)) && (!p || norm(r.prenom).includes(p)) && (!iso || r.ddn === iso),
  );
  out.sort((a, b) => a.nom.localeCompare(b.nom, 'fr') || a.prenom.localeCompare(b.prenom, 'fr'));
  return { total: out.length, rows: out.slice(0, limit) };
}

/** Ligne « en cours » : la plus récente dont Date_effet <= aujourd'hui (à date égale, la plus grande id). */
export function ligneEnCours(lignes, todayIso) {
  let best = null;
  for (const l of lignes) {
    if (!l.date || l.date > todayIso) continue;
    if (!best || l.date > best.date || (l.date === best.date && l.id > best.id)) best = l;
  }
  return best;
}

/**
 * Noms de famille déjà présents dans Individus dont le début correspond à la saisie (sans accents,
 * ni espaces, ni tirets). Un même nom n'apparaît qu'une fois, avec sa graphie la plus fréquente ;
 * les plus nombreux d'abord. Renvoie `[{ value, label }]`.
 */
export function suggestNoms(rows, query, limit = 8) {
  const q = norm(query);
  if (q.length < 2) return [];
  const groupes = new Map(); // nom normalisé -> Map(graphie -> effectif)
  for (const r of rows) {
    const k = norm(r.nom);
    if (!k.startsWith(q)) continue;
    const graphies = groupes.get(k) ?? new Map();
    graphies.set(r.nom, (graphies.get(r.nom) ?? 0) + 1);
    groupes.set(k, graphies);
  }
  return [...groupes.values()]
    .map((graphies) => {
      const triees = [...graphies].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'));
      const total = triees.reduce((s, [, n]) => s + n, 0);
      return { value: triees[0][0], n: total };
    })
    .sort((a, b) => b.n - a.n || a.value.localeCompare(b.value, 'fr'))
    .slice(0, limit)
    .map(({ value, n }) => ({ value, label: `${value} (${n} fiche${n > 1 ? 's' : ''})` }));
}

/** Service de géocodage de la Géoplateforme (IGN) : successeur de api-adresse.data.gouv.fr (Base Adresse Nationale). */
export const BAN_URL = 'https://data.geopf.fr/geocodage/search/';

/** URL de recherche d'adresse avec autocomplétion. */
export function banUrl(query, limit = 6) {
  const q = String(query ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return `${BAN_URL}?${new URLSearchParams({ q, limit: String(limit), autocomplete: '1' })}`;
}

/** Réponse GeoJSON de la BAN -> `[{ label, adresse, cp, commune }]` (numéro et voie séparés du code postal et de la commune). */
export function parseBan(json) {
  const features = Array.isArray(json?.features) ? json.features : [];
  return features
    .map((f) => f?.properties ?? {})
    .filter((p) => p.name && p.postcode && p.city && p.type !== 'municipality') // une commune seule n'est pas une adresse
    .map((p) => ({ label: p.label || `${p.name} ${p.postcode} ${p.city}`, adresse: p.name, cp: String(p.postcode), commune: p.city }));
}

/**
 * Niveaux proposés pour un type d'établissement. `parType` associe un type (ex. « CLG ») à la liste de
 * ses niveaux ; l'ordre de `tous` (celui des choix de la colonne Grist) est conservé. Un type absent de
 * `parType` (« Autre », vide, inconnu) ne restreint rien, et une liste qui n'aurait aucun niveau en
 * commun avec `tous` est ignorée : on ne propose jamais une liste vide.
 */
export function niveauxPour(type, tous, parType) {
  const liste = parType?.[type];
  if (!Array.isArray(liste)) return tous;
  const autorises = new Set(liste);
  const restreints = tous.filter((n) => autorises.has(n));
  return restreints.length > 0 ? restreints : tous;
}

/**
 * Type d'établissement (ECO / CLG / LYC) : la colonne `Type` si elle est reconnue, sinon déduit du libellé
 * (« E.E.PU … », « COLLEGE … », « LYCEE … »). '' si rien ne permet de conclure.
 */
export function typeEtab(brut, libelle = '') {
  const t = norm(brut || '');
  if (['eco', 'ecole', 'ee', 'ecoleelementaire'].includes(t)) return 'ECO';
  if (['clg', 'college'].includes(t)) return 'CLG';
  if (['lyc', 'lycee', 'lpo', 'lp'].includes(t)) return 'LYC';
  // minuscules sans accents, ponctuation conservée (normSearch l'efface, ce qui ruine les limites de mots)
  const l = String(libelle || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/\b(college|clg)\b/.test(l)) return 'CLG';
  if (/\b(lycee|lyc|lpo)\b/.test(l)) return 'LYC';
  if (/\becole\b/.test(l) || /^e\.?\s?[ep]\.?\s?(pu|pr)?\b/.test(l)) return 'ECO';
  return '';
}

/** Libellé d'établissement : n'ajoute la commune que si le libellé ne contient ni elle, ni déjà une parenthèse. */
export function libelleEtab(base, commune) {
  const b = String(base || '').replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').trim();
  const c = String(commune || '').trim();
  if (!c || b.includes('(') || normSearch(b).includes(normSearch(c))) return b;
  return `${b} (${c})`;
}
