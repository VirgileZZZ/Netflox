/* 05-scan.js
 *
 * Parcourir le dossier et en tirer la bibliotheque.
 *
 * Charge par index.html, dans l'ordre. Script classique et non module:
 * une page ouverte en file:// ne peut pas charger de module — le navigateur
 * y voit une requete inter-origines et la refuse. Tous ces fichiers
 * partagent donc la meme portee globale, exactement comme quand ils ne
 * faisaient qu'un. L'ordre compte: il est celui de la liste dans la page.
 */
"use strict";
/* ==================================================== scan du dossier = */
async function* walkFS(dir, path){
  for await (const entry of dir.values()){
    if (entry.kind === 'directory'){
      if (shouldSkipDir(entry.name)) continue;
      const sub = path.concat(entry.name);
      // un dossier au premier niveau utile = une serie: on garde son handle
      if (stripRoot(sub).length === 1) S.seriesDirs.set(entry.name, entry);
      yield* walkFS(entry, sub);
    } else {
      yield { handle: entry, path: path.concat(entry.name) };
    }
  }
}

let scanning = false;
async function scan(){
  if (scanning) return;
  scanning = true;
  $('#btnRefresh').classList.add('spin');
  bar(12);
  try {
    let files = [];
    if (S.mode === 'fs'){
      S.seriesDirs = new Map();
      const found = [];
      for await (const it of walkFS(S.dirHandle, [])) found.push(it);
      bar(45);
      let done = 0;
      for (const it of found){
        const kind = kindOf(it.path[it.path.length-1]);
        if (!kind && !fichierUtile(it.path)) { done++; continue; }
        // les pages de scans se comptent par milliers: on n'ouvre que ce dont
        // on a besoin (taille des videos et documents), le reste attendra
        let f = null;
        if (kind !== 'image'){ try { f = await it.handle.getFile(); } catch(e){} }
        files.push({
          path: it.path, size: f ? f.size : 0,
          lastModified: f ? f.lastModified : 0,
          ref: { kind:'handle', handle: it.handle, file: f }
        });
        if ((++done & 31) === 0) bar(45 + 45 * done / found.length);
      }
    } else {
      files = S.pendingFiles || [];   // 'input' (sélecteur / glisser-déposer) et 'http' (auto)
    }
    bar(94);
    const animes = buildLibrary(files);
    S.animes = animes;
    S.byKey  = new Map(animes.map(a => [a.key, a]));
    S.files  = animes.reduce((n,a) => n + a.episodes.length, 0);
    store.set('root', S.rootName);
    S.canWrite = await checkWrite();
    await readSidecars();
    afterScan();
  } catch(e){
    console.error(e);
    toast('Erreur pendant le scan : ' + e.message, 'bad');
  } finally {
    scanning = false;
    $('#btnRefresh').classList.remove('spin');
    bar(100); setTimeout(() => bar(0), 400);
  }
}
function bar(pct){
  const el = $('#scanbar');
  el.style.opacity = pct > 0 && pct < 100 ? '1' : '0';
  el.style.width = pct + '%';
}

let firstScan = true;
function afterScan(){
  if (!S.animes.length){
    toast('Aucune vidéo trouvée dans « ' + S.rootName + ' »', 'bad');
    return;
  }
  appliquerTitres();
  $('#welcome').hidden = true;
  $('#topbar').hidden = false;
  $('#tipFolder').textContent = S.rootName ? 'Dossier : ' + S.rootName : 'Changer de dossier';
  const known = store.get('seen', []);
  const now = S.animes.flatMap(a => a.episodes.map(e => e.rel));
  const fresh = firstScan ? [] : now.filter(r => !known.includes(r));
  store.set('seen', now);
  S.freshSet = new Set(firstScan ? [] : fresh);
  if (!firstScan && fresh.length) toast(fmtCount(fresh.length, 'nouvel épisode détecté', 'nouveaux épisodes détectés'), 'ok');
  firstScan = false;
  render();
}
