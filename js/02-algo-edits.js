/* 02-algo-edits.js
 *
 * L'algorithme du fil d'edits: mesure d'attrait, priorite des series,
 * placement. Teste par outils/tests-algo-edits.js.
 *
 * Charge par index.html, dans l'ordre. Script classique et non module:
 * une page ouverte en file:// ne peut pas charger de module — le navigateur
 * y voit une requete inter-origines et la refuse. Tous ces fichiers
 * partagent donc la meme portee globale, exactement comme quand ils ne
 * faisaient qu'un. L'ordre compte: il est celui de la liste dans la page.
 */
"use strict";
/* ---------------------------------------------------------- edits ---- */
/* Un dossier « edits » juste sous une série ne contient pas des épisodes mais
   des montages verticaux. Ils sortent du fil des saisons pour vivre dans leur
   propre lecteur, sinon ils passeraient pour une saison de 116 épisodes. */
const EDIT_DIR = /^(edits?|amvs?)$/i;
function isEditsDir(name){ return EDIT_DIR.test(String(name).trim()); }
/** Les edits viennent d'un téléphone: « export_1785332900917 », « v12044gd… ».
    Ces noms-là ne disent rien à personne, on les numérote plutôt. */
function editTitle(base, n){
  const b = String(base);
  const s = b.replace(/[_.]+/g, ' ').trim();
  const muet = !/[a-zA-Z]{3}/.test(s)
            || /^(?=.*[0-9])[a-z0-9]{16,}$/i.test(b)
            || /^(export|screen ?recording|screen ?record|video|movie|vid|img|rpreplay|final|snaptik|ssstik|v\d)/i.test(s);
  return muet ? 'Edit ' + n : prettify(s);
}
/**
 * Un titre d'épisode qui n'en est pas un.
 *
 * IMDb appelle « Episode #4.15 » un épisode dont le titre n'a pas été annoncé.
 * C'est un bouche-trou, et il vaut moins que ce que la liste sait déjà écrire
 * toute seule: il n'apprend rien, et il affiche un numéro de saison qui n'est
 * pas forcément celui du dossier. On le traite donc comme une absence de
 * titre — la donnée reste dans le fichier, elle ne sert simplement pas de nom.
 */
const TITRE_BOUCHE_TROU = /^(?:episode|épisode)\s*#?\s*\d+(?:[.\-x]\d+)?$/i;
function titreUtile(t){
  const s = String(t == null ? '' : t).trim();
  return s && !TITRE_BOUCHE_TROU.test(s) ? s : '';
}
/**
 * Mélange où le hasard reste maître, mais penche.
 *
 * Clé = r^(1/poids), puis tri décroissant — le tirage sans remise d'Efraimidis
 * et Spirakis. Un edit deux fois plus lourd sort devant à peu près deux fois
 * plus souvent, sans que ce soit jamais garanti: deux ouvertures ne donnent
 * pas le même fil, et c'est ce qui fait vivre le fil. Un poids uniforme
 * redonne exactement un mélange équitable.
 */
function melangerPondere(liste, poids, tirage){
  const r = tirage || Math.random;
  return liste
    .map(e => ({ e, k: Math.pow(Math.max(1e-9, r()), 1 / Math.max(1e-6, poids(e))) }))
    .sort((a,b) => b.k - a.k)
    .map(x => x.e);
}
/**
 * L'attrait d'un edit: le temps passé devant, rapporté à sa longueur.
 * 0 = balayé aussitôt, 1 = resté jusqu'au bout et au-delà (le fil boucle, donc
 * rester c'est revoir). Renvoie null quand rien n'a été mesuré: un edit jamais
 * servi ne doit pas être puni de ne rien avoir à dire, l'appelant lui donnera
 * la valeur neutre.
 *
 * La longueur de référence est plafonnée: sur un montage de trois minutes,
 * rester trente secondes dit déjà qu'il a plu. Sans ce plafond les longs edits
 * seraient condamnés à un attrait faible, pour la seule raison qu'on ne les
 * finit pas.
 */
const ED_REF_TOUR = 1.25;   // a la mediane, rester ce nombre de longueurs = plein
const ED_DUREE_MED = 22;    // mediane mesuree du catalogue, en secondes
/* Ce qu'un seul passage peut rapporter, au maximum.
 *
 * Deux roles en un. Plafond d'abord: sans lui, un passage aberrant masque
 * tous les autres — un edit de 10 s laisse quatre minutes devant l'ecran,
 * l'onglet est reste ouvert sans personne, puis se fait zapper neuf fois en
 * 0,3 s; le total donnait un attrait plein la ou le comportement reel est un
 * rejet franc. Unite de mesure ensuite: c'est par lui qu'on divise, donc c'est
 * lui qui dit ce que « regarder en entier » veut dire pour cette duree-la.
 *
 * D'ou la loi de puissance plutot qu'un ecretage a 30 s. L'ecretage imposait
 * le meme temps cible a un edit de 30 s et a un de 110 s: le taux de
 * completion attendu s'effondrait de 1,25 a 0,34, avec un coude net a 30 s et
 * 29 % du catalogue du mauvais cote. Ici il decroit continument, et la valeur
 * a la mediane ne bouge pas — la calibration existante reste valable, seules
 * les queues changent.
 *
 * ED_ALPHA vaut 0,5 par defaut, faute de mesures. Il se determine: regresser
 * log(t/n) sur log(d) sur les edits mesures donne la pente empirique, et le
 * test d'acceptation est que la correlation de Spearman entre attrait et d
 * tombe a zero.
 */
const ED_ALPHA = .5;
function edPlafondPasse(d){
  const duree = d > 0 ? d : ED_DUREE_MED;
  return ED_REF_TOUR * ED_DUREE_MED * Math.pow(duree / ED_DUREE_MED, ED_ALPHA);
}
/* Demi-vie des compteurs, en jours. Sans elle, un edit adore il y a huit mois
   garde sa note pour l'eternite et la lassitude n'existe pas. */
const ED_DEMI_VIE = 45;
/* Lissage de l'attrait d'une oeuvre: m mesures fictives a 0,5. Une seule
   mesure reelle ne peut donc plus fixer la valeur de tout un dossier, et la
   spirale « bien notee -> plus servie -> plus mesuree -> mieux notee » se
   referme moins vite. */
const ED_LISSAGE = 3;
/* Meme lissage, au niveau de l'edit. Il vaut moins cher: deux passages
 * fictifs au neutre suffisent a empecher qu'un echantillon unique parle aussi
 * fort que trente. Son effet de bord est le plus utile de tout ce fichier:
 * l'attrait n'est plus jamais indefini, donc la bascule « inconnu -> mesure »
 * disparait. Elle valait un facteur 17 sur le poids pour 400 ms de regard,
 * dont seul un facteur 8 venait du bonus de nouveaute. */
const ED_LISSAGE_EDIT = 2;
/* La nouveaute se depense a proportion de ce qui a ete reellement consomme,
 * au lieu de tomber d'un coup au premier coup d'oeil. x = t / C, soit le
 * nombre de visionnages complets equivalents; x0 est la quantite qui use la
 * moitie de l'avance. Comme t et n vieillissent, x vieillit aussi: un edit vu
 * une fois il y a trois mois redevient presque neuf. Un booleen ne savait pas
 * faire ca. */
const ED_EXPO_DEMI = .5;
/* Temps brut d'un passage, ecrete tres haut et surtout sans rapport avec
 * ED_ALPHA. C'est la seule donnee qui permettra un jour d'estimer alpha au
 * lieu de le postuler: regresser log(tb/n) sur log(d) donne la pente reelle du
 * temps passe en fonction de la duree, et le test d'acceptation est que la
 * correlation de Spearman entre attrait et d tombe a zero.
 *
 * Sans elle, la regression serait circulaire: t est ecrete par C, donc par
 * alpha, et l'on mesurerait le parametre qu'on cherche. tb est amorti comme le
 * reste — un estimateur qui suit les gouts recents vaut mieux qu'une moyenne
 * sur l'eternite — mais jamais rogne par la loi de puissance. */
const ED_BRUT_MAX = 300;   // secondes
/* Le poids d'un edit dans la moyenne de son oeuvre: une mesure appuyee vaut
 * plus qu'un passage unique. Plafonne, sinon un seul edit tres regarde
 * deciderait a lui seul de ce que vaut tout le dossier. */
const ED_MESURE_MAX = 10;
/* Demi-vie du suivi d'une serie. « Commence » etait un booleen: un episode sur
 * soixante-quatorze, il y a deux ans, pesait autant qu'un visionnage en cours.
 * Tout le reste du systeme est amorti; ce terme-la ne l'etait pas. */
const ED_SUIVI_DEMI = 60;   // jours
/**
 * Ce que l'edit nous a reellement donne, en visionnages complets equivalents.
 * C'est la mesure du plaisir: elle n'entend que du temps de lecture.
 */
function edExposition(s){
  if (!s || !(s.t > 0)) return 0;
  return s.t / edPlafondPasse(s.d);
}
/**
 * Ce que l'edit nous a deja coute, qui n'est pas la meme chose.
 *
 * Les echecs comptent ici et seulement ici: un fichier qui ne se lit pas a
 * quand meme occupe une place, donc il a depense de la nouveaute — sinon il
 * resterait eternellement « jamais consomme », donc eternellement en tete,
 * puisque le chronometre ne tourne plus qu'a la lecture. Mais il n'a rien
 * donne, et les compter dans l'attrait le ferait passer pour aime.
 */
function edUsure(s){
  return edExposition(s) + ((s && s.ko) || 0);
}
/**
 * L'attrait d'un edit, entre 0 et 1. Deux mesures pesees, pas moyennees.
 *
 *   le temps      x/n : combien de fois l'edit a ete consomme, par passage.
 *   la completion c/n : jusqu'ou on est alle dedans, par passage.
 *
 * Elles se recoupent largement — depuis que le chronometre ne compte que du
 * media lu, un clip vu une fois donne presque le meme chiffre aux deux. Elles
 * ne divergent que sur la relecture en boucle, ou le temps depasse 1 quand la
 * completion y plafonne. Les moyenner a parts egales revenait donc a diviser
 * par deux le poids du seul cas ou la seconde apporte quelque chose: le temps
 * pese davantage.
 *
 * Les deux passent par le meme lissage, donc valent exactement le neutre sans
 * aucun passage: l'attrait n'est jamais indefini, et un coup d'oeil de 0,4 s
 * ne remplace pas « on ne sait rien » par « c'est nul ».
 */
function edAttrait(s){
  const n = s && s.n > 0 ? s.n : 0;
  const aime = (s && s.j) ? ED_JAIME_EDIT : 0;
  const socle = ED_LISSAGE_EDIT * ED_NEUTRE + aime;   // le like: des passages parfaits
  const sur   = n + ED_LISSAGE_EDIT + aime;
  const temps      = (edExposition(s) + socle) / sur;
  const completion = (((s && s.c) || 0) + socle) / sur;
  return Math.max(0, Math.min(1, ED_PART_TEMPS * temps + ED_PART_FIN * completion));
}
/** Le seul signal explicite du fil: tout le reste est deduit du comportement. */
function edAime(rel){
  const st = edStats();
  return !!(rel && st[rel] && st[rel].j);
}
/** Vrai quand l'edit a vraiment ete servi: seuls ceux-la parlent pour leur oeuvre. */
function edMesure(s){ return !!(s && s.n > 0); }
/**
 * A partir de quand un edit compte comme vu. Le fil doit tourner: si le seuil
 * est haut, on retombe toujours sur les memes en tete. Un coup d'oeil au debut
 * suffit donc — et sur un clip tres court, la moitie suffit.
 */
function edSeuilVu(duree){
  if (!(duree > 0)) return null;
  return Math.min(0.4, duree / 2);
}
/** Le temps qu'une diapo doit rester devant les yeux pour compter, quand la
 *  video ne demarre pas: fichier lourd, illisible, ou defilement arrete. */
const ED_ATTENTE_VU = 1500;
const ED_NEUTRE = .5;       // ce que vaut un edit dont on ne sait rien

/* --- j'aime ------------------------------------------------------------
 * Un like n'est pas un terme colle a cote: il entre comme observation dans
 * les estimateurs qui existent deja, ce qui lui donne son poids sans nouvelle
 * echelle a calibrer, et le laisse temperer par la suite. Un edit aime mais
 * rejete cinq fois redescend — un bonus plat ne saurait pas faire ca.
 *
 * Les likes ne vieillissent pas, contrairement a tout le reste: c'est une
 * declaration, pas une trace de comportement, et elle se retire d'un clic. */
const ED_JAIME_EDIT = 5;     // passages fictifs parfaits, sur l'edit aime
const ED_JAIME_SATURE = 2;   // nombre de likes qui portent l'essentiel de l'effet

/* --- etage oeuvre -------------------------------------------------------
 * Ce qui est commun a toute une serie ne peut pas decider de l'ordre de ses
 * edits entre eux — c'est la meme valeur pour tous. L'ancienne version
 * l'injectait pourtant dans la note de chaque edit, ou il s'annulait: deux
 * oeuvres identiques sauf la qualite sortaient au meme rang, a la troisieme
 * decimale pres. Ces signaux-la decident donc d'autre chose: a quelle densite
 * la serie apparait le long du fil.
 *
 * Les trois parts se somment a 1, donc la priorite reste dans [0,1]. */
const ED_PART_QUALITE   = .45;   // ce que valent ses edits, likes compris
const ED_PART_FRAICHEUR = .35;   // ce qu'il reste a decouvrir dedans
const ED_PART_SUIVI     = .20;   // la serie est-elle en cours de visionnage
/* Amplitude de la deformation du pas. Au-dela de 0,3 une grosse oeuvre
 * commence a s'agglutiner en tete: mesure sur le catalogue reel, 47 % des dix
 * premiers rangs a 0,3, mais 58 % a 0,5 et 78 % a 1,0. */
const ED_WARP = .3;
/* Plancher sur la dispersion des priorites: en dessous, les series se valent
 * et il n'y a rien a etaler. Sans lui, un ecart de trois millièmes serait
 * amplifie jusqu'aux bornes. */
const ED_DISPERSION_MIN = .06;
/* Un souffle, pas un vent: de quoi deranger les ex aequo et empecher deux
   edits de meme note de sortir toujours dans le meme ordre. */
const ED_BRUIT = .08;
/* La note se traduit en poids de tirage. Le bas n'est jamais zero — un edit
   detestable reste servable — et l'ecart du bas au haut vaut une quarantaine. */
const ED_POIDS_MIN = .12;
const ED_POIDS_MAX = 5;
/* Jamais vu: gros coup de pouce, mais fini. Avant, les non-vus formaient un
   bloc etanche servi en entier avant le reste; un edit adore ne pouvait donc
   jamais remonter tant qu'il restait un inconnu quelque part. La, il le peut,
   c'est juste rare. */
const ED_BONUS_NEUF = 12;
/* Une estimation fondee sur trois passages n'est pas une estimation fondee sur
 * trente, mais le lissage seul ne le dit nulle part: il rapproche du neutre
 * sans signaler que le doute subsiste. Ce terme remonte ce dont on est le
 * moins sur, pour aller le mesurer.
 *
 * Il ne fait pas double emploi avec la nouveaute: celle-ci se depense a la
 * consommation, celui-ci au nombre d'observations. Un edit regarde une fois
 * trente secondes a depense sa nouveaute et reste tres incertain. */
const ED_INCERTITUDE = .6;
/* Dans le signal propre a l'edit, le temps pese plus que la completion: la
 * completion plafonne a 1, le temps compte les relectures — le signal positif
 * le plus net du format. Une moyenne a parts egales ecrasait justement le seul
 * cas ou les deux divergent. */
const ED_PART_TEMPS = .6;
const ED_PART_FIN = .4;

/**
 * La note d'attrait d'un edit, entre 0 et 1.
 *
 * Ce qu'on ne sait pas vaut le neutre plutot que zero: un edit jamais servi
 * ne doit pas etre puni de n'avoir rien a dire. Le bruit est tire a chaque
 * appel, donc une fois par edit et par ouverture du fil.
 */
function edQualiteOeuvre(lot, stats){
  let somme = 0, poids = 0, likes = 0;
  for (const e of lot){
    const s = stats[e.rel];
    if (s && s.j) likes++;
    if (!edMesure(s)) continue;   // un edit jamais servi ne parle pas pour sa serie
    const w = Math.min(s.n, ED_MESURE_MAX);   // vingt passages valent mieux qu'un
    somme += edAttrait(s) * w;
    poids += w;
  }
  const mesure = (somme + ED_LISSAGE * ED_NEUTRE) / (poids + ED_LISSAGE);
  /* Les likes tirent la qualite vers le haut, sans se faire diluer.
     Les compter comme des observations de plus les noyait: trois mesures
     fictives contre quatre-vingts reelles, un like sur une grosse serie ne se
     voyait pas. Or un like n'est pas une observation de plus, c'est une
     declaration — il doit peser autant sur une serie de soixante-dix edits que
     sur une de trois. La fonction sature: le premier like compte beaucoup, le
     huitieme presque plus. */
  const appui = 1 - Math.exp(-likes / ED_JAIME_SATURE);
  return mesure + (1 - mesure) * appui;
}
/** Ce qu'il reste a decouvrir dans une serie: 1 si aucun de ses edits n'a servi. */
function edFraicheurOeuvre(lot, stats){
  if (!lot.length) return 1;
  let somme = 0;
  for (const e of lot) somme += Math.exp(-edUsure(stats[e.rel]) / ED_EXPO_DEMI);
  return somme / lot.length;
}
/** Ce qui donne envie de voir une serie maintenant, entre 0 et 1. */
function edPriorite(anime, lot, stats, suivis){
  return ED_PART_QUALITE   * edQualiteOeuvre(lot, stats)
       + ED_PART_FRAICHEUR * edFraicheurOeuvre(lot, stats)
       + ED_PART_SUIVI     * Math.max(0, Math.min(1, (suivis && suivis[anime]) || 0));
}
/**
 * La deformation du pas de chaque serie, entre 1-ED_WARP et 1+ED_WARP.
 *
 * Au-dessus de 1 ses edits se tassent vers l'avant du fil, en dessous ils
 * refluent vers l'arriere. Dans les deux cas la serie reste presente du premier
 * au dernier rang: la derniere cle vaut n quel que soit gamma, donc aucune
 * serie ne peut etre ni exclue de la fin ni entassee a la fin.
 *
 * La priorite est comparee aux autres series, pas a une echelle absolue. Une
 * echelle absolue ne s'etalait jamais: aucune serie ne peut avoir a la fois la
 * qualite maximale et la fraicheur maximale — mesurer suppose d'avoir
 * consomme — donc la priorite restait coincee au milieu et la deformation ne
 * servait a rien. Ramenee a la moyenne et divisee par la dispersion reelle,
 * elle se calibre toute seule, quel que soit le catalogue. Le plancher sur la
 * dispersion evite d'amplifier du bruit quand toutes les series se valent, et
 * la tangente hyperbolique borne le tout sans couper brutalement.
 */
function edGammas(lots, stats, suivis){
  const prios = new Map();
  for (const [anime, lot] of lots) prios.set(anime, edPriorite(anime, lot, stats, suivis));
  const vals = [...prios.values()];
  const moy = vals.reduce((s, v) => s + v, 0) / vals.length;
  const ecart = Math.sqrt(vals.reduce((s, v) => s + (v - moy) * (v - moy), 0) / vals.length);
  const echelle = Math.max(ED_DISPERSION_MIN, ecart);
  const out = new Map();
  for (const [anime, p] of prios) out.set(anime, 1 + ED_WARP * Math.tanh((p - moy) / echelle));
  return out;
}
/**
 * La file d'un fil d'edits, en deux etages.
 *
 * Chaque signal agit a un seul niveau, et c'est celui auquel il varie. Ce qui
 * change d'un edit a l'autre — son attrait, sa nouveaute, l'incertitude sur
 * lui — decide de son rang DANS sa serie. Ce qui est commun a toute la serie —
 * sa qualite moyenne, ses likes, ce qu'il y reste a decouvrir, le fait qu'on
 * la regarde en ce moment — decide d'OU la serie apparait et a quelle densite.
 *
 * L'ancienne version melangeait les deux dans une seule note, et les termes
 * d'oeuvre s'y annulaient: etant identiques pour tous les edits d'une serie,
 * ils ne pouvaient pas les departager, et le placement par pas effacait
 * ensuite l'ordre entre series. Deux oeuvres identiques sauf la qualite
 * sortaient au meme rang moyen, a la troisieme decimale pres.
 *
 * Le placement lui-meme est le tri: cle = n x ((rang + phase) / k) ^ gamma.
 * La phase est tiree par serie a chaque ouverture, sinon toutes demarreraient
 * au meme rang. La file entiere est servie, dans tous les cas.
 */
function fileEdits(edits, vus, ctx, tirage){
  const stats  = (ctx && ctx.stats) || {};
  const suivis = (ctx && ctx.commences) || {};
  const r = tirage || Math.random;
  const n = edits.length;
  if (!n) return { list: [], neufs: 0 };

  const lots = new Map();
  for (const e of edits){
    if (!lots.has(e.anime)) lots.set(e.anime, []);
    lots.get(e.anime).push(e);
  }

  /* Etage edit. La nouveaute s'use a proportion de ce qui a ete consomme, au
     lieu de tomber d'un coup au premier regard — « vu » ne sert plus qu'a
     compter les inconnus pour l'affichage. L'incertitude, elle, decroit avec le
     nombre d'observations: elle remonte ce dont on est le moins sur pour aller
     le mesurer, ce que la nouveaute ne fait pas — un edit regarde une fois
     trente secondes a depense sa nouveaute et reste tres incertain. */
  const poids = (e) => {
    const s = stats[e.rel];
    const nb = (s && s.n > 0) ? s.n : 0;
    return (ED_POIDS_MIN + (ED_POIDS_MAX - ED_POIDS_MIN) * edAttrait(s))
         * (1 + (ED_BONUS_NEUF - 1) * Math.exp(-edUsure(s) / ED_EXPO_DEMI))
         * (1 + ED_INCERTITUDE / Math.sqrt(1 + nb))
         * (1 + (r() * 2 - 1) * ED_BRUIT);
  };

  const gammas = edGammas(lots, stats, suivis);
  const places = [];
  for (const [anime, lot] of lots){
    const ordre = melangerPondere(lot, poids, tirage);
    const gamma = gammas.get(anime);
    const phase = r();
    for (let i = 0; i < ordre.length; i++)
      places.push({ e: ordre[i], cle: n * Math.pow((i + phase) / ordre.length, gamma) });
  }
  places.sort((a, b) => a.cle - b.cle);

  return { list: places.map(x => x.e),
           neufs: edits.reduce((c, e) => c + (vus && vus[e.rel] ? 0 : 1), 0) };
}

/**
 * Construit la bibliothèque à partir d'une liste plate de fichiers.
 * Chaque fichier: { path:[...dossiers, nom], size, lastModified, ref }
 */
function buildLibrary(files){
  const map = new Map();
  const cotes = [];                     // sous-titres et pistes audio a rattacher
  const get = (folder) => {
    if (!map.has(folder)){
      const q = splitTags(folder);
      map.set(folder, {
        key: folder, folder, title: prettify(q.name) || folder, quality: q.quality, lang: q.lang, subs: q.subs,
        seasons: new Map(), episodes: [], docs: [], images: [], edits: [],
        size: 0, added: 0, tsCount: 0
      });
    }
    return map.get(folder);
  };

  for (const f of files){
    const p = stripRoot(f.path);
    if (p.length < 1) continue;
    if (p.slice(0,-1).some(shouldSkipDir)) continue;
    const name = p[p.length-1];
    if (!name || name.startsWith('~$')) continue;
    const cote = coteOf(p, name, f);
    if (cote){ cotes.push(cote); continue; }   // complete un episode, n'en est pas un
    const kind = kindOf(name);
    if (!kind) continue;

    const dirs   = p.slice(0,-1);
    const folder = dirs.length ? dirs[0] : '(divers)';
    const a      = get(folder);
    const rel    = p.join('/');

    const dansEdits = dirs.length > 1 && isEditsDir(dirs[1]);
    if (kind === 'image'){
      a.images.push({ name, depth: Math.max(0, dirs.length - 1), ref: f.ref, rel,
                      dirs: dirs.slice(1),      // chemin sous la serie: scan/Chapitre 1
                      inEdits: dansEdits });    // une vignette d'edit n'est pas une jaquette
      continue;
    }
    if (kind === 'doc'){
      const b = baseOf(name);
      a.docs.push({
        name, rel, ext: extOf(name), size: f.size || 0, ref: f.ref,
        group: dirs.length > 1 ? dirs[1] : '',   // dossier juste sous la série: LN, Scans…
        vol: volumeNumber(b), title: prettify(b)
      });
      continue;
    }

    const base = baseOf(name);
    if (dansEdits){
      a.edits.push({ id: rel, rel, name, base, anime: folder,
                     ext: extOf(name), play: playModeOf(name),
                     size: f.size || 0, added: f.lastModified || 0, ref: f.ref });
      continue;                 // ni saison, ni taille de serie: c'est du bonus
    }

    const seasonKey = dirs.length > 1 ? dirs.slice(1).join('/') : '';
    const ep   = episodeNumber(base);
    const item = {
      id: rel, rel, name, anime: folder, seasonKey,
      ep, title: episodeTitle(base, folder, ep),
      ext: extOf(name), play: playModeOf(name),
      size: f.size || 0, added: f.lastModified || 0, ref: f.ref
    };
    if (!a.seasons.has(seasonKey)){
      a.seasons.set(seasonKey, { key: seasonKey, label: seasonLabel(seasonKey), rank: seasonRank(seasonKey), eps: [] });
    }
    a.seasons.get(seasonKey).eps.push(item);
    a.episodes.push(item);
    a.size += item.size;
    if (item.added > a.added) a.added = item.added;
    if (item.play === 'ts') a.tsCount++;
  }

  // serie|saison|nom de l'episode -> ce qui a ete depose a cote
  const parEpisode = new Map();
  for (const c of cotes){
    const cle = c.folder + '|' + c.seasonKey + '|' + c.base;
    if (!parEpisode.has(cle)) parEpisode.set(cle, []);
    parEpisode.get(cle).push(c);
  }

  const animes = [];
  for (const a of map.values()){
    a.scanGroups = groupScans(a.images.filter(i => !i.inEdits));
    // une serie peut n'etre faite que de scans: ni episode, ni document
    if (!a.episodes.length && !a.docs.length && !a.scanGroups.length && !a.edits.length) continue;
    a.seasonList = [...a.seasons.values()].sort(
      (x,y) => x.rank[0]-y.rank[0] || x.rank[1]-y.rank[1] || naturalCompare(x.key,y.key)
    );
    for (const s of a.seasonList){
      s.eps.sort((x,y) => (x.ep ?? 1e9) - (y.ep ?? 1e9) || naturalCompare(x.name,y.name));
    }
    a.episodes = a.seasonList.flatMap(s => s.eps);
    a.episodes.forEach((e,i) => { e.idx = i; });
    for (const e of a.episodes){
      const l = parEpisode.get(a.key + '|' + e.seasonKey + '|' + baseOf(e.name)) || [];
      e.subs = l.filter(c => c.genre === 'sub').sort((x,y) => naturalCompare(x.lang, y.lang));
      e.auds = l.filter(c => c.genre === 'aud').sort((x,y) => naturalCompare(x.lang, y.lang));
    }
    // le plus frais en haut du fil, comme sur un telephone
    a.edits.sort((x,y) => (y.added - x.added) || naturalCompare(x.name, y.name));
    a.edits.forEach((e,i) => { e.idx = i; e.title = editTitle(e.base, i + 1); });
    a.editSize = a.edits.reduce((n,e) => n + e.size, 0);
    a.art = pickArt(a.images.filter(i => !i.inChapter && !i.inEdits), a.folder);
    a.docs.sort((x,y) => naturalCompare(x.name,y.name));
    a.docGroups = groupDocs(a.docs);
    animes.push(a);
  }
  animes.sort((a,b) => naturalCompare(a.title, b.title));
  return animes;
}
function fmtSize(bytes){
  if (!bytes) return '—';
  const gb = bytes / 1073741824;
  if (gb >= 1) return gb.toFixed(gb >= 10 ? 0 : 1) + ' Go';
  return Math.round(bytes / 1048576) + ' Mo';
}
function fmtTime(sec){
  if (!isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60), m = Math.floor(sec / 60) % 60, h = Math.floor(sec / 3600);
  const p = (n) => String(n).padStart(2,'0');
  return h ? h + ':' + p(m) + ':' + p(s) : m + ':' + p(s);
}
function fmtCount(n, one, many){ return n + ' ' + (n > 1 ? many : one); }
/* ==================================================================== */
/* ==== PURE LOGIC END ====                                             */
/* ==================================================================== */