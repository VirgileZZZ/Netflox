/* sw.js — ce qui rend Netflox installable (icone sur l'ecran d'accueil,
 * plein ecran sans barre d'adresse) et l'ouvre meme quand le reseau flanche.
 *
 * Prudent par principe:
 *  - le code de la page (html, js, icones) est toujours demande au reseau
 *    d'abord: une mise a jour arrive tout de suite. La copie gardee ne sert
 *    que si le reseau ne repond pas;
 *  - les videos, l'index de la bibliotheque, les notes et les comptes ne sont
 *    jamais mis en cache: ils doivent etre frais, et pesent des gigaoctets.
 */
const CACHE = 'netflox-v1';
const COQUILLE = ['./', 'index.html', 'manifest.webmanifest', 'icones/netflox.svg', 'icones/netflox-192.png'];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(COQUILLE)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (ev) => {
  ev.waitUntil(caches.keys().then(l => Promise.all(l.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
function aGarder(url){
  const p = url.pathname;
  if (p.includes('/__')) return false;                       // notes, comptes, qui-suis-je
  if (/\/videos?\//.test(p)) return false;                   // medias, sous-titres, pistes
  if (p.endsWith('bibliotheque-index.json')) return false;   // toujours frais
  return /\/$|\.(html|js|css|webmanifest|svg|png)$/.test(p);
}
self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !aGarder(url)) return;
  ev.respondWith(
    fetch(req).then(rep => {
      if (rep.ok){ const copie = rep.clone(); caches.open(CACHE).then(c => c.put(req, copie)); }
      return rep;
    }).catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
