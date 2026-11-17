import test from 'node:test';
import assert from 'node:assert/strict';
import { norm, cle, secToIso, isoToSec, formatDateFr, searchIndividus, ligneEnCours, filterOptions, cellText, isInvalidCell, suggestNoms, banUrl, parseBan, niveauxPour } from '../src/lib.js';

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
