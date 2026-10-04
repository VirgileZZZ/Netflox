/* 08-partage.js
 *
 * L'adoption d'une bibliotheque recue par un lien de partage.
 *
 * Charge par index.html, dans l'ordre. Script classique et non module:
 * une page ouverte en file:// ne peut pas charger de module — le navigateur
 * y voit une requete inter-origines et la refuse. Tous ces fichiers
 * partagent donc la meme portee globale, exactement comme quand ils ne
 * faisaient qu'un. L'ordre compte: il est celui de la liste dans la page.
 */
"use strict";
/* =========================================== bibliothèque partagée == */
/* Le script de partage joint au manifeste les fichiers d'accompagnement de
   l'hôte: ses catégories, ses repères de générique. L'invité les
   lit — le bouton « passer le générique » marche donc chez lui aussi — mais il
   ne les touche pas: rien de ce qu'il ferait ici ne pourrait revenir sur le
   disque de l'hôte, et une modification qui ne mène nulle part vaut moins
   qu'un refus franc. Sa progression, elle, reste la sienne. */
function adopterFiches(fiches){
  S.shared = true;
  const cats = {}, intro = {}, outro = {}, notes = {}, epNotes = {};
  const imdb = {}, epImdb = {}, descs = {}, titres = {};
  const favs = {};                               // jamais rempli: les favoris ne se partagent pas
  for (const [key, d] of Object.entries(fiches || {})){
    if (!d || typeof d !== 'object') continue;
    if (Array.isArray(d.categories)){
      const l = d.categories.filter(c => typeof c === 'string');
      if (l.length) cats[key] = l;
    }
    if (typeof d.note === 'number') notes[key] = d.note;
    for (const [rel, v] of Object.entries(d.notes_episodes || {}))
      if (typeof v === 'number') epNotes[key + '/' + rel] = v;
    if (typeof d.note_imdb === 'number') imdb[key] = d.note_imdb;
    for (const [rel, v] of Object.entries(d.notes_episodes_imdb || {}))
      if (typeof v === 'number') epImdb[key + '/' + rel] = v;
    if (typeof d.description === 'string') descs[key] = d.description;
    for (const [rel, t] of Object.entries(d.titres_episodes || {}))
      if (titreUtile(t)) titres[key + '/' + rel] = titreUtile(t);
    for (const [champ, ou] of [['generiques', intro], ['generiques_fin', outro]]){
      for (const [rel, seg] of Object.entries(d[champ] || {})){
        if (seg && typeof seg.start === 'number' && typeof seg.end === 'number' && seg.end > seg.start)
          ou[key + '/' + rel] = { start: seg.start, end: seg.end };
      }
    }
  }
  S.host = { cats, favs, intro, outro, notes, epNotes, imdb, epImdb, descs, titres };
  /* Rien n'annonce le partage a l'ecran: le bandeau disait deux fois ce que
     l'invite constate de toute facon. Les droits, eux, ne changent pas —
     S.shared reste vrai et lectureSeule() refuse toujours les ecritures. */
  // Changer de dossier ne veut rien dire ici: la collection vient du reseau,
  // en ouvrir un local ne ferait que la remplacer.
  const dossier = $('#btnFolder');
  if (dossier) dossier.hidden = true;
}
/** Un geste d'écriture sur une bibliothèque partagée: on explique, on refuse. */
function lectureSeule(){
  if (!S.shared) return false;
  toast('Bibliothèque partagée par son hôte : lecture seule', 'bad');
  return true;
}
