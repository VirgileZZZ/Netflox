# Netflox

Ma bibliothèque de séries et d'animes, à regarder dans le navigateur comme sur un site de streaming — mais avec mes propres fichiers.

- **Bibliothèque** : jaquettes, saisons, épisodes, reprise là où on s'est arrêté, favoris, catégories, notes en étoiles et notes IMDb.
- **Lecteur vidéo** : sous-titres `.vtt` (sans fond, déplaçables à la souris), autres langues audio, passer le générique, épisode suivant automatique, aperçu au survol de la barre, raccourcis clavier.
- **Partage** : un lien pour regarder depuis le téléphone ou la télé sur la même box, ou depuis n'importe où via un tunnel Cloudflare.
- **Scans et documents** : lecteur de scans page par page, PDF, EPUB, CBZ.
- **Téléchargement** : récupérer des épisodes depuis Anime-Sama / Nakanime.

## Démarrer

### Regarder sur cet ordinateur

Ouvrir `index.html` dans Chrome (ou Edge / Opera), puis choisir le dossier `videos/`. Le navigateur s'en souvient pour les fois suivantes.

Ou l'app **Netflox** (menu Démarrer) : la même page dans sa propre fenêtre, sans serveur ni partage. Le dossier `videos/` se choisit une fois, puis se rouvre tout seul ; RTX Video Super Resolution est allumée d'office ; au premier lancement elle reprend ce qu'Opera gardait (edits vus, favoris…). Elle est d'office sur le compte de l'hôte (celui coché « compte de l'hôte » dans `comptes.html`) : ce qu'on y regarde part dans ce compte, et ce qu'il a appris sur un lien de partage revient dans l'app (`--compte <pseudo>` pour en prendre un autre). `F11` plein écran, `F5` recharger, `F12` outils de développement. Pour la refaire après une modification de `app/` : `cd app`, `npm install`, `npm run build` → `app/dist/win-unpacked/Netflox.exe`. Ce qui change dans `index.html` et `js/` y arrive sans rien refaire.

### Regarder depuis un autre appareil

Double-cliquer sur `partager.bat` (il faut Python) :

- **local** : un lien `http://192.168.x.x:8000` pour le téléphone ou la télé connectés à la même box ;
- **internet** : un lien Cloudflare temporaire, valable tant que la fenêtre reste ouverte (il faut `cloudflared`, sinon : `winget install --id Cloudflare.cloudflared`).

Ceux qui l'ouvrent peuvent noter les épisodes et, s'ils le veulent, créer un compte (pseudo + mot de passe) pour retrouver leur progression sur les liens suivants. Le lien ne donne accès qu'aux vidéos, images, sous-titres et pistes : jamais à tes fichiers de données.

Sur téléphone, Netflox s'installe comme une application (« Ajouter à l'écran d'accueil »).

Pendant le partage, un épisode ajouté dans `videos/` apparaît sans relancer (l'index est refait toutes les 3 minutes). À chaque lancement, les fiches des séries, les notes des invités et les comptes sont copiés dans `sauvegardes-auto/` (les 15 dernières sont gardées).



## Ranger les fichiers

```
videos/
  nom-de-la-serie/
    nom-de-la-serie.jpg          ← la jaquette (facultatif)
    saison1/
      nom-de-la-serie_1.mp4
      nom-de-la-serie_2.mp4
      sous-titres/
        nom-de-la-serie_1.fr.vtt
        nom-de-la-serie_1.en.vtt
      audio/
        nom-de-la-serie_1.fr.m4a ← une autre langue, jouée à la place de celle de la vidéo
```

- Vidéos lisibles : `.mp4` (le mieux), `.webm`, `.ts` ; le `.mkv` ne passe pas dans un navigateur.
- Les sous-titres doivent être en `.vtt`, posés à côté : ceux qui sont dans le MP4 ne s'affichent pas dans Chrome.
- Pour plusieurs pistes de la même langue : `.fr.vtt`, `.fr2.vtt`…

## Outils

| Fichier | À quoi ça sert |
| :--- | :--- |
| `comptes.html` | Les comptes de tes potes : ce qu'ils ont vu et noté, nouveau mot de passe, déconnexion, renommage, suppression. Pendant que `partager.bat` tourne, ouvre `http://127.0.0.1:<port>/comptes.html` sur ton PC (jamais accessible par le lien). |
| `annoter-edits.html` |
 Dit, pour chaque edit, jusqu'à quel épisode il montre l'histoire. Le fil d'edits ne montre ensuite que ceux qui ne spoilent rien de ce que tu n'as pas vu (bouton « Spoilers » en haut à droite pour tout voir). À ouvrir dans Chrome sur l'ordinateur des vidéos. |
| `Convertir-Video.bat` | Convertit n'importe quelle vidéo en MP4 lisible par le navigateur (ou en MKV pour archiver). Glisser-déposer des fichiers ou des dossiers dessus. |
| `download-all-seasons.bat` | Télécharge toutes les saisons d'un anime depuis une URL du catalogue Anime-Sama, une fenêtre par saison. |
| `main.py` | Le téléchargeur en ligne de commande (`python main.py --help`). |
| `outils/dedoublonner_sous_titres.py` | Repère les répliques affichées deux fois en même temps dans les `.vtt` (`--corriger` pour les fusionner ; les originaux vont dans `sauvegardes-sous-titres/`). Une phrase redite juste après n'est pas touchée. |
| `outils/notes_imdb.py` | Remplit les notes IMDb des épisodes (`--complet` pour les nouvelles séries et les titres). |

Pour le téléchargeur : `pip install -r requirements.txt`, et `ffmpeg` pour convertir les `.ts` en `.mp4`.

Exemple :

```bash
python main.py --url "https://anime-sama.to/catalogue/demon-slayer/saison1/vostfr/" --episodes all --mp4
```

## Raccourcis du lecteur

| Touche | Action |
| :---: | :--- |
| `Espace` / `K` | Lecture / pause |
| `←` / `→` | 10 s en arrière / en avant (`Maj` : 60 s) |
| `↑` / `↓` | Volume |
| `M` | Couper le son |
| `F` | Plein écran |
| `N` | Épisode suivant |
| `0` … `9` | Aller à 0 %, 10 %… 90 % de l'épisode |
| `Échap` | Quitter le plein écran, puis fermer le lecteur |

## Crédits

Le téléchargeur (`main.py`, `src/`) vient de [SertraFurr/Anime-Downloader](https://github.com/SertraFurr/Anime-Downloader).
