# -*- coding: utf-8 -*-
"""Partage la bibliotheque par un lien Cloudflare temporaire.

Trois etapes:
  1. on ecrit un index de tous les fichiers, pour que la page n'ait pas a
     explorer 26 000 fichiers a coups de requetes une fois en ligne;
  2. on sert le dossier en HTTP, avec le support des requetes partielles
     (sans quoi on ne peut pas se deplacer dans une video);
  3. on ouvre un tunnel cloudflared et on affiche le lien a partager.

Le lien vit le temps que cette fenetre reste ouverte. Ctrl+C pour tout fermer.
"""
import http.server
import json
import mimetypes
import os
import re
import shutil
import socket
import socketserver
import subprocess
import sys
import threading
import time
import urllib.parse

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFESTE = "bibliotheque-index.json"
ACCOMPAGNEMENT = "bibliotheque.json"            # depose par la page dans chaque serie
DOSSIERS_MEDIA = ("videos", "video")

VIDEO_EXT = {"mp4", "m4v", "webm", "mov", "mkv", "ts", "m2ts", "avi", "flv", "ogv"}
IMAGE_EXT = {"jpg", "jpeg", "png", "webp", "avif", "gif", "bmp"}
DOC_EXT = {"pdf", "epub", "cbz", "cbr", "md", "txt"}
MEDIA_EXT = VIDEO_EXT | IMAGE_EXT | DOC_EXT

# Les cotes: les sous-titres, que le navigateur ne lit qu'en .vtt separe, et les
# autres langues, qu'il ne sait pas aller chercher dans un MP4 a plusieurs
# pistes. Elles ne figuraient pas au manifeste — servables mais jamais listees,
# donc invisibles pour l'invite, qui se retrouvait sans choix de langue ni de
# sous-titres. Elles ne comptent que dans un dossier prevu pour, sous une
# saison: la meme regle que la page applique de son cote.
DOSSIERS_COTE = {"sous-titres", "sous titres", "subs", "subtitles", "audio", "pistes"}
SUB_EXT = {"vtt"}
AUD_EXT = {"m4a", "mp3", "aac", "opus", "ogg", "wav"}


def est_cote(rel, ext):
    """rel est le chemin sous videos/. Il faut au moins serie/saison/dossier."""
    parts = rel.split("/")
    if len(parts) < 4:
        return False
    if parts[-2].lower() not in DOSSIERS_COTE:
        return False
    return ext in (SUB_EXT | AUD_EXT)
SAUTER = {"node_modules", ".git", "__pycache__", "$recycle.bin",
          "system volume information", "outils"}

# Types que Windows ne connait pas toujours: sans eux le navigateur refuse de lire
mimetypes.add_type("video/mp2t", ".ts")
mimetypes.add_type("video/mp4", ".m4v")
mimetypes.add_type("video/x-matroska", ".mkv")
mimetypes.add_type("text/markdown", ".md")
mimetypes.add_type("application/json", ".json")
mimetypes.add_type("text/vtt", ".vtt")


def couleur(txt, code):
    return "\033[%sm%s\033[0m" % (code, txt)


# --------------------------------------------------------------- index ----
def _note(v):
    """Une note de 1 a 10 a une decimale, ou 0 si ce n en est pas une. Les
    booleens comptent comme des entiers en Python: on les ecarte a la main."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return 0
    return round(float(v), 1) if 1 <= v <= 10 else 0


def _titres_episodes(v):
    """Le tableau chemin d episode -> titre, debarrasse de ce qui n en est pas."""
    if not isinstance(v, dict):
        return {}
    propre = {}
    for rel, t in v.items():
        if isinstance(rel, str) and isinstance(t, str) and t.strip():
            propre[rel] = t.strip()[:200]
    return propre


def _notes_episodes(v):
    """Le tableau chemin d episode -> note, debarrasse de ce qui n en est pas."""
    if not isinstance(v, dict):
        return {}
    propre = {}
    for rel, x in v.items():
        n = _note(x)
        if isinstance(rel, str) and n:
            propre[rel] = n
    return propre


def lire_accompagnement(chemin):
    """Ce que l hote a range dans une serie: categories, description, notes
    (la sienne et celle d IMDb), titres d episodes, generiques.

    Ni sa progression ni ses favoris ne partent avec le lien: l'un le ferait
    regarder au rythme d'un autre, l'autre ne regarde que lui."""
    try:
        with open(chemin, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return None
    if not isinstance(d, dict):
        return None
    fiche = {}
    cats = d.get("categories")
    if isinstance(cats, list):
        cats = [c for c in cats if isinstance(c, str)]
        if cats:
            fiche["categories"] = cats
    texte = d.get("description")
    if isinstance(texte, str) and texte.strip():
        fiche["description"] = texte.strip()[:1200]
    for champ in ("note", "note_imdb"):
        note = _note(d.get(champ))
        if note:
            fiche[champ] = note
    for champ in ("notes_episodes", "notes_episodes_imdb"):
        propre = _notes_episodes(d.get(champ))
        if propre:
            fiche[champ] = propre
    titres = _titres_episodes(d.get("titres_episodes"))
    if titres:
        fiche["titres_episodes"] = titres
    for champ in ("generiques", "generiques_fin"):    # debut d episode, puis fin
        gen = d.get(champ)
        if not isinstance(gen, dict):
            continue
        propre = {}
        for rel, seg in gen.items():
            if not isinstance(rel, str) or not isinstance(seg, dict):
                continue
            a, b = seg.get("start"), seg.get("end")
            if isinstance(a, (int, float)) and isinstance(b, (int, float)) and b > a:
                propre[rel] = {"start": a, "end": b}
        if propre:
            fiche[champ] = propre
    return fiche or None


def construire_index():
    """Liste les media d'un dossier de la bibliotheque: [chemin, taille, date]."""
    for nom in DOSSIERS_MEDIA:
        base = os.path.join(RACINE, nom)
        if os.path.isdir(base):
            break
    else:
        return None, 0

    fichiers = []
    accompagnements = {}
    for dossier, sous, noms in os.walk(base):
        sous[:] = [d for d in sous if d.lower() not in SAUTER]
        if ACCOMPAGNEMENT in noms:
            serie = os.path.relpath(dossier, base).replace(os.sep, "/")
            if "/" not in serie and serie != ".":   # un seul par serie, a sa racine
                fiche = lire_accompagnement(os.path.join(dossier, ACCOMPAGNEMENT))
                if fiche:
                    accompagnements[serie] = fiche
        for n in noms:
            ext = n.rsplit(".", 1)[-1].lower() if "." in n else ""
            chemin = os.path.join(dossier, n)
            rel = os.path.relpath(chemin, base).replace(os.sep, "/")
            if ext not in MEDIA_EXT and not est_cote(rel, ext):
                continue
            try:
                st = os.stat(chemin)
            except OSError:
                continue
            fichiers.append([rel, st.st_size, int(st.st_mtime * 1000)])

    fichiers.sort(key=lambda f: f[0])
    data = {"version": 1, "base": nom + "/", "genere": int(time.time() * 1000),
            "partage": True, "fiches": accompagnements, "files": fichiers}
    cible = os.path.join(RACINE, MANIFESTE)
    tmp = cible + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, cible)
    return cible, len(fichiers)


# -------------------------------------------------------------- serveur ----
class Handler(http.server.SimpleHTTPRequestHandler):
    """Ajoute les requetes partielles: sans elles, impossible de se deplacer
    dans une video, et chaque episode devrait etre telecharge en entier."""

    # En HTTP/1.0 la connexion se ferme apres chaque fichier: 26 000 pages de
    # scan feraient 26 000 ouvertures a travers le tunnel. En 1.1 elle est
    # reutilisee, et la fin des gros fichiers arrive intacte.
    protocol_version = "HTTP/1.1"
    timeout = 30                                # une connexion oisive ne retient pas un fil

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=RACINE, **kw)

    def log_message(self, *a):
        pass                                    # la console reste lisible

    def end_headers(self):
        # Sans cette annonce, le navigateur ne tente meme pas de se deplacer
        # dans une video: il la telecharge en entier ou rien.
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def autorise(self):
        """Un lien public ne donne acces qu'a la page et aux media: le code
        source et les fichiers de travail restent a la maison."""
        chemin = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
        if chemin in ("", "/"):
            return True
        rel = chemin.lstrip("/")
        if rel in ("index.html", MANIFESTE, "favicon.ico"):
            return True
        premier = rel.split("/", 1)[0].lower()
        # js/ porte le code de la page: sans lui l'invite recoit une coquille vide
        return premier in DOSSIERS_MEDIA or premier in ("assets", "js")

    def send_head(self):
        if not self.autorise():
            self.send_error(404)
            return None
        plage = self.headers.get("Range")
        if not plage:
            return super().send_head()

        chemin = self.translate_path(self.path)
        if os.path.isdir(chemin) or not os.path.isfile(chemin):
            return super().send_head()

        m = re.match(r"bytes=(\d*)-(\d*)$", plage.strip())
        if not m:
            return super().send_head()

        taille = os.path.getsize(chemin)
        debut, fin = m.group(1), m.group(2)
        if debut == "":                          # bytes=-500 : les 500 derniers octets
            longueur = min(int(fin or 0), taille)
            debut = taille - longueur
            fin = taille - 1
        else:
            debut = int(debut)
            fin = int(fin) if fin else taille - 1
        fin = min(fin, taille - 1)
        if debut > fin or debut >= taille:
            self.send_response(416)
            self.send_header("Content-Range", "bytes */%d" % taille)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None

        try:
            f = open(chemin, "rb")
        except OSError:
            self.send_error(404)
            return None
        f.seek(debut)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(chemin))
        self.send_header("Content-Range", "bytes %d-%d/%d" % (debut, fin, taille))
        self.send_header("Content-Length", str(fin - debut + 1))
        self.end_headers()
        return _Tranche(f, fin - debut + 1)


class _Tranche:
    """Vue en lecture seule sur une portion de fichier, pour copyfile()."""

    def __init__(self, f, restant):
        self.f = f
        self.restant = restant

    def read(self, n=-1):
        if self.restant <= 0:
            return b""
        if n < 0 or n > self.restant:
            n = self.restant
        bloc = self.f.read(n)
        self.restant -= len(bloc)
        return bloc

    def close(self):
        self.f.close()


class Serveur(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request, client_address):
        """Un lecteur video coupe la connexion des qu'on se deplace dans un
        episode, et le navigateur en abandonne d'autres en quittant une page.
        C'est normal: on ne noie pas la console sous des traces pour ca."""
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionError, TimeoutError, socket.timeout)):
            return
        print(couleur("  (requete abandonnee: %s)" % exc.__class__.__name__,
                      "90"))


def port_libre(prefere=0, hote="127.0.0.1"):
    """Un port utilisable: celui qu'on prefere s'il est libre, sinon au hasard."""
    if prefere:
        s = socket.socket()
        try:
            s.bind((hote, prefere))
            s.close()
            return prefere
        except OSError:
            s.close()
    s = socket.socket()
    s.bind((hote, 0))
    p = s.getsockname()[1]
    s.close()
    return p


def adresse_locale():
    """L'adresse de cette machine sur la box, celle que voient le telephone
    et la television du salon."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))        # aucun paquet n'est envoye
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


# ---------------------------------------------------------- cloudflared ----
def trouver_cloudflared():
    """Cherche l'executable: PATH, dossier du projet, puis emplacements connus."""
    trouve = shutil.which("cloudflared")
    if trouve:
        return trouve

    memo = os.path.join(RACINE, "outils", "cloudflared.txt")
    if os.path.isfile(memo):
        try:
            chemin = open(memo, encoding="utf-8").read().strip()
            if chemin and os.path.isfile(chemin):
                return chemin
        except OSError:
            pass

    pistes = [os.path.join(RACINE, "outils", "cloudflared.exe"),
              os.path.join(RACINE, ".tools", "cloudflared.exe")]
    bureau = os.path.join(os.path.expanduser("~"), "Desktop")
    for racine in (bureau, os.path.expanduser("~")):
        if not os.path.isdir(racine):
            continue
        for dossier, sous, noms in os.walk(racine):
            if dossier.count(os.sep) - racine.count(os.sep) > 3:
                sous[:] = []
                continue
            sous[:] = [d for d in sous if not d.startswith("$")]
            if "cloudflared.exe" in noms:
                pistes.append(os.path.join(dossier, "cloudflared.exe"))
                if len(pistes) > 6:
                    break

    for p in pistes:
        if os.path.isfile(p):
            try:
                os.makedirs(os.path.dirname(memo), exist_ok=True)
                with open(memo, "w", encoding="utf-8") as f:
                    f.write(p)
            except OSError:
                pass
            return p
    return None


LIEN = re.compile(r"https://[-a-z0-9]+\.trycloudflare\.com")


def ouvrir_tunnel(exe, port, sur_lien):
    """Lance le tunnel et rappelle sur_lien() des que l'adresse apparait."""
    proc = subprocess.Popen(
        [exe, "tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:%d" % port],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))

    def lire():
        vu = False
        for ligne in proc.stdout:
            texte = ligne.decode("utf-8", "replace")
            m = LIEN.search(texte)
            if m and not vu:
                vu = True
                sur_lien(m.group(0))
            elif "ERR" in texte and not vu:
                sys.stdout.write("   " + texte.strip()[-160:] + "\n")

    threading.Thread(target=lire, daemon=True).start()
    return proc


def copier(texte):
    try:
        subprocess.run("clip", input=texte.encode("utf-16-le"), check=True,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return True
    except Exception:
        return False


# ----------------------------------------------------------------- mode ----
def demander_mode():
    """Deux usages bien differents, on laisse choisir plutot que deviner."""
    print(couleur("  Comment veux-tu partager ?", "1"))
    print()
    print("    " + couleur("1", "96") + "  Local     " +
          couleur("sur ta box uniquement, rien ne sort de chez toi", "90"))
    print("    " + couleur("2", "96") + "  Internet  " +
          couleur("lien public temporaire, accessible de partout", "90"))
    print()
    while True:
        try:
            rep = input("  Ton choix [1] : ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print()
            return None
        if rep in ("", "1", "l", "local"):
            return "local"
        if rep in ("2", "i", "internet", "en ligne", "ligne"):
            return "internet"
        print(couleur("  Tape 1 ou 2.", "90"))


def mode_demande():
    """Le mode peut aussi venir de la ligne de commande, pour les raccourcis."""
    for a in sys.argv[1:]:
        a = a.lstrip("-").lower()
        if a in ("l", "local"):
            return "local"
        if a in ("i", "internet", "online", "ligne"):
            return "internet"
    return None


def rafraichir_notes():
    """Remet a jour les notes IMDb des episodes avant de construire l'index.

    L'ordre compte: l'index recopie les bibliotheque.json dans le manifeste, il
    faut donc que les notes y soient deja quand il passe. Le module ne
    telecharge que si IMDb a publie depuis la veille — un lancement ordinaire
    ne coute rien. Et s'il echoue, on continue sans lui: un partage ne doit pas
    dependre de la sante d'un site tiers.
    """
    try:
        import notes_imdb
    except Exception:
        return
    print("  Notes IMDb des episodes...")
    try:
        res = notes_imdb.maj(log=lambda m: print("  " + m))
    except Exception as e:
        print("        " + couleur("indisponible (%s)" % e, "93"))
        return
    if not res:
        return
    ajout, _laissees, titres, _ = res
    if ajout or titres:
        print("        " + couleur("%d note(s), %d titre(s) ajoutes"
                                   % (ajout, titres), "92"))
    else:
        print("        " + couleur("deja a jour", "90"))


# ----------------------------------------------------------------- main ----
def main():
    os.system("")                               # active les couleurs sur la console Windows
    print()
    print(couleur("  Partage de la bibliotheque", "1;95"))
    print("  " + "-" * 42)
    print()

    mode = mode_demande() or demander_mode()
    if mode is None:
        return 1
    print()

    rafraichir_notes()
    print()

    total = 2 if mode == "local" else 3
    print("  1/%d  Index des fichiers..." % total, end=" ", flush=True)
    debut = time.time()
    chemin, nb = construire_index()
    if chemin is None:
        print(couleur("aucun dossier videos/ trouve", "91"))
        return 1
    print(couleur("%d fichiers" % nb, "92") + " en %.1fs" % (time.time() - debut))

    if mode == "local":
        return partage_local()
    return partage_internet()


def partage_local():
    """On ecoute sur toute la maison: le lien marche sur le telephone et la
    television, mais il s'arrete a la box."""
    port = port_libre(8000, "0.0.0.0")
    serveur = Serveur(("0.0.0.0", port), Handler)
    threading.Thread(target=serveur.serve_forever, daemon=True).start()
    url = "http://%s:%d" % (adresse_locale(), port)
    print("  2/2  Serveur pret sur ton reseau.")
    print()
    print("  " + couleur("  " + url + "  ", "1;30;106"))
    print()
    print("  " + couleur("Copie dans le presse-papier." if copier(url) else
                         "Copie ce lien pour le partager.", "90"))
    print("  " + couleur("A ouvrir depuis un appareil connecte a la meme box.", "90"))
    print("  " + couleur("Sur cette machine : http://127.0.0.1:%d" % port, "90"))
    print("  " + couleur("Si Windows demande d'autoriser Python, accepte (reseau prive).", "93"))
    print()
    attendre(serveur, None)
    return 0


def partage_internet():
    """Un tunnel Cloudflare donne une adresse publique le temps de la fenetre."""
    port = port_libre(hote="127.0.0.1")
    serveur = Serveur(("127.0.0.1", port), Handler)
    threading.Thread(target=serveur.serve_forever, daemon=True).start()
    print("  2/3  Serveur local sur " + couleur("http://127.0.0.1:%d" % port, "96"))

    exe = trouver_cloudflared()
    if not exe:
        print(couleur("  3/3  cloudflared introuvable.", "91"))
        print("       Pose cloudflared.exe dans le dossier outils/, ou installe-le")
        print("       avec : winget install --id Cloudflare.cloudflared")
        print()
        print("  La bibliotheque reste accessible ici meme : " +
              couleur("http://127.0.0.1:%d" % port, "96"))
        attendre(serveur, None)
        return 0

    print("  3/3  Ouverture du tunnel...", end=" ", flush=True)
    pret = threading.Event()

    def sur_lien(url):
        print(couleur("en ligne", "92"))
        print()
        print("  " + couleur("  " + url + "  ", "1;30;105"))
        print()
        print("  " + couleur("Copie dans le presse-papier." if copier(url) else
                             "Copie ce lien pour le partager.", "90"))
        print("  " + couleur("Toute personne ayant ce lien voit la bibliotheque entiere.", "93"))
        print("  " + couleur("Le lien meurt a la fermeture de cette fenetre.", "90"))
        print()
        pret.set()

    proc = ouvrir_tunnel(exe, port, sur_lien)
    if not pret.wait(45):
        print(couleur("pas de reponse", "91"))
        print("  Verifie ta connexion, puis relance.")
    attendre(serveur, proc)
    return 0


def attendre(serveur, proc):
    print(couleur("  Ctrl+C pour arreter le partage.", "90"))
    try:
        while True:
            if proc is not None and proc.poll() is not None:
                print(couleur("\n  Le tunnel s'est ferme.", "91"))
                break
            time.sleep(0.5)
    except KeyboardInterrupt:
        print()
    print("  Fermeture...")
    if proc is not None:
        try:
            proc.terminate()
        except Exception:
            pass
    serveur.shutdown()
    try:                                        # un index perime vaut moins que pas d index
        os.remove(os.path.join(RACINE, MANIFESTE))
    except OSError:
        pass
    print(couleur("  Partage arrete.", "90"))


if __name__ == "__main__":
    sys.exit(main())
