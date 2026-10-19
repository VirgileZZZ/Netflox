/* Avant les scripts de la page.
 *
 * 1. Au tout premier lancement, ce qu'Opera gardait pour Netflox est pose
 *    dans le stockage de l'app. Seulement s'il est encore vide — on n'ecrase
 *    jamais ce que l'app a deja appris.
 * 2. window.netfloxApp.compte: le compte de l'hote, lu et ecrit par l'app
 *    sur le disque, la ou le serveur de partage le range (js/16-compte.js).
 */
'use strict';
const { ipcRenderer, contextBridge } = require('electron');

if (location.protocol === 'file:'){
  try {
    const recu = ipcRenderer.sendSync('netflox:import');
    if (recu && recu.cles){
      let vide = true;
      for (let i = 0; i < localStorage.length; i++)
        if (localStorage.key(i).startsWith('ad2.')){ vide = false; break; }
      let n = 0;
      if (vide){
        for (const [k, v] of Object.entries(recu.cles)){
          try { localStorage.setItem(k, v); n++; } catch(e){}
        }
      }
      ipcRenderer.sendSync('netflox:import-fait', n);
    }
  } catch(e){}

  contextBridge.exposeInMainWorld('netfloxApp', {
    compte: {
      // { pseudo, hote, donnees }, ou null; siChange: null aussi quand rien n'a bouge depuis
      lire: (siChange) => ipcRenderer.sendSync('netflox:compte-lire', !!siChange),
      // part tout de suite au processus de l'app, qui ecrit meme si la page s'en va
      sauver: (donnees) => ipcRenderer.send('netflox:compte-sauver', donnees)
    }
  });
}
