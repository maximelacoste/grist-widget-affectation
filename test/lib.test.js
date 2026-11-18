import test from 'node:test';
import assert from 'node:assert/strict';
import { norm, cle, secToIso, isoToSec, formatDateFr, searchIndividus, ligneEnCours, filterOptions, cellText, isInvalidCell, suggestNoms, banUrl, parseBan, niveauxPour, typeEtab, libelleEtab, rechercheLibre, libelleEleve, elevesDuDispositif, trierEleves, effectifsParEtab, alerteFinDroits, libelleAlerteFin, infosManquantes } from '../src/lib.js';

// Valeurs de référence produites par la formule Python de la colonne `Cle` d'Individus.
const REFERENCE_PYTHON = [
  ['Éloïse', 'eloise'],
  ['Jean-Pierre', 'jeanpierre'],
  ["O'Brien", 'obrien'],
  ['de la Fontaine', 'delafontaine'],
  ['Œuvre', 'uvre'],
  ['Straße', 'strae'],
  ['Muñoz', 'munoz'],
  ['Łukasz', 'ukasz'],
  ['ÇA Va', 'cava'],
  ['  Léa  ', 'lea'],
  ['Anne-Sophie2', 'annesophie'],
  ['', ''],
  [null, ''],
  ['İbrahim', 'ibrahim'],
  ['Ａｂｃ', 'abc'],
];

test('norm() est identique à la normalisation Python de Cle', () => {
  for (const [entree, attendu] of REFERENCE_PYTHON) assert.equal(norm(entree), attendu, `entrée : ${entree}`);
});

test('cle() : date présente ou absente', () => {
  assert.equal(cle('Éloïse', 'Jean-Pierre', '2015-03-09'), 'eloise|jeanpierre|2015-03-09');
  assert.equal(cle('', '', ''), '||');
  assert.equal(cle('Dupont', 'Léa', ''), 'dupont|lea|');
});

test('dates : aller-retour secondes <-> ISO', () => {
  assert.equal(secToIso(isoToSec('2015-03-09')), '2015-03-09');
  assert.equal(isoToSec('2015-02-30'), null); // date inexistante refusée
  assert.equal(isoToSec(''), null);
  assert.equal(secToIso('texte'), '');
  assert.equal(secToIso(null), '');
  assert.equal(formatDateFr('2015-03-09'), '09/03/2015');
  assert.equal(formatDateFr(''), '');
});

const lignes = [
  { id: 1, nom: 'Martin', prenom: 'Léa', ddn: '2014-05-01', cle: 'martin|lea|2014-05-01' },
  { id: 2, nom: 'Martin-Durand', prenom: 'Lucas', ddn: '2013-01-12', cle: '' },
  { id: 3, nom: 'Dubois', prenom: 'Éloïse', ddn: '', cle: '' },
];

test('searchIndividus : sans accents, casse ni tirets', () => {
  assert.deepEqual(searchIndividus(lignes, { nom: 'MARTIN' }).rows.map((r) => r.id), [1, 2]);
  assert.deepEqual(searchIndividus(lignes, { nom: 'martin durand' }).rows.map((r) => r.id), [2]);
  assert.deepEqual(searchIndividus(lignes, { prenom: 'eloise' }).rows.map((r) => r.id), [3]);
  assert.deepEqual(searchIndividus(lignes, { nom: 'martin', iso: '2014-05-01' }).rows.map((r) => r.id), [1]);
  assert.equal(searchIndividus(lignes, { nom: 'zzz' }).total, 0);
});

test('searchIndividus : limite et total', () => {
  const beaucoup = Array.from({ length: 80 }, (_, i) => ({ id: i + 1, nom: 'Nom', prenom: `P${i}`, ddn: '', cle: '' }));
  const r = searchIndividus(beaucoup, { nom: 'nom' }, 50);
  assert.equal(r.total, 80);
  assert.equal(r.rows.length, 50);
});

test('filterOptions : mots dans le désordre, sans accents, chiffres conservés', () => {
  const opts = [
    { value: 1, label: 'Collège Jean Jaurès (Albi)' },
    { value: 2, label: 'École élémentaire Jules Ferry (Gaillac)' },
    { value: 3, label: 'Collège Lapérouse 2 (Albi)' },
  ];
  assert.deepEqual(filterOptions(opts, 'albi college').rows.map((o) => o.value), [1, 3]);
  assert.deepEqual(filterOptions(opts, 'JAURES').rows.map((o) => o.value), [1]);
  assert.deepEqual(filterOptions(opts, 'laperouse 2').rows.map((o) => o.value), [3]);
  assert.deepEqual(filterOptions(opts, '').rows.map((o) => o.value), [1, 2, 3]);
  assert.equal(filterOptions(opts, 'zzz').total, 0);
  assert.equal(filterOptions(opts, '', 2).rows.length, 2);
  assert.equal(filterOptions(opts, '', 2).total, 3);
});

test('ligneEnCours : dernière ligne datée <= aujourd\'hui, départage par id', () => {
  const l = [
    { id: 1, date: '2025-09-01' },
    { id: 2, date: '2026-09-01' },
    { id: 3, date: '2026-09-01' },
    { id: 4, date: '2027-09-01' }, // futur (positionnement n+1)
    { id: 5, date: '' },
  ];
  assert.equal(ligneEnCours(l, '2026-11-16').id, 3);
  assert.equal(ligneEnCours(l, '2025-10-01').id, 1);
  assert.equal(ligneEnCours(l, '2024-01-01'), null);
});

test('cellText / isInvalidCell : cellules invalides de Grist', () => {
  const invalide = ['E', 'InvalidTypedValue', 'Ref', 'Sortie du département'];
  assert.equal(isInvalidCell(invalide), true);
  assert.equal(isInvalidCell(12), false);
  assert.equal(cellText(invalide), 'Sortie du département');
  assert.equal(cellText(['E', 'ZeroDivisionError']), 'erreur ZeroDivisionError');
  assert.equal(cellText(['L', 'a', 'b']), 'a, b');
  assert.equal(cellText(null), '');
  assert.equal(cellText(0), '0');
  assert.equal(cellText('Léa'), 'Léa');
});

test('suggestNoms() : début de nom, sans accents ni espaces, graphie la plus fréquente, regroupé', () => {
  const rows = [
    { nom: 'Martin' }, { nom: 'MARTIN' }, { nom: 'Martin' }, { nom: 'Martinez' },
    { nom: 'de la Fontaine' }, { nom: 'Muñoz' }, { nom: 'Durand' },
  ];
  assert.deepEqual(suggestNoms(rows, 'mar'), [
    { value: 'Martin', label: 'Martin (3 fiches)' },
    { value: 'Martinez', label: 'Martinez (1 fiche)' },
  ]);
  assert.deepEqual(suggestNoms(rows, 'DE LA F').map((s) => s.value), ['de la Fontaine']);
  assert.deepEqual(suggestNoms(rows, 'munoz').map((s) => s.value), ['Muñoz']);
  assert.deepEqual(suggestNoms(rows, 'm'), []); // trop court
  assert.deepEqual(suggestNoms(rows, 'zzz'), []);
  assert.equal(suggestNoms(rows, 'ma', 1).length, 1);
});

test('banUrl() : paramètres encodés, longueur bornée', () => {
  const u = new URL(banUrl('  8  bd du Port  Amiens '));
  assert.equal(u.origin + u.pathname, 'https://data.geopf.fr/geocodage/search/');
  assert.equal(u.searchParams.get('q'), '8 bd du Port Amiens');
  assert.equal(u.searchParams.get('autocomplete'), '1');
  assert.equal(new URL(banUrl('x'.repeat(500))).searchParams.get('q').length, 200);
});

test('parseBan() : sépare voie, code postal et commune ; écarte les communes seules et les réponses incomplètes', () => {
  const json = {
    features: [
      { properties: { label: '8 Boulevard du Port 80000 Amiens', name: '8 Boulevard du Port', postcode: '80000', city: 'Amiens', type: 'housenumber' } },
      { properties: { label: 'Amiens', name: 'Amiens', postcode: '80000', city: 'Amiens', type: 'municipality' } },
      { properties: { label: 'Rue sans code', name: 'Rue sans code', city: 'Ailleurs', type: 'street' } },
      { properties: { name: 'Chemin de Peyre', postcode: '01000', city: 'Bourg', type: 'street' } },
    ],
  };
  assert.deepEqual(parseBan(json), [
    { label: '8 Boulevard du Port 80000 Amiens', adresse: '8 Boulevard du Port', cp: '80000', commune: 'Amiens' },
    { label: 'Chemin de Peyre 01000 Bourg', adresse: 'Chemin de Peyre', cp: '01000', commune: 'Bourg' },
  ]);
  assert.deepEqual(parseBan(null), []);
  assert.deepEqual(parseBan({}), []);
});

test('niveauxPour() : filtre par type en gardant l\'ordre des choix, sans jamais renvoyer une liste vide', () => {
  const tous = ['GS', 'CP', 'CM2', '6G', '3G', 'Lycée', '2PRO'];
  const parType = { ECO: ['GS', 'CP', 'CM2', 'CE1'], CLG: ['3G', '6G'], VIDE: ['inconnu'] };
  assert.deepEqual(niveauxPour('ECO', tous, parType), ['GS', 'CP', 'CM2']); // CE1 absent des choix : ignoré
  assert.deepEqual(niveauxPour('CLG', tous, parType), ['6G', '3G']); // ordre des choix Grist, pas celui de la config
  assert.deepEqual(niveauxPour('Autre', tous, parType), tous);
  assert.deepEqual(niveauxPour('', tous, parType), tous);
  assert.deepEqual(niveauxPour(undefined, tous, parType), tous);
  assert.deepEqual(niveauxPour('VIDE', tous, parType), tous); // aucun niveau en commun : pas de liste vide
});

test('typeEtab et libelleEtab', () => {
  assert.equal(typeEtab('CLG'), 'CLG');
  assert.equal(typeEtab(' eco '), 'ECO');
  assert.equal(typeEtab('', 'E.E.PU JEAN MONNET (FENOUILLET)'), 'ECO');
  assert.equal(typeEtab('Autre', 'COLLEGE VICTOR HUGO'), 'CLG');
  assert.equal(typeEtab('', 'Truc'), '');
  assert.equal(libelleEtab('E.E.PU HENRI PUIS (ST ORENS DE GAMEVILLE)', 'Saint-Orens-de-Gameville'), 'E.E.PU HENRI PUIS (ST ORENS DE GAMEVILLE)');
  assert.equal(libelleEtab('COLLEGE X ()', ''), 'COLLEGE X');
  assert.equal(libelleEtab('0311584D COLLEGE MARENGO (TOULOUSE) (Toulouse)', 'Toulouse'), '0311584D COLLEGE MARENGO (TOULOUSE)');
  assert.equal(libelleEtab('COLLEGE X', 'Muret'), 'COLLEGE X (Muret)');
});

test('rechercheLibre : nom, prénom et date dans le désordre', () => {
  const rows = [
    { id: 1, nom: 'DUPONT', prenom: 'Léa', ddn: '2015-03-12' },
    { id: 2, nom: 'DUPONT', prenom: 'Léo', ddn: '2016-05-01' },
    { id: 3, nom: 'MARTIN', prenom: 'Éloïse', ddn: '' },
  ];
  assert.equal(rechercheLibre(rows, 'dupont').total, 2);
  assert.deepEqual(rechercheLibre(rows, 'léa dupont').rows.map((r) => r.id), [1]);
  assert.deepEqual(rechercheLibre(rows, 'dupont 2016').rows.map((r) => r.id), [2]);
  assert.deepEqual(rechercheLibre(rows, '12/03/2015 dupont').rows.map((r) => r.id), [1]);
  assert.deepEqual(rechercheLibre(rows, 'eloise').rows.map((r) => r.id), [3]);
  assert.equal(rechercheLibre(rows, 'd').total, 0);
  assert.equal(libelleEleve(rows[0]), 'DUPONT Léa, né(e) le 12/03/2015');
  assert.match(libelleEleve(rows[2]), /non renseignée/);
});

test('elevesDuDispositif : seule la ligne en cours compte ; attente et autres situations écartées', () => {
  const L = (eleve, id, date, affectation, situation = 'En ULIS', attente = false, niveau = 'CM2') => ({ eleve, id, date, affectation, situation, attente, niveau });
  const lignes = [
    L(1, 1, '2025-09-01', 7), L(1, 2, '2026-09-01', 8), // 1 : parti vers 8
    L(2, 3, '2025-09-01', 7), // 2 : présent
    L(3, 4, '2026-09-01', 7, 'En ULIS', true), // 3 : liste d'attente
    L(4, 5, '2026-09-01', 7, 'Retour classe ordinaire'), // 4 : autre situation
    L(5, 6, '2027-09-01', 7), // 5 : affectation future, pas encore en cours
    L(6, 7, '2024-09-01', 7), L(6, 8, '2026-01-01', 7, 'Exclusion'), // 6 : en cours = exclusion
  ];
  const r = elevesDuDispositif(lignes, 7, '2026-11-18');
  assert.deepEqual(r.rows.map((x) => x.eleve), [2]);
  assert.equal(r.attente, 1);
  assert.equal(r.autres, 2);
  const tout = elevesDuDispositif(lignes, 7, '2026-11-18', { inclure: true });
  assert.deepEqual(tout.rows.map((x) => x.eleve).sort(), [2, 3, 4, 6]);
  assert.deepEqual(elevesDuDispositif(lignes, 8, '2026-11-18').rows.map((x) => x.eleve), [1]);
});

test('trierEleves : nom, classe (ordre des choix), date de première notification (vides à la fin)', () => {
  const rows = [
    { nom: 'MARTIN', prenom: 'Zoé', niveau: 'CM2', premiere: '2022-09-01', fin: '' },
    { nom: 'DUPONT', prenom: 'Léa', niveau: 'CP', premiere: '', fin: '2027-06-30' },
    { nom: 'DURAND', prenom: 'Éli', niveau: '6G', premiere: '2020-09-01', fin: '2026-06-30' },
    { nom: 'ABEL', prenom: 'Ann', niveau: 'Inconnu', premiere: '2021-09-01', fin: '' },
  ];
  const niveaux = ['CP', 'CE1', 'CM2', '6G'];
  const noms = (k, d) => trierEleves(rows, k, d, niveaux).map((r) => r.nom);
  assert.deepEqual(noms('nom', 1), ['ABEL', 'DUPONT', 'DURAND', 'MARTIN']);
  assert.deepEqual(noms('nom', -1), ['MARTIN', 'DURAND', 'DUPONT', 'ABEL']);
  assert.deepEqual(noms('classe', 1), ['DUPONT', 'MARTIN', 'DURAND', 'ABEL']);
  assert.deepEqual(noms('premiere', 1), ['DURAND', 'ABEL', 'MARTIN', 'DUPONT']);
  assert.deepEqual(noms('premiere', -1), ['MARTIN', 'ABEL', 'DURAND', 'DUPONT']); // sans date toujours en dernier
  assert.deepEqual(noms('fin', 1), ['DURAND', 'DUPONT', 'ABEL', 'MARTIN']);
});

test('effectifsParEtab : présents et liste d\'attente par établissement, ligne en cours seulement', () => {
  const L = (eleve, id, date, affectation, situation = 'En ULIS', attente = false) => ({ eleve, id, date, affectation, situation, attente });
  const lignes = [
    L(1, 1, '2025-09-01', 7), L(1, 2, '2026-09-01', 8), // 1 : en cours à 8
    L(2, 3, '2025-09-01', 7),
    L(3, 4, '2026-09-01', 7, 'En ULIS', true),
    L(4, 5, '2026-09-01', 8, 'Retour classe ordinaire'),
    L(5, 6, '2027-09-01', 8), // futur : ignoré
  ];
  const m = effectifsParEtab(lignes, '2026-11-18');
  assert.deepEqual(m.get(7), { presents: 1, attente: 1, ids: [2] });
  assert.deepEqual(m.get(8), { presents: 1, attente: 0, ids: [1] });
  assert.equal(m.size, 2);
});

test('alerteFinDroits : échue, proche, ok, sans date', () => {
  const today = '2026-11-18';
  assert.equal(alerteFinDroits('', today), null);
  assert.deepEqual(alerteFinDroits('2026-11-17', today), { niveau: 'expiree', jours: -1 });
  assert.deepEqual(alerteFinDroits('2026-11-18', today), { niveau: 'proche', jours: 0 });
  assert.equal(alerteFinDroits('2027-03-18', today).niveau, 'proche'); // 120 jours
  assert.equal(alerteFinDroits('2027-03-19', today).niveau, 'ok');
  assert.equal(alerteFinDroits('2027-03-19', today, 200).niveau, 'proche');
  assert.equal(libelleAlerteFin(alerteFinDroits('2026-06-30', today)), 'Échue depuis 5 mois');
  assert.equal(libelleAlerteFin(alerteFinDroits('2026-11-10', today)), 'Échue depuis 8 jours');
  assert.equal(libelleAlerteFin(alerteFinDroits('2026-11-19', today)), 'Fin dans 1 jour');
  assert.equal(libelleAlerteFin(alerteFinDroits('2026-11-18', today)), "Échoit aujourd'hui");
  assert.equal(libelleAlerteFin(alerteFinDroits('2027-01-20', today)), 'Fin dans 2 mois');
  assert.equal(libelleAlerteFin(alerteFinDroits('2028-01-01', today)), '');
});

test('infosManquantes : nom, prénom, date de naissance', () => {
  assert.deepEqual(infosManquantes({ nom: 'A', prenom: 'B', ddn: '2014-05-01' }), []);
  assert.deepEqual(infosManquantes({ nom: '', prenom: ' ', ddn: null }), ['nom', 'prénom', 'date de naissance']);
  assert.deepEqual(infosManquantes({ nom: 'A', prenom: 'B', ddn: 'pas une date' }), ['date de naissance']);
  assert.deepEqual(infosManquantes({ nom: 'A', prenom: null, ddn: '2014-05-01' }), ['prénom']);
  assert.deepEqual(infosManquantes(null), []);
});
