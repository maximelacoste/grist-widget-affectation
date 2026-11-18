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

/** Cellule dont la formule Grist a échoué (AttributeError, etc.) ; une valeur invalide saisie (`InvalidTypedValue`) n'en est pas une. */
export function isFormulaError(v) {
  return Array.isArray(v) && v[0] === 'E' && v[1] !== 'InvalidTypedValue';
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

/** 1er septembre de l'année scolaire qui contient `todayIso` (comme la formule `Actuellement_en_ULIS` de Scolarite). */
export function debutAnneeScolaire(todayIso) {
  const annee = Number(todayIso.slice(0, 4));
  return `${Number(todayIso.slice(5, 7)) >= 9 ? annee : annee - 1}-09-01`;
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
 * Ligne « en cours » à afficher dans le dossier et les suggestions. Si les lignes portent `actuel` (colonne
 * `Actuellement_en_ULIS` de Grist, la même que celle de `Effectif`), c'est elle qui décide : la ligne la plus récente
 * marquée actuelle, ou aucune (une scolarité de 2023 échue n'est plus « en cours »). Sans cette colonne : `ligneEnCours`.
 */
export function ligneActuelle(lignes, todayIso) {
  if (!lignes.some((l) => l.actuel !== undefined)) {
    // Repli sans la colonne : même règle que la formule Grist (dernière ligne, de l'année scolaire en cours, « En ULIS » ou vide)
    const l = ligneEnCours(lignes, todayIso);
    return l && l.date >= debutAnneeScolaire(todayIso) && (!l.situation || l.situation === 'En ULIS') ? l : null;
  }
  let best = null;
  for (const l of lignes) {
    if (l.actuel !== true) continue;
    if (!best || (l.date || '') > (best.date || '') || ((l.date || '') === (best.date || '') && l.id > best.id)) best = l;
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
  let b = String(base || '').replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').trim();
  // « NOM (TOULOUSE) (Toulouse) » : la dernière parenthèse répète la précédente -> une seule
  const dbl = /\(([^()]*)\)\s*\(([^()]*)\)$/.exec(b);
  if (dbl && normSearch(dbl[1]) === normSearch(dbl[2])) b = b.slice(0, dbl.index + dbl[1].length + 2);
  const c = String(commune || '').trim();
  if (!c || b.includes('(') || normSearch(b).includes(normSearch(c))) return b;
  return `${b} (${c})`;
}

/**
 * Recherche libre : chaque mot saisi doit se retrouver dans le nom, le prénom ou la date de naissance
 * (jj/mm/aaaa, aaaa-mm-jj ou fragments : « 2015 », « 03/2015 »), dans n'importe quel ordre.
 * Un mot qui ne contient que des chiffres et des séparateurs est traité comme un fragment de date.
 */
export function rechercheLibre(rows, query, limit = 50) {
  const mots = String(query || '').trim().split(/\s+/).filter(Boolean);
  const criteres = mots.map((m) => (/^[\d/.\-]+$/.test(m) ? { date: m.replace(/[.\-]/g, '/') } : { texte: norm(m) }));
  if (criteres.length === 0 || criteres.every((c) => (c.texte ?? '').length < 2 && !c.date)) return { total: 0, rows: [] };
  const out = rows.filter((r) => {
    const fr = formatDateFr(r.ddn);
    const nomNorm = norm(r.nom);
    const prenomNorm = norm(r.prenom);
    return criteres.every((c) =>
      c.date !== undefined ? c.date.length >= 2 && (fr.includes(c.date) || (r.ddn || '').includes(c.date.replace(/\//g, '-'))) : c.texte.length >= 1 && (nomNorm.includes(c.texte) || prenomNorm.includes(c.texte)),
    );
  });
  out.sort((a, b) => a.nom.localeCompare(b.nom, 'fr') || a.prenom.localeCompare(b.prenom, 'fr') || (a.ddn || '').localeCompare(b.ddn || ''));
  return { total: out.length, rows: out.slice(0, limit) };
}

/** Libellé d'une suggestion : « DUPONT Léa, né(e) le 12/03/2015 ». */
export function libelleEleve(r) {
  const d = formatDateFr(r.ddn);
  return `${r.nom} ${r.prenom}, ${d ? `né(e) le ${d}` : 'date de naissance non renseignée'}`.replace(/\s+,/, ',');
}

/**
 * Statut de chaque élève : `[{ eleve, ligne, statut }]`, `statut` = 'present' | 'attente' | 'autre'.
 * Si les lignes portent `actuel` (colonne `Actuellement_en_ULIS` de Grist, la même que celle de la colonne `Effectif`),
 * c'est elle qui décide : la ligne la plus récente marquée « actuellement en ULIS » donne l'établissement, « attente »
 * si `Liste_d_attente`, sinon « présent ». Sans cette colonne, on retombe sur la ligne « en cours » (la plus récente
 * dont la date est passée) : présent si la situation est `situationPresent` et hors liste d'attente.
 */
export function statutsEleves(lignes, todayIso, situationPresent = 'En ULIS') {
  const parEleve = new Map();
  for (const l of lignes) {
    if (!parEleve.has(l.eleve)) parEleve.set(l.eleve, []);
    parEleve.get(l.eleve).push(l);
  }
  const grist = lignes.some((l) => l.actuel !== undefined);
  const debut = debutAnneeScolaire(todayIso); // une ligne d'une année scolaire passée n'est plus « en cours »
  const plusRecente = (ls) => ls.reduce((b, l) => (!b || (l.date || '') > (b.date || '') || ((l.date || '') === (b.date || '') && l.id > b.id) ? l : b), null);
  const out = [];
  for (const [eleve, ls] of parEleve) {
    if (grist) {
      const actuelles = ls.filter((l) => l.actuel === true && l.affectation);
      if (actuelles.length) {
        const l = plusRecente(actuelles);
        out.push({ eleve, ligne: l, statut: l.attente ? 'attente' : 'present' });
        continue;
      }
      const l = ligneEnCours(ls, todayIso);
      if (l && l.affectation && l.date >= debut) out.push({ eleve, ligne: l, statut: l.attente ? 'attente' : 'autre' });
      continue;
    }
    const l = ligneEnCours(ls, todayIso);
    if (!l || !l.affectation || l.date < debut) continue;
    out.push({ eleve, ligne: l, statut: l.attente ? 'attente' : !l.situation || l.situation === situationPresent ? 'present' : 'autre' });
  }
  return out;
}

/**
 * Élèves d'un dispositif. Par défaut, seuls les « présents » sont renvoyés ; `inclureAttente` ajoute la liste d'attente,
 * `inclureAutres` les autres situations (sortie, exclusion…) dont l'affectation en cours est cet établissement ;
 * `inclure: true` ajoute les deux. Renvoie `{ rows: [{ eleve, ligne, statut }], presents, attente, autres }` :
 * les trois compteurs portent sur tout l'établissement, affichés ou non.
 */
export function elevesDuDispositif(lignes, etabId, todayIso, { inclure = false, inclureAttente = inclure, inclureAutres = inclure, situationPresent = 'En ULIS' } = {}) {
  const rows = [];
  const n = { present: 0, attente: 0, autre: 0 };
  for (const x of statutsEleves(lignes, todayIso, situationPresent)) {
    if (x.ligne.affectation !== etabId) continue;
    n[x.statut] += 1;
    if (x.statut === 'present' || (x.statut === 'attente' && inclureAttente) || (x.statut === 'autre' && inclureAutres)) rows.push(x);
  }
  return { rows, presents: n.present, attente: n.attente, autres: n.autre };
}

/**
 * Tri d'une liste d'élèves du dispositif. `cle` : nom | classe | premiere | fin ; `dir` : 1 ou -1.
 * La classe suit l'ordre des choix de `niveaux` (inconnus à la fin) ; une date absente passe toujours après les autres.
 * `rows` : [{ nom, prenom, niveau, premiere, fin }].
 */
export function trierEleves(rows, cle, dir = 1, niveaux = []) {
  const parNom = (a, b) => a.nom.localeCompare(b.nom, 'fr') || a.prenom.localeCompare(b.prenom, 'fr');
  const rang = (n) => {
    const i = niveaux.indexOf(n);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const date = (k) => (a, b) => {
    if (!a[k] && !b[k]) return 0;
    if (!a[k]) return 1; // sans date : toujours en dernier
    if (!b[k]) return -1;
    return dir * a[k].localeCompare(b[k]);
  };
  const cmp = {
    nom: (a, b) => dir * parNom(a, b),
    classe: (a, b) => dir * (rang(a.niveau) - rang(b.niveau) || (a.niveau || '').localeCompare(b.niveau || '', 'fr')),
    premiere: date('premiere'),
    fin: date('fin'),
  }[cle] || ((a, b) => parNom(a, b));
  return [...rows].sort((a, b) => cmp(a, b) || parNom(a, b));
}

/**
 * Effectifs de tous les établissements en une passe : pour chaque élève, sa ligne en cours ; Map(id d'établissement ->
 * { presents, attente, ids }), `ids` = élèves présents. « Présent » = situation `situationPresent` hors liste d'attente (même règle que `elevesDuDispositif`).
 */
export function effectifsParEtab(lignes, todayIso, situationPresent = 'En ULIS') {
  const out = new Map();
  for (const x of statutsEleves(lignes, todayIso, situationPresent)) {
    const etab = x.ligne.affectation;
    if (!out.has(etab)) out.set(etab, { presents: 0, attente: 0, ids: [] });
    const e = out.get(etab);
    if (x.statut === 'attente') e.attente += 1;
    else if (x.statut === 'present') {
      e.presents += 1;
      e.ids.push(x.eleve);
    }
  }
  return out;
}

/**
 * Alerte sur la fin de droits : `null` sans date ; `expiree` (date passée), `proche` (dans les `seuilJours` jours,
 * aujourd'hui compris) ou `ok`. `jours` = jours restants (négatif si échue). Dates 'AAAA-MM-JJ'.
 */
export function alerteFinDroits(finIso, todayIso, seuilJours = 120) {
  if (!finIso || !todayIso) return null;
  const jours = Math.round((Date.parse(`${finIso}T00:00:00Z`) - Date.parse(`${todayIso}T00:00:00Z`)) / 86400000);
  if (!Number.isFinite(jours)) return null;
  return { niveau: jours < 0 ? 'expiree' : jours <= seuilJours ? 'proche' : 'ok', jours };
}

/** Texte de l'alerte (« Échue depuis 3 mois », « Fin dans 12 jours »), pour ne pas compter sur la seule couleur. */
export function libelleAlerteFin(a) {
  if (!a || a.niveau === 'ok') return '';
  const duree = (j) => (j < 60 ? `${j} jour${j > 1 ? 's' : ''}` : `${Math.round(j / 30)} mois`);
  if (a.niveau === 'expiree') return `Échue depuis ${duree(-a.jours)}`;
  return a.jours === 0 ? "Échoit aujourd'hui" : `Fin dans ${duree(a.jours)}`;
}

/**
 * Informations d'état civil manquantes d'une fiche Individus (`{ nom, prenom, ddn }`) : tableau de libellés,
 * vide si la fiche est complète. `ddn` est la date ISO 'AAAA-MM-JJ' (voir `secToIso`) ; une valeur vide ou qui n'est pas une vraie date compte comme manquante.
 */
export function infosManquantes(row, affectation = null) {
  if (!row) return [];
  const out = [];
  if (!String(row.nom ?? '').trim()) out.push('nom');
  if (!String(row.prenom ?? '').trim()) out.push('prénom');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.ddn ?? ''))) out.push('date de naissance');
  // `affectation` = { affecte, niveau } : le niveau n'est exigé que pour un élève réellement affecté (ni liste d'attente, ni sans affectation)
  if (affectation && affectation.affecte && !String(affectation.niveau ?? '').trim()) out.push('niveau');
  return out;
}

/**
 * Taux d'occupation d'un dispositif : `null` si la capacité est inconnue ; sinon `{ niveau, libres }` avec `niveau` =
 * 'libre' (places disponibles), 'presque' (au moins `seuil` de la capacité, sans être plein), 'plein' ou 'depassement'.
 * `libres` est négatif en cas de dépassement.
 */
export function occupation(presents, places, seuil = 0.85) {
  if (typeof places !== 'number' || !Number.isFinite(places) || places <= 0) return null;
  const libres = places - presents;
  const niveau = libres < 0 ? 'depassement' : libres === 0 ? 'plein' : presents / places >= seuil ? 'presque' : 'libre';
  return { niveau, libres };
}
