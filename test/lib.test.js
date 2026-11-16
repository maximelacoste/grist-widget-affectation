import test from 'node:test';
import assert from 'node:assert/strict';
import { norm, cle, secToIso, isoToSec, formatDateFr, searchIndividus, ligneEnCours } from '../src/lib.js';

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
