/* 04-dossier.js
 *
 * Choisir le dossier de la bibliotheque, et le retrouver d'une fois sur l'autre.
 *
 * Charge par index.html, dans l'ordre. Script classique et non module:
 * une page ouverte en file:// ne peut pas charger de module — le navigateur
 * y voit une requete inter-origines et la refuse. Tous ces fichiers
 * partagent donc la meme portee globale, exactement comme quand ils ne
 * faisaient qu'un. L'ordre compte: il est celui de la liste dans la page.
 */
"use strict";
/* ================================================== choix du dossier == */
function fsaAvailable(){
  try { return typeof window.showDirectoryPicker === 'function'; } catch(e){ return false; }
}
const idb = {
  open(){
    return new Promise((res, rej) => {
      let r;
      try { r = indexedDB.open('ad2', 1); } catch(e){ return rej(e); }
      r.onupgradeneeded = () => { try { r.result.createObjectStore('kv'); } catch(e){} };
      r.onsuccess = () => res(r.result);
      r.onerror   = () => rej(r.error);
    });
  },
  async set(k, v){
    const db = await idb.open();
    return new Promise((res, rej) => {
      const tx = db.transaction('kv','readwrite');
      tx.objectStore('kv').put(v, k);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  },
  async get(k){
    const db = await idb.open();
    return new Promise((res, rej) => {
      const tx = db.transaction('kv','readonly');
      const rq = tx.objectStore('kv').get(k);
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    });
  }
};

/* ------------------------------------------------------------------- */
/* Détection automatique : si la page est servie (http), on peut lire    */
/* l'index des dossiers voisins et tout charger sans rien demander.      */
/* En file://, le navigateur interdit la lecture d'un dossier sans       */
/* autorisation explicite : on retombe alors sur le dossier mémorisé.    */
/* ------------------------------------------------------------------- */
async function listDir(url){
  let res;
  try { res = await fetch(url, { cache:'no-store' }); } catch(e){ return null; }
  if (!res || !res.ok) return null;
  if (!/html/i.test(res.headers.get('content-type') || '')) return null;
  let doc;
  try { doc = new DOMParser().parseFromString(await res.text(), 'text/html'); } catch(e){ return null; }
  const out = [];
  for (const a of doc.querySelectorAll('a[href]')){
    const href = a.getAttribute('href');
    if (!href || /^[a-z]+:/i.test(href)) continue;              // liens absolus / externes
    if (href.startsWith('?') || href.startsWith('#')) continue; // tri des listings Apache
    if (href.startsWith('/') || href.startsWith('..')) continue;// remontée d'arborescence
    out.push(href);
  }
  return out;
}
// Les scans se comptent par milliers de pages: une collection complete depasse
// largement le nombre de videos, la limite doit suivre.
const CRAWL_BUDGET = 60000;
async function crawlHttp(base, budget){
  const files = [], seen = new Set();
  async function rec(url, parts, depth){
    if (depth > 6 || files.length >= budget) return;
    const links = await listDir(url);
    if (!links) return;
    for (const href of links){
      if (files.length >= budget) return;
      const full = url + href;
      if (seen.has(full)) continue;
      seen.add(full);
      let name;
      try { name = decodeURIComponent(href.replace(/\/+$/,'')); } catch(e){ name = href.replace(/\/+$/,''); }
      if (!name || name === '.') continue;
      if (href.endsWith('/')){
        if (shouldSkipDir(name)) continue;
        await rec(full, parts.concat(name), depth + 1);
      } else if (fichierUtile(parts.concat(name))){
        files.push({ path: parts.concat(name), size: 0, lastModified: 0, ref: { kind:'url', url: full } });
      }
    }
  }
  await rec(base, [], 0);
  return files;
}
async function fillMeta(files){
  let i = 0;
  const worker = async () => {
    while (i < files.length){
      const f = files[i++];
      try {
        const r = await fetch(f.ref.url, { method:'HEAD', cache:'no-store' });
        const len = r.headers.get('content-length');
        if (len) f.size = parseInt(len, 10) || 0;
        const lm = r.headers.get('last-modified');
        if (lm) f.lastModified = Date.parse(lm) || 0;
      } catch(e){}
      if ((i & 15) === 0) bar(50 + 44 * i / files.length);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
}
/* Sur un dossier partagé, explorer 26 000 fichiers à coups de requêtes prend
   des minutes. Le script de partage dépose un index tout prêt à la racine: on
   le lit d'un trait quand il est là, et on explore comme avant sinon. */
const MANIFEST = 'bibliotheque-index.json';
async function loadManifest(){
  let res;
  try { res = await fetch(MANIFEST, { cache:'no-store' }); } catch(e){ return null; }
  if (!res || !res.ok) return null;
  let data;
  try { data = await res.json(); } catch(e){ return null; }
  if (!data || !Array.isArray(data.files)) return null;
  const base = typeof data.base === 'string' && data.base ? data.base : 'videos/';
  const files = [];
  for (const row of data.files){
    if (!Array.isArray(row) || typeof row[0] !== 'string') continue;
    const parts = row[0].split('/').filter(Boolean);
    if (!parts.length || !fichierUtile(parts)) continue;
    files.push({
      path: parts,
      size: +row[1] || 0,
      lastModified: +row[2] || 0,
      ref: { kind:'url', url: base + parts.map(encodeURIComponent).join('/') }
    });
  }
  const fiches = (data.fiches && typeof data.fiches === 'object') ? data.fiches : null;
  return files.length ? { base, files, fiches, partage: !!data.partage } : null;
}

async function autoDetect(){
  if (location.protocol === 'file:') return false;
  bar(10);
  const man = await loadManifest();
  if (man){
    bar(60);
    S.mode = 'http';
    S.httpBase = man.base;
    S.rootName = man.base.replace(/\/$/,'') || 'ici';
    S.pendingFiles = man.files;
    if (man.partage) adopterFiches(man.fiches);
    await scan();
    return true;
  }
  for (const dir of AUTO_DIRS){
    const files = await crawlHttp(dir, CRAWL_BUDGET);
    if (!files.some(f => kindOf(f.path[f.path.length-1]) === 'video')) continue;
    bar(50);
    await fillMeta(files);
    S.mode = 'http';
    S.httpBase = dir;
    S.rootName = dir === './' ? (location.pathname.split('/').filter(Boolean).slice(-1)[0] || 'ici') : dir.replace(/\/$/,'');
    S.pendingFiles = files;
    await scan();
    return true;
  }
  bar(0);
  return false;
}

async function pickFolder(){
  if (fsaAvailable()){
    try {
      // lecture-ecriture: permet d'ecrire les reperes de generique dans les dossiers
      const handle = await window.showDirectoryPicker({ id:'anime-lib', mode:'readwrite' });
      S.dirHandle = handle; S.mode = 'fs'; S.rootName = handle.name;
      try { await idb.set('dir', handle); } catch(e){}
      await scan();
      return;
    } catch(e){
      if (e && e.name === 'AbortError') return;
      console.warn('showDirectoryPicker indisponible, bascule sur le sélecteur classique', e);
    }
  }
  $('#dirInput').click();
}

async function restoreFolder(){
  if (!fsaAvailable()) return false;
  let handle = null;
  try { handle = await idb.get('dir'); } catch(e){ return false; }
  if (!handle) return false;
  try {
    const perm = await handle.queryPermission({ mode:'readwrite' });
    if (perm !== 'granted') { showResume(handle); return true; }
    S.dirHandle = handle; S.mode = 'fs'; S.rootName = handle.name;
    await scan();
    return true;
  } catch(e){ return false; }
}

function showResume(handle){
  const box = $('#drop');
  box.innerHTML = '<button class="btn btn-primary" id="btnResume">Rouvrir « ' + esc(handle.name) + ' »</button>'
                + '<div class="wnote">Le navigateur redemande l\'autorisation à chaque session.</div>';
  const pied = $('#wLast');
  if (pied) pied.textContent = 'Dernier dossier : ' + handle.name;
  $('#btnResume').addEventListener('click', async () => {
    try {
      const p = await handle.requestPermission({ mode:'readwrite' });
      if (p !== 'granted') return toast('Autorisation refusée', 'bad');
      S.dirHandle = handle; S.mode = 'fs'; S.rootName = handle.name;
      await scan();
    } catch(e){ toast('Impossible de rouvrir le dossier', 'bad'); }
  });
}
