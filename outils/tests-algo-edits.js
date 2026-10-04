/* Tests de l'algorithme du fil d'edits.
 *
 *     node outils/tests-algo-edits.js
 *
 * Le code teste n'est pas recopie ici: il est extrait d'index.html a chaque
 * execution. Une copie se serait desynchronisee au premier reglage, et un test
 * qui verifie autre chose que le code livre ne verifie rien.
 *
 * Les fonctions du fil touchent au stockage et a l'horloge; les deux sont
 * remplacees par des doublures, ce qui permet de faire passer trois mois en
 * une ligne et de verifier le vieillissement pour de vrai.
 */
const fs = require('fs');
const path = require('path');

/* Le code vit maintenant dans js/, decoupe par sujet. On recolle tout dans
   l'ordre de chargement plutot que de nommer les fichiers un par un: un
   redecoupage ne doit pas casser les tests. */
const DOSSIER = path.join(__dirname, '..', 'js');
const src = fs.readdirSync(DOSSIER).filter((f) => f.endsWith('.js')).sort()
  .map((f) => fs.readFileSync(path.join(DOSSIER, f), 'utf8')).join('\n');

function bloc(entete) {
  const i = src.indexOf(entete);
  if (i < 0) throw new Error('introuvable dans js/ : ' + entete);
  // une fonction qui tient sur une ligne s'arrete a cette ligne: chercher le
  // prochain « \n} » la ferait deborder sur la suivante
  const premiere = src.slice(i, src.indexOf('\n', i));
  if (premiere.trimEnd().endsWith('}')) return premiere;
  return src.slice(i, src.indexOf('\n}', i) + 2);
}
function ligne(prefixe) {
  const i = src.indexOf(prefixe);
  if (i < 0) throw new Error('introuvable dans js/ : ' + prefixe);
  return src.slice(i, src.indexOf('\n', i));
}
function declaration(prefixe) {
  const i = src.indexOf(prefixe);
  if (i < 0) throw new Error('introuvable dans js/ : ' + prefixe);
  return src.slice(i, src.indexOf(';', i) + 1);
}

const CONSTANTES = ['ED_REF_TOUR', 'ED_DUREE_MED', 'ED_ALPHA', 'ED_DEMI_VIE', 'ED_LISSAGE',
  'ED_LISSAGE_EDIT', 'ED_EXPO_DEMI', 'ED_BRUT_MAX', 'ED_MESURE_MAX', 'ED_SUIVI_DEMI',
  'ED_NEUTRE', 'ED_BRUIT', 'ED_POIDS_MIN', 'ED_POIDS_MAX', 'ED_BONUS_NEUF',
  'ED_INCERTITUDE', 'ED_PART_TEMPS', 'ED_PART_FIN', 'ED_JAIME_EDIT', 'ED_JAIME_SATURE',
  'ED_PART_QUALITE', 'ED_PART_FRAICHEUR', 'ED_PART_SUIVI', 'ED_WARP', 'ED_DISPERSION_MIN',
  'ED_DWELL_MIN', 'ED_SAUT_MAX', 'ED_FIN_PROCHE', 'ED_ECRITURE'];
const FONCTIONS = ['edPlafondPasse', 'edExposition', 'edUsure', 'edAttrait', 'edMesure',
  'edAime', 'edQualiteOeuvre', 'edFraicheurOeuvre', 'edPriorite', 'edGammas',
  'melangerPondere', 'fileEdits', 'edStats', 'edStatsMarquer', 'edStatsEcrire',
  'edStatDe', 'edDwellDebut', 'edDwellMarche', 'edDwellArret', 'edDwellAvance',
  'edDwellEchec', 'edDwellFin'];

// ---- doublures: un magasin en memoire, une horloge qu'on avance a la main ----
let MEM = {};
const store = {
  get: (k, d) => (k in MEM ? JSON.parse(JSON.stringify(MEM[k])) : d),
  set: (k, v) => { MEM[k] = JSON.parse(JSON.stringify(v)); },
};
let HORLOGE = 1700000000000;
const VRAI_NOW = Date.now;
Date.now = () => HORLOGE;
const avancer = (ms) => { HORLOGE += ms; };
const JOUR = 86400000;

let ok = 0, ko = 0;
function verif(nom, condition, detail) {
  if (condition) { ok++; console.log('  ok    ' + nom + (detail ? '   ' + detail : '')); }
  else { ko++; console.log('  ECHEC ' + nom + (detail ? '   ' + detail : '')); }
}
const pres = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps);

/* Evaluation indirecte: un eval direct enferme ses declarations dans sa propre
   portee, et rien de ce qu'on extrait ne serait visible ici. Les const
   deviennent des proprietes globales pour la meme raison — une liaison
   lexicale creee par eval ne traverse pas la portee d'un module CommonJS. */
globalThis.store = store;
globalThis.edStatsCache = null;
const CODE = [
  ...CONSTANTES.map((c) => ligne('const ' + c).replace('const ' + c, 'globalThis.' + c)),
  declaration('let edDwellRel = null,'),
  declaration('let edStatsSale = false,'),
  ...FONCTIONS.map((f) => bloc('function ' + f + '(')),
].join('\n');
if (process.env.DUMP) { console.log(CODE); process.exit(0); }
(0, eval)(CODE);

console.log('');
console.log('  Fil d\'edits — ' + FONCTIONS.length + ' fonctions et ' + CONSTANTES.length
            + ' constantes extraites d\'index.html');

// ---- une video de laboratoire: on la fait avancer a la main ----
function video(duree) {
  return {
    duration: duree, currentTime: 0, paused: true,
    demarrer() { this.paused = false; edDwellMarche(this); },
    stopper() { this.paused = true; edDwellArret(); },
    jouer(secondes, vitesse) {
      const pas = 0.25 * (vitesse || 1);
      let reste = secondes;
      while (reste > 1e-9) {
        const bout = Math.min(pas, reste);
        this.currentTime += bout; reste -= bout;
        edDwellAvance(this, true);
      }
    },
    boucler() { this.currentTime = 0; edDwellAvance(this, true); },
    glisser(vers) { this.currentTime = vers; edDwellAvance(this, false); },
    sauter(vers) { this.currentTime = vers; edDwellAvance(this, true); },
  };
}
function passage(rel, duree, faire) {
  edDwellDebut({ rel });
  edStatDe(rel).d = duree;
  const v = video(duree); faire(v);
  edDwellFin();
  return edStats()[rel];
}
// un catalogue jouet: oeuvres nommees, tailles donnees
function catalogue(tailles) {
  const edits = [], stats = {};
  for (const a of Object.keys(tailles))
    for (let i = 0; i < tailles[a]; i++) edits.push({ rel: a + '/' + i, anime: a });
  return { edits, stats };
}
function rangsMoyens(edits, stats, ctx, N) {
  const r = {};
  for (let k = 0; k < (N || 1500); k++)
    fileEdits(edits, {}, Object.assign({ stats }, ctx)).list
      .forEach((e, i) => { r[e.rel] = (r[e.rel] || 0) + i; });
  for (const k in r) r[k] /= (N || 1500);
  return r;
}
const moyOeuvre = (rangs, edits, a) => {
  const l = edits.filter((e) => e.anime === a);
  return l.reduce((s, e) => s + rangs[e.rel], 0) / l.length;
};
const C12 = 0;   // rempli plus bas

console.log('');
console.log('=========== 1. la mesure est du media, pas du temps ===============');
MEM = {}; edStatsCache = null;
const a1 = passage('a1', 20, (v) => { v.demarrer(); v.jouer(16, 1); });
MEM = {}; edStatsCache = null;
const a2 = passage('a2', 20, (v) => { v.demarrer(); v.jouer(16, 2); });
verif('la vitesse de lecture ne change rien', pres(a1.tb, a2.tb, 0.01),
      '1x -> ' + a1.tb + ' s   |   2x -> ' + a2.tb + ' s');
MEM = {}; edStatsCache = null;
const a3 = passage('a3', 20, (v) => {
  avancer(4000); v.demarrer(); v.jouer(5, 1);
  v.stopper(); avancer(30000); v.demarrer(); v.jouer(3, 1);
});
verif('chargement et pause ne comptent pas', pres(a3.tb, 8, 0.01),
      'tb=' + a3.tb + ' s (8 attendu, 42 s ecoulees)');

console.log('');
console.log('=========== 2. le glissement ne fabrique rien ====================');
MEM = {}; edStatsCache = null;
const g1 = passage('b1', 20, (v) => {
  v.demarrer(); v.jouer(2, 1); v.glisser(18); v.glisser(3); v.jouer(1, 1);
});
verif('glisser ne gonfle ni la completion ni le temps', g1.c < 0.3 && g1.tb < 4,
      'c=' + g1.c + '   tb=' + g1.tb + ' s');
MEM = {}; edStatsCache = null;
verif('boucle depuis la fin = tour complet',
      pres(passage('b2', 20, (v) => { v.demarrer(); v.jouer(19.5, 1); v.boucler(); v.jouer(2, 1); }).c, 1));
MEM = {}; edStatsCache = null;
verif('retour depuis le milieu ne vaut pas un tour',
      passage('b3', 20, (v) => { v.demarrer(); v.jouer(8, 1); v.sauter(0); v.jouer(1, 1); }).c < 0.5);

console.log('');
console.log('=========== 3. j aime : sur l edit lui-meme ======================');
MEM = {}; edStatsCache = null;
const neutre = edAttrait(undefined);
const aimeSeul = edAttrait({ n: 0, t: 0, c: 0, d: 20, ko: 0, j: 1 });
verif('un edit aime et jamais mesure monte haut', aimeSeul > 0.8,
      'sans rien=' + neutre.toFixed(3) + '   aime=' + aimeSeul.toFixed(3));
const P20 = edPlafondPasse(20);
const rejete = { n: 5, t: 0.2 * P20, c: 0.2, d: 20, ko: 0 };
const rejeteAime = Object.assign({}, rejete, { j: 1 });
verif('la preuve tempere la declaration',
      edAttrait(rejeteAime) > edAttrait(rejete) + 0.2 && edAttrait(rejeteAime) < aimeSeul,
      'rejete=' + edAttrait(rejete).toFixed(3) + '   rejete mais aime='
      + edAttrait(rejeteAime).toFixed(3) + '   (< ' + aimeSeul.toFixed(3) + ')');
verif('attrait toujours dans [0,1] avec un like',
      edAttrait({ n: 40, t: 40 * P20, c: 40, d: 20, ko: 0, j: 1 }) <= 1
      && edAttrait({ n: 40, t: 0, c: 0, d: 20, ko: 0, j: 1 }) >= 0);

console.log('');
console.log('=========== 4. j aime : ca remonte toute la serie =================');
{
  const { edits, stats } = catalogue({ A: 20, B: 20 });
  const p12 = edPlafondPasse(12);
  for (const e of edits) stats[e.rel] = { n: 4, t: 4 * p12 * 0.5, c: 4 * 0.5, d: 12, ko: 0, j: 0 };
  const avantR = rangsMoyens(edits, stats, { commences: {} });
  const avant = moyOeuvre(avantR, edits, 'A');
  // on aime UN SEUL edit de A, et pas celui qu'on regarde
  stats['A/7'].j = Date.now();
  const apresR = rangsMoyens(edits, stats, { commences: {} });
  const apres = moyOeuvre(apresR, edits, 'A');
  verif('un like sur un edit avance toute sa serie', apres < avant - 0.5,
        'serie A : ' + avant.toFixed(1) + ' -> ' + apres.toFixed(1) + ' / 40');
  const autres = edits.filter((e) => e.anime === 'A' && e.rel !== 'A/7');
  const dAvant = autres.reduce((s, e) => s + avantR[e.rel], 0) / autres.length;
  const dApres = autres.reduce((s, e) => s + apresR[e.rel], 0) / autres.length;
  verif('les VOISINS de l edit aime avancent aussi', dApres < dAvant - 0.3,
        'les 19 autres : ' + dAvant.toFixed(1) + ' -> ' + dApres.toFixed(1));
  /* L'edit aime passe devant ses jumeaux, sans etre epingle en premier: avec
     un tirage pondere parmi vingt items identiques, il faudrait un rapport de
     poids de 19 contre 1 pour sortir premier une fois sur deux. Le like doit
     se voir, pas confisquer le fil. */
  verif('l edit aime passe devant ses jumeaux', apresR['A/7'] < dApres - 2,
        'A/7 au rang ' + apresR['A/7'].toFixed(1) + '   ses 19 jumeaux a '
        + dApres.toFixed(1) + ' / 40');
}

console.log('');
console.log('=========== 5. LE test que l ancienne archi echouait ==============');
{
  const { edits, stats } = catalogue({ AIME: 40, DETESTE: 40 });
  const p12 = edPlafondPasse(12);
  for (const e of edits) {
    const part = e.anime === 'AIME' ? 0.95 : 0.05;
    stats[e.rel] = { n: 6, t: 6 * p12 * part, c: 6 * part, d: 12, ko: 0, j: 0 };
  }
  const r = rangsMoyens(edits, stats, { commences: { AIME: 1, DETESTE: 0 } });
  const bon = moyOeuvre(r, edits, 'AIME'), mauvais = moyOeuvre(r, edits, 'DETESTE');
  verif('la qualite d une serie change enfin son rang', bon < mauvais - 5,
        'adoree=' + bon.toFixed(1) + '   detestee=' + mauvais.toFixed(1)
        + ' / 80   (l ancienne archi donnait 39,5 contre 39,5)');
  let tete = 0;
  for (let k = 0; k < 1000; k++) {
    const l = fileEdits(edits, {}, { stats, commences: { AIME: 1, DETESTE: 0 } }).list;
    for (let i = 0; i < 20; i++) if (l[i].anime === 'AIME') tete++;
  }
  verif('et sa part en tete de fil', tete / 20000 > 0.6,
        (tete / 200).toFixed(1) + ' % des 20 premieres places (50 % = aucun effet)');
}

console.log('');
console.log('=========== 6. une serie neuve passe devant une serie epuisee =====');
{
  const { edits, stats } = catalogue({ VUE: 40, NEUVE: 40 });
  const p12 = edPlafondPasse(12);
  for (const e of edits)
    stats[e.rel] = e.anime === 'VUE'
      ? { n: 8, t: 8 * p12 * 0.5, c: 8 * 0.5, d: 12, ko: 0, j: 0 }
      : { n: 0, t: 0, c: 0, d: 12, ko: 0, j: 0 };
  const r = rangsMoyens(edits, stats, { commences: {} });
  verif('la fraicheur d une serie la fait remonter',
        moyOeuvre(r, edits, 'NEUVE') < moyOeuvre(r, edits, 'VUE') - 5,
        'neuve=' + moyOeuvre(r, edits, 'NEUVE').toFixed(1)
        + '   epuisee=' + moyOeuvre(r, edits, 'VUE').toFixed(1) + ' / 80');
}

console.log('');
console.log('=========== 7. couverture : aucune serie entassee ni exclue =======');
{
  // le cas du fil : 70 edits d une serie sur 250, et on la pousse au maximum
  const { edits, stats } = catalogue(
    Object.assign({ MT: 70 }, ...Array.from({ length: 17 }, (_, i) => ({ ['S' + i]: i < 10 ? 11 : 10 }))));
  const p12 = edPlafondPasse(12);
  for (const e of edits)
    stats[e.rel] = e.anime === 'MT'
      ? { n: 3, t: 3 * p12, c: 3, d: 12, ko: 0, j: 1 }        // adoree ET aimee
      : { n: 3, t: 0, c: 0, d: 12, ko: 0, j: 0 };
  let suiteMax = 0, absente = 0, partFin = 0, partTete = 0;
  const N = 300;
  for (let k = 0; k < N; k++) {
    const l = fileEdits(edits, {}, { stats, commences: { MT: 1 } }).list;
    let c = 0;
    for (const e of l) { if (e.anime === 'MT') { c++; suiteMax = Math.max(suiteMax, c); } else c = 0; }
    const fin = l.slice(200);
    if (!fin.some((e) => e.anime === 'MT')) absente++;
    partFin += fin.filter((e) => e.anime === 'MT').length / fin.length;
    partTete += l.slice(0, 10).filter((e) => e.anime === 'MT').length / 10;
  }
  verif('jamais un bloc, meme poussee au maximum', suiteMax <= 6,
        'plus longue suite = ' + suiteMax + ' (70 edits sur 250, soit 28 %)');
  verif('jamais absente du dernier cinquieme', absente === 0,
        (partFin / N * 100).toFixed(0) + ' % du dernier cinquieme');
  verif('mais nettement plus dense en tete', partTete / N > 0.4,
        (partTete / N * 100).toFixed(0) + ' % des 10 premiers (28 % = aucun effet)');
}

console.log('');
console.log('=========== 8. gamma et priorite restent bornes ===================');
{
  let mn = 9, mx = -9;
  const p20 = edPlafondPasse(20);
  for (const attrait of [0, 0.5, 1]) for (const like of [0, 1]) for (const suivi of [0, 0.5, 1])
    for (const usure of [0, 1, 5]) {
      const lots = new Map([['z', [{ rel: 'z/0', anime: 'z' }]],
                            ['w', [{ rel: 'w/0', anime: 'w' }]]]);
      const st = { 'z/0': { n: 4, t: usure * p20, c: 4 * attrait, d: 20, ko: 0, j: like },
                   'w/0': { n: 4, t: 0, c: 0, d: 20, ko: 0, j: 0 } };
      for (const g of edGammas(lots, st, { z: suivi }).values()){
        mn = Math.min(mn, g); mx = Math.max(mx, g);
      }
    }
  verif('gamma dans [1-w, 1+w]', mn >= 1 - ED_WARP - 1e-9 && mx <= 1 + ED_WARP + 1e-9,
        mn.toFixed(3) + ' .. ' + mx.toFixed(3) + '   (borne ' + (1 - ED_WARP) + ' .. ' + (1 + ED_WARP) + ')');
  verif('qualite d oeuvre dans [0,1]',
        edQualiteOeuvre([{ rel: 'z/0', anime: 'z' }], {}) === 0.5
        && edFraicheurOeuvre([{ rel: 'z/0', anime: 'z' }], {}) === 1,
        'sans mesure : qualite 0,5 et fraicheur 1');
}

console.log('');
console.log('=========== 9. integrite de la file ==============================');
{
  const { edits, stats } = catalogue({ A: 29, B: 29, C: 29, D: 29, E: 29, F: 29, G: 29, H: 29 });
  const p12 = edPlafondPasse(12);
  edits.forEach((e, i) => {
    if (i % 4) stats[e.rel] = { n: 3, t: 3 * p12 * ((i * 37 % 100) / 100), c: 3 * ((i * 37 % 100) / 100), d: 12, ko: 0, j: i % 23 === 0 ? 1 : 0 };
  });
  let mauvaise = 0, doublon = 0;
  for (let k = 0; k < 400; k++) {
    const f = fileEdits(edits, {}, { stats, commences: { A: 1, B: 0.5 } });
    if (f.list.length !== edits.length) mauvaise++;
    if (new Set(f.list.map((e) => e.rel)).size !== edits.length) doublon++;
  }
  verif('toujours la file entiere, sans doublon', mauvaise === 0 && doublon === 0);
  verif('catalogue vide', fileEdits([], {}, {}).list.length === 0);
  verif('un seul edit', fileEdits([{ rel: 'x', anime: 'y' }], {}, {}).list.length === 1);
}

console.log('');
console.log('=========== 10. gradient de consommation dans une serie ===========');
{
  const { edits, stats } = catalogue({ A: 60 });
  const p12 = edPlafondPasse(12);
  edits.forEach((e, i) => {
    const tours = i < 15 ? 0 : i < 30 ? 0.3 : i < 45 ? 1 : 3;
    stats[e.rel] = { n: tours ? 3 : 0, t: tours * p12, c: tours ? 3 * 0.6 : 0, d: 12, ko: 0, j: 0 };
  });
  const r = rangsMoyens(edits, stats, { commences: {} }, 1200);
  const bande = (d, f) => edits.slice(d, f).reduce((s, e) => s + r[e.rel], 0) / (f - d);
  const m = [bande(0, 15), bande(15, 30), bande(30, 45), bande(45, 60)];
  ['jamais servi', 'peu consomme', 'consomme', 'epuise'].forEach((nom, i) =>
    console.log('    ' + nom.padEnd(14) + ' rang moyen ' + m[i].toFixed(1)));
  verif('monotone croissant', m.every((v, i) => i === 0 || v > m[i - 1]));
}

console.log('');
console.log('=========== 11. le reste, inchange ================================');
MEM = {}; edStatsCache = null;
const bonusDe = (st) => 1 + (ED_BONUS_NEUF - 1) * Math.exp(-edUsure(st) / ED_EXPO_DEMI);
edDwellEchec('k1'); edDwellEchec('k1'); edDwellEchec('k1');
verif('un illisible perd sa nouveaute et son attrait',
      bonusDe(edStats()['k1']) < 1.2 && edAttrait(edStats()['k1']) < 0.25,
      'bonus x' + bonusDe(edStats()['k1']).toFixed(2) + '   attrait ' + edAttrait(edStats()['k1']).toFixed(3));
MEM = {}; edStatsCache = null;
passage('k2', 20, (v) => { v.demarrer(); v.jouer(19.8, 1); });
const frais = edAttrait(edStats()['k2']);
avancer(90 * JOUR);
passage('k2', 20, (v) => { v.demarrer(); v.jouer(1, 1); });
verif('vieillissement : un rejet recent efface un vieil amour',
      edAttrait(edStats()['k2']) < frais - 0.2,
      frais.toFixed(3) + ' -> ' + edAttrait(edStats()['k2']).toFixed(3));
MEM = {}; edStatsCache = null;
passage('k3', 20, (v) => { v.demarrer(); v.jouer(10, 1); });
verif('rien n est ecrit pendant le defilement', MEM['edstats'] === undefined);
edStatsEcrire();
verif('tout est ecrit quand le fil se calme', MEM['edstats'] && MEM['edstats']['k3'] !== undefined);

console.log('');
console.log('==================================================================');
console.log('  ' + ok + ' reussis, ' + ko + ' echoues');
Date.now = VRAI_NOW;
process.exit(ko ? 1 : 0);
