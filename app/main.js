/* Netflox, l'app: la bibliotheque dans sa propre fenetre, sur ce PC seulement.
 *
 * Pas de serveur, pas de tunnel, pas de comptes: la fenetre ouvre la vraie
 * page du projet (index.html et js/), exactement comme un double-clic dans
 * Opera. Ce qu'on change sur le site arrive donc tel quel dans l'app.
 *
 * Ce que l'app fait en plus d'un onglet:
 *  - RTX Video Super Resolution allumee d'office (le drapeau qu'Opera perd a
 *    chaque mise a jour);
 *  - le dossier videos rouvert sans clic d'une fois sur l'autre;
 *  - au premier lancement, ce qu'Opera gardait pour la page (edits vus,
 *    favoris, titres, volume...) est recopie: on ne repart pas de zero;
 *  - a la fermeture, la page finit d'ecrire ses fiches avant que la fenetre
 *    parte: un onglet ferme pouvait couper l'ecriture en route;
 *  - le compte de l'hote (Virgile) est celui de l'app: sa progression et ses
 *    edits vus y arrivent, et ce qu'on regarde ici y repart — dans le meme
 *    comptes/<id>.json que le serveur de partage, avec les memes regles.
 *
 * Options, surtout pour les essais:
 *   --racine <dossier>    le dossier qui contient index.html (sinon: trouve tout seul)
 *   --donnees <dossier>   ou l'app range ses donnees (sinon: %APPDATA%/Netflox)
 *   --sans-import         ne rien reprendre d'Opera
 *   --compte <pseudo>     un autre compte que celui de l'hote
 */
'use strict';
const { app, BrowserWindow, ipcMain, shell, Menu, dialog, session, nativeTheme } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

function option(nom){
  const i = process.argv.indexOf(nom);
  return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

// RTX Video Super Resolution: Chromium a le code, il faut le lui demander
app.commandLine.appendSwitch('enable-features', 'NvidiaVpSuperResolution');
if (option('--donnees')) app.setPath('userData', path.resolve(option('--donnees')));
const ETAT = () => path.join(app.getPath('userData'), 'netflox.json');

/* ---------------------------------------------------- ou est la page -- */
function estRacine(d){
  return !!d && fs.existsSync(path.join(d, 'index.html')) && fs.existsSync(path.join(d, 'js', '01-outils.js'));
}
function enRemontant(depuis){
  for (let d = depuis; ; d = path.dirname(d)){
    if (estRacine(d)) return d;
    if (path.dirname(d) === d) return null;
  }
}
/* L'exe vit sous app/dist/... dans le projet: en remontant, on tombe sur
   index.html. Deplace ailleurs, il se souvient du dernier dossier, ou le demande. */
function trouverRacine(etat){
  const demande = option('--racine');
  if (demande) return estRacine(path.resolve(demande)) ? path.resolve(demande) : null;
  const trouve = enRemontant(path.dirname(app.getPath('exe'))) || enRemontant(__dirname);
  if (trouve) return trouve;
  if (estRacine(etat.racine)) return etat.racine;
  const choix = dialog.showOpenDialogSync({
    title: 'Où est Netflox ? (le dossier qui contient index.html)', properties: ['openDirectory']
  });
  return choix && estRacine(choix[0]) ? choix[0] : null;
}

function lireEtat(){
  try { const d = JSON.parse(fs.readFileSync(ETAT(), 'utf8')); return d && typeof d === 'object' ? d : {}; }
  catch(e){ return {}; }
}
function ecrireEtat(etat){
  try {
    fs.mkdirSync(path.dirname(ETAT()), { recursive: true });
    fs.writeFileSync(ETAT() + '.tmp', JSON.stringify(etat, null, 2));
    fs.renameSync(ETAT() + '.tmp', ETAT());
  } catch(e){}
}

/* ------------------------------------------------ reprise depuis Opera -- */
/* La page range ses reglages dans le navigateur (cles « ad2. » de l'origine
   file://). Au premier lancement on les relit dans le profil du navigateur
   qui en a le plus — Opera, en pratique — sur une copie: l'original n'est
   jamais ouvert, et Opera peut rester lance. Le format est celui de Chromium:
   cle « _file://\0 » + octet d'encodage + nom, valeur prefixee de meme
   (0: UTF-16, 1: Latin-1). */
const PROFILS = [
  ['Opera',    path.join(process.env.APPDATA || '', 'Opera Software', 'Opera Stable', 'Default')],
  ['Opera GX', path.join(process.env.APPDATA || '', 'Opera Software', 'Opera GX Stable', 'Default')],
  ['Chrome',   path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data', 'Default')],
  ['Edge',     path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'User Data', 'Default')]
];
function decoder(buf){
  return buf[0] === 0 ? buf.subarray(1).toString('utf16le') : buf.subarray(1).toString('latin1');
}
async function lireProfil(dossier){
  const source = path.join(dossier, 'Local Storage', 'leveldb');
  if (!fs.existsSync(source)) return null;
  const copie = fs.mkdtempSync(path.join(os.tmpdir(), 'netflox-import-'));
  try {
    for (const nom of fs.readdirSync(source)){
      if (nom === 'LOCK') continue;                // tenu par le navigateur ouvert
      try { fs.copyFileSync(path.join(source, nom), path.join(copie, nom)); } catch(e){}
    }
    const { ClassicLevel } = require('classic-level');
    const db = new ClassicLevel(copie, { keyEncoding: 'buffer', valueEncoding: 'buffer', createIfMissing: false });
    const debut = Buffer.from('_file://\x00', 'latin1');
    const cles = {};
    try {
      for await (const [k, v] of db.iterator({ gte: debut, lt: Buffer.from('_file://\x01', 'latin1') })){
        const nom = decoder(k.subarray(debut.length));
        if (nom.startsWith('ad2.') && v.length) cles[nom] = decoder(v);
      }
    } finally { await db.close(); }
    return cles;
  } catch(e){
    return null;
  } finally {
    fs.rmSync(copie, { recursive: true, force: true });
  }
}
async function preparerImport(etat){
  if (etat.importFait || process.argv.includes('--sans-import')) return null;
  let meilleur = null;
  for (const [nom, dossier] of PROFILS){
    const cles = await lireProfil(dossier);
    const n = cles ? Object.keys(cles).length : 0;
    if (n && (!meilleur || n > meilleur.n)) meilleur = { nom, n, cles };
  }
  return meilleur;
}

/* ------------------------------------------------------------- compte -- */
/* Le fichier que partager.py tient pour ce compte: comptes/<empreinte du
   pseudo>.json. L'app n'y touche qu'a « donnees » et « maj »: ni au mot de
   passe, ni aux sessions des appareils connectes par le lien. */
const estObjet = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
let compteFichier = null, compteVu = 0;        // date du fichier tel que l'app l'a lu ou ecrit
let ecritures = Promise.resolve();

function idCompte(pseudo){
  return crypto.createHash('sha256').update(pseudo.trim().toLowerCase(), 'utf8').digest('hex').slice(0, 32);
}
/* Celui qu'on a demande, sinon celui qui est declare comme le compte de
   l'hote — retenu ensuite par son pseudo, pour ne pas changer en route. */
function trouverCompte(){
  const dossier = path.join(racine, 'comptes');
  const voulu = option('--compte') || etat.compte;
  if (voulu){
    const f = path.join(dossier, idCompte(voulu) + '.json');
    return fs.existsSync(f) ? f : null;
  }
  let noms = [];
  try { noms = fs.readdirSync(dossier).filter(n => /^[0-9a-f]{32}\.json$/.test(n)); } catch(e){}
  for (const nom of noms){
    try {
      const c = JSON.parse(fs.readFileSync(path.join(dossier, nom), 'utf8'));
      if (estObjet(c) && c.hote && typeof c.pseudo === 'string'){
        etat.compte = c.pseudo; ecrireEtat(etat);
        return path.join(dossier, nom);
      }
    } catch(e){}
  }
  return null;
}
function lireCompte(){
  const c = JSON.parse(fs.readFileSync(compteFichier, 'utf8'));
  if (!estObjet(c)) throw new Error('compte illisible');
  return c;
}
/* fusionner_donnees de partager.py, regle pour regle: plusieurs appareils
   envoient au meme compte, aucun n'efface ce qu'un autre vient d'y mettre. */
function fusionnerDonnees(serveur, recu){
  const out = Object.assign({}, estObjet(serveur) ? serveur : {});
  for (const [k, v] of Object.entries(recu)){
    const ici = out[k];
    if (ici == null || v == null){ if (v != null) out[k] = v; continue; }
    if (/^(pg|rd|sc|fav)\./.test(k) && estObjet(v) && estObjet(ici)){
      if ((v.at || 0) >= (ici.at || 0)) out[k] = v;
    } else if (k.startsWith('oubli.') && typeof v === 'number' && typeof ici === 'number'){
      out[k] = Math.max(v, ici);
    } else if ((k === 'edvus' || k === 'edstats') && estObjet(v) && estObjet(ici)){
      out[k] = Object.assign({}, ici, v);
    } else out[k] = v;
  }
  // une serie retiree de « Reprendre »: ses positions d'avant l'oubli partent
  for (const k of Object.keys(out)){
    const m = /^(pg|rd|sc)\.(.+)/.exec(k);
    if (!m || !estObjet(out[k])) continue;
    const oubli = out['oubli.' + m[2].split(m[1] === 'sc' ? '|' : '/')[0]];
    if (typeof oubli === 'number' && (out[k].at || 0) <= oubli) delete out[k];
  }
  return out;
}
/* Relu juste avant d'ecrire: le partage a pu y poser ce qu'on a regarde sur
   le telephone. Illisible: on n'ecrit pas par-dessus. Windows refuse parfois
   un remplacement pendant que le partage lit le fichier: on reessaie. */
async function ecrireCompte(donnees){
  for (let essai = 0; essai < 5; essai++){
    try {
      const c = lireCompte();
      c.donnees = fusionnerDonnees(c.donnees, donnees);
      c.maj = Math.floor(Date.now() / 1000);
      const tmp = compteFichier + '.app.tmp';
      const fd = fs.openSync(tmp, 'w');
      try { fs.writeSync(fd, JSON.stringify(c, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, compteFichier);
      compteVu = fs.statSync(compteFichier).mtimeMs;
      return;
    } catch(e){
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) return;
      await new Promise(r => setTimeout(r, 200));
    }
  }
}

/* ------------------------------------------------------------ fenetre -- */
let fenetre = null, racine = null, etat = {}, aImporter = null;

function creerFenetre(){
  const b = etat.fenetre || {};
  fenetre = new BrowserWindow({
    width: b.width || 1400, height: b.height || 860, x: b.x, y: b.y,
    minWidth: 720, minHeight: 480,
    backgroundColor: '#08080c', title: 'Netflox', show: false, autoHideMenuBar: true,
    icon: path.join(racine, 'icones', 'netflox-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, sandbox: true,
      plugins: true,                                  // le lecteur PDF des documents
      autoplayPolicy: 'no-user-gesture-required',     // l'episode suivant demarre seul
      spellcheck: false
    }
  });
  if (b.maximise) fenetre.maximize();
  fenetre.once('ready-to-show', () => fenetre.show());

  const wc = fenetre.webContents;
  // un lien vers le web (IMDb...) part dans le navigateur; un document local s'ouvre ici
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)){ shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow', overrideBrowserWindowOptions: { backgroundColor: '#08080c', autoHideMenuBar: true } };
  });
  wc.on('will-navigate', (ev, url) => {
    if (/^https?:/i.test(url)){ ev.preventDefault(); shell.openExternal(url); }
  });
  wc.on('before-input-event', (ev, i) => {
    if (i.type !== 'keyDown') return;
    if (i.key === 'F11'){ ev.preventDefault(); fenetre.setFullScreen(!fenetre.isFullScreen()); }
    else if (i.key === 'F5' || (i.control && i.key.toLowerCase() === 'r')){ ev.preventDefault(); recharger(); }
    else if (i.key === 'F12' || (i.control && i.shift && i.key.toLowerCase() === 'i')){ ev.preventDefault(); wc.toggleDevTools(); }
  });
  // les boutons « precedent » de la souris: le retour de la page, comme dans le navigateur
  fenetre.on('app-command', (ev, cmd) => {
    const h = wc.navigationHistory;
    if (cmd === 'browser-backward' && h.canGoBack()) h.goBack();
    else if (cmd === 'browser-forward' && h.canGoForward()) h.goForward();
  });
  wc.on('did-finish-load', rouvrirDossier);

  let fermeture = false;
  fenetre.on('close', (ev) => {
    retenirFenetre();
    if (fermeture) return;
    ev.preventDefault();
    vider().then(() => ecritures).finally(() => { fermeture = true; fenetre.close(); });
  });

  fenetre.loadURL(pathToFileURL(path.join(racine, 'index.html')).href);
}

function retenirFenetre(){
  if (!fenetre || fenetre.isFullScreen()) return;
  const maximise = fenetre.isMaximized();
  etat.fenetre = Object.assign(maximise ? (etat.fenetre || {}) : fenetre.getNormalBounds(), { maximise });
  ecrireEtat(etat);
}

/* Ce que la page fait en quittant (position de l'episode, fiches a ecrire,
   temps passe sur l'edit), lance a la main, puis le temps que le disque
   suive: ses ecritures sont asynchrones, une fermeture seche les coupait. */
function vider(){
  if (!fenetre || fenetre.webContents.isDestroyed()) return Promise.resolve();
  const js = "(async () => { try { dispatchEvent(new Event('beforeunload')); } catch(e){} " +
             "try { if (typeof compteSauver === 'function') compteSauver(); } catch(e){} " +
             "await new Promise(r => setTimeout(r, 900)); })()";
  return Promise.race([
    fenetre.webContents.executeJavaScript(js).catch(() => {}),
    new Promise(r => setTimeout(r, 3000))
  ]);
}
function recharger(){ vider().finally(() => fenetre && fenetre.webContents.reload()); }

/* Le dossier deja choisi: la page le retrouve, mais Chromium redemande la
   permission a chaque session et attend un clic sur « Rouvrir ». Ce clic,
   l'app le fait — avec le geste utilisateur qu'il faut a la permission. */
async function rouvrirDossier(){
  const wc = fenetre.webContents;
  if (!/\/index\.html$/i.test(wc.getURL())) return;
  for (let k = 0; k < 40; k++){
    let r = 'attente';
    try {
      r = await wc.executeJavaScript(
        "(() => { const b = document.getElementById('btnResume'); if (b){ b.click(); return 'clic'; }" +
        " const w = document.getElementById('welcome'); return w && w.hidden ? 'ouvert' : 'attente'; })()", true);
    } catch(e){ return; }
    if (r !== 'attente') return;
    await new Promise(res => setTimeout(res, 150));
  }
}

/* ------------------------------------------------------------- canaux -- */
ipcMain.on('netflox:compte-lire', (ev, siChange) => {
  let rep = null;
  try {
    if (compteFichier){
      const date = fs.statSync(compteFichier).mtimeMs;
      if (!siChange || date !== compteVu){
        const c = lireCompte();
        compteVu = date;
        rep = { pseudo: String(c.pseudo || ''), hote: !!c.hote, donnees: estObjet(c.donnees) ? c.donnees : {} };
      }
    }
  } catch(e){}
  ev.returnValue = rep;
});
ipcMain.on('netflox:compte-sauver', (ev, donnees) => {
  if (!compteFichier || !estObjet(donnees)) return;
  ecritures = ecritures.then(() => ecrireCompte(donnees)).catch(() => {});
});
ipcMain.on('netflox:import', (ev) => {
  ev.returnValue = aImporter ? { de: aImporter.nom, cles: aImporter.cles } : null;
});
ipcMain.on('netflox:import-fait', (ev, n) => {
  if (aImporter){
    etat.importFait = { de: aImporter.nom, cles: n, le: new Date().toISOString() };
    ecrireEtat(etat);
    aImporter = null;
  }
  ev.returnValue = true;
});

/* --------------------------------------------------------------- vie -- */
if (!app.requestSingleInstanceLock()){
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!fenetre) return;
    if (fenetre.isMinimized()) fenetre.restore();
    fenetre.focus();
  });
  app.whenReady().then(async () => {
    nativeTheme.themeSource = 'dark';                 // barre de titre sombre, comme la page
    Menu.setApplicationMenu(null);
    etat = lireEtat();
    racine = trouverRacine(etat);
    if (!racine){
      dialog.showErrorBox('Netflox', 'Le dossier de Netflox (celui qui contient index.html) est introuvable.');
      return app.quit();
    }
    if (!option('--racine') && etat.racine !== racine){ etat.racine = racine; ecrireEtat(etat); }
    // une app locale: elle n'ouvre que ses fichiers, on lui accorde ce qu'elle demande
    // (le dossier en lecture-ecriture surtout); rien du web n'est jamais charge ici
    session.defaultSession.setPermissionRequestHandler((wc, perm, ok, details) =>
      ok(/^(file:|blob:)/i.test((details && details.requestingUrl) || wc.getURL())));
    aImporter = await preparerImport(etat);
    compteFichier = trouverCompte();
    creerFenetre();
  });
  app.on('window-all-closed', () => app.quit());
}
