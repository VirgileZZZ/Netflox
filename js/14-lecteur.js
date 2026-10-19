/* 14-lecteur.js
 *
 * Le lecteur video: pistes, sous-titres, controles, generique, suivant.
 *
 * Charge par index.html, dans l'ordre. Script classique et non module:
 * une page ouverte en file:// ne peut pas charger de module — le navigateur
 * y voit une requete inter-origines et la refuse. Tous ces fichiers
 * partagent donc la meme portee globale, exactement comme quand ils ne
 * faisaient qu'un. L'ordre compte: il est celui de la liste dans la page.
 */
"use strict";
/* ====================================================== lecteur ====== */
const V = $('#vid'), P = $('#player'), A = $('#altAud');

/* ------------------------------------------- langues et sous-titres --
   Chrome n'expose pas les pistes audio d'un MP4: on ne peut pas y changer de
   langue. La video garde donc sa piste d'origine — la VO — et toute autre
   langue arrive dans un fichier a cote, joue par un <audio> qu'on recale sur
   l'image. Les sous-titres, eux, sont de vrais <track> en .vtt. */
const NOM_LANGUE = { fr:'Français', en:'Anglais', de:'Allemand', es:'Espagnol',
                     it:'Italien', ja:'Japonais', pt:'Portugais', nl:'Néerlandais',
                     ru:'Russe', ar:'Arabe', ko:'Coréen', zh:'Chinois',
                     pl:'Polonais', id:'Indonésien', ms:'Malais', th:'Thaï',
                     vi:'Vietnamien', tr:'Turc', hi:'Hindi', he:'Hébreu',
                     sv:'Suédois', da:'Danois', fi:'Finnois', no:'Norvégien',
                     cs:'Tchèque', hu:'Hongrois', ro:'Roumain', el:'Grec',
                     uk:'Ukrainien' };
function nomLangue(code, rang){
  const c = String(code || '').toLowerCase();
  const n = NOM_LANGUE[c.slice(0,2)] || (c ? c.toUpperCase() : 'Piste');
  return rang > 1 ? n + ' (' + rang + ')' : n;
}
/** Deuxieme piste de meme langue: « Français (2) » plutot que deux « Français ». */
function numeroter(liste){
  const vus = {};
  return liste.map(c => {
    const b = String(c.lang).slice(0,2);
    vus[b] = (vus[b] || 0) + 1;
    return { c, label: nomLangue(c.lang, vus[b]) };
  });
}

let altRevoke = null, altLang = null, altT = null, subUrls = [];
/** L'element qui porte reellement le son: la piste a cote si elle joue. */
function sortie(){ return altLang ? A : V; }

function altStop(){
  if (altT){ clearInterval(altT); altT = null; }
  try { A.pause(); } catch(e){}
  A.removeAttribute('src');
  try { A.load(); } catch(e){}
  if (altRevoke){ try { altRevoke(); } catch(e){} altRevoke = null; }
  altLang = null;
  V.muted = false;
}
/** Recale la piste sur l'image. Au-dela d'un quart de seconde, on l'entend. */
function altCaler(force){
  if (!altLang || !A.src) return;
  if (force || Math.abs(A.currentTime - V.currentTime) > 0.25){
    try { A.currentTime = V.currentTime; } catch(e){}
  }
}
async function altChoisir(cote){
  const vol = sortie().volume, muet = sortie().muted;
  altStop();
  if (cote){
    const s = await srcOf(cote);
    if (!s) return toast('Piste audio introuvable', 'bad');
    altRevoke = s.revoke; altLang = cote.lang;
    A.src = s.url; A.load();
    A.playbackRate = V.playbackRate;
    V.muted = true;                       // la video ne fournit plus que l'image
    altCaler(true);
    if (!V.paused) A.play().catch(() => {});
    altT = setInterval(() => altCaler(false), 1000);
  }
  sortie().volume = vol;
  sortie().muted = muet;
  paintVol();
  $('#pAudio').classList.toggle('marque', !!altLang);
  buildAudMenu();
}
V.addEventListener('play',       () => { if (altLang){ altCaler(true); A.play().catch(()=>{}); } });
V.addEventListener('pause',      () => { if (altLang) A.pause(); });
V.addEventListener('seeked',     () => altCaler(true));
V.addEventListener('ratechange', () => { if (altLang) A.playbackRate = V.playbackRate; });
V.addEventListener('waiting',    () => { if (altLang) A.pause(); });
V.addEventListener('playing',    () => { if (altLang){ altCaler(true); A.play().catch(()=>{}); } });

function buildAudMenu(){
  const e = S.current;
  const pistes = numeroter((e && e.auds) || []);
  $('#audMenu').innerHTML =
    '<h4>Langue</h4>' +
    '<button data-aud="-1"' + (altLang ? '' : ' class="on"') + '>Version originale</button>' +
    pistes.map((p,i) => '<button data-aud="' + i + '"' +
      (altLang === p.c.lang ? ' class="on"' : '') + '>' + esc(p.label) + '</button>').join('');
  $$('[data-aud]', $('#audMenu')).forEach(b => b.addEventListener('click', () => {
    const i = +b.dataset.aud;
    altChoisir(i < 0 ? null : pistes[i].c);
  }));
}
function buildSubMenu(){
  const pistes = [...V.textTracks];
  const actif = pistes.findIndex(t => t.mode !== 'disabled');
  $('#subMenu').innerHTML =
    '<h4>Sous-titres</h4>' +
    '<button data-sub="-1"' + (actif < 0 ? ' class="on"' : '') + '>Aucun</button>' +
    pistes.map((t,i) => '<button data-sub="' + i + '"' +
      (i === actif ? ' class="on"' : '') + '>' + esc(t.label || nomLangue(t.language)) +
      '</button>').join('') +
    // les sous-titres se deplacent au doigt: le dire, et offrir un retour en bas sans double-clic
    (pistes.length ? '<div class="msep"></div>' + (store.get('subpos', null)
      ? '<button data-subpos="">Remettre les sous-titres en bas</button>'
      : '<p class="mnote">Astuce : glisse les sous-titres pour les déplacer</p>') : '');
  const bas = $('#subMenu [data-subpos]');
  if (bas) bas.addEventListener('click', () => { store.set('subpos', null); placerSousTitres(posDefaut()); buildSubMenu(); });
  $$('[data-sub]', $('#subMenu')).forEach(b => b.addEventListener('click', () => {

    const i = +b.dataset.sub;
    stVoulue = i < 0 ? '' : (pistes[i].language || '');
    pistes.forEach((t,k) => { t.mode = k === i ? modeAllume() : 'disabled'; });
    suivrePiste(i < 0 ? null : pistes[i]);
    store.set('sublang', stVoulue);
    $('#pSubs').classList.toggle('marque', i >= 0);
    buildSubMenu();
  }));
}
/* La touche C: eteint les sous-titres, ou rallume ceux d'avant — a defaut le
   francais complet de l'episode, a defaut la premiere piste. */
let stFrancais = '', stAvant = '';
function basculerSousTitres(){
  const pistes = [...V.textTracks];
  if (!pistes.length){ osd('Pas de sous-titres pour cet épisode'); return; }
  const existe = (l) => l && pistes.some(t => t.language === l);
  if (existe(stVoulue)){ stAvant = stVoulue; stVoulue = ''; }
  else stVoulue = [stAvant, stFrancais, pistes[0].language].find(existe) || '';
  store.set('sublang', stVoulue);
  appliquerSousTitres();
  const p = pistes.find(t => stVoulue && t.language === stVoulue);
  osd(p ? 'Sous-titres : ' + (p.label || nomLangue(p.language)) : 'Sous-titres désactivés');
  if (!$('#subMenu').hidden) buildSubMenu();
}
/* La langue de sous-titres a afficher pour l'episode en cours. */
let stVoulue = '';
/**
 * Regle l'etat de TOUTES les pistes, pas seulement celle qu'on veut.
 *
 * Chrome active de lui-meme la premiere piste ajoutee a la video. Ne faire
 * qu'allumer la langue retenue laissait donc deux sous-titres a l'ecran — la
 * premiere piste, l'arabe par ordre alphabetique, et le francais — et sans
 * langue retenue, l'arabe seul. Chrome pouvant repasser apres nous, on
 * reapplique aussi quand la video charge et quand elle demarre.
 */
function appliquerSousTitres(){
  const pistes = [...V.textTracks];
  const i = stVoulue ? pistes.findIndex(t => t.language === stVoulue) : -1;
  pistes.forEach((t,k) => {
    const m = k === i ? modeAllume() : 'disabled';
    if (t.mode !== m) t.mode = m;
  });
  suivrePiste(i >= 0 ? pistes[i] : null);
  $('#pSubs').classList.toggle('marque', i >= 0);
}

/* ------------------------------------------ affichage des repliques --
   Chrome dessine les sous-titres sur un pave noir qu'on ne peut ni enlever
   proprement ni deplacer. La piste choisie reste donc en mode « hidden » —
   elle charge et suit le temps, sans rien dessiner — et c'est #pCues qui
   affiche ses repliques. Seule exception, le mini-lecteur: notre calque n'y
   va pas, Chrome reprend la main. */
const CUES = $('#pCues');
let pisteAffichee = null;
function modeAllume(){ return document.pictureInPictureElement === V ? 'showing' : 'hidden'; }
function rendreReplique(){
  CUES.textContent = '';
  const t = pisteAffichee;
  if (!t || !t.activeCues) return;
  for (const c of t.activeCues){
    const l = document.createElement('div');
    l.appendChild(c.getCueAsHTML ? c.getCueAsHTML() : document.createTextNode(c.text));
    CUES.appendChild(l);
  }
}
function suivrePiste(t){
  if (pisteAffichee !== t){
    if (pisteAffichee) pisteAffichee.removeEventListener('cuechange', rendreReplique);
    pisteAffichee = t;
    if (t) t.addEventListener('cuechange', rendreReplique);
  }
  rendreReplique();
}
V.addEventListener('enterpictureinpicture', appliquerSousTitres);
V.addEventListener('leavepictureinpicture', appliquerSousTitres);

/* La place des sous-titres: glisser pour les deplacer, double-clic pour les
   remettre en bas. Retenue d'un episode et d'une visite a l'autre, en
   fraction de l'ecran pour tenir en plein ecran comme en fenetre. */
/* Sur telephone — debout, la barre tient sur deux lignes; couche, l'image est
   basse — on part un peu plus haut. Calcule a chaque fois: le telephone tourne. */
function posDefaut(){
  return { x:.5, y: matchMedia('(max-width:560px), (max-height:500px)').matches ? .78 : .88 };
}
function placerSousTitres(pos){
  CUES.style.left = (pos.x * 100) + '%';
  CUES.style.top  = (pos.y * 100) + '%';
}
placerSousTitres(store.get('subpos', null) || posDefaut());
matchMedia('(orientation:landscape)').addEventListener('change', () => {
  if (!store.get('subpos', null)) placerSousTitres(posDefaut());
});
(() => {
  let prise = null;
  CUES.addEventListener('pointerdown', (ev) => {
    if (ev.button) return;
    const r = P.getBoundingClientRect(), b = CUES.getBoundingClientRect();
    // l'ecart entre le doigt et le point d'ancrage (bas, milieu), garde pendant le geste
    prise = { r, dx: (b.left + b.width / 2) - ev.clientX, dy: b.bottom - ev.clientY };
    CUES.setPointerCapture(ev.pointerId);
    CUES.classList.add('prise');
    ev.preventDefault();
  });
  CUES.addEventListener('pointermove', (ev) => {
    if (!prise) return;
    const { r, dx, dy } = prise;
    const x = Math.min(.95, Math.max(.05, (ev.clientX + dx - r.left) / r.width));
    const y = Math.min(.98, Math.max(.08, (ev.clientY + dy - r.top) / r.height));
    prise.pos = { x, y };
    placerSousTitres(prise.pos);
    poke();
  });
  const lacher = () => {
    if (!prise) return;
    if (prise.pos) store.set('subpos', prise.pos);
    prise = null;
    CUES.classList.remove('prise');
  };
  CUES.addEventListener('pointerup', lacher);
  CUES.addEventListener('pointercancel', lacher);
  CUES.addEventListener('dblclick', (ev) => {
    ev.stopPropagation();
    store.set('subpos', null);
    placerSousTitres(posDefaut());
  });
})();
/** Les <track> d'un episode, avec la langue retenue la derniere fois. */
async function poserSousTitres(ep){
  /* Eteindre avant de retirer: Chrome garde a l'ecran la derniere replique
     d'une piste qu'on enleve allumee, et l'episode suivant demarrait avec. */
  [...V.textTracks].forEach(t => { t.mode = 'disabled'; });
  suivrePiste(null);
  $$('track', V).forEach(t => t.remove());
  subUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch(e){} });
  subUrls = [];
  /* Rien de retenu dans le navigateur (null): le francais. Une chaine vide,
     elle, veut dire qu'on a choisi « Aucun », et on la respecte.
     Quand il y a plusieurs pistes francaises, la plus lourde: l'autre ne porte
     que les passages forces (quelques lignes). Selon les episodes de Game of
     Thrones, la complete s'appelle « fr » ou « fr2 », d'ou la taille plutot
     que le nom. */
  const retenue = store.get('sublang', null);
  let francais = '', poids = -1, nb = 0;
  stVoulue = retenue !== null ? retenue : '';
  for (const { c, label } of numeroter(ep.subs || [])){
    /* Un .vtt sert par le reseau (bibliotheque partagee) se lit a
       son adresse: meme origine que la page, <track> l'accepte sans
       CORS. fileOf() n'ouvre que des fichiers locaux — sans ce
       detour, aucune piste n'arrivait en partage, et le bouton
       sous-titres restait eteint pour les series dont la video
       n'embarque pas de piste. */
    let url, taille = c.size || 0;
    if (c.ref && c.ref.kind === 'url'){
      url = c.ref.url;
    } else {
      const f = await fileOf(c);
      if (!f) continue;
      url = URL.createObjectURL(f);
      subUrls.push(url);
      taille = f.size;
    }
    if (/^fr/i.test(c.lang) && taille > poids){ francais = c.lang; poids = taille; }
    const t = document.createElement('track');
    t.kind = 'subtitles'; t.label = label; t.srclang = c.lang; t.src = url;
    V.appendChild(t);
    nb++;
  }
  if (retenue === null) stVoulue = francais;
  stFrancais = francais;
  $('#pSubs').hidden = !nb;
  appliquerSousTitres();
}
/* Chrome reprend la main apres nous — a l'ajout des pistes, puis de nouveau au
   V.load() qui suit — et rallume la premiere. Plutot que de deviner quand,
   on le laisse faire et on corrige a chaque changement. Le menu met stVoulue
   a jour avant de toucher aux pistes: son choix, lui, n'est pas annule. */
V.textTracks.addEventListener('change', appliquerSousTitres);
V.textTracks.addEventListener('addtrack', () => setTimeout(appliquerSousTitres, 0));
let hideT, saveT, nextT, nextCount = 0;
/* L'episode dont on a refuse la suite (« Annuler » sur la carte): la carte ne
   revient plus pour lui — elle reapparaissait au timeupdate suivant — et la
   fin de l'episode ne lance plus le suivant toute seule. N ou le bouton
   « episode suivant » le lancent toujours. Oublie a l'ouverture d'un episode. */
let nextRefuse = null;

async function openPlayer(ep){
  const a = S.byKey.get(ep.anime);
  S.current = ep;
  majSessionMedia(ep);

  S.queue = a ? a.episodes : [ep];
  P.hidden = false;
  document.body.style.overflow = 'hidden';
  $('#pErr').hidden = true;
  $('#pTitle').textContent = (a ? a.title : ep.anime);
  $('#pSub').textContent = [seasonLabel(ep.seasonKey), ep.title, fmtSize(ep.size)].filter(Boolean).join(' · ');
  nextRefuse = null;
  hideNext();
  hideSkip();
  segInside = { intro:false, fin:false };
  MENUS.forEach(k => { $(k).hidden = true; });
  showCenter(false);

  cleanupSource();
  altStop();
  $('#pAudio').hidden = !(ep.auds && ep.auds.length);
  $('#pAudio').classList.remove('marque');
  await poserSousTitres(ep);
  const src = await srcOf(ep);
  if (!src) return playerError('Fichier introuvable', 'Le fichier a peut-être été déplacé. Relance un scan du dossier.');
  S.srcUrl = src.url;
  S.srcRevoke = src.revoke;

  if (ep.play === 'ts'){ await playTS(src.url, ep); }
  else {
    const direct = urlDirecte(ep);
    S.replier = direct ? src.url : null;
    if (direct) S.srcUrl = direct;
    V.src = direct || src.url;
    V.load();
  }
  S.switching = false;

  const p = getProgress(ep);
  // reprendre ou l'on s'etait arrete, meme sur un episode deja vu; arrive au
  // bout (les 15 dernieres secondes), on repart du debut
  const seekTo = p && p.t > 20 && (!p.d || p.t < p.d - 15) ? p.t : 0;

  const start = () => {
    if (S.current !== ep) return;                 // un autre épisode a été lancé entre-temps
    if (seekTo) { try { V.currentTime = seekTo; } catch(e){} }
    V.play().catch(() => showCenter(true));
  };
  if (V.readyState >= 1) start();
  else V.addEventListener('loadedmetadata', start, { once:true });

  V.volume = store.get('vol', 1);
  A.volume = V.volume;
  V.playbackRate = store.get('rate', 1);
  $('#pRate').textContent = (V.playbackRate + '').replace('.',',') + '×';
  $('#pVol').value = V.volume;
  paintVol();
  poke();
}

function cleanupSource(){
  altStop();
  dropPeek();
  S.switching = true;                 // évite un faux « lecture impossible » pendant le changement
  if (S.tsPlayer){ try { S.tsPlayer.destroy(); } catch(e){} S.tsPlayer = null; }
  try { V.pause(); } catch(e){}
  V.removeAttribute('src');
  try { V.load(); } catch(e){}
  if (S.srcRevoke){ try { S.srcRevoke(); } catch(e){} S.srcRevoke = null; }
  S.srcUrl = null; S.replier = null;
  P.classList.remove('jouant');
}

function closePlayer(){
  finirEpisode(false);

  flushProgress();
  cleanupSource();
  P.hidden = true;
  document.body.style.overflow = '';
  clearTimeout(nextT);
  if (document.fullscreenElement) document.exitFullscreen().catch(()=>{});
  render();
}

/* ---- lecture des .ts via mpegts.js (chargé seulement si nécessaire) - */
const TS_SRC = [
  'assets/mpegts.js',
  'https://cdn.jsdelivr.net/npm/mpegts.js@1.8.0/dist/mpegts.js',
  'https://unpkg.com/mpegts.js@1.8.0/dist/mpegts.js'
];
function loadScript(src){
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => res(true); s.onerror = () => rej(new Error(src));
    document.head.appendChild(s);
  });
}
async function ensureTS(){
  if (S.tsReady !== null) return S.tsReady;
  for (const src of TS_SRC){
    try {
      await loadScript(src);
      if (window.mpegts && window.mpegts.isSupported()){ S.tsReady = true; return true; }
    } catch(e){ /* source suivante */ }
  }
  S.tsReady = false;
  return false;
}
async function playTS(url, ep){
  $('#pErr').hidden = false;
  $('#pErrBox').innerHTML = '<div class="spinner"></div><h3>Préparation du flux MPEG-TS…</h3>' +
    '<p>Les fichiers .ts ne sont pas lus nativement par le navigateur : on charge le décodeur.</p>';
  const ok = await ensureTS();
  if (!ok) return tsFallback(ep);
  if (S.current !== ep) return;
  try {
    const player = window.mpegts.createPlayer(
      { type:'mpegts', isLive:false, url },
      { enableWorker:false, lazyLoad:false, autoCleanupSourceBuffer:true, fixAudioTimestampGap:true }
    );
    S.tsPlayer = player;
    player.on(window.mpegts.Events.ERROR, () => tsFallback(ep));
    player.attachMediaElement(V);
    player.load();
    $('#pErr').hidden = true;
  } catch(e){
    tsFallback(ep);
  }
}
function tsFallback(ep){
  const name = ep.rel.split('/').pop();
  const cmd = 'ffmpeg -i "' + ep.rel + '" -c copy "' + baseOf(name) + '.mp4"';
  $('#pErr').hidden = false;
  $('#pErrBox').innerHTML =
    '<h3>Ce .ts ne peut pas être lu ici</h3>' +
    '<p>Le MPEG-TS n\'est pas décodé nativement par les navigateurs, et le décodeur d\'appoint n\'a pas pu être chargé (pas de connexion ?).<br>' +
    'Convertis-le en .mp4 — c\'est une simple recopie, sans perte de qualité ni ré-encodage :</p>' +
    '<div class="cmd"><code>' + esc(cmd) + '</code><button class="btn btn-ghost" id="cpCmd">Copier</button></div>' +
    '<p style="font-size:.85rem">Il se lit aussi tel quel dans VLC ou MPV.</p>' +
    '<button class="btn btn-ghost" id="errBack">Retour</button>';
  const cp = $('#cpCmd');
  cp && cp.addEventListener('click', () => {
    navigator.clipboard.writeText(cmd).then(() => toast('Commande copiée', 'ok'), () => toast('Copie impossible', 'bad'));
  });
  const bk = $('#errBack');
  bk && bk.addEventListener('click', closePlayer);
}
function playerError(title, msg){
  $('#pErr').hidden = false;
  $('#pErrBox').innerHTML = '<h3>' + esc(title) + '</h3><p>' + esc(msg) + '</p>' +
    '<button class="btn btn-ghost" id="errBack">Retour</button>';
  $('#errBack').addEventListener('click', closePlayer);
}

/* --------------------------------------------------- contrôles ------ */
const ICON_PLAY  = '<svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor"><path d="m6 4 14 8-14 8z"/></svg>';
const ICON_PAUSE = '<svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';
const ICON_BIG   = '<svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor"><path d="m6 4 14 8-14 8z"/></svg>';
const ICON_VOL   = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 8.5a4.5 4.5 0 0 1 0 7"/></svg>';
const ICON_MUTE  = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="m17 9 5 6m0-6-5 6"/></svg>';
$('#pBig').innerHTML = ICON_BIG;
$('#pPlay').innerHTML = ICON_PLAY;

function showCenter(on){ $('#pBig').classList.toggle('show', !!on); }
function poke(){
  P.classList.remove('hide-ui');
  clearTimeout(hideT);
  hideT = setTimeout(() => { if (!V.paused && $('#pErr').hidden) P.classList.add('hide-ui'); }, 2800);
}
/* Jamais les commandes du navigateur par-dessus les notres: Chrome les offre
   au clic droit sur la video (« Afficher les commandes »), une extension peut
   les poser. Un ami voyait ainsi deux barres de lecture superposees. Le menu
   du navigateur ne s'ouvre plus sur la video, et l'attribut est retire des
   qu'il apparait — sur le lecteur comme dans le fil d'edits. */
function sansCommandesNatives(v){
  if (!v || v.dataset.sansNatif) return;
  v.dataset.sansNatif = '1';
  v.controls = false;
  v.addEventListener('contextmenu', (ev) => ev.preventDefault());
  new MutationObserver(() => { if (v.controls) v.controls = false; })
    .observe(v, { attributes: true, attributeFilter: ['controls'] });
}
sansCommandesNatives(V);
new MutationObserver(() => document.querySelectorAll('#edRail video').forEach(sansCommandesNatives))
  .observe(document.getElementById('edRail'), { childList: true, subtree: true });
P.addEventListener('mousemove', poke);

/* Au doigt, les commandes cachees ne se touchent pas a l'aveugle: le premier
   tap les fait seulement revenir. Avant, le tap reveillait l'interface (le
   mousemove emule arrive avant le clic) puis touchait le bouton dessous — la
   croix fermait le lecteur, « suivant » changeait d'episode. Et toucher
   l'image quand l'interface est cachee la montre, comme sur YouTube, au lieu
   de mettre en pause sans rien voir. */
/* Au doigt, sur l'image, les gestes d'une appli video:
 *  - un tap: pause / lecture (ou, interface cachee, la faire revenir);
 *  - un double-tap sur le tiers gauche ou droit: -10 / +10 s, et chaque tap
 *    de plus dans la foulee ajoute 10 s, comme sur YouTube;
 *  - un double-tap au centre: plein ecran.
 * Un tap simple attend un quart de seconde, le temps de savoir s'il est double.
 * A la souris rien ne change: clic = pause, double-clic = plein ecran. */
let toucherReveil = 0, dernierType = 'mouse';
let tapAttente = null, dernierTap = { t: 0, zone: null }, serieSaut = null;
P.addEventListener('pointerdown', (ev) => {
  dernierType = ev.pointerType || 'mouse';
  if (dernierType !== 'mouse' && P.classList.contains('hide-ui')) toucherReveil = Date.now();
}, true);
function zoneTap(x){
  const r = P.getBoundingClientRect();
  return x < r.left + r.width / 3 ? -1 : x > r.right - r.width / 3 ? 1 : 0;
}
P.addEventListener('click', (ev) => {
  if (geste.consomme){ geste.consomme = false; ev.stopPropagation(); ev.preventDefault(); return; }
  if (dernierType === 'mouse') return;
  const cache = Date.now() - toucherReveil < 700;
  const surImage = ev.target === V || ev.target === P;
  if (!surImage){
    // une commande cachee touchee a l'aveugle: on montre l'interface, sans l'activer
    if (cache && !ev.target.closest('.pcues')){ toucherReveil = 0; ev.stopPropagation(); ev.preventDefault(); poke(); }
    return;
  }
  ev.stopPropagation(); ev.preventDefault();
  const zone = zoneTap(ev.clientX), maintenant = Date.now();
  if (zone && serieSaut && serieSaut.zone === zone && maintenant - serieSaut.t < 700){
    serieSaut.t = maintenant; skip(zone * 10); return;
  }
  if (tapAttente && maintenant - dernierTap.t < 300 && zone === dernierTap.zone){
    clearTimeout(tapAttente); tapAttente = null;
    if (zone){ serieSaut = { zone, t: maintenant }; skip(zone * 10); } else toggleFull();
    return;
  }
  dernierTap = { t: maintenant, zone };
  toucherReveil = 0;
  clearTimeout(tapAttente);
  tapAttente = setTimeout(() => {
    tapAttente = null;
    if (cache) poke(); else { V.paused ? V.play() : V.pause(); poke(); }
  }, 280);
}, true);
P.addEventListener('click', (ev) => {
  if (ev.target === V || ev.target === P){ V.paused ? V.play() : V.pause(); poke(); }
});

P.addEventListener('dblclick', (ev) => {
  if (dernierType !== 'mouse') return;          // au doigt, le double-tap est gere plus haut
  if (ev.target === V || ev.target === P) toggleFull();
});

/* Deux gestes de plus sur l'image, comme dans les applis video:
 *  - rester appuye: lecture en 2x tant que le doigt (ou le bouton) reste pose;
 *  - au doigt, glisser de haut en bas: le volume. Pas sur iPhone, ou une page
 *    ne regle pas le volume: seuls les boutons du telephone le font.
 * Le clic qui suit le geste est avale: lacher l'appui long ne met pas en pause. */
const geste = { id: null, x: 0, y: 0, t: null, rapide: false, vol: null, consomme: false, avant: 1 };
const VOLUME_REGLABLE = (() => { const a = document.createElement('audio'); try { a.volume = .5; } catch(e){} return a.volume === .5; })();
P.addEventListener('pointerdown', (ev) => {
  if (ev.button || (ev.target !== V && ev.target !== P)) return;
  clearTimeout(geste.t);
  Object.assign(geste, { id: ev.pointerId, x: ev.clientX, y: ev.clientY, rapide: false, vol: null, consomme: false });
  geste.t = setTimeout(() => {
    geste.t = null;
    if (V.paused || geste.id === null) return;
    geste.rapide = true; geste.consomme = true; geste.avant = V.playbackRate;
    V.playbackRate = 2;
    osd('2× ▸▸', true);
  }, 450);
});
P.addEventListener('pointermove', (ev) => {
  if (ev.pointerId !== geste.id || geste.rapide) return;
  if (geste.vol === null){
    const dx = ev.clientX - geste.x, dy = ev.clientY - geste.y;
    if (Math.hypot(dx, dy) < 14) return;
    clearTimeout(geste.t); geste.t = null;
    // la souris, un iPhone, ou un balayage de cote: ce n'est pas le volume
    if (ev.pointerType === 'mouse' || !VOLUME_REGLABLE || Math.abs(dy) < Math.abs(dx) * 1.5){ geste.id = null; return; }
    const o = sortie();
    geste.vol = o.muted ? 0 : o.volume; geste.y = ev.clientY; geste.consomme = true;
  }
  const o = sortie();
  o.volume = Math.max(0, Math.min(1, geste.vol - (ev.clientY - geste.y) / (P.clientHeight * .6)));
  o.muted = o.volume === 0;
  $('#pVol').value = o.volume; paintVol();
  osd('Volume ' + Math.round(o.volume * 100) + ' %');
});
function finGeste(ev){
  if (ev.pointerId !== geste.id) return;
  clearTimeout(geste.t); geste.t = null; geste.id = null;
  if (geste.rapide){ geste.rapide = false; V.playbackRate = geste.avant; osd(''); }
  if (geste.vol !== null){ store.set('vol', sortie().volume); geste.vol = null; }
}
P.addEventListener('pointerup', finGeste);
P.addEventListener('pointercancel', finGeste);

/* Ce qu'un raccourci ou un geste vient de changer — vitesse, volume,
   sous-titres — s'affiche un instant au milieu de l'image. */
let osdT = 0;
function osd(texte, tenir){
  const el = $('#pOsd');
  clearTimeout(osdT);
  if (!texte){ el.classList.remove('on'); return; }
  el.textContent = texte;
  el.classList.add('on');
  if (!tenir) osdT = setTimeout(() => el.classList.remove('on'), 900);
}

/* L'ecran ne s'eteint pas pendant qu'on regarde: un telephone se mettait en
   veille au milieu d'un episode. Rendu a la pause, repris au retour. */
let verrouEcran = null;
async function garderEcranAllume(){
  if (!('wakeLock' in navigator) || verrouEcran || V.paused || P.hidden || document.hidden) return;
  try {
    verrouEcran = await navigator.wakeLock.request('screen');
    verrouEcran.addEventListener('release', () => { verrouEcran = null; });
  } catch(e){ verrouEcran = null; }
}
function relacherEcran(){ if (verrouEcran){ verrouEcran.release().catch(() => {}); verrouEcran = null; } }
V.addEventListener('play', garderEcranAllume);
V.addEventListener('pause', relacherEcran);
document.addEventListener('visibilitychange', () => { if (!document.hidden) garderEcranAllume(); });

/* L'ecran verrouille, les notifications, les touches media du clavier et des
   ecouteurs: le titre de l'episode, sa jaquette, et les boutons lecture,
   -10 / +10 s, suivant. */
function majSessionMedia(ep){
  if (!('mediaSession' in navigator) || !ep) return;
  const a = S.byKey.get(ep.anime);
  const jaquette = a && a.art && artUrls.get(a.art.rel);
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: titreEpisode(ep), artist: a ? a.title : '', album: seasonLabel(ep.seasonKey) || 'Netflox',
      artwork: jaquette && !/^blob:/.test(jaquette)
        ? [{ src: new URL(jaquette, location.href).href, sizes: '512x512' }]
        : [{ src: new URL('icones/netflox-512.png', location.href).href, sizes: '512x512', type: 'image/png' }]
    });
  } catch(e){}
}
if ('mediaSession' in navigator){
  const ms = navigator.mediaSession;
  [['play', () => V.play()], ['pause', () => V.pause()],
   ['seekbackward', (d) => skip(-((d && d.seekOffset) || 10))], ['seekforward', (d) => skip((d && d.seekOffset) || 10)],
   ['seekto', (d) => { if (d && isFinite(d.seekTime)) V.currentTime = d.seekTime; }],
   ['nexttrack', () => playNext(true)]].forEach(([k, f]) => { try { ms.setActionHandler(k, f); } catch(e){} });
  let positionT = 0;
  V.addEventListener('timeupdate', () => {
    if (Date.now() - positionT < 5000 || !isFinite(V.duration) || !V.duration) return;
    positionT = Date.now();
    try { ms.setPositionState({ duration: V.duration, playbackRate: V.playbackRate || 1, position: Math.min(V.currentTime, V.duration) }); } catch(e){}
  });
}
$('#pClose').addEventListener('click', closePlayer);
$('#pPlay').addEventListener('click', () => V.paused ? V.play() : V.pause());
$('#pBig').addEventListener('click', () => V.play());
$('#pBack').addEventListener('click', () => skip(-10));
$('#pFwd').addEventListener('click', () => skip(10));
$('#pNext').addEventListener('click', () => playNext(true));
$('#pFull').addEventListener('click', toggleFull);
$('#pPip').addEventListener('click', () => {
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(()=>{});
  else V.requestPictureInPicture && V.requestPictureInPicture().catch(() => toast('Mini-lecteur indisponible', 'bad'));
});
/* le volume agit sur ce qui sonne: la video, ou la piste a cote quand elle
   a pris le relais. La video reste coupee tant qu'une autre langue joue. */
function basculerSon(){ const o = sortie(); o.muted = !o.muted; paintVol(); return o; }
$('#pMute').addEventListener('click', basculerSon);
$('#pVol').addEventListener('input', (ev) => {
  const o = sortie();
  o.volume = parseFloat(ev.target.value); o.muted = o.volume === 0;
  store.set('vol', o.volume); paintVol();
});
function paintVol(){
  const o = sortie();
  const coupe = o.muted || o.volume === 0;
  $('#pMute').innerHTML = coupe ? ICON_MUTE : ICON_VOL;
  $('#pMute').dataset.tip = coupe ? 'Remettre le son (M)' : 'Couper le son (M)';
}

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
function choisirVitesse(r){
  V.playbackRate = r;
  store.set('rate', r);
  const txt = (r + '').replace('.',',') + '×';
  $('#pRate').textContent = txt;
  osd('Vitesse ' + txt);
}
$('#pRate').addEventListener('click', () => {
  const i = RATES.indexOf(V.playbackRate);
  choisirVitesse(RATES[(i + 1) % RATES.length]);
});
/* < et >: un cran plus lent ou plus rapide, sans faire le tour */
function vitesseDe(sens){
  if (geste.rapide) return;
  const r = V.playbackRate;
  const n = sens > 0 ? RATES.find(x => x > r + 1e-6) : [...RATES].reverse().find(x => x < r - 1e-6);
  if (n) choisirVitesse(n); else osd('Vitesse ' + (r + '').replace('.',',') + '×');
}

function skip(d){
  V.currentTime = Math.max(0, Math.min((V.duration || 0), V.currentTime + d));
  const fb = $(d < 0 ? '#fbBack' : '#fbFwd');
  fb.classList.add('on');
  setTimeout(() => fb.classList.remove('on'), 420);
  poke();
}
function toggleFull(){
  if (document.fullscreenElement) document.exitFullscreen().catch(()=>{});
  else P.requestFullscreen().then(tournerEnPaysage, () => toast('Plein écran refusé', 'bad'));
}
/* Sur telephone, le plein ecran couche aussi l'image, comme une appli video.
   Android le permet; l'iPhone ne laisse pas une page choisir, il suit le
   capteur. Une video plus haute que large (rare) reste debout. */
function tournerEnPaysage(){
  if (!matchMedia('(pointer:coarse)').matches) return;
  if (V.videoWidth && V.videoWidth < V.videoHeight) return;
  try { screen.orientation.lock('landscape').catch(() => {}); } catch(e){}
}
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) try { screen.orientation.unlock(); } catch(e){}
});

V.addEventListener('play',  () => { $('#pPlay').innerHTML = ICON_PAUSE; $('#pPlay').dataset.tip = 'Pause (K)'; showCenter(false); P.classList.add('jouant'); poke(); });
V.addEventListener('pause', () => {
  $('#pPlay').innerHTML = ICON_PLAY; $('#pPlay').dataset.tip = 'Lecture (K)'; showCenter(true); P.classList.remove('hide-ui', 'jouant'); clearTimeout(hideT);
  saveNow(); flushProgress();                 // moment calme: on pose la progression sur le disque
});
V.addEventListener('timeupdate', () => {
  paintScrub();
  checkSegs();
  if (!saveT) saveT = setTimeout(() => { saveT = null; saveNow(); }, 4000);
  const d = V.duration;
  if (d && d - V.currentTime < 22 && d > 120) showNext();
});
V.addEventListener('progress', paintScrub);
V.addEventListener('loadedmetadata', () => {
  $('#tAll').textContent = fmtTime(V.duration);
  paintScrub(); paintSegZones();
});
V.addEventListener('ended', () => {
  saveNow(); flushProgress();
  if (S.current && nextRefuse === S.current.rel) return;   // la suite a ete refusee: on s'arrete la
  playNext(false);
});
V.addEventListener('error', () => {
  if (P.hidden || S.switching || !S.current) return;
  if (S.replier){                 // l'adresse directe n'a pas pris: on reprend par le blob:
    const u = S.replier; S.replier = null;
    S.srcUrl = u; V.src = u; V.load();
    return;
  }
  if (S.current.play === 'ts' && !S.tsPlayer) return;
  playerError('Lecture impossible',
    'Le navigateur n\'arrive pas à décoder « ' + S.current.name + ' ». Le codec du fichier n\'est probablement pas supporté.');
});
function saveNow(){
  if (S.current && V.duration) setProgress(S.current, V.currentTime, V.duration);
}

/* --------------------------------------------------- barre de temps - */
const scrub = $('#scrub');
function paintScrub(){
  const d = V.duration || 0;
  const pct = d ? (V.currentTime / d) * 100 : 0;
  $('#sProg').style.width = pct + '%';
  $('#sKnob').style.left  = pct + '%';
  $('#tNow').textContent  = fmtTime(V.currentTime);
  let buf = 0;
  try { if (V.buffered.length) buf = (V.buffered.end(V.buffered.length - 1) / d) * 100; } catch(e){}
  $('#sBuf').style.width = (isFinite(buf) ? buf : 0) + '%';
}
function scrubAt(ev){
  const r = scrub.getBoundingClientRect();
  return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
}
/* ---------------------------------------- aperçu au survol -------- */
/* Une seconde vidéo, muette et jamais lue, sert de décodeur: on la déplace au
   temps survolé et on recopie l'image dans la bulle. Les .ts n'y passent pas,
   le navigateur ne sait pas les décoder hors du lecteur. */
let peekV = null, peekWant = null, peekBusy = false, peekFor = null;
let peekShown = null, peekCible = 0;     // le temps de l'image dans la bulle, et celui sous la souris
/* L'image est-elle assez proche de la souris pour s'y fier? */
function peekJuste(){
  return peekShown != null && Math.abs(peekShown - peekCible) <= Math.max(8, (V.duration || 0) / 150);
}
function peekable(){
  return !!(S.current && S.current.play === 'native' && S.srcUrl && V.duration);
}
function dropPeek(){
  if (peekV){ peekV.removeAttribute('src'); try { peekV.load(); } catch(e){} }
  peekV = null; peekFor = null; peekWant = null; peekBusy = false; peekShown = null;
}
function peekVideo(){
  if (peekV && peekFor === S.srcUrl) return peekV;
  dropPeek();
  peekV = document.createElement('video');
  peekV.muted = true; peekV.playsInline = true; peekV.preload = 'auto';
  peekFor = S.srcUrl;
  peekV.src = S.srcUrl;
  return peekV;
}
function pumpPeek(){
  if (peekBusy || peekWant == null || !peekable()) return;
  const t = peekWant;                    // relevé avant peekVideo(), qui peut tout remettre à zéro
  const v = peekVideo();
  if (!v.duration){                      // pas encore prêt: on retentera au chargement
    peekWant = t;
    v.addEventListener('loadeddata', pumpPeek, { once:true });
    v.addEventListener('error', () => { peekWant = null; }, { once:true });
    return;
  }
  peekWant = null;
  peekBusy = true;
  const draw = () => {
    peekBusy = false;
    const c = $('#sThumb'), ctx = c.getContext('2d');
    try { ctx.drawImage(v, 0, 0, c.width, c.height); peekShown = v.currentTime; } catch(e){}
    $('#sBubble').classList.toggle('attente', !peekJuste());
    pumpPeek();
  };
  const give = setTimeout(() => { peekBusy = false; }, 2500);
  v.addEventListener('seeked', () => { clearTimeout(give); draw(); }, { once:true });
  try { v.currentTime = Math.min(t, Math.max(v.duration - 0.2, 0)); }
  catch(e){ clearTimeout(give); peekBusy = false; }
}
scrub.addEventListener('pointermove', (ev) => {
  const p = scrubAt(ev), b = $('#sBubble');
  const d = V.duration || 0;
  b.classList.toggle('novid', !peekable());
  // la bulle reste dans le cadre, même tout au bord de la barre
  const r = scrub.getBoundingClientRect();
  const half = (b.offsetWidth || 0) / 2;
  const x = Math.max(half, Math.min(r.width - half, p * r.width));
  b.style.left = x + 'px';
  $('#sTime').textContent = fmtTime(p * d);
  if (peekable()){
    // une image a plus de quelques secondes de la souris montre autre chose
    peekCible = p * d;
    b.classList.toggle('attente', !peekJuste());
    peekWant = p * d; pumpPeek();

  }

});
scrub.addEventListener('pointerleave', () => { peekWant = null; });
let dragging = false;
scrub.addEventListener('pointerdown', (ev) => {
  dragging = true; scrub.classList.add('drag'); scrub.setPointerCapture(ev.pointerId);
  if (V.duration) V.currentTime = scrubAt(ev) * V.duration;
});
scrub.addEventListener('pointermove', (ev) => { if (dragging && V.duration) V.currentTime = scrubAt(ev) * V.duration; });
['pointerup','pointercancel'].forEach(t => scrub.addEventListener(t, (ev) => {
  dragging = false; scrub.classList.remove('drag');
  try { scrub.releasePointerCapture(ev.pointerId); } catch(e){}
}));

/* ---------------------------------------------------- générique ----- */
/* Un repère par épisode: la longueur du générique varie d'un épisode à l'autre.
   Le menu propose de recopier le repère sur toute la saison quand il ne bouge pas. */
/* Deux repères par épisode: le générique de début et celui de fin. Même
   mécanique pour les deux, seule la clé change. Leur longueur varie d'un
   épisode à l'autre, d'où le menu qui propose de recopier sur la saison. */
const SEGS = {
  intro: { cle:'intro.', auto:'introAuto', titre:'Générique de début', quoi:'le générique' },
  fin:   { cle:'outro.', auto:'outroAuto', titre:'Générique de fin',   quoi:'le générique de fin' }
};
const SEG_KINDS = ['intro', 'fin'];
function segKey(ep, k){ return SEGS[k].cle + ep.rel; }
function getSeg(ep, k){
  if (!ep) return null;
  if (S.shared) return (k === 'fin' ? S.host.outro : S.host.intro)[ep.rel] || null;
  return store.get(segKey(ep, k), null);
}
/* Sur un lien de partage, l'hote — sa machine, ou un compte declare comme le
   sien — pose ses reperes comme chez lui: le serveur les ecrit dans le
   bibliotheque.json de la serie (/__generique). Les invites n'ont que le
   choix de passer automatiquement. */
function peutReperer(){ return !S.shared || S.estHote; }
function courtDe(ep){ return ep.rel.slice(ep.anime.length + 1); }
async function envoyerReperes(k, serie, segs){
  let d = null;
  try {
    const r = await fetch('__generique', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                           body: JSON.stringify({ genre: k, serie, segs }) });
    d = await r.json();
  } catch(e){}
  if (!d || !d.ok) toast('Repère non enregistré : ' + ((d && d.erreur) || 'le partage ne répond pas'), 'bad');
}
function setSeg(k, patch){
  if (!S.current || !peutReperer()) return;
  if (S.shared){
    // un repere a moitie pose (le debut seul) attend sa fin ici: seul un repere
    // complet part sur le disque, comme dans le fichier ecrit par la page
    const t = k === 'fin' ? S.host.outro : S.host.intro;
    const seg = Object.assign({}, t[S.current.rel] || {}, patch);
    t[S.current.rel] = seg;
    if (segReady(seg)) envoyerReperes(k, S.current.anime, { [courtDe(S.current)]: { start: seg.start, end: seg.end } });
  } else {
    const cur = store.get(segKey(S.current, k), null) || {};
    store.set(segKey(S.current, k), Object.assign({}, cur, patch));
    saveSidecar(S.current.anime);
  }
  paintSegZones(); buildIntroMenu(); poke();
}
function clearSeg(k){
  if (!S.current || !peutReperer()) return;
  if (S.shared){
    delete (k === 'fin' ? S.host.outro : S.host.intro)[S.current.rel];
    envoyerReperes(k, S.current.anime, { [courtDe(S.current)]: null });
  } else {
    store.del(segKey(S.current, k));
    saveSidecar(S.current.anime);
  }
  hideSkip(); paintSegZones(); buildIntroMenu();
}
function segReady(seg){
  return !!(seg && seg.start != null && seg.end != null && seg.end > seg.start + 0.5);
}
/** Bandes colorées sur la barre de temps, à l'emplacement des génériques. */
function paintSegZones(){
  const d = V.duration;
  for (const k of SEG_KINDS){
    const seg = getSeg(S.current, k), el = $(k === 'fin' ? '#sOutro' : '#sIntro');
    if (!segReady(seg) || !d || !isFinite(d)){ el.hidden = true; continue; }
    el.hidden = false;
    el.style.left  = (seg.start / d * 100) + '%';
    el.style.width = ((seg.end - seg.start) / d * 100) + '%';
  }
}
/** Recopie un repère sur tous les épisodes de la même saison. */
function spreadSeg(k){
  const seg = getSeg(S.current, k);
  if (!segReady(seg) || !S.current || !peutReperer()) return;
  const a = S.byKey.get(S.current.anime);
  if (!a) return;
  let n = 0;
  const envoi = {};
  for (const e of a.episodes){
    if (e.seasonKey !== S.current.seasonKey || e.rel === S.current.rel) continue;
    if (S.shared){
      (k === 'fin' ? S.host.outro : S.host.intro)[e.rel] = { start: seg.start, end: seg.end };
      envoi[courtDe(e)] = { start: seg.start, end: seg.end };
    } else store.set(segKey(e, k), { start: seg.start, end: seg.end });
    n++;
  }
  if (S.shared){ if (n) envoyerReperes(k, a.key, envoi); }
  else saveSidecar(S.current.anime);
  toast(n ? 'Repère appliqué à ' + fmtCount(n, 'autre épisode', 'autres épisodes') : 'Aucun autre épisode dans la saison', 'ok');
  buildIntroMenu();
}
function buildIntroMenu(){
  const bloc = (k) => {
    const seg = getSeg(S.current, k) || {};
    const auto = store.get(SEGS[k].auto, false);
    const line = (label, val) => label + '<b>' + (val != null ? fmtTime(val) : '—') + '</b>';
    const passer = '<button data-seg="' + k + ':auto" class="' + (auto ? 'on' : '') + '">Passer automatiquement<b>' +
      (auto ? 'oui' : 'non') + '</b></button>';
    // l'invite: le seul choix qui le regarde, passer ou non
    if (!peutReperer()) return '<h4>' + SEGS[k].titre + '</h4>' + passer;
    return '<h4>' + SEGS[k].titre + '</h4>' +
      '<button data-seg="' + k + ':start">' + line('Marquer le début ', seg.start) + '</button>' +
      '<button data-seg="' + k + ':end">' + line('Marquer la fin ', seg.end) + '</button>' +
      (segReady(seg) ? '<button data-seg="' + k + ':spread">Appliquer à la saison</button>' : '') +
      passer +
      (seg.start != null || seg.end != null ? '<button data-seg="' + k + ':clear">Effacer les repères</button>' : '');
  };
  const note = 'font-weight:400;text-transform:none;letter-spacing:0;line-height:1.4;padding-bottom:8px';
  $('#introMenu').innerHTML =
    bloc('intro') + '<div class="msep"></div>' + bloc('fin') +
    (!peutReperer() ? '' :
    '<h4 style="' + note + '">Place-toi au bon moment, puis clique.<br>' +
      (S.shared
        ? 'Enregistré dans <b style="font-weight:600">' + SIDECAR + '</b>, sur la machine de l’hôte.'
        : S.canWrite
          ? 'Enregistré dans <b style="font-weight:600">' + SIDECAR + '</b>, dans le dossier de la série.'
          : 'Enregistré dans ce navigateur seulement.') + '</h4>');
  $$('[data-seg]', $('#introMenu')).forEach(b => b.addEventListener('click', () => {
    const [k, quoi] = b.dataset.seg.split(':');
    if (quoi === 'start')       setSeg(k, { start: V.currentTime });
    else if (quoi === 'end')    setSeg(k, { end: V.currentTime });
    else if (quoi === 'spread') spreadSeg(k);
    else if (quoi === 'auto'){  store.set(SEGS[k].auto, !store.get(SEGS[k].auto, false)); buildIntroMenu(); }
    else                        clearSeg(k);
  }));
}
let segInside = { intro:false, fin:false }, skipT = null, skipKind = null;
function checkSegs(){
  const t = V.currentTime;
  for (const k of SEG_KINDS){
    const seg = getSeg(S.current, k);
    if (!segReady(seg)) continue;
    const inside = t >= seg.start && t < seg.end - 0.3;
    if (!inside){
      if (segInside[k]){ segInside[k] = false; if (skipKind === k) hideSkip(); }
      continue;
    }
    if (segInside[k]) continue;                  // déjà proposé pour cette entrée
    segInside[k] = true;
    if (store.get(SEGS[k].auto, false)){ V.currentTime = seg.end; return; }
    showSkip(k);
  }
}
function showSkip(k){
  // la carte « épisode suivant » propose déjà la sortie: deux offres au même
  // endroit se recouvriraient
  if ($('#nextCard').classList.contains('on')) return;
  skipKind = k;
  const b = $('#skipIntro');
  $('#skipLabel').textContent = 'Passer ' + SEGS[k].quoi;
  b.hidden = false;
  requestAnimationFrame(() => b.classList.add('on'));
  clearTimeout(skipT);
  // 3 secondes réelles: setTimeout ignore la vitesse de lecture
  skipT = setTimeout(hideSkip, 3000);
}
function hideSkip(){
  clearTimeout(skipT);
  skipKind = null;
  const b = $('#skipIntro');
  b.classList.remove('on');
  setTimeout(() => { if (!b.classList.contains('on')) b.hidden = true; }, 260);
}
$('#skipIntro').addEventListener('click', () => {
  const seg = getSeg(S.current, skipKind || 'intro');
  if (segReady(seg)) V.currentTime = seg.end;
  hideSkip();
});
$('#pIntro').addEventListener('click', (ev) => {
  ev.stopPropagation();
  const m = $('#introMenu');
  m.hidden = !m.hidden;
  if (!m.hidden) buildIntroMenu();
});
const MENUS = ['#introMenu', '#audMenu', '#subMenu', '#pAide'];
function ouvrirMenu(id, remplir){
  return (ev) => {
    ev.stopPropagation();
    const m = $(id), ouvert = m.hidden;
    MENUS.forEach(k => { $(k).hidden = true; });   // un seul menu a la fois
    if (ouvert){ remplir(); m.hidden = false; }
  };
}
$('#pAudio').addEventListener('click', ouvrirMenu('#audMenu', buildAudMenu));
$('#pSubs').addEventListener('click',  ouvrirMenu('#subMenu', buildSubMenu));
MENUS.forEach(k => $(k).addEventListener('click', (ev) => ev.stopPropagation()));
P.addEventListener('click', () => { MENUS.forEach(k => { $(k).hidden = true; }); });
V.addEventListener('seeked', () => { segInside = { intro:false, fin:false }; });

/* ------------------------------------------------- épisode suivant -- */
function nextEpisode(){
  if (!S.current || !S.queue.length) return null;
  const i = S.queue.findIndex(e => e.rel === S.current.rel);
  return i >= 0 && i + 1 < S.queue.length ? S.queue[i + 1] : null;
}
function showNext(){
  const n = nextEpisode();
  if (!n || $('#nextCard').classList.contains('on') || (S.current && nextRefuse === S.current.rel)) return;
  hideSkip();                                    // la carte prend le relais
  const a = S.byKey.get(n.anime);
  $('#nName').textContent = (a ? a.title + ' · ' : '') + titreEpisode(n);
  $('#nImg').parentNode.classList.toggle('spoil', !!classeSpoil(n));

  const th = store.get('th.' + n.rel, null);
  if (th){ $('#nImg').src = th; $('#nImg').style.display = ''; }
  else   { $('#nImg').removeAttribute('src'); $('#nImg').style.display = 'none'; }
  nextCount = 10;
  $('#nRing').textContent = nextCount;
  $('#nextCard').classList.add('on');
  clearTimeout(nextT);
  const tick = () => {
    nextCount--;
    $('#nRing').textContent = nextCount;
    if (nextCount <= 0) playNext(true);
    else nextT = setTimeout(tick, 1000);
  };
  nextT = setTimeout(tick, 1000);
}
function hideNext(){ clearTimeout(nextT); $('#nextCard').classList.remove('on'); }
/* Quitter un episode dans sa fin le compte comme vu: le generique de fin
   entame, ou — quand on demande la suite — plus des quatre cinquiemes. Sans
   ca, la touche N pendant le generique laissait l'episode « en cours », et
   les edits annotes sur lui restaient caches. */
function finirEpisode(versLaSuite){
  const ep = S.current, d = V.duration, t = V.currentTime;
  if (!ep || !d || !isFinite(d)) return;
  const fin = getSeg(ep, 'fin');
  const dansLaFin = (segReady(fin) && t >= fin.start - 5) || (versLaSuite && t / d >= .8);
  setProgress(ep, dansLaFin ? d : t, d);
  flushProgress();
}
function playNext(force){
  const n = nextEpisode();
  hideNext();
  finirEpisode(true);
  if (!n){
    if (force) return toast('C’est le dernier épisode de la série');
    // la fin du dernier episode: on le dit, et on revient sur la fiche plutot que de disparaitre
    const a = S.current && S.byKey.get(S.current.anime);
    closePlayer();
    if (a){ S.view = 'anime'; S.animeKey = a.key; render(); scrollTo(0, 0); toast('Fin de « ' + a.title + ' » : tu as tout vu', 'ok'); }
    return;
  }

  openPlayer(n);
}
$('#nGo').addEventListener('click', () => playNext(true));
$('#nNo').addEventListener('click', () => { nextRefuse = S.current ? S.current.rel : null; hideNext(); });

/* --------------------------------------------------- raccourcis ----- */
addEventListener('keydown', (ev) => {
  // Ctrl+F, Ctrl+R, Alt+fleches: au navigateur, pas au lecteur
  if (P.hidden || ev.ctrlKey || ev.metaKey || ev.altKey || ev.target.matches('input,textarea,select')) return;
  // Espace sur un bouton: c'est lui qui agit, sinon lecture/pause partait deux fois
  if (ev.key === ' ' && ev.target.closest('button,[role=slider]')) return;
  // Echap ferme d'abord un menu ouvert, pas le lecteur
  if (ev.key === 'Escape' && MENUS.some(m => !$(m).hidden)){ MENUS.forEach(m => { $(m).hidden = true; }); return; }
  const k = ev.key.toLowerCase();
  if (k === ' ' || k === 'k'){ ev.preventDefault(); V.paused ? V.play() : V.pause(); }
  else if (ev.key === 'ArrowRight'){ ev.preventDefault(); skip(ev.shiftKey ? 60 : 10); }
  else if (ev.key === 'ArrowLeft') { ev.preventDefault(); skip(ev.shiftKey ? -60 : -10); }
  else if (ev.key === 'ArrowUp')   { ev.preventDefault(); const o = sortie(); o.volume = Math.min(1, o.volume + .08); o.muted = false; $('#pVol').value = o.volume; store.set('vol', o.volume); paintVol(); osd('Volume ' + Math.round(o.volume * 100) + ' %'); }
  else if (ev.key === 'ArrowDown') { ev.preventDefault(); const o = sortie(); o.volume = Math.max(0, o.volume - .08); $('#pVol').value = o.volume; store.set('vol', o.volume); paintVol(); osd('Volume ' + Math.round(o.volume * 100) + ' %'); }
  else if (k === 'f'){ toggleFull(); }
  // ce qui sonne, comme le bouton: avec une autre langue, couper la video ne coupait rien
  else if (k === 'm'){ const o = basculerSon(); osd(o.muted ? 'Son coupé' : 'Son remis'); }
  else if (ev.key === '<' || ev.key === '>'){ vitesseDe(ev.key === '>' ? 1 : -1); }
  else if (k === 'c'){ basculerSousTitres(); }
  else if (ev.key === '?'){ const m = $('#pAide'), ouvert = m.hidden; MENUS.forEach(x => { $(x).hidden = true; }); m.hidden = !ouvert; }
  else if (k === 'n'){ playNext(true); }
  else if (k === 'escape'){ if (document.fullscreenElement) document.exitFullscreen().catch(()=>{}); else closePlayer(); }
  else if (k >= '0' && k <= '9'){ if (V.duration) V.currentTime = V.duration * (parseInt(k,10) / 10); }
  poke();
});
addEventListener('beforeunload', () => { saveNow(); flushProgress(); edDwellFin(); edStatsEcrire(); });
