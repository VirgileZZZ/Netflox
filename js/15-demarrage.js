/* 15-demarrage.js
 *
 * Le demarrage: on cherche un dossier voisin, puis un dossier deja autorise.
 *
 * Charge par index.html, dans l'ordre. Script classique et non module:
 * une page ouverte en file:// ne peut pas charger de module — le navigateur
 * y voit une requete inter-origines et la refuse. Tous ces fichiers
 * partagent donc la meme portee globale, exactement comme quand ils ne
 * faisaient qu'un. L'ordre compte: il est celui de la liste dans la page.
 */
"use strict";
/* ======================================================= démarrage == */
(async function boot(){
  try {
    reparerRenommages();
    // 1. dossiers voisins (videos/, video/, .) — sans rien demander
    if (await autoDetect()) return;
    // 2. dossier déjà autorisé lors d'une session précédente
    if (await restoreFolder()) return;
  } finally {
    // l'ecran de chargement s'en va: la bibliotheque est la, ou l'accueil prend le relais
    document.documentElement.classList.remove('demarrage');
  }
  // 3. sinon seulement, on demande
  const note = $('#fsNote');
  const bits = [];
  bits.push(location.protocol === 'file:'
    ? 'Page ouverte en local : le navigateur interdit de lire un dossier sans ton accord. Un seul clic et c\'est réglé.'
    : 'Aucun dossier <code>videos</code> à côté de la page — choisis-le à la main.');
  bits.push(fsaAvailable()
    ? 'Le dossier est demandé en lecture <b>et écriture</b> : c\'est ce qui permet d\'enregistrer tes catégories ' +
      'et tes repères de générique dans un petit <code>' + SIDECAR + '</code> à côté de chaque série. Aucune vidéo n\'est modifiée.'
    : 'Ton navigateur ne sait pas mémoriser le dossier ; avec <b>Chrome</b> ou <b>Edge</b>, il est retrouvé tout seul.');
  const last = store.get('root', null);
  if (last) bits.push('Dernier dossier utilisé : <code>' + esc(last) + '</code>');
  note.innerHTML = bits.join('<br>');
})();
