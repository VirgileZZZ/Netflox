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

### Regarder depuis un autre appareil

Double-cliquer sur `partager.bat` (il faut Python) :

- **local** : un lien `http://192.168.x.x:8000` pour le téléphone ou la télé connectés à la même box ;
- **internet** : un lien Cloudflare temporaire, valable tant que la fenêtre reste ouverte (il faut `cloudflared`, sinon : `winget install --id Cloudflare.cloudflared`).

La bibliothèque partagée est en lecture seule pour ceux qui l'ouvrent.

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
| `Convertir-Video.bat` | Convertit n'importe quelle vidéo en MP4 lisible par le navigateur (ou en MKV pour archiver). Glisser-déposer des fichiers ou des dossiers dessus. |
| `download-all-seasons.bat` | Télécharge toutes les saisons d'un anime depuis une URL du catalogue Anime-Sama, une fenêtre par saison. |
| `main.py` | Le téléchargeur en ligne de commande (`python main.py --help`). |
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
