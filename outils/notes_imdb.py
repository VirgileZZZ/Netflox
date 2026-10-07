# -*- coding: utf-8 -*-
"""Tient a jour les notes IMDb des episodes, toute seule.

IMDb ferme sa porte aux robots — une requete sur une page d'episodes repond 403
— mais publie chaque jour les memes chiffres en clair sur datasets.imdbws.com.
On y prend deux tables:

    title.ratings.tsv.gz     ~8 Mo    la note de chaque titre
    title.episode.tsv.gz    ~52 Mo    a quel (saison, numero) correspond un titre
    title.basics.tsv.gz    ~220 Mo    les noms, pour identifier une serie

La grosse des trois ne sert qu'une fois par serie: on en garde le plan dans
cache-imdb/episodes.json. Un lancement ordinaire ne telecharge donc que les
8 Mo des notes, et rien du tout si le fichier n'a pas bouge depuis la veille.
Un episode 16 apparu depuis la derniere fois suffit a redemander le plan.

Ce qui est ecrit, dans le bibliotheque.json de chaque serie:

    notes_episodes_imdb    seulement si la case est vide
    titres_episodes        seulement si la case est vide, et en mode complet

Ce qui n'est jamais touche: une note deja ecrite, quoi qu'IMDb en dise
aujourd'hui — un episode special ou une correction a la main valent mieux
qu'une correspondance automatique — notes_episodes, qui sont tes notes a toi,
et tout le reste du fichier, relu et reecrit tel quel.

    python outils/notes_imdb.py              tourne vite, notes seulement
    python outils/notes_imdb.py --complet    identifie les nouvelles series
                                             et remplit les titres manquants
"""
import difflib
import gzip
import io
import json
import os
import re
import shutil
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.request

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache-imdb")
ACCOMPAGNEMENT = "bibliotheque.json"
DOSSIERS_MEDIA = ("videos", "video")
VIDEO_EXT = {"mp4", "m4v", "webm", "mov", "mkv", "ts", "m2ts", "avi", "flv", "ogv"}
HORS_EPISODES = {"edits", "edit", "amv", "amvs"}

_CURL = shutil.which("curl")

BASE = "https://datasets.imdbws.com/"
NOTES = "title.ratings.tsv.gz"
EPISODES = "title.episode.tsv.gz"
NOMS = "title.basics.tsv.gz"

# Passe ce delai sans rien redemander: IMDb ne publie qu'une fois par jour, et
# on lance le serveur bien plus souvent que ca.
FRAICHEUR = 20 * 3600

# Un titre que la note doit depasser pour etre consideree comme differente.
# Les notes bougent au dixieme; en dessous ce n'est que du bruit d'arrondi.
ECART = 0.051

SAISON = re.compile(r"^saison\s*(\d+)$", re.I)
NUMERO = re.compile(r"_(\d+)\.[a-z0-9]+$", re.I)
# IMDb nomme « Episode #4.15 » un episode sans titre annonce: un bouche-trou
# qui vaut moins que le « Episode 15 » que la page sait deja ecrire.
BOUCHE_TROU = re.compile(r"^(?:episode|épisode)\s*#?\s*\d+(?:[.\-x]\d+)?$", re.I)


# --------------------------------------------------------------- outils ----

def couleur(txt, code):
    return "\033[%sm%s\033[0m" % (code, txt)


def normaliser(s):
    """Un nom reduit a l'os, pour comparer « Re:Zero » et « re zero »."""
    s = unicodedata.normalize("NFKD", str(s).lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def saison_episode(rel):
    """« saison4/re-zero_15.mp4 » -> (4, 15). None des que le doute s'installe:
    un film, un hors-serie ou un nom qui ne dit pas son numero n'a pas de place
    dans une grille de saisons, et lui en inventer une serait pire que rien."""
    parts = rel.split("/")
    if len(parts) < 2:
        return None
    s = SAISON.match(parts[0])
    n = NUMERO.search(parts[-1])
    return (int(s.group(1)), int(n.group(1))) if s and n else None


def dossier_videos():
    for nom in DOSSIERS_MEDIA:
        chemin = os.path.join(RACINE, nom)
        if os.path.isdir(chemin):
            return chemin
    return None


def episodes_locaux(dossier_serie):
    """Les chemins relatifs des episodes d'une serie, edits exclus."""
    out = []
    for base, dirs, fichiers in os.walk(dossier_serie):
        dirs[:] = [d for d in dirs if d.lower() not in HORS_EPISODES]
        for f in fichiers:
            ext = f.rsplit(".", 1)[-1].lower() if "." in f else ""
            if ext in VIDEO_EXT:
                rel = os.path.relpath(os.path.join(base, f), dossier_serie)
                out.append(rel.replace(os.sep, "/"))
    return sorted(out)


# ---------------------------------------------------------- le cache ------

def lire_json(chemin, defaut):
    try:
        with io.open(chemin, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return defaut


def ecrire_json(chemin, donnees):
    os.makedirs(os.path.dirname(chemin), exist_ok=True)
    tmp = chemin + ".tmp"
    with io.open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(donnees, ensure_ascii=False, indent=2))
    os.replace(tmp, chemin)


def _par_curl(url, depuis, tmp):
    """Telecharge avec curl. Renvoie (code HTTP, Last-Modified) ou leve.

    Pourquoi curl et pas urllib: sur une machine ou un antivirus s'interpose, le
    certificat qu'il presente est signe par une autorite ajoutee au magasin de
    Windows. curl s'y fie, OpenSSL — donc Python — la refuse et ne telecharge
    plus rien. curl est livre avec Windows depuis la 10, il fait donc l'affaire
    partout ou ce script tourne."""
    entetes = tmp + ".head"
    cmd = [_CURL, "-sS", "-L", "--max-time", "600", "-o", tmp, "-D", entetes,
           "-w", "%{http_code}", "-A", "bibliotheque/1.0"]
    if depuis:
        cmd += ["-H", "If-Modified-Since: " + depuis]
    cmd.append(url)
    code = subprocess.run(cmd, capture_output=True, text=True, check=True).stdout.strip()
    date = None
    try:
        with io.open(entetes, encoding="utf-8", errors="replace") as f:
            for ligne in f:
                if ligne.lower().startswith("last-modified:"):
                    date = ligne.split(":", 1)[1].strip()
    except Exception:
        pass
    finally:
        try:
            os.remove(entetes)
        except OSError:
            pass
    return int(code or 0), date


def _par_urllib(url, depuis, tmp):
    req = urllib.request.Request(url, headers={"User-Agent": "bibliotheque/1.0"})
    if depuis:
        req.add_header("If-Modified-Since", depuis)
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            with open(tmp, "wb") as f:
                while True:
                    bloc = r.read(1 << 20)
                    if not bloc:
                        break
                    f.write(bloc)
            return r.status, r.headers.get("Last-Modified")
    except urllib.error.HTTPError as e:
        if e.code == 304:
            return 304, None
        raise


def telecharger(nom, log):
    """Rapporte le fichier, ou la copie locale si IMDb dit qu'elle est a jour.

    Le cache retient la date annoncee par le serveur; on la lui repropose et il
    repond 304 sans rien envoyer quand rien n'a bouge. Renvoie le chemin local,
    ou None si le reseau n'a pas repondu et qu'on n'a rien en reserve."""
    dest = os.path.join(CACHE, nom)
    meta = lire_json(os.path.join(CACHE, "meta.json"), {})
    dispo = os.path.exists(dest)

    if dispo and time.time() - meta.get(nom + ":vu", 0) < FRAICHEUR:
        return dest                              # regarde il y a moins d'un jour

    os.makedirs(CACHE, exist_ok=True)
    tmp = dest + ".part"
    prendre = _par_curl if _CURL else _par_urllib
    try:
        code, date = prendre(BASE + nom, meta.get(nom) if dispo else None, tmp)
    except Exception as e:
        log("%s : %s" % (nom, e))
        return dest if dispo else None

    if code == 304:
        log("%s : deja a jour" % nom)
        try:
            os.remove(tmp)
        except OSError:
            pass
    elif code == 200 and os.path.getsize(tmp) > 0:
        log("%s : %.0f Mo recuperes" % (nom, os.path.getsize(tmp) / 1048576.0))
        os.replace(tmp, dest)
        if date:
            meta[nom] = date
    else:
        log("%s : reponse %s" % (nom, code))
        try:
            os.remove(tmp)
        except OSError:
            pass
        return dest if dispo else None

    meta[nom + ":vu"] = time.time()
    ecrire_json(os.path.join(CACHE, "meta.json"), meta)
    return dest


# ------------------------------------------------------- les tables -------

def charger_notes(chemin):
    """{ tconst : (note, nombre de votes) } — les votes servent a departager."""
    notes = {}
    with gzip.open(chemin, "rt", encoding="utf-8") as f:
        next(f, None)
        for ligne in f:
            c = ligne.rstrip("\n").split("\t")
            if len(c) >= 3:
                try:
                    notes[c[0]] = (float(c[1]), int(c[2]))
                except ValueError:
                    pass
    return notes


def note_de(notes, tconst):
    v = notes.get(tconst)
    return v[0] if v else None


def plan_episodes(chemin, parents):
    """{ tconst de la serie : { "saison.numero" : tconst de l'episode } }"""
    plan = {}
    with gzip.open(chemin, "rt", encoding="utf-8") as f:
        next(f, None)
        for ligne in f:
            c = ligne.rstrip("\n").split("\t")
            if len(c) < 4 or c[1] not in parents:
                continue
            if not c[2].isdigit() or not c[3].isdigit():
                continue
            plan.setdefault(c[1], {})["%s.%s" % (c[2], c[3])] = c[0]
    return plan


def index_series(chemin, notes):
    """Toutes les series notees, rangees par nom normalise."""
    index = {}
    with gzip.open(chemin, "rt", encoding="utf-8") as f:
        next(f, None)
        for ligne in f:
            c = ligne.split("\t")
            if len(c) < 6 or c[1] not in ("tvSeries", "tvMiniSeries") or c[0] not in notes:
                continue
            fiche = (c[0], c[2], notes[c[0]][0], notes[c[0]][1])
            for brut in {normaliser(c[2]), normaliser(c[3])}:
                if brut:
                    index.setdefault(brut, []).append(fiche)
    return index


# ------------------------------------------------------- le travail -------

MAX_CANDIDATS = 25

def a_identifier(videos, series):
    """Les dossiers qui portent des episodes mais n'ont pas encore de fiche."""
    out = {}
    for dossier in sorted(os.listdir(videos)):
        chemin = os.path.join(videos, dossier)
        if dossier in series or not os.path.isdir(chemin):
            continue
        eps = episodes_locaux(chemin)
        if not eps:
            continue                              # que des edits: rien a noter
        # Des films, sans saison: aucune grille d'episodes ou les ranger, et la
        # seule preuve restante — la note de l'oeuvre — ne vaut rien ici. Le
        # Hobbit, note 7,7 (la moyenne de ses films), etait sorti « The Vampire
        # Diaries ». Leurs notes se posent a la main, film par film.
        if not any(saison_episode(r) for r in eps):
            continue

        # « mushoku-tensei-720p-vostfr » -> « mushoku tensei »
        propre = re.sub(r"[-_]?(720p|1080p|480p|2160p|vostfr|vf|vo|multi)\b", " ",
                        dossier, flags=re.I)
        out[dossier] = normaliser(propre)
    return out


def candidats_series(chemin_noms, manquantes, notes):
    """Pour chaque dossier, les fiches IMDb qui pourraient etre la sienne.

    On ratisse large, exprès. Un dossier ne porte presque jamais le titre exact:
    « frieren » pour « Frieren: Beyond Journey's End », « rick et morty » pour
    « Rick and Morty », « parasite » pour « Parasyte: The Maxim », et parfois une
    faute de frappe franche comme « invicible ». Quatre filets, donc: le nom
    exact, les titres qui commencent par lui, ceux dont le premier mot est le
    meme, et enfin la simple ressemblance.

    Etre trop genereux ici ne coute rien: c'est trancher() qui decide, et il ne
    retient un candidat que si les notes de ses episodes retombent sur celles
    deja inscrites. Etre trop avare, en revanche, laisse la serie de cote."""
    index = index_series(chemin_noms, notes)
    cles = list(index)
    debuts = {}
    for cle in cles:
        debuts.setdefault(cle.split(" ", 1)[0], []).append(cle)

    lots = {}
    for dossier, nom in manquantes.items():
        premier = nom.split(" ", 1)[0]
        proches = set()
        proches.update(cle for cle in cles
                       if cle == nom or cle.startswith(nom + " ") or nom.startswith(cle + " "))
        proches.update(debuts.get(premier, []))
        proches.update(difflib.get_close_matches(nom, cles, n=6, cutoff=0.7))
        for mot in difflib.get_close_matches(premier, list(debuts), n=3, cutoff=0.8):
            proches.update(debuts[mot])

        lot = [f for cle in proches for f in index[cle]]
        # les mieux votes d'abord: une serie qu'on regarde n'est pas une obscurite
        lot.sort(key=lambda f: -f[3])
        vus, garde = set(), []
        for f in lot:
            if f[0] not in vus:
                vus.add(f[0])
                garde.append(f)
        lots[dossier] = garde[:MAX_CANDIDATS]
    return lots


# Une note relevee il y a des semaines a pu glisser; au-dela c'est une autre serie.
TOLERANCE_EMPREINTE = 0.4
MIN_EMPREINTE = 5


def trancher(manquantes, lots, series, plan, notes, videos, log):
    """Choisit la fiche de chaque dossier, ou n'en choisit aucune.

    Deux preuves possibles, dans cet ordre:

      - l'empreinte. Les notes d'episodes deja inscrites sont une signature: si
        les notes IMDb d'une fiche retombent dessus episode par episode, c'est
        elle. Aucune autre serie ne peut y arriver par hasard.
      - a defaut — un dossier tout neuf n'a aucune note a comparer — la note de
        la serie elle-meme, si elle ne designe qu'un seul candidat.

    Sans preuve on ne decide rien et on le dit. Une note posee sur la mauvaise
    serie serait bien pire qu'une case vide: elle ne se verrait pas."""
    retenus = 0
    for dossier in sorted(manquantes):
        sc = lire_json(os.path.join(videos, dossier, ACCOMPAGNEMENT), {})
        stock = sc.get("notes_episodes_imdb") or {}
        attendue = sc.get("note_imdb")

        scores = []
        for tconst, titre, note, votes in lots.get(dossier, []):
            grille = plan.get(tconst, {})
            bons = compares = 0
            for rel, val in stock.items():
                se = saison_episode(rel)
                r = note_de(notes, grille.get("%d.%d" % se)) if se else None
                if r is None:
                    continue
                compares += 1
                if abs(r - val) < TOLERANCE_EMPREINTE:
                    bons += 1
            scores.append((bons, compares, tconst, titre, note))
        scores.sort(reverse=True)

        choix = None
        if scores and scores[0][0] >= MIN_EMPREINTE and scores[0][0] >= scores[0][1] * 0.8:
            second = scores[1][0] if len(scores) > 1 else 0
            if scores[0][0] > second:
                choix = scores[0][2:4]
                preuve = "%d/%d episodes concordent" % (scores[0][0], scores[0][1])
        if choix is None and attendue is not None:
            sur = [f for f in lots.get(dossier, []) if abs(f[2] - attendue) < ECART]
            if len(sur) == 1:
                choix = (sur[0][0], sur[0][1])
                preuve = "note de la serie"
        if choix:
            series[dossier] = {"tconst": choix[0], "titre": choix[1]}
            log("identifiee : %-38s %-11s %s  (%s)"
                % (dossier[:38], choix[0], choix[1][:34], preuve))
            retenus += 1
        else:
            n = len(lots.get(dossier, []))
            log(couleur("a la main :", "93") + " %-38s %s"
                % (dossier[:38], "%d fiche(s) possible(s), aucune ne se confirme" % n
                   if n else "aucune fiche trouvee"))
    return retenus


def appliquer(videos, series, plan, notes, titres, log, bavard=False):
    """Ecrit les notes manquantes dans les bibliotheque.json.

    Une case deja remplie n'est jamais retouchee, meme si IMDb annonce autre
    chose aujourd'hui. Les notes du fichier ne viennent pas toutes d'ici: un
    episode special, un hors-serie, une note corrigee a la main valent mieux que
    ce qu'une correspondance automatique irait chercher, et rien ne permet de
    les distinguer une fois ecrites. On ne comble donc que les trous.

    Renvoie (ajoutees, laissees telles quelles, titres, sans correspondance) —
    « laissees » compte les cases ou IMDb dit autre chose et ou l'on n'a rien
    touche, histoire que ce silence soit visible."""
    a = r = t = sans = 0
    for dossier, fiche in sorted(series.items()):
        chemin = os.path.join(videos, dossier)
        if not os.path.isdir(chemin):
            continue
        grille = plan.get(fiche["tconst"], {})
        if not grille:
            continue
        sc_chemin = os.path.join(chemin, ACCOMPAGNEMENT)
        sc = lire_json(sc_chemin, None)
        if sc is None and os.path.exists(sc_chemin):
            # present mais illisible: le recreer vide effacerait tout le reste
            log(couleur("illisible, laisse tel quel :", "91") + " " + dossier)
            continue
        if sc is None:
            sc = {"version": 1, "serie": dossier}
        elif not isinstance(sc, dict):
            log(couleur("illisible, laisse tel quel :", "91") + " " + dossier)
            continue

        stock = dict(sc.get("notes_episodes_imdb") or {})
        noms = dict(sc.get("titres_episodes") or {})
        avant_n, avant_t = dict(stock), dict(noms)
        orphelins = 0

        for rel in episodes_locaux(chemin):
            se = saison_episode(rel)
            tc = grille.get("%d.%d" % se) if se else None
            note = note_de(notes, tc) if tc else None
            if note is None:
                if rel not in stock:
                    sans += 1
                    orphelins += 1
                continue
            if rel not in stock:
                stock[rel] = note
                a += 1
            elif abs(stock[rel] - note) >= ECART:
                r += 1                            # differente, et on n'y touche pas
            titre = titres.get(tc)
            if titre and rel not in noms and not BOUCHE_TROU.match(titre.strip()):
                noms[rel] = titre.strip()
                t += 1

        # Une saison entiere sans correspondance, c'est presque toujours une
        # suite qu'IMDb compte comme une autre serie (Tokyo Ghoul √A,
        # Steins;Gate 0). Autant le dire plutot que de laisser un trou muet.
        if orphelins >= 5 and bavard:
            log(couleur("sans note :", "93") + " %-38s %d episode(s) hors de la fiche %s"
                % (dossier[:38], orphelins, fiche["tconst"]))

        if stock == avant_n and noms == avant_t:
            continue
        sc["notes_episodes_imdb"] = {k: stock[k] for k in sorted(stock)}
        if noms:
            sc["titres_episodes"] = {k: noms[k] for k in sorted(noms)}
        ecrire_json(sc_chemin, sc)
    return a, r, t, sans


def nouveaux_episodes(videos, series, plan, notes):
    """Les tconst des episodes presents, notes sur IMDb, et pas encore dans
    leur bibliotheque.json: ceux qu'on vient d'ajouter."""
    out = []
    for dossier, fiche in series.items():
        chemin = os.path.join(videos, dossier)
        grille = plan.get(fiche["tconst"], {})
        if not grille or not os.path.isdir(chemin):
            continue
        stock = (lire_json(os.path.join(chemin, ACCOMPAGNEMENT), {}) or {}).get("notes_episodes_imdb") or {}
        for rel in episodes_locaux(chemin):
            se = saison_episode(rel)
            tc = grille.get("%d.%d" % se) if se else None
            if tc and rel not in stock and note_de(notes, tc) is not None:
                out.append(tc)
    return out


def charger_titres(chemin, voulus):
    out = {}
    with gzip.open(chemin, "rt", encoding="utf-8") as f:
        next(f, None)
        for ligne in f:
            c = ligne.split("\t")
            if c and c[0] in voulus:
                out[c[0]] = c[2]
    return out


def maj(complet=False, log=print):
    """Le tour complet. Ne leve jamais: un lancement de serveur ne doit pas
    echouer parce qu'IMDb tousse."""
    videos = dossier_videos()
    if not videos:
        return None

    chemin_notes = telecharger(NOTES, log)
    if not chemin_notes:
        log("pas de notes disponibles, on passe")
        return None
    notes = charger_notes(chemin_notes)

    fichier_series = os.path.join(CACHE, "series.json")
    fichier_plan = os.path.join(CACHE, "episodes.json")
    series = lire_json(fichier_series, {})
    plan = lire_json(fichier_plan, {})

    # Un dossier renomme laisse une fiche orpheline. On la jette plutot que de
    # la trainer: le prochain --complet reconnaitra le dossier a son empreinte.
    # Le garde-fou sur la liste evite de tout effacer si le disque est absent.
    presents = {d for d in os.listdir(videos) if os.path.isdir(os.path.join(videos, d))}
    if presents:
        orphelines = [d for d in series if d not in presents]
        if orphelines:
            for d in orphelines:
                log("dossier disparu, fiche oubliee : " + d)
                del series[d]
            ecrire_json(fichier_series, series)

    # On rassemble d'abord les fiches possibles des dossiers inconnus: leurs
    # episodes doivent entrer dans le plan pour qu'on puisse les confronter aux
    # notes deja inscrites. Avant, seul --complet le faisait — une serie
    # ajoutee restait sans note a chaque lancement, sous un « deja a jour ».
    # Un dossier deja essaye sans succes n'est retente que s'il a change
    # (episodes en plus) ou au bout d'une semaine: la table des noms pese
    # 220 Mo, pas question de la reprendre a chaque lancement pour rien.
    fichier_essais = os.path.join(CACHE, "essais.json")
    essais = lire_json(fichier_essais, {})
    lots = {}
    manquantes = a_identifier(videos, series)
    if not complet:
        for d in list(manquantes):
            e = essais.get(d)
            if e and e.get("eps") == len(episodes_locaux(os.path.join(videos, d))) \
                    and time.time() - e.get("vu", 0) < 7 * 86400:
                del manquantes[d]
    if manquantes:
        log("nouvelle(s) serie(s) : %s" % ", ".join(sorted(manquantes)))
        chemin_noms = telecharger(NOMS, log)
        if chemin_noms:
            lots = candidats_series(chemin_noms, manquantes, notes)

    if not series and not lots:
        log("aucune serie identifiee — lance une fois "
            + couleur("python outils/notes_imdb.py --complet", "96"))
        return None

    # Un episode que le plan ne connait pas encore, c'est peut-etre un nouveau:
    # seule occasion de redemander la grosse table.
    #
    # « Peut-etre », parce que beaucoup n'y seront jamais: les hors-series
    # numerotes a la suite d'une saison, un OAV range dans saison1. Sans
    # memoire, ceux-la relanceraient un telechargement de 52 Mo a chaque
    # lancement, pour rien. On note donc ce qu'IMDb n'a pas su nous dire, et on
    # ne le redemande qu'une fois par semaine — au cas ou la fiche s'etoffe.
    fichier_absents = os.path.join(CACHE, "absents.json")
    absents = lire_json(fichier_absents, {})
    if time.time() - absents.get("_vu", 0) > 7 * 86400:
        absents = {}

    inconnus = []
    for dossier, fiche in series.items():
        grille = plan.get(fiche["tconst"])
        if grille is None:
            inconnus.append(dossier)
            continue
        connus_absents = set(absents.get(fiche["tconst"], ()))
        for rel in episodes_locaux(os.path.join(videos, dossier)):
            se = saison_episode(rel)
            if not se:
                continue
            cle = "%d.%d" % se
            if cle not in grille and cle not in connus_absents:
                inconnus.append(dossier)
                break
    if inconnus or lots:
        quoi = sorted(set(inconnus)) or sorted(lots)
        log("a revoir : %s%s" % (", ".join(quoi[:4]), " ..." if len(quoi) > 4 else ""))
        chemin_eps = telecharger(EPISODES, log)
        if chemin_eps:
            parents = {f["tconst"] for f in series.values()}
            parents |= {f[0] for lot in lots.values() for f in lot}
            plan = plan_episodes(chemin_eps, parents)
            try:
                os.remove(chemin_eps)             # 52 Mo qui ne resservent pas
            except OSError:
                pass

    if lots:
        if trancher(manquantes, lots, series, plan, notes, videos, log):
            ecrire_json(fichier_series, series)
        for d in manquantes:
            if d in series:
                essais.pop(d, None)
            else:
                essais[d] = {"eps": len(episodes_locaux(os.path.join(videos, d))), "vu": time.time()}
        ecrire_json(fichier_essais, essais)
        # le plan a servi a departager: on n'en garde que les series retenues
        gardes = {f["tconst"] for f in series.values()}
        plan = {k: v for k, v in plan.items() if k in gardes}
    if inconnus or lots:
        ecrire_json(fichier_plan, plan)
        # ce qu'IMDb ne connait pas malgre un plan tout frais: on s'en souvient
        neufs = {"_vu": time.time()}
        for dossier, fiche in series.items():
            grille = plan.get(fiche["tconst"], {})
            hors = sorted({"%d.%d" % se for se in (
                saison_episode(rel) for rel in episodes_locaux(os.path.join(videos, dossier))
            ) if se and "%d.%d" % se not in grille})
            if hors:
                neufs[fiche["tconst"]] = hors
        ecrire_json(fichier_absents, neufs)

    # Les titres: tous en mode complet; sinon ceux des episodes qui n'ont pas
    # encore de note — les nouveaux. Avant, un episode ajoute recevait sa note
    # mais jamais son titre. Une fois note il sort du lot: pas de seconde fois.
    titres = {}
    if complet:
        voulus = {tc for g in plan.values() for tc in g.values()}
    else:
        voulus = set(nouveaux_episodes(videos, series, plan, notes))
    noms_pris = False
    if voulus:
        chemin_noms = telecharger(NOMS, log)
        if chemin_noms:
            noms_pris = True
            titres = charger_titres(chemin_noms, voulus)

    res = appliquer(videos, series, plan, notes, titres, log, bavard=complet)
    if complet or noms_pris or lots:
        # 220 Mo qui ne resservent qu'a la prochaine serie inconnue: on les rend
        try:
            os.remove(os.path.join(CACHE, NOMS))
        except OSError:
            pass
    return res


# ------------------------------------------------------------ entree ------

def main():
    os.system("")
    complet = "--complet" in sys.argv
    print()
    print(couleur("  Notes IMDb des episodes", "1;95"))
    print("  " + "-" * 42)
    debut = time.time()
    try:
        res = maj(complet=complet, log=print)
    except Exception as e:
        print("  " + couleur("interrompu : %s" % e, "91"))
        return 1
    if res is None:
        print("  rien a faire.")
        return 0
    a, laissees, t, sans = res
    print()
    print("  %s note(s) ajoutee(s)%s en %.1fs"
          % (couleur(a, "92"), (", %s titre(s)" % couleur(t, "92")) if t else "",
             time.time() - debut))
    if laissees:
        print("  %d note(s) deja en place different de celle d'IMDb aujourd'hui : "
              "laissees telles quelles." % laissees)
    if sans:
        print("  %d fichier(s) sans episode IMDb correspondant "
              "(films, OAV, hors-series : ils ont leur propre fiche)." % sans)
    return 0


if __name__ == "__main__":
    sys.exit(main())
