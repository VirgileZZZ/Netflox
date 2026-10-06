/* 13-fil-edits.js
 *
 * Le fil des edits: affichage, mesure du temps passe, j'aime, retri.
 *
 * Charge par index.html, dans l'ordre. Script classique et non module:
 * une page ouverte en file:// ne peut pas charger de module — le navigateur
 * y voit une requete inter-origines et la refuse. Tous ces fichiers
 * partagent donc la meme portee globale, exactement comme quand ils ne
 * faisaient qu'un. L'ordre compte: il est celui de la liste dans la page.
 */
"use strict";
/* ==================================================== fil des edits == */
/* Niveau sonore des edits, mesure une fois pour toutes.
   D'un fichier a l'autre l'ecart atteint 30 dB: le plus fort tape a -2,1 LUFS,
   le plus faible a -31,7. La table dit de combien baisser chacun pour qu'ils
   sortent tous au meme niveau, -20 LUFS. Une balise <video> ne sait que
   baisser le son, jamais le monter: les 22 edits deja plus faibles que -20 ne
   sont donc pas dans la table et passent tels quels. Ce sont les seuls qui
   restent en retrait, et seul un reencodage du fichier les remonterait.
   Un edit ajoute apres la mesure vaut 1: il ne change pas de niveau.
   Pour refaire la mesure d'un fichier:
     ffmpeg -i <fichier> -af ebur128=framelog=quiet -f null -    (ligne « I: »)
     gain = 10 ^ ((-20 - I) / 20), borne entre 0,1 et 1 */
const ED_GAINS = {
  "Dragon Ball Super/edits/v12044gd0000d9use4nog65vqem114b0.mov": 0.501,
  "Dragon Ball Super/edits/v14044g50000dad10nfog65jn3vgr8r0.mov": 0.427,
  "Dragon Ball Super/edits/v1c044g50000dabgs07og65jk5n7ukn0.mov": 0.224,
  "Dragon Ball Super/edits/v26044gc0000dae4qtvog65kej9ug3cg.mov": 0.211,
  "Dragon Ball Z/edits/v12025gd0000d9s7ht7og65jsds7beu0.mov": 0.24,
  "Dragon Ball Z/edits/v12044gd0000d41v2anog65ob1nv7ntg.mov": 0.457,
  "Dragon Ball Z/edits/v15025gf0000d56t8dnog65okv9e7r5g.mp4": 0.191,
  "Dragon Ball Z/edits/v26044gc0000d8qj7cnog65s74egrj3g.mov": 0.759,
  "Dragon Ball Z/edits/v26044gc0000dae0tbnog65gdjnnq8a0.mov": 0.226,
  "Game-of-Thrones-720p-vostfr/edits/v10025g50000d45njffog65qu8m81dp0.mov": 0.295,
  "Game-of-Thrones-720p-vostfr/edits/v14044g50000d33fmtnog65rccdsled0.mov": 0.367,
  "Game-of-Thrones-720p-vostfr/edits/v24025gl0000d2vfhc7og65panq0i72g.mov": 0.668,
  "Game-of-Thrones-720p-vostfr/edits/v24025gl0000d36314vog65l0kn8vl90.mov": 0.316,
  "Game-of-Thrones-720p-vostfr/edits/v24044gl0000d4gpie7og65uugm540vg.mov": 0.582,
  "chainsaw-man-720p-vostfr/edits/v09025g40000d4ct237og65pt6d7mgeg.mov": 0.172,
  "cyberpunk-edgerunners-720p-vostfr/edits/v15044gf0000d9b5pffog65pvpd68390.mov": 0.398,
  "cyberpunk-edgerunners-720p-vostfr/edits/v24044gl0000da3p4gnog65pu92l3oag.mov": 0.891,
  "death-note-720p-vostfr/edits/ScreenRecording_09-05-2026 10-53-06_1.mov": 0.292,
  "death-note-720p-vostfr/edits/export_1788603271095.mov": 0.437,
  "death-note-720p-vostfr/edits/v10025g50000d8nsmj7og65la8vji9pg.mov": 0.232,
  "death-note-720p-vostfr/edits/v12044gd0000da2ja0fog65g8lr1jr70.mov": 0.653,
  "death-note-720p-vostfr/edits/v12044gd0000dad25o7og65sgm4ai530.mov": 0.653,
  "death-note-720p-vostfr/edits/v14044g50000d9qfol7og65jj9jkqms0.mov": 0.537,
  "death-note-720p-vostfr/edits/v14044g50000da0b11fog65qcio5kj2g.mov": 0.603,
  "death-note-720p-vostfr/edits/v15044gf0000da7psqvog65lpj6bc49g.mov": 0.316,
  "death-note-720p-vostfr/edits/v1c025g50000d9ju567og65up9rohfi0.mov": 0.389,
  "death-note-720p-vostfr/edits/v1c044g50000d8v5ttnog65nrk4j0n70.mov": 0.305,
  "death-note-720p-vostfr/edits/v1c044g50000d911cr7og65hnhqr7k80.mov": 0.468,
  "death-note-720p-vostfr/edits/v1c044g50000d94b1hfog65rf1m7nos0.mov": 0.531,
  "death-note-720p-vostfr/edits/v1c044g50000d988m4fog65highn4clg.mov": 0.495,
  "death-note-720p-vostfr/edits/v1c044g50000d9irfcfog65vu1pado3g.mov": 0.519,
  "death-note-720p-vostfr/edits/v1c044g50000da2laivog65r2k3dkuj0.mov": 0.525,
  "death-note-720p-vostfr/edits/v24044gl0000da7hu97og65m3brgih20.mov": 0.219,
  "death-note-720p-vostfr/edits/v24044gl0000dad9vsfog65gb0ccjiag.mov": 0.343,
  "death-note-720p-vostfr/edits/v26044gc0000d9d8c6fog65lcn762teg.mov": 0.309,
  "death-note-720p-vostfr/edits/v26044gc0000d9rlstnog65r9k0lu02g.mov": 0.359,
  "death-note-720p-vostfr/edits/v26044gc0000d9vjio7og65glfb82nh0.mov": 0.229,
  "death-note-720p-vostfr/edits/v26044gc0000da5k06vog65ss7v6tu8g.mov": 0.279,
  "demon-slayer-720p-vostfr/edits/v14044g50000dadpr3vog65u66petia0.mov": 0.407,
  "invincible-720p-vostfr/edits/v12044gd0000d7anhpfog65hpa452vrg.mov": 0.495,
  "invincible-720p-vostfr/edits/v14044g50000d6t9k3fog65ut3cr9p90.mov": 0.708,
  "invincible-720p-vostfr/edits/v14044g50000d6vd8ufog65kehmmhe3g.mov": 0.232,
  "invincible-720p-vostfr/edits/v15044gf0000d5h670vog65i1gvveodg.mov": 0.556,
  "invincible-720p-vostfr/edits/v15044gf0000d71gs97og65hl8an0mvg.mov": 0.412,
  "invincible-720p-vostfr/edits/v1c044g50000d6tl22vog65vjmrp6tv0.mov": 0.351,
  "invincible-720p-vostfr/edits/v1c044g50000d7meelnog65ms95s6k60.mov": 0.363,
  "invincible-720p-vostfr/edits/v24044gl0000d6g70snog65kofvgelk0.mov": 0.24,
  "invincible-720p-vostfr/edits/v24044gl0000d70ju07og65jq6m8k7mg.mov": 0.209,
  "invincible-720p-vostfr/edits/v26044gc0000d383e77og65sf20h1o00.mov": 0.437,
  "jujutsu-kaisen-720p-vostfr/edits/export_1788008560318.mov": 0.407,
  "jujutsu-kaisen-720p-vostfr/edits/export_1788687175580.mov": 0.389,
  "jujutsu-kaisen-720p-vostfr/edits/export_1788707199935.mov": 0.537,
  "jujutsu-kaisen-720p-vostfr/edits/v09025g40000d3igcmfog65jp2hh6mh0.mov": 0.221,
  "jujutsu-kaisen-720p-vostfr/edits/v12025gd0000dadat5vog65t2k4tpimg.mov": 0.266,
  "jujutsu-kaisen-720p-vostfr/edits/v12044gd0000d8q3kdvog65jom7o42pg.mov": 0.741,
  "jujutsu-kaisen-720p-vostfr/edits/v12044gd0000d93dkqfog65ibh7pmr1g.mov": 0.422,
  "jujutsu-kaisen-720p-vostfr/edits/v14025g50000d9hlr57og65v43ashfd0.mov": 0.176,
  "jujutsu-kaisen-720p-vostfr/edits/v14044g50000d9trnp7og65kfq5lge00.mov": 0.531,
  "jujutsu-kaisen-720p-vostfr/edits/v14044g50000dadgcvnog65uqpi5aiog.mov": 0.473,
  "jujutsu-kaisen-720p-vostfr/edits/v14044g50000dae3tofog65r521krclg.mov": 0.427,
  "jujutsu-kaisen-720p-vostfr/edits/v15044gf0000d4mqqrfog65opb9675r0.mov": 0.407,
  "jujutsu-kaisen-720p-vostfr/edits/v15044gf0000da5444fog65pmcn82j70.mov": 0.182,
  "jujutsu-kaisen-720p-vostfr/edits/v15044gf0000dade56nog65hh0nijlf0.mov": 0.219,
  "jujutsu-kaisen-720p-vostfr/edits/v1c025g50000dadlhjnog65pd12e0pvg.mov": 0.209,
  "jujutsu-kaisen-720p-vostfr/edits/v24025gl0000d43pumnog65soe4c08kg.mov": 0.188,
  "jujutsu-kaisen-720p-vostfr/edits/v24025gl0000d8ra4enog65j7v9tsmqg.mov": 0.285,
  "jujutsu-kaisen-720p-vostfr/edits/v24044gl0000d5g4tbnog65qqkupupj0.mp4": 0.716,
  "jujutsu-kaisen-720p-vostfr/edits/v24044gl0000d96njj7og65qb16utbh0.mov": 0.38,
  "jujutsu-kaisen-720p-vostfr/edits/v26044gc0000da9dkq7og65ul5k3lbu0.mov": 0.324,
  "jujutsu-kaisen-720p-vostfr/edits/v26044gc0000daelhcvog65r0gk4t380.mov": 0.207,
  "mushoku-tensei-720p-vostfr/edits/ScreenRecording_07-28-2026 22-07-25_1.mov": 0.305,
  "mushoku-tensei-720p-vostfr/edits/ScreenRecording_07-30-2026 14-04-31_1.mov": 0.305,
  "mushoku-tensei-720p-vostfr/edits/ScreenRecording_08-23-2026 10-59-33_1.mov": 0.412,
  "mushoku-tensei-720p-vostfr/edits/ScreenRecording_08-28-2026 10-32-07_1_576x576.mp4": 0.513,
  "mushoku-tensei-720p-vostfr/edits/any_more_wifes.MOV": 0.313,
  "mushoku-tensei-720p-vostfr/edits/export_1784916812383.mov": 0.7,
  "mushoku-tensei-720p-vostfr/edits/export_1785332900917.mov": 0.531,
  "mushoku-tensei-720p-vostfr/edits/export_1785335429622.mov": 0.923,
  "mushoku-tensei-720p-vostfr/edits/export_1785357893558.mov": 0.452,
  "mushoku-tensei-720p-vostfr/edits/export_1785410456201.mov": 0.372,
  "mushoku-tensei-720p-vostfr/edits/export_1785413399607.mov": 0.501,
  "mushoku-tensei-720p-vostfr/edits/export_1785433237919.mov": 0.617,
  "mushoku-tensei-720p-vostfr/edits/export_1785451827098.mov": 0.55,
  "mushoku-tensei-720p-vostfr/edits/export_1785497722085.mov": 0.841,
  "mushoku-tensei-720p-vostfr/edits/export_1785512953958.mov": 0.624,
  "mushoku-tensei-720p-vostfr/edits/export_1785560404618.mov": 0.422,
  "mushoku-tensei-720p-vostfr/edits/export_1785618541776.mov": 0.462,
  "mushoku-tensei-720p-vostfr/edits/export_1785675935929.mov": 0.61,
  "mushoku-tensei-720p-vostfr/edits/export_1787767714319.mov": 0.507,
  "mushoku-tensei-720p-vostfr/edits/export_1787917012185.mov": 0.479,
  "mushoku-tensei-720p-vostfr/edits/v10025g50000dad61unog65mgodhv45g.mp4": 0.138,
  "mushoku-tensei-720p-vostfr/edits/v12025gd0000d9nkgkvog65k37m7ctj0.mov": 0.282,
  "mushoku-tensei-720p-vostfr/edits/v12044gd0000d7sfqsvog65jr69r05t0.mov": 0.427,
  "mushoku-tensei-720p-vostfr/edits/v12044gd0000d8287rfog65ioetk5t80.mov": 0.372,
  "mushoku-tensei-720p-vostfr/edits/v12044gd0000d8is9nnog65qgti86vpg.mov": 0.335,
  "mushoku-tensei-720p-vostfr/edits/v12044gd0000d8j041fog65m5k4670e0.mov": 0.257,
  "mushoku-tensei-720p-vostfr/edits/v12044gd0000d8j094fog65r2k7nhn40.mov": 0.269,
  "mushoku-tensei-720p-vostfr/edits/v12044gd0000d8k7pknog65h10ehb070.mov": 0.372,
  "mushoku-tensei-720p-vostfr/edits/v12044gd0000d8np35vog65pas88hd40.mov": 0.589,
  "mushoku-tensei-720p-vostfr/edits/v12044gd0000d8q4qr7og65hs59mt4ig.mov": 0.219,
  "mushoku-tensei-720p-vostfr/edits/v12044gd0000d94iu2fog65vkpvrg2pg.mov": 0.412,
  "mushoku-tensei-720p-vostfr/edits/v12044gd0000d94m40vog65nenl3pj7g.mov": 0.234,
  "mushoku-tensei-720p-vostfr/edits/v12044gd0000d959kbnog65pln3jdq5g.mov": 0.299,
  "mushoku-tensei-720p-vostfr/edits/v12044gd0000d980vefog65v20oq3oj0.mov": 0.174,
  "mushoku-tensei-720p-vostfr/edits/v12044gd0000d9aiqrfog65goavnv0kg.mov": 0.661,
  "mushoku-tensei-720p-vostfr/edits/v12044gd0000d9c1cdvog65ienv7nto0.mov": 0.871,
  "mushoku-tensei-720p-vostfr/edits/v12044gd0000d9gl5o7og65i90msqo4g.mov": 0.966,
  "mushoku-tensei-720p-vostfr/edits/v12044gd0000d9is0vfog65rtogebhcg.mov": 0.813,
  "mushoku-tensei-720p-vostfr/edits/v12044gd0000d9jcgtvog65r8b6jhp4g.mov": 0.226,
  "mushoku-tensei-720p-vostfr/edits/v12044gd0000d9qhkivog65me62tmii0.MP4": 0.229,
  "mushoku-tensei-720p-vostfr/edits/v12044gd0000da6d34vog65oqgad8r0g.mov": 0.279,
  "mushoku-tensei-720p-vostfr/edits/v14025g50000d8on47vog65ik1qghqjg.mov": 0.214,
  "mushoku-tensei-720p-vostfr/edits/v14025g50000d8s0nsnog65l39pt5gu0.mov": 0.155,
  "mushoku-tensei-720p-vostfr/edits/v14025g50000d97odc7og65m9br3smjg.mov": 0.452,
  "mushoku-tensei-720p-vostfr/edits/v14025g50000d9c9tsfog65kl1aufsf0.mov": 0.389,
  "mushoku-tensei-720p-vostfr/edits/v14025g50000d9hi92vog65og5d3u380.mov": 0.214,
  "mushoku-tensei-720p-vostfr/edits/v14025g50000d9l55gnog65urbfe096g.mov": 0.257,
  "mushoku-tensei-720p-vostfr/edits/v14025g50000d9qr7f7og65tn7slgh7g.mov": 0.313,
  "mushoku-tensei-720p-vostfr/edits/v14044g50000d956ujfog65j811eivp0.mov": 0.452,
  "mushoku-tensei-720p-vostfr/edits/v14044g50000d97urpnog65hn60mvuk0.mov": 0.331,
  "mushoku-tensei-720p-vostfr/edits/v14044g50000d9a1pdnog65o0r5tmkj0.mov": 0.224,
  "mushoku-tensei-720p-vostfr/edits/v14044g50000d9ghcmnog65s0i8kvkhg.mov": 0.394,
  "mushoku-tensei-720p-vostfr/edits/v15025gf0000d97j677og65p2qm3b7e0.MP4": 0.232,
  "mushoku-tensei-720p-vostfr/edits/v15025gf0000d9egko7og65i5rnghsl0.mov": 0.157,
  "mushoku-tensei-720p-vostfr/edits/v15044gf0000d8jjoofog65us0jc1u60.mov": 0.232,
  "mushoku-tensei-720p-vostfr/edits/v15044gf0000d8k4g7vog65m98najjr0.mov": 0.245,
  "mushoku-tensei-720p-vostfr/edits/v15044gf0000d9art9fog65sregpqd0g.mov": 0.813,
  "mushoku-tensei-720p-vostfr/edits/v15044gf0000d9e7pd7og65jf2rbvk90.mov": 0.575,
  "mushoku-tensei-720p-vostfr/edits/v15044gf0000d9hb61nog65srelgdupg.mov": 0.219,
  "mushoku-tensei-720p-vostfr/edits/v15044gf0000d9hkoqfog65pvb9u58ig.mov": 0.569,
  "mushoku-tensei-720p-vostfr/edits/v15044gf0000da13hmnog65qg5cna7ug.mov": 0.412,
  "mushoku-tensei-720p-vostfr/edits/v1c025g50000d8sgrg7og65hm56bl9vg.mov": 0.251,
  "mushoku-tensei-720p-vostfr/edits/v1c025g50000d955sffog65mp2fdtlcg.mov": 0.282,
  "mushoku-tensei-720p-vostfr/edits/v1c025g50000d9e2d17og65peaob5p70.mov": 0.195,
  "mushoku-tensei-720p-vostfr/edits/v1c025g50000da9s9tvog65n2j58giqg.mov": 0.127,
  "mushoku-tensei-720p-vostfr/edits/v1c044g50000d8bt0tnog65j19647040.mov": 0.372,
  "mushoku-tensei-720p-vostfr/edits/v1c044g50000d8c33fvog65vf8qfegng.mov": 0.624,
  "mushoku-tensei-720p-vostfr/edits/v1c044g50000d8h5dfvog65s5c51dgtg.mov": 0.184,
  "mushoku-tensei-720p-vostfr/edits/v1c044g50000d9a2297og65htt00360g.mov": 0.589,
  "mushoku-tensei-720p-vostfr/edits/v1c044g50000d9h00p7og65lfhk0tmng.mov": 0.305,
  "mushoku-tensei-720p-vostfr/edits/v1c044g50000d9i0lh7og65loqp4ptl0.mov": 0.832,
  "mushoku-tensei-720p-vostfr/edits/v1c044g50000d9l5857og65ge5v49230.mov": 0.285,
  "mushoku-tensei-720p-vostfr/edits/v1c044g50000d9o7b5nog65ue6tmro2g.mov": 0.624,
  "mushoku-tensei-720p-vostfr/edits/v24025gl0000d8kkif7og65it5vobd80.mov": 0.251,
  "mushoku-tensei-720p-vostfr/edits/v24025gl0000d8kmntvog65p76dcn5ug.mov": 0.232,
  "mushoku-tensei-720p-vostfr/edits/v24025gl0000d8upg6fog65h200our9g.mov": 0.272,
  "mushoku-tensei-720p-vostfr/edits/v24025gl0000d9b58f7og65ta3a83rj0.mov": 0.638,
  "mushoku-tensei-720p-vostfr/edits/v24025gl0000da4ugpfog65h14p3nd70.mov": 0.224,
  "mushoku-tensei-720p-vostfr/edits/v24044gl0000d82r937og65tc311mrl0.mov": 0.266,
  "mushoku-tensei-720p-vostfr/edits/v24044gl0000d86v6bnog65nh98kta20.mov": 0.367,
  "mushoku-tensei-720p-vostfr/edits/v24044gl0000d8g8l77og65m0am1so4g.mov": 0.841,
  "mushoku-tensei-720p-vostfr/edits/v24044gl0000d8ivgn7og65mfg0d1nrg.mov": 0.543,
  "mushoku-tensei-720p-vostfr/edits/v24044gl0000d8k908vog65p0dqjhpbg.mov": 0.861,
  "mushoku-tensei-720p-vostfr/edits/v24044gl0000d96p8hnog65qojqq1epg.mov": 0.372,
  "mushoku-tensei-720p-vostfr/edits/v24044gl0000d9762avog65n5f2elk4g.mov": 0.305,
  "mushoku-tensei-720p-vostfr/edits/v24044gl0000d986hb7og65o5jj7b5rg.mov": 0.251,
  "mushoku-tensei-720p-vostfr/edits/v24044gl0000d9if4g7og65ofr6pedn0.mov": 0.224,
  "mushoku-tensei-720p-vostfr/edits/v24044gl0000d9j5juvog65kmm8nkuog.mov": 0.272,
  "mushoku-tensei-720p-vostfr/edits/v24044gl0000d9jrj7vog65qqa1c39e0.mov": 0.245,
  "mushoku-tensei-720p-vostfr/edits/v24044gl0000d9l4udnog65geg9seun0.mov": 0.394,
  "mushoku-tensei-720p-vostfr/edits/v24044gl0000d9mf46fog65qojq8aj60.MP4": 0.531,
  "mushoku-tensei-720p-vostfr/edits/v24044gl0000d9mjkdvog65g99c11hr0.MP4": 0.24,
  "mushoku-tensei-720p-vostfr/edits/v24044gl0000d9n460nog65q3bt2q2s0.MP4": 0.295,
  "mushoku-tensei-720p-vostfr/edits/v26044gc0000d85d4cfog65q6mni2fe0.mov": 0.398,
  "mushoku-tensei-720p-vostfr/edits/v26044gc0000d8qo1j7og65nmvb9bj80.mov": 0.955,
  "mushoku-tensei-720p-vostfr/edits/v26044gc0000d8uno6fog65mqe6rbqd0.mov": 0.243,
  "mushoku-tensei-720p-vostfr/edits/v26044gc0000d959conog65n2no4bkfg.mov": 0.638,
  "mushoku-tensei-720p-vostfr/edits/v26044gc0000d97ft8vog65k5pespptg.mov": 0.813,
  "mushoku-tensei-720p-vostfr/edits/v26044gc0000d98fcdvog65i2gmll2eg.mp4": 0.462,
  "mushoku-tensei-720p-vostfr/edits/v26044gc0000d99ubd7og65u1q8vmpo0.mov": 0.266,
  "mushoku-tensei-720p-vostfr/edits/v26044gc0000d9a0ns7og65teu7lclgg.mov": 0.452,
  "mushoku-tensei-720p-vostfr/edits/v26044gc0000d9ajdk7og65uut37fa50.mov": 0.955,
  "mushoku-tensei-720p-vostfr/edits/v26044gc0000d9b8ionog65k406tdgcg.mov": 0.245,
  "mushoku-tensei-720p-vostfr/edits/v26044gc0000d9bkq5vog65rsluadrc0.mov": 0.61,
  "mushoku-tensei-720p-vostfr/edits/v26044gc0000d9d3b4vog65i1i0b4itg.mov": 0.495,
  "mushoku-tensei-720p-vostfr/edits/v26044gc0000d9hqttnog65i2gmmhdug.mov": 0.75,
  "mushoku-tensei-720p-vostfr/edits/v26044gc0000d9t0vlfog65ssotpqrv0.mov": 0.462,
  "mushoku-tensei-720p-vostfr/edits/v26044gc0000da1an5fog65v9on8cm9g.mov": 0.24,
  "mushoku-tensei-720p-vostfr/edits/v26044gc0000daa5quvog65ott0qrpig.mov": 0.316,
  "mushoku-tensei-720p-vostfr/edits/v29025g50000d9aip47og65h5f9ic040.mov": 0.575,
  "mushoku-tensei-720p-vostfr/edits/v29025g50000d9aqtj7og65qp36bcbjg.mov": 0.501,
  "mushoku-tensei-720p-vostfr/edits/v29025g50000da6tli7og65jvcum1kf0.mov": 0.292,
  "mushoku-tensei-720p-vostfr/edits/v29025g50000daccml7og65o4dtbptb0.mov": 0.197,
  "rick-et-morty-720p-vostfr/edits/ScreenRecording_07-30-2026 10-52-43_1.mov": 0.335,
  "rick-et-morty-720p-vostfr/edits/ScreenRecording_09-06-2026 17-05-58_1.mov": 0.407,
  "rick-et-morty-720p-vostfr/edits/export_1786057050792.mov": 0.417,
  "rick-et-morty-720p-vostfr/edits/export_1788707272831.mov": 0.501,
  "rick-et-morty-720p-vostfr/edits/export_1788707413791.mov": 0.582,
  "rick-et-morty-720p-vostfr/edits/v12044gd0000d8pgk3fog65pasceh1vg.mov": 0.166,
  "rick-et-morty-720p-vostfr/edits/v12044gd0000d97b127og65u4v90241g.mov": 0.575,
  "rick-et-morty-720p-vostfr/edits/v12044gd0000da4rrfvog65g59tfr250.mov": 0.543,
  "rick-et-morty-720p-vostfr/edits/v12044gd0000da8gk3fog65lhmus4neg.mov": 0.531,
  "rick-et-morty-720p-vostfr/edits/v12044gd0000dackm17og65t32nqkuag.mov": 0.197,
  "rick-et-morty-720p-vostfr/edits/v14025g50000da0utsvog65lsbqc05qg.mov": 0.343,
  "rick-et-morty-720p-vostfr/edits/v14044g50000d9ji0gfog65m5drd9u7g.mov": 0.61,
  "rick-et-morty-720p-vostfr/edits/v14044g50000d9upi1vog65olvbb67m0.mov": 0.266,
  "rick-et-morty-720p-vostfr/edits/v14044g50000da1i5gfog65r85ahpa00.mov": 0.407,
  "rick-et-morty-720p-vostfr/edits/v14044g50000da4glo7og65ndtqpvo7g.MP4": 0.26,
  "rick-et-morty-720p-vostfr/edits/v14044g50000da65pnnog65p4d8312j0.mp4": 0.468,
  "rick-et-morty-720p-vostfr/edits/v14044g50000da852mfog65m9rbi21u0.mov": 0.389,
  "rick-et-morty-720p-vostfr/edits/v15044gf0000d9aiplnog65gl3j33egg.mov": 0.457,
  "rick-et-morty-720p-vostfr/edits/v1c044g50000d8mn3inog65qt8g2gsh0.mov": 0.596,
  "rick-et-morty-720p-vostfr/edits/v1c044g50000d9ic0i7og65t84mprp3g.mov": 0.305,
  "rick-et-morty-720p-vostfr/edits/v1c044g50000d9ssgkfog65m8tcjr080.mov": 0.257,
  "rick-et-morty-720p-vostfr/edits/v1c044g50000dac5a2nog65pogq1aum0.mov": 0.692,
  "rick-et-morty-720p-vostfr/edits/v24044gl0000d9lpnmvog65ofchog0h0.mov": 0.363,
  "rick-et-morty-720p-vostfr/edits/v24044gl0000dadf3jvog65nv7nkn7lg.mov": 0.272,
  "rick-et-morty-720p-vostfr/edits/v24044gl0000dadtjq7og65tlts9vof0.mov": 0.452,
  "shingeki-no-kyojin-720p-vostfr/edits/v29025g50000d95gihvog65v4lqna4jg.mov": 0.272,
  "the-quintessential-quintuplets-720p-vostfr/edits/export_1788707280513.mov": 0.617,
  "the-quintessential-quintuplets-720p-vostfr/edits/v1c044g50000dad9ip7og65l794fivlg.mov": 0.944,
  "tokyo-ghoul-720p-vostfr/edits/v1c025g50000d98i61nog65vugk15ju0.mov": 0.158,
  "tokyo-ghoul-720p-vostfr/edits/v1c025g50000d9bpiivog65kik0tiav0.mov": 0.214,
  "tokyo-ghoul-720p-vostfr/edits/v1c025g50000dadum7fog65jv7c13csg.mov": 0.186
};
/* Un fil vertical: une video par ecran, on fait defiler au pouce ou a la
   molette. Une seule source a la fois est branchee — ouvrir 116 fichiers
   d'un coup mettrait l'onglet a genoux — et on garde juste le voisinage
   pret pour que le suivant demarre sans attendre. */
const ED = $('#edits');
let edCtx = null, edObs = null, edCible = null, edCibleT = 0, edVuT = 0;
const edSrcs = new Map();            // index -> { url, revoke } (null = en cours)

const SVG_SON   = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 8.5a5 5 0 0 1 0 7"/></svg>';
const SVG_MUET  = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="m17 9 4 6m0-6-4 6"/></svg>';
const SVG_COEUR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 20.3 4.6 13a4.8 4.8 0 0 1 0-6.8 4.8 4.8 0 0 1 6.8 0l.6.6.6-.6a4.8 4.8 0 0 1 6.8 0 4.8 4.8 0 0 1 0 6.8z"/></svg>';
const SVG_COEUR_PLEIN = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 20.3 4.6 13a4.8 4.8 0 0 1 0-6.8 4.8 4.8 0 0 1 6.8 0l.6.6.6-.6a4.8 4.8 0 0 1 6.8 0 4.8 4.8 0 0 1 0 6.8z"/></svg>';
const SVG_LIRE  = '<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="m7 4 13 8-13 8z"/></svg>';

const ED_RATES = [1, 1.5, 2];
function edRate(){
  const v = store.get('edRate', 1);
  return ED_RATES.includes(v) ? v : 1;
}
function paintEdRate(){ $('#edRate').textContent = (edRate() + '').replace('.', ',') + '×'; }

/** Format, poids, et la definition reelle des que le fichier l'a annoncee. */
function edLegende(e, v){
  const bouts = [String(e.ext).toUpperCase(), fmtSize(e.size)];
  if (v && v.videoWidth) bouts.push(v.videoWidth + ' × ' + v.videoHeight);
  return bouts.join(' · ');
}

function edMuted(){ return store.get('edMute', false) === true; }
function edVolume(){
  const v = store.get('edVol', 1);
  return typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
}
/**
 * Le volume reellement pose sur la balise, pour un edit donne.
 *
 * Les edits ne viennent pas du meme endroit et n'ont pas ete montes par les
 * memes gens: d'un fichier a l'autre le niveau saute de plus de 20 dB, et on
 * passe son temps sur la molette. ED_GAINS porte, pour chacun, de combien il
 * faut le baisser pour qu'ils s'entendent tous pareil. Un fichier absent de la
 * table (un edit ajoute depuis la mesure) vaut 1: il passe tel quel, comme
 * avant. La glissiere reste le niveau general, par-dessus.
 */
/* Repli par nom de fichier: la table est indexee par chemin, or un dossier
   renomme change tous les chemins d'un coup et les edits repartiraient au
   volume d'origine, sans que rien ne le signale. Les noms sortis de TikTok
   sont uniques, ils suffisent a retrouver la mesure. */
let edGainsParNom = null;
function edGainDe(rel){
  if (typeof ED_GAINS[rel] === 'number') return ED_GAINS[rel];
  if (!edGainsParNom){
    edGainsParNom = {};
    for (const k of Object.keys(ED_GAINS)) edGainsParNom[k.slice(k.lastIndexOf('/') + 1)] = ED_GAINS[k];
  }
  const g = edGainsParNom[String(rel).slice(String(rel).lastIndexOf('/') + 1)];
  return typeof g === 'number' ? g : 1;
}
function edVolumeDe(e){
  return Math.max(0, Math.min(1, edVolume() * (e ? edGainDe(e.rel) : 1)));
}

/* Ce qu'on a deja regarde reste sur cet appareil, comme la progression: rien
   de tout ca ne part dans le fichier d'accompagnement ni dans le partage. */
let edVusCache = null;
function edVus(){ if (!edVusCache) edVusCache = store.get('edvus', {}) || {}; return edVusCache; }
function edMarquerVu(rel){
  const v = edVus();
  if (!rel || v[rel]) return;
  v[rel] = 1;
  store.set('edvus', v);
}

/* ------------------------------------------------ temps passé devant --
 * Ce qui nourrit l'ordre du fil: pour chaque edit, le nombre de passages, le
 * temps cumulé passé devant et sa durée. On mesure du moment où la diapo prend
 * la main à celui où on la quitte — pas le temps de lecture de la vidéo: un
 * fichier qui ne démarre pas et qu'on regarde quand même compte, et à
 * l'inverse une vidéo qui tourne dans un onglet caché ne compte pas.
 *
 * Comme la progression et les edits déjà vus, ça reste sur cet appareil. Rien
 * de ce qu'on regarde ne part dans le fichier d'accompagnement ni dans le lien
 * de partage: un invité ne doit pas pouvoir lire ce qui a plu ici.
 */
/* Secondes de media consommees en dessous desquelles un passage ne compte pas.
   Un rejet franc n'est plus dangereux a enregistrer depuis que l'attrait est
   lisse: on ecarte juste les evenements parasites. Plus de plafond ici — une
   mesure en temps de media est bornee par le clip lui-meme. */
const ED_DWELL_MIN = .15;
/* Un ecart de position superieur a ca entre deux rapports de lecture n'est pas
   du visionnage: c'est un saut dans la barre, ou un onglet qu'on a etrangle. */
const ED_SAUT_MAX = 2;
/* La boucle ne vaut un tour complet que si l'on repartait vraiment de la fin.
   Sans ce seuil, reculer dans la barre valait un visionnage entier. */
const ED_FIN_PROCHE = .85;
/* Delai avant d'ecrire les mesures. La table entiere fait 36 Ko; la reecrire a
   chaque diapo, en JSON et en synchrone, saccade le defilement sur telephone —
   precisement l'ecran ou il doit etre lisse. */
const ED_ECRITURE = 5000;
let edStatsCache = null;
let edDwellRel = null,        // l'edit en cours de mesure
    edDwellActif = false,     // la video tourne-t-elle
    edDwellAncre = -1,        // derniere position connue, en secondes de media
    edDwellCumul = 0,         // secondes de media deja consommees
    edDwellMax = 0,           // position la plus avancee atteinte
    edDwellBoucle = false;    // la video a reboucle depuis la fin
function edStats(){ if (!edStatsCache) edStatsCache = store.get('edstats', {}) || {}; return edStatsCache; }
/* La table entiere pese 36 Ko. L'ecrire a chaque diapo, en JSON et en
   synchrone, saccade le defilement. On note qu'elle a bouge, et on la pose sur
   le disque quand le fil se calme — ou quand il se ferme, ce qui est le seul
   moment ou la perdre couterait quelque chose. */
let edStatsSale = false, edStatsMinuteur = 0;
function edStatsMarquer(){
  edStatsSale = true;
  clearTimeout(edStatsMinuteur);
  edStatsMinuteur = setTimeout(edStatsEcrire, ED_ECRITURE);
}
function edStatsEcrire(){
  clearTimeout(edStatsMinuteur);
  if (!edStatsSale) return;
  edStatsSale = false;
  store.set('edstats', edStats());
}
function edStatDe(rel){
  const st = edStats();
  if (!st[rel]) st[rel] = { n:0, t:0, tb:0, c:0, ko:0, j:0, d:0, at:0 };
  const s = st[rel];
  if (s.tb == null) s.tb = 0;
  if (s.c  == null) s.c  = 0;
  if (s.ko == null) s.ko = 0;
  if (s.j  == null) s.j  = 0;
  return s;
}
/* On mesure du media consomme, pas du temps qui passe.
 *
 * Deux versions ont ete fausses avant celle-ci. La premiere partait a la prise
 * de focus, donc le chargement comptait comme de l'attention — un biais
 * correle au poids du fichier, donc a la duree. La seconde chronometrait la
 * lecture a l'horloge murale, en ignorant la vitesse: a 1,5x, un clip regarde
 * en entier ne rapportait que les deux tiers de sa valeur.
 *
 * Additionner les avancees de currentTime regle les deux d'un coup, et aussi
 * le decrochage reseau: ce qui n'a pas ete joue n'est pas compte. Un ecart
 * trop grand entre deux rapports est un saut, pas du visionnage.
 */
function edDwellDebut(e){
  edDwellRel = e ? e.rel : null;
  edDwellActif = false; edDwellAncre = -1;
  edDwellCumul = 0; edDwellMax = 0; edDwellBoucle = false;
}
function edDwellMarche(v){
  if (!edDwellRel) return;
  edDwellActif = true;
  edDwellAncre = v && isFinite(v.currentTime) ? v.currentTime : -1;
}
function edDwellArret(){ edDwellActif = false; edDwellAncre = -1; }
/**
 * Un rapport de position. `compte` est faux pendant qu'on glisse dans la
 * barre: on suit alors la position sans rien en conclure, sinon explorer un
 * edit a la barre puis le rejeter s'enregistrait comme un visionnage entier.
 */
function edDwellAvance(v, compte){
  if (!edDwellRel || !v) return;
  const t = isFinite(v.currentTime) ? v.currentTime : 0;
  if (compte === false){ edDwellAncre = edDwellActif ? t : -1; return; }
  if (edDwellActif && edDwellAncre >= 0){
    const pas = t - edDwellAncre;
    if (pas > 0 && pas < ED_SAUT_MAX) edDwellCumul += pas;
  }
  edDwellAncre = edDwellActif ? t : -1;
  // un retour en arriere ne vaut un tour complet que s'il part de la fin
  const d = isFinite(v.duration) ? v.duration : 0;
  if (t + .35 < edDwellMax && d > 0 && edDwellMax >= ED_FIN_PROCHE * d) edDwellBoucle = true;
  if (t > edDwellMax) edDwellMax = t;
}
/* Un fichier qui ne se lit pas a quand meme occupe une place. Sans ce compte,
   il n'accumulerait plus rien — le chronometre ne tourne qu'a la lecture — et
   resterait donc « jamais consomme », donc toujours en tete, indefiniment. */
function edDwellEchec(rel){
  if (!rel) return;
  const s = edStatDe(rel);
  s.ko = Math.round((s.ko + 1) * 100) / 100;
  s.n  = Math.round((s.n + 1) * 1000) / 1000;
  s.at = Date.now();
  edStatsMarquer();
}
function edDwellFin(){
  edDwellArret();
  const rel = edDwellRel, secondes = edDwellCumul;
  const atteint = edDwellMax, boucle = edDwellBoucle;
  edDwellRel = null; edDwellCumul = 0; edDwellMax = 0; edDwellBoucle = false;
  if (!rel) return;
  if (secondes < ED_DWELL_MIN) return;
  const s = edStatDe(rel);
  const maintenant = Date.now();
  // Les compteurs vieillissent avant d'encaisser le passage: l'estimateur
  // suit la derive des gouts au lieu de la moyenner sur l'eternite. Le
  // rapport t/n reste a la meme echelle, seule sa memoire raccourcit.
  const gamma = s.at ? Math.pow(.5, (maintenant - s.at) / 86400000 / ED_DEMI_VIE) : 0;
  // ou l'on s'est arrete, entre 0 et 1. Duree inconnue: on ne prejuge de rien.
  const part = boucle ? 1
             : s.d > 0 ? Math.max(0, Math.min(1, atteint / s.d))
             : ED_NEUTRE;
  s.t  = Math.round((s.t  * gamma + Math.min(secondes, edPlafondPasse(s.d))) * 100) / 100;
  s.tb = Math.round((s.tb * gamma + Math.min(secondes, ED_BRUT_MAX)) * 100) / 100;
  s.c  = Math.round((s.c  * gamma + part) * 1000) / 1000;
  s.n  = Math.round((s.n  * gamma + 1) * 1000) / 1000;
  s.ko = Math.round(s.ko * gamma * 100) / 100;   // une lecture reussie efface l'echec
  s.at = maintenant;
  edStatsMarquer();
}
/** La durée du clip, connue seulement une fois le fichier ouvert. */
function edDureeEdit(rel, d){
  if (!rel || !(d > 0) || !isFinite(d)) return;
  const s = edStatDe(rel);
  const v = Math.round(d * 100) / 100;
  if (s.d === v) return;
  s.d = v;
  edStatsMarquer();
}
/** Ce que l'algorithme a besoin de savoir, ramassé au moment d'ouvrir le fil. */
/* Les mesures d'un edit disparu du disque ne servent plus a rien et ne
   s'effacent jamais toutes seules. On les jette a l'ouverture du fil, ou la
   bibliotheque complete est sous la main. */
function edPurgerStats(){
  const vivants = new Set();
  for (const a of S.animes) for (const e of a.edits) vivants.add(e.rel);
  if (!vivants.size) return 0;
  const st = edStats();
  let jetes = 0;
  for (const rel of Object.keys(st)) if (!vivants.has(rel)){ delete st[rel]; jetes++; }
  if (jetes) edStatsMarquer();
  return jetes;
}
function edContexte(){
  const commences = {};
  const maintenant = Date.now();
  let encours = null, recent = 0;
  for (const a of S.animes){
    const at = lastWatched(a);
    if (!at) continue;
    // une serie regardee aujourd'hui vaut 1, il y a deux mois 0,5, il y a un an 0,02
    commences[a.key] = Math.pow(.5, (maintenant - at) / 86400000 / ED_SUIVI_DEMI);
    if (at > recent){ recent = at; encours = a.key; }   // la serie en cours
  }
  return { stats: edStats(), commences, encours };
}
/* Un onglet caché n'est pas un regard: on ferme la mesure et on la rouvre au
   retour, sinon une nuit en arrière-plan ferait passer un edit pour un chef
   d'oeuvre. */
addEventListener('visibilitychange', () => {
  if (!ED || ED.hidden || !edCtx) return;
  if (document.hidden){ edDwellArret(); edStatsEcrire(); }
  else {
    const v = edVideo(edCtx.i);
    if (v && !v.paused) edDwellMarche(v);   // le navigateur n'a pas coupe la lecture
    edRetrier();
  }
});
/* ------------------------------------------- retri du suffixe --------
 * Un seul tirage a l'ouverture fige l'ordre pour toute la session: commencer
 * une oeuvre au troisieme edit laisse les deux cents suivants classes sans le
 * savoir. Recalculer en continu est exclu — reordonner sous le doigt deplace
 * la position de lecture — mais rien ne s'y oppose a un moment ou l'on ne fait
 * defiler rien: retour d'arriere-plan, ou franchissement d'un palier.
 *
 * On ne touche qu'au-dela de la fenetre de chargement, donc a des diapos dont
 * aucune video n'est branchee et qu'aucun oeil ne voit. Les positions ne
 * bougent pas — seul le contenu des diapos change — donc le defilement n'a
 * rien a rattraper, et la video en cours n'est jamais interrompue.
 */
const ED_RETRI_PALIER = 15;
const ED_RETRI_MIN = 8;      // en dessous, la queue est trop courte pour valoir le detour
function edRetrier(){
  if (!edCtx || ED.hidden || edCible !== null) return;
  const depart = edCtx.i + 3;        // i-1 a i+2 sont charges: on les laisse
  if (depart < 0 || edCtx.list.length - depart < ED_RETRI_MIN) return;
  /* Le tirage porte sur la bibliotheque entiere, pas sur le seul suffixe: les
     moyennes par oeuvre se calculent sur toute la population, sinon une oeuvre
     dont l'essentiel des mesures est deja passe serait mal estimee ici. On ne
     garde ensuite que ce qui appartient a la queue. */
  const aRevoir = new Set(edCtx.list.slice(depart).map(e => e.rel));
  let queue = fileEdits(edCtx.list, edVus(), edContexte()).list
                .filter(e => aRevoir.has(e.rel));
  // depuis une oeuvre, le retri garde les nouveaux debloques devant
  if (edCtx.priorite) queue = prioriserDebloques(queue, filtrerSpoils(queue).place);

  const rail = $('#edRail');
  for (let j = 0; j < queue.length; j++){
    const e = queue[j];
    edCtx.list[depart + j] = e;
    const s = rail.querySelector('[data-i="' + (depart + j) + '"]');
    if (!s) continue;
    const b = s.querySelector('.ed-cap b'), m = s.querySelector('.ed-meta');
    if (b) b.textContent = e.title;
    if (m) m.textContent = edLegende(e, null);
    const defaut = s.querySelector('.ed-bad');   // il appartenait a l'edit d'avant
    if (defaut) defaut.remove();
  }
}
function edSlide(i){ return edCtx ? $('#edRail').querySelector('[data-i="' + i + '"]') : null; }
function edVideo(i){ const s = edSlide(i); return s ? s.querySelector('video') : null; }

function openEdits(key, depart){
  const a = S.byKey.get(key);
  if (!a || !a.edits.length) return toast('Aucun edit dans cette série', 'bad');
  edSpoilsVisibles = false;
  edOuvrir(a.edits, a.title, depart, null, true);
}
/** Le fil de la bibliothèque entière: chaque edit annonce son œuvre en haut. */
function openEditsTous(depart){
  const edits = S.animes.flatMap(a => a.edits);
  if (!edits.length) return toast('Aucun edit dans la bibliothèque', 'bad');
  edSpoilsVisibles = false;
  edOuvrir(edits, 'Tous les edits', depart);
}
/* ------------------------------------------------- sans spoiler -------
 * Un edit montre l'histoire jusqu'a un episode, note dans annoter-edits.html.
 * Tant que cet episode n'est pas vu jusqu'au bout, l'edit reste hors du fil.
 * Un edit pas encore annote compte comme s'il montrait toute la serie: il
 * n'arrive qu'une fois la serie finie. Une oeuvre sans episode n'a rien a
 * gacher. Le bouton en haut a droite les montre tous, le temps d'une
 * ouverture: chaque fil repart protege.
 */
let edSpoilsVisibles = false;
function filtrerSpoils(edits){
  const spoils = spoilMap(), series = new Map();
  const garder = [], place = new Map();      // edit -> { jusque, vu }: ou il en est, ou on en est
  let caches = 0;
  for (const e of edits){
    const a = S.byKey.get(e.anime);
    if (!a || !a.episodes.length){ garder.push(e); continue; }
    let s = series.get(a.key);
    if (!s){
      let vu = -1;
      for (const ep of a.episodes){ const p = getProgress(ep); if (p && p.done && ep.idx > vu) vu = ep.idx; }
      const rang = new Map(a.episodes.map(ep => [ep.rel.slice(a.key.length + 1), ep.idx]));
      s = { vu, rang, fin: a.episodes.length - 1 };
      series.set(a.key, s);
    }
    const v = spoils[e.rel];
    // « suite »: plus loin que le dernier episode qu'on a — cache meme la serie
    // finie. Un episode disparu du disque: on ne sait plus, on suppose le pire.
    const jusque = v === 'aucun' ? -1 : v === 'suite' ? Infinity
                 : (v && s.rang.has(v) ? s.rang.get(v) : s.fin);

    place.set(e.rel, { jusque, vu: s.vu });
    if (jusque <= s.vu) garder.push(e); else caches++;
  }
  return { garder, caches, place };
}
/* Depuis la fiche d'une oeuvre, ce que les derniers episodes vus viennent
 * d'ouvrir passe devant: les edits pas encore vus et debloques, du plus avance
 * dans l'histoire au moins avance — l'episode 21 juste regarde d'abord, les
 * « aucun spoil » en dernier, eux etaient la depuis le debut. A episode egal,
 * l'ordre de l'algorithme tient (le tri est stable). Tout le reste suit dans
 * son ordre a lui, y compris ce que le bouton Spoilers montre en plus: un edit
 * encore verrouille ne passe jamais devant. Le fil de toute la bibliotheque,
 * lui, garde l'algorithme seul. */
function prioriserDebloques(list, place){
  const vus = edVus(), tete = [], reste = [];
  for (const e of list){
    const p = place.get(e.rel);
    if (p && !vus[e.rel] && p.jusque <= p.vu) tete.push(e); else reste.push(e);
  }
  tete.sort((x, y) => place.get(y.rel).jusque - place.get(x.rel).jusque);
  return tete.concat(reste);
}
function paintEdSpoil(caches){
  const b = $('#edSpoil');
  b.classList.toggle('on', edSpoilsVisibles);
  b.setAttribute('aria-pressed', edSpoilsVisibles ? 'true' : 'false');
  $('#edSpoilTxt').textContent = edSpoilsVisibles ? 'Spoilers visibles'
    : caches ? fmtCount(caches, 'masqué', 'masqués') : 'Sans spoiler';
  b.title = edSpoilsVisibles ? 'Remasquer les edits qui spoilent la suite'
    : caches ? 'Afficher aussi les edits qui spoilent la suite' : 'Aucun edit ne spoile ce que tu as vu';
}
/* Basculer les spoilers ne rebat pas le fil: rebattre placait l'edit a
 * l'ecran n'importe ou dans le nouvel ordre, souvent tout en bas. Ce qui est
 * deja passe et l'edit en cours gardent leur place. Les edits devoiles se
 * melent a la suite seulement; masques, ils sont retires, sans rien remuer —
 * et si l'on etait sur l'un d'eux, on passe au suivant encore permis. */
function edBasculerSpoils(){
  if (!edCtx) return;
  edSpoilsVisibles = !edSpoilsVisibles;
  const avant = edCtx.list, i = Math.max(0, edCtx.i), courant = avant[i];
  const tri = filtrerSpoils(edCtx.tous);
  let list;
  if (edSpoilsVisibles){
    const deja = new Set(avant.map(e => e.rel));
    const devoiles = edCtx.tous.filter(e => !deja.has(e.rel));
    let suite = fileEdits(avant.slice(i + 1).concat(devoiles), edVus(), edContexte()).list;
    if (edCtx.priorite) suite = prioriserDebloques(suite, tri.place);
    list = avant.slice(0, i + 1).concat(suite);
  } else {
    const permis = new Set(tri.garder.map(e => e.rel));
    list = avant.filter(e => permis.has(e.rel));
  }
  // la meme place: l'edit en cours, sinon le premier encore la apres lui
  let j = courant ? list.findIndex(e => e.rel === courant.rel) : -1;
  for (let k = i + 1; j < 0 && k < avant.length; k++) j = list.findIndex(e => e.rel === avant[k].rel);
  if (j < 0) j = list.length - 1;
  edDwellFin();
  edStatsEcrire();
  clearTimeout(edCibleT); edCible = null;
  clearTimeout(edVuT);
  edFree(new Set());
  edCtx.list = list; edCtx.i = -1;
  edRendre(edSpoilsVisibles ? 0 : tri.caches, Math.max(0, j));
}
/**
 * Le nom de l'œuvre, en haut à gauche. Dans le fil global il change à chaque
 * edit; un clic ferme le fil et ouvre sa fiche. Tant qu'aucun edit n'a pris la
 * main, c'est le nom du fil qui s'affiche, et il ne mène nulle part.
 */
function edPeindreNom(e){
  const b = $('#edTitle');
  const a = e ? S.byKey.get(e.anime) : null;
  b.textContent = a ? a.title : (edCtx ? edCtx.defaut : '');
  if (a) b.setAttribute('data-anime', a.key); else b.removeAttribute('data-anime');
}
function edOuvrir(edits, defaut, depart, garderRel, priorite){
  edPurgerStats();
  const tous = edits;
  const tri = filtrerSpoils(edits);
  if (edSpoilsVisibles){ tri.garder = edits; tri.caches = 0; }
  const file = fileEdits(tri.garder, edVus(), edContexte());
  if (priorite) file.list = prioriserDebloques(file.list, tri.place);
  edCtx = { list: file.list, i: -1, defaut, tous, priorite: !!priorite };
  ED.hidden = false;
  document.body.style.overflow = 'hidden';
  const garde = garderRel ? edCtx.list.findIndex(e => e.rel === garderRel) : -1;
  edRendre(tri.caches, garde >= 0 ? garde : depart | 0);
}
/** Dessine le fil de edCtx.list et se place sur la diapo `start`. */
function edRendre(caches, start){
  const vus = edVus();
  const neufs = edCtx.list.filter(e => !vus[e.rel]).length;
  const revus = edCtx.list.length - neufs;
  paintEdSpoil(caches);
  edPeindreNom(null);
  $('#edSub').textContent = fmtCount(edCtx.list.length, 'edit', 'edits') +
    (!revus ? '' : neufs ? ' · ' + neufs + ' nouveau' + (neufs > 1 ? 'x' : '') + ' en tête'
                         : ' · tous déjà vus');
  if (!edCtx.list.length){
    // tout spoile la suite: le fil s'ouvre quand meme, pour le bouton du haut
    $('#edCount').textContent = '0 / 0';
    $('#edRail').innerHTML = '<section class="ed-slide ed-vide"><div class="ed-bad">' +
      'Ces edits montrent des épisodes que tu n\'as pas encore vus.<br>' +
      'Regarde la suite, ou affiche les spoilers en haut à droite.</div></section>';
    return;
  }
  $('#edHint').hidden = true;
  $('#edProg').style.width = '0';
  $('#edRail').innerHTML = edCtx.list.map((e,i) =>
    '<section class="ed-slide paused" data-i="' + i + '">' +
      '<video playsinline loop preload="none"></video>' +
      '<div class="ed-play">' + SVG_LIRE + '</div>' +
      '<div class="ed-cap"><b>' + esc(e.title) + '</b>' +
        '<span class="ed-meta">' + esc(edLegende(e, null)) + '</span></div>' +
    '</section>').join('');
  paintEdMute();
  paintEdRate();
  paintEdAime(false);
  edGo(Math.max(0, Math.min(edCtx.list.length - 1, start | 0)), false);
  edObserve();
}

function closeEdits(){
  edDwellFin();
  edStatsEcrire();
  clearTimeout(edCibleT); edCible = null;
  clearTimeout(edVuT);
  if (edObs){ edObs.disconnect(); edObs = null; }
  edFree(new Set());
  edCtx = null;
  ED.hidden = true;
  $('#edRail').innerHTML = '';
  $('#edProg').style.width = '0';
  document.body.style.overflow = '';
}
/** Le defilement decide de l'edit courant: la diapo la plus visible gagne. */
function edObserve(){
  const rail = $('#edRail');
  if (edObs) edObs.disconnect();
  edObs = new IntersectionObserver((entrees) => {
    for (const en of entrees){
      if (!en.isIntersecting || en.intersectionRatio < .55) continue;
      // pendant un saut, les diapos traversees ne prennent pas la main:
      // sinon celle du milieu se chargerait et demarrerait pour rien
      if (edCible !== null && +en.target.dataset.i !== edCible) continue;
      edFocus(+en.target.dataset.i);
    }
  }, { root: rail, threshold: [0, .55, .9] });
  $$('.ed-slide', rail).forEach(el => edObs.observe(el));
}
function edFocus(i){
  if (!edCtx || i < 0 || i >= edCtx.list.length || i === edCtx.i) return;
  edDwellFin();                 // on quitte la diapo precedente: son temps est fige
  clearTimeout(edVuT);
  // meme si la video ne demarre pas, rester devant compte comme l'avoir vu
  edVuT = setTimeout(() => {
    const e = edCtx && edCtx.list[edCtx.i];
    if (e) edMarquerVu(e.rel);
  }, ED_ATTENTE_VU);
  edCtx.i = i;
  edDwellDebut(edCtx.list[i]);
  edPeindreNom(edCtx.list[i]);
  paintEdAime(false);
  $('#edCount').textContent = (i + 1) + ' / ' + edCtx.list.length;
  $('#edProg').style.width = '0';
  const garde = new Set();
  for (let j = i - 1; j <= i + 2; j++) if (j >= 0 && j < edCtx.list.length) garde.add(j);
  edFree(garde);
  garde.forEach(edLoad);
  edPlay(i);
  // un palier franchi: la queue se retrie avec ce qu'on vient d'apprendre
  if (i > 0 && i % ED_RETRI_PALIER === 0) edRetrier();
}
function edGo(i, doux){
  if (!edCtx) return;
  i = Math.max(0, Math.min(edCtx.list.length - 1, i));
  edCible = i;                                 // seule cette diapo peut prendre la main
  clearTimeout(edCibleT);
  edCibleT = setTimeout(() => { edCible = null; }, doux ? 1200 : 80);
  const el = edSlide(i);
  if (el) el.scrollIntoView({ block:'start', behavior: doux ? 'smooth' : 'auto' });
  edFocus(i);
}
function edStep(d){ if (edCtx) edGo(edCtx.i + d, true); }

async function edLoad(i){
  const v = edVideo(i);
  if (!edCtx || !v || edSrcs.has(i)) return;
  // un jeton par tentative: si le fil defile vite, la reponse qui revient trop
  // tard se voit ecartee au lieu d'ecraser la source en place
  const jeton = {};
  edSrcs.set(i, jeton);
  const s = await srcOf(edCtx.list[i]);
  if (edSrcs.get(i) !== jeton){ if (s && s.revoke) s.revoke(); return; }
  if (!s || !edCtx || !v.isConnected){ edSrcs.delete(i); if (s && s.revoke) s.revoke(); return; }
  edSrcs.set(i, s);
  v.preload = 'auto';
  // Page en file:// : l'adresse du fichier plutot que le blob:, comme dans le
  // lecteur. Le repli reste arme au cas ou elle serait refusee.
  const direct = urlDirecte(edCtx.list[i]);
  v.dataset.replier = direct ? s.url : '';
  v.src = direct || s.url;
  if (edCtx.i === i) edPlay(i);
}
function edFree(garde){
  for (const [j, s] of [...edSrcs]){
    if (garde.has(j)) continue;
    const v = edVideo(j);
    if (v){ v.dataset.replier = ''; v.pause(); v.removeAttribute('src'); v.load(); }
    if (s && s.revoke) s.revoke();
    edSrcs.delete(j);
  }
}
function edPlay(i){
  for (const [j] of edSrcs){
    if (j === i) continue;
    const v = edVideo(j);
    if (v && !v.paused){ v.pause(); v.currentTime = 0; }
  }
  const v = edVideo(i);
  if (!v || !v.getAttribute('src')) return;
  v.muted = edMuted() || edMuetForce;
  v.volume = edVolumeDe(edCtx.list[i]);
  v.playbackRate = edRate();
  v.play().catch((err) => {
    /* Seul un refus du navigateur (NotAllowedError: pas encore de geste sur la
       page) demande de repartir muet. Defiler vite, lui, interrompt le play()
       en cours (AbortError): rien a voir avec le son. Les deux etaient
       confondus, et le son se coupait — pour de bon, puisque c'etait retenu. */
    if (!err || err.name !== 'NotAllowedError' || v.muted) return;
    v.muted = true;
    edMuetForce = true;                         // pour ce passage seulement, pas retenu
    paintEdMute();
    $('#edHint').hidden = false;
    v.play().catch(() => {});
  });
}
/* Muet impose par le navigateur: le premier geste sur la page le leve, et le
   son revient sur l'edit en cours si l'on n'avait pas soi-meme coupe le son. */
let edMuetForce = false;
['pointerdown', 'keydown'].forEach(t => addEventListener(t, (ev) => {
  // le haut-parleur gere lui-meme ce cas: sinon on rallumerait ici, et son clic recouperait
  if (!edMuetForce || (ev.target.closest && ev.target.closest('#edMute'))) return;
  edMuetForce = false;
  $('#edHint').hidden = true;
  const v = edCtx && edVideo(edCtx.i);
  if (v && !edMuted()) v.muted = false;
  paintEdMute();
}, true));
function edToggle(){
  if (!edCtx) return;
  const v = edVideo(edCtx.i);
  if (!v || !v.getAttribute('src')) return;
  if (v.paused) v.play().catch(() => {}); else v.pause();
}
/* Aimer un edit agit a trois endroits, sans que rien d'autre ne bouge:
   sur lui — cinq passages parfaits dans son attrait — sur la qualite de sa
   serie, et par la sur la densite de toute la serie dans le fil. */
function edBasculerAime(){
  if (!edCtx) return;
  const e = edCtx.list[edCtx.i];
  if (!e) return;
  const s = edStatDe(e.rel);
  s.j = s.j ? 0 : Date.now();
  edStatsMarquer();
  paintEdAime(true);
  toast(s.j ? 'Ajoute a tes coups de coeur' : 'Retire de tes coups de coeur', s.j ? 'ok' : '');
}
function paintEdAime(anime){
  const b = $('#edJaime');
  if (!b) return;
  const e = edCtx && edCtx.list[edCtx.i];
  const on = !!(e && edAime(e.rel));
  b.innerHTML = on ? SVG_COEUR_PLEIN : SVG_COEUR;
  b.classList.toggle('on', on);
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.setAttribute('aria-label', on ? 'Retirer des coups de coeur' : "J'aime cet edit");
  if (anime && on){                      // le rebond, seulement quand on vient d'aimer
    b.classList.remove('bat');
    void b.offsetWidth;
    b.classList.add('bat');
  }
}
function paintEdMute(){
  const muet = edMuted() || edMuetForce || edVolume() === 0;

  const b = $('#edMute');
  b.innerHTML = muet ? SVG_MUET : SVG_SON;
  b.setAttribute('aria-label', muet ? 'Activer le son' : 'Couper le son');
  const n = edVolume();
  $('#edVolFill').style.height = (n * 100) + '%';
  $('#edVolBar').setAttribute('aria-valuenow', Math.round(n * 100));
}

$('#edClose').addEventListener('click', closeEdits);
$('#edSpoil').addEventListener('click', edBasculerSpoils);

$('#edJaime').addEventListener('click', edBasculerAime);
$('#edMute').addEventListener('click', () => {
  if (edMuetForce) edMuetForce = false;          // muet impose: ce clic rallume, il ne coupe pas
  else store.set('edMute', !edMuted());
  paintEdMute();
  $('#edHint').hidden = true;
  const v = edCtx ? edVideo(edCtx.i) : null;
  if (v){ v.muted = edMuted(); if (v.paused) v.play().catch(() => {}); }
});
/* Poser un volume rallume le son: on ne monte pas le niveau d'une video muette
   en esperant l'entendre. */
function edPoserVolume(n){
  n = Math.max(0, Math.min(1, n));
  store.set('edVol', n);
  if (n > 0 && edMuted()) store.set('edMute', false);
  paintEdMute();
  $('#edHint').hidden = true;
  const v = edCtx ? edVideo(edCtx.i) : null;
  if (v){ v.muted = edMuted(); v.volume = edVolumeDe(edCtx.list[edCtx.i]); }
}
/* Le haut de la jauge vaut 1, le bas 0. Comme pour la barre de progression, la
   capture du pointeur laisse sortir de la pastille en glissant sans perdre la
   main. */
function edVolDepuisY(clientY){
  const r = $('#edVolBar').querySelector('.ed-voltrack').getBoundingClientRect();
  if (!r.height) return;
  edPoserVolume(Math.round((1 - (clientY - r.top) / r.height) * 50) / 50);
}
const edVolBar = $('#edVolBar');
edVolBar.addEventListener('pointerdown', (ev) => {
  ev.preventDefault();
  edVolBar.setPointerCapture(ev.pointerId);
  edVolBar.classList.add('open');   // reste ouverte tant qu'on glisse, meme en sortant
  edVolDepuisY(ev.clientY);
});
edVolBar.addEventListener('pointermove', (ev) => {
  if (edVolBar.hasPointerCapture(ev.pointerId)) edVolDepuisY(ev.clientY);
});
['pointerup','pointercancel'].forEach(nom =>
  edVolBar.addEventListener(nom, () => edVolBar.classList.remove('open')));
// les fleches, tant que la jauge a le focus: sinon elles font defiler le fil
$('#edVolBar').addEventListener('keydown', (ev) => {
  const d = ev.key === 'ArrowUp' ? .05 : ev.key === 'ArrowDown' ? -.05 : 0;
  if (!d) return;
  ev.preventDefault(); ev.stopPropagation();
  edPoserVolume(edVolume() + d);
});
// la molette sur le coin du son, sans avoir a viser la jauge
$('.ed-volwrap').addEventListener('wheel', (ev) => {
  ev.preventDefault();
  edPoserVolume(edVolume() + (ev.deltaY < 0 ? .05 : -.05));
}, { passive:false });
$('#edRate').addEventListener('click', () => {
  store.set('edRate', ED_RATES[(ED_RATES.indexOf(edRate()) + 1) % ED_RATES.length]);
  paintEdRate();
  const v = edCtx ? edVideo(edCtx.i) : null;
  if (v) v.playbackRate = edRate();
});
/* Les bords font passer au suivant ou au precedent, comme dans les scans;
   le milieu met en pause. Meme decoupe que le lecteur de pages, a 22 %. */
/* On se deplace dans l'edit courant a la souris comme au doigt. La capture du
   pointeur permet de sortir de la barre en glissant sans perdre la main. */
let edScrub = null;
function edSeek(clientX){
  const v = edCtx ? edVideo(edCtx.i) : null;
  if (!v || !isFinite(v.duration) || v.duration <= 0) return;
  const r = $('#edProgBar').getBoundingClientRect();
  const x = r.width ? Math.max(0, Math.min(1, (clientX - r.left) / r.width)) : 0;
  v.currentTime = x * v.duration;
  $('#edProg').style.width = (x * 100).toFixed(2) + '%';
}
$('#edProgBar').addEventListener('pointerdown', (ev) => {
  ev.preventDefault();
  edScrub = ev.pointerId;
  $('#edProgBar').classList.add('grab');
  try { $('#edProgBar').setPointerCapture(ev.pointerId); } catch(e){}
  edSeek(ev.clientX);
});
$('#edProgBar').addEventListener('pointermove', (ev) => { if (edScrub !== null) edSeek(ev.clientX); });
const edScrubFin = () => {
  if (edScrub === null) return;
  try { $('#edProgBar').releasePointerCapture(edScrub); } catch(e){}
  edScrub = null;
  $('#edProgBar').classList.remove('grab');
};
$('#edProgBar').addEventListener('pointerup', edScrubFin);
$('#edProgBar').addEventListener('pointercancel', edScrubFin);

// le defilement fini, le fil redevient libre de suivre le pouce
$('#edRail').addEventListener('scrollend', () => { clearTimeout(edCibleT); edCible = null; });
$('#edRail').addEventListener('click', (ev) => {
  const action = clickAction(ev.clientX / innerWidth, 'ltr');
  if (action === 'next')      edStep(1);
  else if (action === 'prev') edStep(-1);
  else                        edToggle();
});
// les evenements media ne remontent pas: on les attrape a la descente
$('#edRail').addEventListener('timeupdate', (ev) => {
  if (!edCtx || ev.target !== edVideo(edCtx.i)) return;
  edDwellAvance(ev.target, edScrub === null);  // pendant qu'on glisse, on suit sans conclure
  if (edScrub !== null) return;                // et c'est le doigt qui mene l'affichage
  const d = ev.target.duration;
  $('#edProg').style.width = (d > 0 ? (ev.target.currentTime / d * 100).toFixed(2) : 0) + '%';
  // un coup d'oeil au debut suffit: sinon le fil resert toujours les memes
  const seuil = edSeuilVu(d);
  if (seuil !== null && ev.target.currentTime >= seuil){
    const e = edCtx.list[edCtx.i];
    if (e) edMarquerVu(e.rel);
  }
}, true);
['play','pause'].forEach(nom => $('#edRail').addEventListener(nom, (ev) => {
  const s = ev.target.closest('.ed-slide');
  if (s) s.classList.toggle('paused', nom === 'pause');
  if (nom === 'play'){
    ev.target.playbackRate = edRate();
    // edToggle et la barre d'espace demarrent la video sans passer par edPlay
    ev.target.volume = edVolumeDe(edCtx && s ? edCtx.list[+s.dataset.i] : null);
  }
  // le chronometre ne suit que la diapo au premier plan: edPlay met les
  // voisines en pause, et leur evenement ne doit pas arreter la mesure
  if (edCtx && s && +s.dataset.i === edCtx.i){
    if (nom === 'play') edDwellMarche(ev.target); else edDwellArret();
  }
}, true));
function edIllisible(s){
  if (!s || s.querySelector('.ed-bad')) return;
  const e = edCtx && edCtx.list[+s.dataset.i];
  if (e) edDwellEchec(e.rel);
  s.insertAdjacentHTML('beforeend',
    '<div class="ed-bad">Ce fichier ne se lit pas dans le navigateur' +
    (e ? '<br>' + esc(e.name) : '') + '</div>');
}
$('#edRail').addEventListener('error', (ev) => {
  const v = ev.target;
  const s = v.closest && v.closest('.ed-slide');
  if (v.dataset && v.dataset.replier){   // l'adresse directe n'a pas pris: on reprend par le blob:
    const u = v.dataset.replier; v.dataset.replier = '';
    v.src = u; v.load();
    if (s && edCtx && +s.dataset.i === edCtx.i) edPlay(edCtx.i);
    return;
  }
  edIllisible(s);
}, true);
$('#edRail').addEventListener('loadedmetadata', (ev) => {
  const s = ev.target.closest('.ed-slide');
  if (!s) return;
  // un codec que la machine ne sait pas decoder « charge » sans jamais donner
  // d'image: aucune largeur annoncee. Autant le dire plutot que montrer du noir.
  if (!ev.target.videoWidth || !ev.target.videoHeight) return edIllisible(s);
  const e = edCtx && edCtx.list[+s.dataset.i];
  if (e) edDureeEdit(e.rel, ev.target.duration);
  const m = s.querySelector('.ed-meta');
  if (e && m) m.textContent = edLegende(e, ev.target);
}, true);

addEventListener('keydown', (ev) => {
  if (ED.hidden || ev.target.matches('input,textarea')) return;
  const k = ev.key.toLowerCase();
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowRight' || k === 'j'){ ev.preventDefault(); edStep(1); }
  else if (ev.key === 'ArrowUp' || ev.key === 'ArrowLeft' || k === 'k'){ ev.preventDefault(); edStep(-1); }
  else if (k === ' '){ ev.preventDefault(); edToggle(); }
  else if (k === 'm'){ $('#edMute').click(); }
  else if (k === 'a'){ ev.preventDefault(); edBasculerAime(); }
  else if (k === 'escape'){ closeEdits(); }
});
