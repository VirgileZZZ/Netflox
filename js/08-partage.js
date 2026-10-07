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
  const imdb = {}, epImdb = {}, descs = {}, titres = {}, spoils = {}, cadrages = {};
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
    if (typeof d.affiche_x === 'number') cadrages[key] = d.affiche_x;
    for (const [rel, t] of Object.entries(d.titres_episodes || {}))
      if (titreUtile(t)) titres[key + '/' + rel] = titreUtile(t);
    adopterInvites(key, d.notes_invites);
    // l'invite ne se fait pas spoiler non plus: les reperes de l'hote valent pour lui
    for (const [rel, v] of Object.entries(d.spoil_edits || {}))
      if (typeof v === 'string' && v) spoils[key + '/' + rel] = v;
    for (const [champ, ou] of [['generiques', intro], ['generiques_fin', outro]]){
      for (const [rel, seg] of Object.entries(d[champ] || {})){
        if (seg && typeof seg.start === 'number' && typeof seg.end === 'number' && seg.end > seg.start)
          ou[key + '/' + rel] = { start: seg.start, end: seg.end };
      }
    }
  }
  S.host = { cats, favs, intro, outro, notes, epNotes, imdb, epImdb, descs, titres, spoils, cadrages };

  /* Rien n'annonce le partage a l'ecran: le bandeau disait deux fois ce que
     l'invite constate de toute facon. Les droits, eux, ne changent pas —
     S.shared reste vrai et lectureSeule() refuse toujours les ecritures. */
  // Changer de dossier ne veut rien dire ici: la collection vient du reseau,
  // en ouvrir un local ne ferait que la remplacer.
  const dossier = $('#btnFolder');
  if (dossier) dossier.hidden = true;
  demanderQuiJeSuis();
}
/* Le serveur dit qui regarde: sa propre machine (l'hote, qui note dans sa
   fiche) ou un invite. Un serveur d'avant ne repond pas: les etoiles restent
   en lecture seule, comme elles l'etaient. */
async function demanderQuiJeSuis(){
  try {
    const r = await fetch('__moi?i=' + encodeURIComponent(inviteId()), { cache:'no-store' });
    const d = r.ok ? await r.json() : null;
    if (!d || typeof d.hote !== 'boolean') return;
    S.peutNoter = true;
    S.estHote = d.hote;
    S.monVote = d.monVote || null;
    // rescanner le dossier de l'hote ne veut rien dire pour un invite
    const rf = $('#btnRefresh'); if (rf) rf.hidden = !d.hote;

    majNotes();
    compteAuDemarrage(d);

  } catch(e){}
}
/* Apres une connexion, l'identifiant de vote peut avoir change (celui du
   compte): on redemande son empreinte, pour retrouver ses notes. */
async function rafraichirMonVote(){
  try {
    const d = await (await fetch('__moi?i=' + encodeURIComponent(inviteId()), { cache:'no-store' })).json();
    S.monVote = d.monVote || null;
    S.estHote = !!d.hote;
    majNotes();
  } catch(e){}
}
/** Une note posee depuis un lien de partage part chez l'hote. On l'affiche

    tout de suite, et on la retire si le serveur la refuse. */
async function envoyerNote(cible, val){
  const avant = S.estHote ? null : Object.assign({}, S.invites[cible] || {});
  const ep = cible.startsWith('e:'), id = cible.slice(2);
  const table = S.estHote ? (ep ? S.host.epNotes : S.host.notes) : null;
  const ancienne = table ? table[id] : undefined;
  const poser = (v) => {
    if (table){ if (v) table[id] = v; else delete table[id]; return; }
    const votes = S.invites[cible] || (S.invites[cible] = {});
    const moi = S.monVote || inviteId();
    if (v) votes[moi] = v; else delete votes[moi];
  };
  poser(val);
  majNotes();
  let ok = false;
  try {
    const r = await fetch('__noter', { method:'POST', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ cible, note: val, invite: inviteId() }) });
    ok = r.ok && (await r.json()).ok;
  } catch(e){}
  if (ok) return;
  if (table){ if (ancienne) table[id] = ancienne; else delete table[id]; }
  else S.invites[cible] = avant;
  majNotes();
  toast('Note non enregistrée : le partage ne répond pas', 'bad');
}

/** Un geste d'écriture sur une bibliothèque partagée: on explique, on refuse. */
function lectureSeule(){
  if (!S.shared) return false;
  toast('Bibliothèque partagée par son hôte : lecture seule', 'bad');
  return true;
}
