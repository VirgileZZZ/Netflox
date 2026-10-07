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
import gzip
import hashlib
import hmac
import io
import http.cookies
import http.server
import json
import secrets
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
NOTES_INVITES = "notes-invites.json"            # les notes des invites, a part: ils n'ecrivent jamais dans le fichier de l'hote
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
# saison ou directement sous la serie (un film n'a pas de saison): la meme
# regle que la page applique de son cote.
DOSSIERS_COTE = {"sous-titres", "sous titres", "subs", "subtitles", "audio", "pistes"}
SUB_EXT = {"vtt"}
AUD_EXT = {"m4a", "mp3", "aac", "opus", "ogg", "wav"}


def est_cote(rel, ext):
    """rel est le chemin sous videos/: serie/[saison/]dossier/fichier.
    Exiger une saison laissait Le Hobbit et Le Seigneur des Anneaux sans
    sous-titres ni VF une fois partages."""
    parts = rel.split("/")
    if len(parts) < 3:
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
    # jusqu'ou chaque edit montre l'histoire: sans elles, l'invite ne verrait
    # aucun edit tant qu'il n'a pas fini la serie
    spoils = d.get("spoil_edits")
    if isinstance(spoils, dict):
        propre = {k: v for k, v in spoils.items() if isinstance(k, str) and isinstance(v, str) and v}
        if propre:
            fiche["spoil_edits"] = propre
    return fiche or None


def _note_valide(v):
    """Une note de 1 a 10, au dixieme. None pour tout le reste."""
    if isinstance(v, bool):
        return None
    try:
        n = round(float(v), 1)
    except (TypeError, ValueError):
        return None
    return n if 1 <= n <= 10 else None


def _votes(d):
    if not isinstance(d, dict):
        return {}
    out = {}
    for qui, v in d.items():
        n = _note_valide(v)
        if isinstance(qui, str) and n:
            out[qui] = n
    return out


def lire_notes_invites(dossier):
    """{"serie": {invite: note}, "episodes": {chemin: {invite: note}}}, nettoye."""
    try:
        with open(os.path.join(dossier, NOTES_INVITES), encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return None
    if not isinstance(d, dict):
        return None
    propre = {}
    serie = _votes(d.get("serie"))
    if serie:
        propre["serie"] = serie
    eps = {}
    for rel, votes in (d.get("episodes") or {}).items() if isinstance(d.get("episodes"), dict) else []:
        v = _votes(votes)
        if isinstance(rel, str) and v:
            eps[rel] = v
    if eps:
        propre["episodes"] = eps
    return propre or None


def hache_invite(iid):
    """L'identifiant de vote d'un invite, tel qu'il est publie. L'index est lu
    par tout le monde: y mettre les vrais identifiants permettait de voter a la
    place d'un ami, ou de lui prendre ses votes. Le vrai ne quitte jamais son
    navigateur et ce serveur; la page apprend son empreinte par /__moi."""
    return hashlib.sha256(("netflox-invite:" + str(iid)).encode("utf-8")).hexdigest()[:16]


def _votes_publies(votes):
    return {hache_invite(k): v for k, v in votes.items()}


def fiche_serie(dossier):
    """Ce que la page recoit d'une serie: la fiche de l'hote et les notes des
    invites, sous leurs identifiants publies."""
    fiche = None
    chemin = os.path.join(dossier, ACCOMPAGNEMENT)
    if os.path.isfile(chemin):
        fiche = lire_accompagnement(chemin)
    invites = lire_notes_invites(dossier)
    if invites:
        publie = {}
        if invites.get("serie"):
            publie["serie"] = _votes_publies(invites["serie"])
        if invites.get("episodes"):
            publie["episodes"] = {rel: _votes_publies(v) for rel, v in invites["episodes"].items()}
        fiche = dict(fiche or {})
        fiche["notes_invites"] = publie
    return fiche


_verrou_index = threading.Lock()
def rafraichir_fiches():
    """Les fiches bougent pendant que le partage tourne: une note, une
    categorie, des edits annotes. On les relit a chaque demande de l'index —
    une trentaine de petits fichiers — sans reparcourir toute la bibliotheque."""
    cible = os.path.join(RACINE, MANIFESTE)
    with _verrou_index:
        try:
            with open(cible, encoding="utf-8") as f:
                data = json.load(f)
            base = os.path.join(RACINE, str(data.get("base", "videos/")).strip("/"))
            series = os.listdir(base)
        except (OSError, ValueError):
            return
        fiches = {}
        for serie in series:
            if serie.lower() in SAUTER or not os.path.isdir(os.path.join(base, serie)):
                continue
            fiche = fiche_serie(os.path.join(base, serie))
            if fiche:
                fiches[serie] = fiche
        if fiches == data.get("fiches"):
            return
        data["fiches"] = fiches
        tmp = cible + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, cible)


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
        if ACCOMPAGNEMENT in noms or NOTES_INVITES in noms:
            serie = os.path.relpath(dossier, base).replace(os.sep, "/")
            if "/" not in serie and serie != ".":   # un seul par serie, a sa racine
                fiche = fiche_serie(dossier)
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


# ----------------------------------------------------------- les notes -----
_verrou_notes = threading.Lock()
_ADRESSES_HOTE = None
_ADRESSES_DATE = 0


def est_hote(handler):
    """L'hote: cette machine, ou un compte qu'il a declare comme le sien depuis
    elle. Sans ce second cas, l'hote connecte par le lien partage notait en
    invite, et sa note comptait deux fois: dans sa fiche et chez les invites."""
    if est_machine_hote(handler):
        return True
    compte = _session(handler)[0]
    return bool(compte and compte.get("hote"))


def est_machine_hote(handler):
    """Cette machine. Le tunnel Cloudflare arrive lui aussi de 127.0.0.1, mais
    il signe ses requetes: une requete signee vient d'ailleurs. Un telephone
    sur la box arrive de sa propre adresse: il note en invite."""
    if handler.headers.get("Cf-Connecting-Ip") or handler.headers.get("Cf-Ray"):
        return False
    global _ADRESSES_HOTE, _ADRESSES_DATE
    # relevees toutes les 5 minutes: l'adresse sur la box peut changer (DHCP, VPN)
    if _ADRESSES_HOTE is None or time.time() - _ADRESSES_DATE > 300:
        _ADRESSES_DATE = time.time()
        a = {"127.0.0.1", "::1", adresse_locale()}
        try:
            a.update(socket.gethostbyname_ex(socket.gethostname())[2])
        except OSError:
            pass
        _ADRESSES_HOTE = a
    ip = handler.client_address[0]
    if ip.startswith("::ffff:"):
        ip = ip[7:]
    return ip in _ADRESSES_HOTE


def _base_media():
    for nom in DOSSIERS_MEDIA:
        base = os.path.join(RACINE, nom)
        if os.path.isdir(base):
            return base
    return None


class FichierAbime(Exception):
    """Un fichier qui existe mais ne se lit pas: on n'y ecrit pas par-dessus."""


def _lire_ou(chemin, defaut):
    try:
        with open(chemin, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else defaut
    except (OSError, ValueError):
        return defaut


def _lire_pour_ecrire(chemin, defaut):
    """Comme _lire_ou, mais un fichier present et illisible (abime, a moitie
    ecrit) leve FichierAbime au lieu de rendre le defaut: le rendre, c'etait le
    remplacer par une fiche presque vide a la prochaine note."""
    if not os.path.exists(chemin):
        return defaut
    try:
        with open(chemin, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        raise FichierAbime(chemin)
    if not isinstance(d, dict):
        raise FichierAbime(chemin)
    return d


def _ecrire(chemin, data):
    """Ecriture atomique et durable: un fichier temporaire propre a ce fil,
    pousse sur le disque, puis mis en place d'un coup."""
    tmp = "%s.%d.tmp" % (chemin, threading.get_ident())
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, chemin)


def noter(d, hote):
    """Pose ou retire une note. cible: « s:serie » ou « e:serie/chemin.mp4 »,
    note: 1 a 10, ou 0 pour retirer. L'hote ecrit dans bibliotheque.json, comme
    depuis la page ouverte sur le dossier; un invite, sous son identifiant de
    navigateur, dans notes-invites.json. Renvoie (ok, raison)."""
    cible, note, invite = d.get("cible"), d.get("note"), d.get("invite")
    if not isinstance(cible, str) or cible[:2] not in ("s:", "e:"):
        return False, "cible"
    n = 0 if note in (0, None) else _note_valide(note)
    if n is None:
        return False, "note"
    chemin = cible[2:]
    morceaux = chemin.split("/")
    if not morceaux[0] or "\\" in chemin or any(m in ("", ".", "..") for m in morceaux):
        return False, "cible"
    base = _base_media()
    dossier = os.path.join(base, morceaux[0]) if base else None
    if not dossier or not os.path.isdir(dossier):
        return False, "serie inconnue"
    court = None
    if cible[0] == "e":
        court = "/".join(morceaux[1:])
        ext = court.rsplit(".", 1)[-1].lower() if "." in court else ""
        if not court or ext not in VIDEO_EXT or not os.path.isfile(os.path.join(dossier, *morceaux[1:])):
            return False, "episode inconnu"
    if not hote and (not isinstance(invite, str) or not re.fullmatch(r"[A-Za-z0-9_-]{8,64}", invite)):
        return False, "invite"

    with _verrou_notes:
        if hote:
            fichier = os.path.join(dossier, ACCOMPAGNEMENT)
            try:
                data = _lire_pour_ecrire(fichier, {"version": 1, "serie": morceaux[0]})
            except FichierAbime:
                return False, "fiche de la serie illisible: rien n'est ecrit"
            if court is None:
                if n: data["note"] = n
                else: data.pop("note", None)
            else:
                t = data.get("notes_episodes") if isinstance(data.get("notes_episodes"), dict) else {}
                if n: t[court] = n
                else: t.pop(court, None)
                if t: data["notes_episodes"] = t
                else: data.pop("notes_episodes", None)
        else:
            fichier = os.path.join(dossier, NOTES_INVITES)
            try:
                data = _lire_pour_ecrire(fichier, {"version": 1})
            except FichierAbime:
                return False, "notes des invites illisibles: rien n'est ecrit"
            if court is None:
                votes = data.get("serie") if isinstance(data.get("serie"), dict) else {}
                if n: votes[invite] = n
                else: votes.pop(invite, None)
                if votes: data["serie"] = votes
                else: data.pop("serie", None)
            else:
                eps = data.get("episodes") if isinstance(data.get("episodes"), dict) else {}
                votes = eps.get(court) if isinstance(eps.get(court), dict) else {}
                if n: votes[invite] = n
                else: votes.pop(invite, None)
                if votes: eps[court] = votes
                else: eps.pop(court, None)
                if eps: data["episodes"] = eps
                else: data.pop("episodes", None)
        _ecrire(fichier, data)
    return True, ""


# ----------------------------------------------------------- les comptes ---
"""Un compte leger pour les invites: un pseudo et un mot de passe, rien d'autre.

Un lien Cloudflare temporaire est, pour le navigateur, un site neuf a chaque
lancement: tout ce qu'il rangeait (progression, edits vus, reglages) restait
sur l'ancien. Le compte garde ces infos ici, sur la machine de l'hote, et les
rend sur n'importe quel lien. Il est facultatif: sans lui, tout marche, mais
rien ne suit d'un lien a l'autre.

Rangement: comptes/<empreinte du pseudo>.json, hors de videos/ — jamais servi.
Le mot de passe n'y est pas: seulement son empreinte (PBKDF2, 200 000 tours,
avec un sel). La session tient dans un cookie HttpOnly, que la page ne lit pas;
le fichier n'en garde que l'empreinte."""
COOKIE = "netflox_session"
PSEUDO = re.compile(r"[A-Za-z0-9_.\- ]{3,24}$")
_verrou_comptes = threading.Lock()
_echecs = {}                                    # adresse -> heures des mots de passe rates
ECHECS_MAX, ECHECS_FENETRE = 8, 600             # 8 essais rates en 10 minutes: on fait attendre


def _dossier_comptes():
    return os.path.join(RACINE, "comptes")


def _id_compte(pseudo):
    return hashlib.sha256(pseudo.strip().lower().encode("utf-8")).hexdigest()[:32]


def _hacher(mdp, sel):
    return hashlib.pbkdf2_hmac("sha256", mdp.encode("utf-8"), bytes.fromhex(sel), 200000).hex()


def _empreinte(jeton):
    return hashlib.sha256(jeton.encode("utf-8")).hexdigest()


def _ouvrir_session(compte):
    """Un jeton neuf; on garde les 20 dernieres sessions (un compte, plusieurs appareils)."""
    jeton = secrets.token_urlsafe(32)
    s = compte.setdefault("sessions", {})
    s[_empreinte(jeton)] = int(time.time())
    for vieux in sorted(s, key=s.get)[:-20]:
        del s[vieux]
    return jeton


def _qui(handler):
    """L'adresse de celui qui demande. L'en-tete du tunnel n'est cru que s'il
    arrive de cette machine (c'est la que tourne cloudflared): sur la box, un
    invite pouvait l'inventer et changer d'adresse a chaque essai."""
    ip = handler.client_address[0]
    if ip in ("127.0.0.1", "::1") and handler.headers.get("Cf-Connecting-Ip"):
        return handler.headers.get("Cf-Connecting-Ip")
    return ip


_inscriptions = {}                              # adresse -> heures des comptes crees
INSCRIPTIONS_MAX, INSCRIPTIONS_FENETRE = 5, 3600


def _trop_d_inscriptions(handler):
    maintenant = time.time()
    l = [t for t in _inscriptions.get(_qui(handler), []) if maintenant - t < INSCRIPTIONS_FENETRE]
    _inscriptions[_qui(handler)] = l
    return len(l) >= INSCRIPTIONS_MAX


def _trop_d_echecs(handler):
    maintenant = time.time()
    l = [t for t in _echecs.get(_qui(handler), []) if maintenant - t < ECHECS_FENETRE]
    _echecs[_qui(handler)] = l
    return len(l) >= ECHECS_MAX


def compte_inscrire(pseudo, mdp, donnees, handler=None):
    if handler is not None and _trop_d_inscriptions(handler):
        return None, "Trop de comptes créés d'ici : réessaie plus tard"
    if not isinstance(pseudo, str) or not PSEUDO.match(pseudo.strip()):
        return None, "Pseudo : 3 à 24 lettres, chiffres, espaces, . _ -"
    if not isinstance(mdp, str) or not 4 <= len(mdp) <= 200:
        return None, "Mot de passe : 4 caractères au moins"
    fid = _id_compte(pseudo)
    fichier = os.path.join(_dossier_comptes(), fid + ".json")
    with _verrou_comptes:
        os.makedirs(_dossier_comptes(), exist_ok=True)
        if os.path.exists(fichier):
            return None, "Ce pseudo est déjà pris"
        sel = secrets.token_hex(16)
        maintenant = int(time.time())
        compte = {"pseudo": pseudo.strip(), "sel": sel, "hash": _hacher(mdp, sel),
                  "cree": maintenant, "maj": maintenant,
                  "donnees": donnees if isinstance(donnees, dict) else {}, "sessions": {}}
        jeton = _ouvrir_session(compte)
        _ecrire(fichier, compte)
    if handler is not None:
        _inscriptions.setdefault(_qui(handler), []).append(time.time())
    return (compte, fid + "." + jeton), ""


def compte_connecter(handler, pseudo, mdp):
    if _trop_d_echecs(handler):
        return None, "Trop d'essais : réessaie dans quelques minutes"
    if not isinstance(pseudo, str) or not isinstance(mdp, str) or not PSEUDO.match(pseudo.strip()):
        return None, "Pseudo ou mot de passe incorrect"
    fid = _id_compte(pseudo)
    fichier = os.path.join(_dossier_comptes(), fid + ".json")
    with _verrou_comptes:
        compte = _lire_ou(fichier, None)
        if not compte or not hmac.compare_digest(compte.get("hash", ""), _hacher(mdp, compte.get("sel", "00"))):
            _echecs.setdefault(_qui(handler), []).append(time.time())
            return None, "Pseudo ou mot de passe incorrect"
        jeton = _ouvrir_session(compte)
        _ecrire(fichier, compte)
    _echecs.pop(_qui(handler), None)            # la bonne reponse efface les essais rates
    return (compte, fid + "." + jeton), ""


def fusionner_donnees(serveur, recu):
    """Ce que garde un compte quand plusieurs appareils l'envoient: avant,
    le dernier arrive ecrasait tout, et un telephone reste ouvert effacait
    ce qu'on venait de regarder sur l'ordinateur. Les positions datees: la
    plus recente. Les edits vus et leurs mesures: les deux, l'envoi recent
    l'emportant sur un meme edit. Les reglages: ceux de l'envoi."""
    out = dict(serveur) if isinstance(serveur, dict) else {}
    for k, v in recu.items():
        ici = out.get(k)
        if ici is None or v is None:
            if v is not None:
                out[k] = v
            continue
        if re.match(r"(pg|rd|sc)\.", k) and isinstance(v, dict) and isinstance(ici, dict):
            if (v.get("at") or 0) >= (ici.get("at") or 0):
                out[k] = v
        elif k.startswith("oubli.") and isinstance(v, (int, float)) and isinstance(ici, (int, float)):
            out[k] = max(v, ici)
        elif k in ("edvus", "edstats") and isinstance(v, dict) and isinstance(ici, dict):
            out[k] = dict(ici, **v)
        else:
            out[k] = v
    return out


def _session(handler):
    """Le compte du cookie, son fichier et son jeton; (None, None, None) sinon."""
    brut = handler.headers.get("Cookie")
    if not brut:
        return None, None, None
    try:
        c = http.cookies.SimpleCookie(brut)
    except http.cookies.CookieError:
        return None, None, None
    v = c.get(COOKIE)
    if not v or "." not in v.value:
        return None, None, None
    fid, jeton = v.value.split(".", 1)
    if not re.fullmatch(r"[0-9a-f]{32}", fid):
        return None, None, None
    fichier = os.path.join(_dossier_comptes(), fid + ".json")
    compte = _lire_ou(fichier, None)
    if not compte or _empreinte(jeton) not in (compte.get("sessions") or {}):
        return None, None, None
    return compte, fichier, jeton


INVITE = re.compile(r"[A-Za-z0-9_-]{8,64}$")


def _deplacer_votes(ancien, vers_hote=False, nouveau=None):
    try:
        return _deplacer_votes_(ancien, vers_hote, nouveau)
    except (OSError, ValueError, TypeError, AttributeError, FichierAbime):
        return 0


def _deplacer_votes_(ancien, vers_hote=False, nouveau=None):
    """Les votes d'invite d'un identifiant, dans toute la bibliotheque: rendus
    a un autre identifiant (le compte qui vient de se connecter), ou portes dans
    la fiche de l'hote. Une case deja prise chez le destinataire garde sa note:
    on retire seulement le vote en double. Renvoie le nombre de votes touches."""
    base = _base_media()
    if not base:
        return 0
    touches = 0
    with _verrou_notes:
        for serie in os.listdir(base):
            dossier = os.path.join(base, serie)
            f_inv = os.path.join(dossier, NOTES_INVITES)
            if not os.path.isfile(f_inv):
                continue
            try:
                inv = _lire_pour_ecrire(f_inv, {})
                fiche = _lire_pour_ecrire(os.path.join(dossier, ACCOMPAGNEMENT), {"version": 1, "serie": serie}) if vers_hote else None
            except FichierAbime:
                continue                          # un fichier abime: on n'y touche pas
            if not isinstance(inv.get("episodes", {}), dict):
                continue
            cibles = [("serie", None, inv.get("serie"))] + \
                     [("ep", rel, v) for rel, v in (inv.get("episodes") or {}).items()]
            change = fiche_change = False
            for genre, rel, votes in cibles:
                if not isinstance(votes, dict) or ancien not in votes:
                    continue
                note = votes.pop(ancien)
                touches += 1
                change = True
                if vers_hote:
                    if genre == "serie":
                        if not fiche.get("note"):
                            fiche["note"] = note; fiche_change = True
                    else:
                        t = fiche.get("notes_episodes") if isinstance(fiche.get("notes_episodes"), dict) else {}
                        if not t.get(rel):
                            t[rel] = note; fiche["notes_episodes"] = t; fiche_change = True
                elif nouveau and nouveau not in votes:
                    votes[nouveau] = note
            if not change:
                continue
            if isinstance(inv.get("serie"), dict) and not inv["serie"]:
                inv.pop("serie")
            eps = inv.get("episodes")
            if isinstance(eps, dict):
                for rel in [r for r, v in eps.items() if not v]:
                    del eps[rel]
                if not eps:
                    inv.pop("episodes")
            _ecrire(f_inv, inv)
            if fiche_change:
                _ecrire(os.path.join(dossier, ACCOMPAGNEMENT), fiche)
    return touches


# ------------------------------------------------- gestion des comptes -----
"""La page comptes.html, servie a la seule machine de l'hote: qui a un compte,
ce qu'il a regarde et note, et de quoi l'aider — nouveau mot de passe,
deconnecter ses appareils, renommer, supprimer. Rien n'est jamais efface pour
de bon: un compte supprime part dans comptes/supprimes/."""
FID = re.compile(r"[0-9a-f]{32}$")


def _episodes_par_serie():
    """Le nombre d'episodes de chaque serie, d'apres l'index (edits exclus)."""
    data = _lire_ou(os.path.join(RACINE, MANIFESTE), {})
    out = {}
    for f in data.get("files") or []:
        rel = f[0] if isinstance(f, list) and f else ""
        parts = rel.split("/")
        ext = rel.rsplit(".", 1)[-1].lower() if "." in rel else ""
        if len(parts) < 2 or ext not in VIDEO_EXT or any(p.lower() in ("edits", "edit", "amv", "amvs") for p in parts[1:-1]):
            continue
        out[parts[0]] = out.get(parts[0], 0) + 1
    return out


def _votes_de(iid):
    """Les notes posees par un identifiant d'invite, serie par serie."""
    base = _base_media()
    out = []
    if not base or not iid:
        return out
    for serie in sorted(os.listdir(base)):
        inv = lire_notes_invites(os.path.join(base, serie)) or {}
        if iid in (inv.get("serie") or {}):
            out.append({"serie": serie, "episode": None, "note": inv["serie"][iid]})
        for rel, votes in (inv.get("episodes") or {}).items():
            if iid in votes:
                out.append({"serie": serie, "episode": rel, "note": votes[iid]})
    return out


def _resume_compte(fid, c):
    d = c.get("donnees") or {}
    vus = en_cours = 0
    dernier = c.get("maj") or 0
    series = set()
    for k, v in d.items():
        if k.startswith("pg.") and isinstance(v, dict):
            series.add(k[3:].split("/", 1)[0])
            if v.get("done"): vus += 1
            elif (v.get("t") or 0) > 20: en_cours += 1
            dernier = max(dernier, int((v.get("at") or 0) / 1000))
    return {"id": fid, "pseudo": c.get("pseudo"), "cree": c.get("cree"), "actif": dernier,
            "hote": bool(c.get("hote")), "appareils": len(c.get("sessions") or {}),
            "vus": vus, "enCours": en_cours, "series": len(series)}


def admin(action, d):
    dossier = _dossier_comptes()
    if action == "liste":
        out = []
        if os.path.isdir(dossier):
            for nom in os.listdir(dossier):
                if nom.endswith(".json") and FID.match(nom[:-5]):
                    c = _lire_ou(os.path.join(dossier, nom), None)
                    if c:
                        out.append(_resume_compte(nom[:-5], c))
        out.sort(key=lambda x: -(x["actif"] or 0))
        return {"ok": True, "comptes": out}

    fid = d.get("id")
    if not isinstance(fid, str) or not FID.match(fid):
        return {"ok": False, "erreur": "compte inconnu"}
    fichier = os.path.join(dossier, fid + ".json")
    with _verrou_comptes:
        c = _lire_ou(fichier, None)
        if not c:
            return {"ok": False, "erreur": "compte inconnu"}

        if action == "detail":
            totaux = _episodes_par_serie()
            par = {}
            for k, v in (c.get("donnees") or {}).items():
                if not (k.startswith("pg.") and isinstance(v, dict)):
                    continue
                rel = k[3:]
                serie = rel.split("/", 1)[0]
                s = par.setdefault(serie, {"serie": serie, "total": totaux.get(serie, 0), "vus": 0, "episodes": []})
                pct = round(100 * (v.get("t") or 0) / v["d"]) if v.get("d") else 0
                s["episodes"].append({"rel": rel.split("/", 1)[1] if "/" in rel else rel,
                                      "vu": bool(v.get("done")), "pct": min(100, pct), "at": v.get("at")})
                if v.get("done"):
                    s["vus"] += 1
            for s in par.values():
                s["episodes"].sort(key=lambda e: [int(x) if x.isdigit() else x for x in re.split(r"(\d+)", e["rel"])])
            iid = (c.get("donnees") or {}).get("inviteId")
            return {"ok": True, "compte": _resume_compte(fid, c),
                    "series": sorted(par.values(), key=lambda s: -max([e["at"] or 0 for e in s["episodes"]] or [0])),
                    "notes": _votes_de(iid) if isinstance(iid, str) else []}

        if action == "mdp":
            mdp = d.get("mdp")
            if not isinstance(mdp, str) or not 4 <= len(mdp) <= 200:
                return {"ok": False, "erreur": "Mot de passe : 4 caractères au moins"}
            c["sel"] = secrets.token_hex(16)
            c["hash"] = _hacher(mdp, c["sel"])
            c["sessions"] = {}                     # un nouveau mot de passe deconnecte partout
            _ecrire(fichier, c)
            return {"ok": True}
        if action == "deconnecter":
            c["sessions"] = {}
            _ecrire(fichier, c)
            return {"ok": True}
        if action == "hote":
            if d.get("actif"): c["hote"] = True
            else: c.pop("hote", None)
            _ecrire(fichier, c)
            return {"ok": True}
        if action == "renommer":
            pseudo = d.get("pseudo")
            if not isinstance(pseudo, str) or not PSEUDO.match(pseudo.strip()):
                return {"ok": False, "erreur": "Pseudo : 3 à 24 lettres, chiffres, espaces, . _ -"}
            nouveau = _id_compte(pseudo)
            cible = os.path.join(dossier, nouveau + ".json")
            if nouveau != fid and os.path.exists(cible):
                return {"ok": False, "erreur": "Ce pseudo est déjà pris"}
            c["pseudo"] = pseudo.strip()
            c["sessions"] = {}                     # le cookie porte l'ancien nom de fichier
            _ecrire(cible, c)
            if nouveau != fid:
                os.remove(fichier)
            return {"ok": True, "id": nouveau}
        if action == "supprimer":
            corbeille = os.path.join(dossier, "supprimes")
            os.makedirs(corbeille, exist_ok=True)
            os.replace(fichier, os.path.join(corbeille, "%s-%d.json" % (fid, int(time.time()))))
            return {"ok": True}
    return {"ok": False, "erreur": "action inconnue"}


def _cookie(handler, valeur, age):

    """HttpOnly: la page ne le voit pas. Secure des qu'on arrive en https
    (le tunnel): un cookie de session ne voyage pas en clair."""
    https = "https" in (handler.headers.get("Cf-Visitor") or "") or \
            handler.headers.get("X-Forwarded-Proto") == "https"
    return "%s=%s; Path=/; Max-Age=%d; HttpOnly; SameSite=Lax%s" % (
        COOKIE, valeur, age, "; Secure" if https else "")


# ------------------------------------------------ l'index tenu a jour -----
REINDEX_DELAI = 180


def reindexer_en_continu():
    """Toutes les 3 minutes, l'index est refait: un episode ajoute pendant le
    partage apparait sans relancer (la page relit l'index quand on revient
    sur l'onglet, ou au rechargement). Le fichier peut etre en cours d'envoi
    a un invite — Windows refuse alors de le remplacer: on reessaie."""
    while True:
        time.sleep(REINDEX_DELAI)
        for essai in range(5):
            try:
                with _verrou_index:
                    construire_index()
                break
            except PermissionError:
                time.sleep(2)
            except Exception:
                break


# ------------------------------------------------ sauvegarde au lancement --
SAUVEGARDES = "sauvegardes-auto"
SAUVEGARDES_GARDEES = 15


def sauvegarder_au_lancement():
    """A chaque lancement, une copie des fiches de series, des notes des
    invites et des comptes, dans sauvegardes-auto/<date>/. On garde les 15
    dernieres. Quelques centaines de Ko a chaque fois: les videos n'y vont pas."""
    racine = os.path.join(RACINE, SAUVEGARDES)
    dest = os.path.join(racine, time.strftime("%Y-%m-%d_%H-%M-%S"))
    base = _base_media()
    n = 0
    try:
        if base:
            for serie in os.listdir(base):
                for nom in (ACCOMPAGNEMENT, NOTES_INVITES):
                    src = os.path.join(base, serie, nom)
                    if os.path.isfile(src):
                        os.makedirs(os.path.join(dest, "videos", serie), exist_ok=True)
                        shutil.copy2(src, os.path.join(dest, "videos", serie, nom))
                        n += 1
        comptes = _dossier_comptes()
        if os.path.isdir(comptes):
            for nom in os.listdir(comptes):
                if nom.endswith(".json"):
                    os.makedirs(os.path.join(dest, "comptes"), exist_ok=True)
                    shutil.copy2(os.path.join(comptes, nom), os.path.join(dest, "comptes", nom))
                    n += 1
        anciennes = sorted(d for d in os.listdir(racine) if os.path.isdir(os.path.join(racine, d)))
        for vieille in anciennes[:-SAUVEGARDES_GARDEES]:
            shutil.rmtree(os.path.join(racine, vieille), ignore_errors=True)
    except OSError:
        pass
    return n


# --------------------------------------------------- affiches allegees -----
"""Certaines jaquettes pesent 5 Mo pour 168 px affiches: en 4G, l'accueil
mettait des dizaines de secondes. La page demande ?mini=400 (vignettes) ou
?mini=1280 (grandes images de fond): le serveur en fait une fois une copie
reduite en JPEG, rangee dans cache-affiches/, et la sert ensuite telle quelle.
L'original n'est jamais touche."""
CACHE_AFFICHES = "cache-affiches"
_verrou_affiches = threading.Lock()


def affiche_reduite(chemin, largeur):
    """Le chemin de la copie reduite, ou None (pas de Pillow, image deja
    petite, ou illisible: on servira l'original)."""
    try:
        from PIL import Image
    except ImportError:
        return None
    try:
        st = os.stat(chemin)
    except OSError:
        return None
    cle = hashlib.sha256(("%s|%d|%d|%d" % (chemin, st.st_mtime_ns, st.st_size, largeur)).encode("utf-8")).hexdigest()[:24]
    cible = os.path.join(RACINE, CACHE_AFFICHES, cle + ".jpg")
    if os.path.isfile(cible):
        return cible
    with _verrou_affiches:
        if os.path.isfile(cible):
            return cible
        try:
            with Image.open(chemin) as im:
                if im.width <= largeur and st.st_size < 400 * 1024:
                    return None                  # deja legere: l'original fait l'affaire
                im = im.convert("RGB")
                im.thumbnail((largeur, largeur * 3))
                os.makedirs(os.path.dirname(cible), exist_ok=True)
                tmp = cible + ".%d.tmp" % threading.get_ident()
                im.save(tmp, "JPEG", quality=82, optimize=True, progressive=True)
                os.replace(tmp, cible)
                return cible
        except Exception:
            return None


_index_gz = {"cle": None, "corps": None}
def _index_compresse():
    """L'index compresse, garde tant que le fichier n'a pas bouge."""
    chemin = os.path.join(RACINE, MANIFESTE)
    try:
        st = os.stat(chemin)
    except OSError:
        return None
    cle = (st.st_mtime_ns, st.st_size)
    if _index_gz["cle"] != cle:
        with open(chemin, "rb") as f:
            _index_gz["corps"] = gzip.compress(f.read(), compresslevel=6)
        _index_gz["cle"] = cle
    return _index_gz["corps"]


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
        # une affiche reduite ne change pas (son nom suit l'original): gardee un jour
        self.send_header("Cache-Control", "max-age=86400" if getattr(self, "_garder", False) else "no-cache")
        super().end_headers()

    def autorise(self):
        """Un lien public ne donne acces qu'a la page et aux media: le code
        source et les fichiers de travail restent a la maison. Sous videos/,
        seulement ce qu'on regarde ou lit — videos, images, documents,
        sous-titres, pistes audio. Les bibliotheque.json bruts (progression et
        favoris de l'hote), notes-invites.json et les fichiers de travail ne
        partent plus: la page recoit deja ce qu'elle doit en savoir par l'index."""
        chemin = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
        if chemin in ("", "/"):
            return True
        rel = chemin.lstrip("/")
        if rel in ("index.html", MANIFESTE, "favicon.ico", "manifest.webmanifest", "sw.js"):
            return True
        if rel == "comptes.html":                   # la gestion des comptes: l'hote seul
            return est_machine_hote(self)
        premier = rel.split("/", 1)[0].lower()
        # js/ porte le code de la page: sans lui l'invite recoit une coquille vide
        if premier in ("assets", "js", "icones"):
            return True
        if premier in DOSSIERS_MEDIA:
            ext = rel.rsplit(".", 1)[-1].lower() if "." in rel.rsplit("/", 1)[-1] else ""
            return ext in MEDIA_EXT or ext in SUB_EXT or ext in AUD_EXT
        return False

    def list_directory(self, path):
        # jamais de liste de dossier: elle enumerait tout ce qui traine
        self.send_error(404)
        return None

    def _chemin(self):
        return urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)

    def _json(self, data, code=200, cookie=None):
        corps = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corps)))
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(corps)

    def do_GET(self):
        # qui regarde: l'hote note dans sa fiche, un invite dans celle des invites;
        # et, s'il est connecte, son compte avec ce qu'il y a range
        if self._chemin() == "/__moi":
            compte = _session(self)[0]
            # l'empreinte publiee de son identifiant de vote: pour retrouver ses notes dans l'index
            iid = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get("i", [""])[0]
            return self._json({"hote": est_hote(self), "machine": est_machine_hote(self), "comptes": True,
                               "monVote": hache_invite(iid) if INVITE.match(iid or "") else None,
                               "compte": {"pseudo": compte["pseudo"], "donnees": compte.get("donnees") or {},
                                          "hote": bool(compte.get("hote"))}
                                         if compte else None})
        super().do_GET()

    def do_POST(self):
        chemin = self._chemin()
        if chemin != "/__noter" and not chemin.startswith("/__compte/") and not chemin.startswith("/__admin/"):
            self.close_connection = True          # le corps n'est pas lu: la connexion ne sert plus
            self.send_error(404)
            return
        # une page d'un autre site ne poste rien ici, meme depuis le navigateur de l'hote
        origine = self.headers.get("Origin")
        if origine and urllib.parse.urlsplit(origine).netloc != (self.headers.get("Host") or ""):
            self.close_connection = True
            return self._json({"ok": False, "erreur": "origine refusee"}, 403)
        limite = 4 * 1024 * 1024 if chemin in ("/__compte/sauver", "/__compte/inscription") else 4096
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n < 0 or n > limite:
                raise ValueError
            d = json.loads(self.rfile.read(n).decode("utf-8") or "{}")
            if not isinstance(d, dict):
                raise ValueError
        except (ValueError, UnicodeDecodeError):
            self.close_connection = True
            return self._json({"ok": False, "erreur": "requete illisible"}, 400)
        if chemin.startswith("/__compte/"):
            try:
                return self._compte(chemin[len("/__compte/"):], d)
            except Exception:
                return self._json({"ok": False, "erreur": "erreur du partage"}, 500)
        if chemin.startswith("/__admin/"):
            if not est_machine_hote(self):
                return self._json({"ok": False, "erreur": "depuis la machine de l'hote seulement"}, 403)
            try:
                return self._json(admin(chemin[len("/__admin/"):], d))
            except Exception as e:
                return self._json({"ok": False, "erreur": "erreur: %s" % e}, 500)
        hote = est_hote(self)
        try:
            ok, raison = noter(d, hote)
        except OSError:
            ok, raison = False, "ecriture impossible"
        self._json({"ok": ok, "erreur": raison, "hote": hote}, 200 if ok else 400)

    def _compte(self, action, d):
        try:
            if action in ("inscription", "connexion"):
                if action == "inscription":
                    res, erreur = compte_inscrire(d.get("pseudo"), d.get("mdp"), d.get("donnees"), self)
                else:
                    res, erreur = compte_connecter(self, d.get("pseudo"), d.get("mdp"))
                if not res:
                    return self._json({"ok": False, "erreur": erreur}, 400)
                compte, valeur = res
                return self._json({"ok": True, "pseudo": compte["pseudo"], "donnees": compte.get("donnees") or {}},
                                  cookie=_cookie(self, valeur, 365 * 86400))
            compte, fichier, jeton = _session(self)
            if action == "deconnexion":
                if compte:
                    with _verrou_comptes:
                        frais = _lire_ou(fichier, None)
                        if frais:
                            (frais.get("sessions") or {}).pop(_empreinte(jeton), None)
                            _ecrire(fichier, frais)
                return self._json({"ok": True}, cookie=_cookie(self, "", 0))
            if action == "hote":
                # le compte de l'hote ne se declare que depuis sa machine
                if not compte or not est_machine_hote(self):
                    return self._json({"ok": False, "erreur": "depuis la machine de l'hote seulement"}, 403)
                actif = bool(d.get("actif"))
                with _verrou_comptes:
                    frais = _lire_ou(fichier, None)
                    if not frais:
                        return self._json({"ok": False, "erreur": "non connecte"}, 401)
                    if actif: frais["hote"] = True
                    else: frais.pop("hote", None)
                    _ecrire(fichier, frais)
                iid = (frais.get("donnees") or {}).get("inviteId")
                n = _deplacer_votes(iid, vers_hote=True) if actif and isinstance(iid, str) and INVITE.match(iid) else 0
                return self._json({"ok": True, "deplaces": n})
            if action == "votes":
                # les votes donnes sans compte dans ce navigateur rejoignent le compte
                ancien = d.get("ancien")
                iid = ((compte or {}).get("donnees") or {}).get("inviteId")
                if not compte or not isinstance(ancien, str) or not INVITE.match(ancien) or not isinstance(iid, str):
                    return self._json({"ok": False, "erreur": "votes"}, 400)
                if ancien == iid:
                    return self._json({"ok": True, "deplaces": 0})
                n = _deplacer_votes(ancien, vers_hote=bool(compte.get("hote")), nouveau=iid)
                return self._json({"ok": True, "deplaces": n})
            if action == "sauver":
                if not compte:
                    return self._json({"ok": False, "erreur": "non connecte"}, 401)
                if not isinstance(d.get("donnees"), dict):
                    return self._json({"ok": False, "erreur": "donnees"}, 400)
                with _verrou_comptes:
                    frais = _lire_ou(fichier, None)
                    if not frais:
                        return self._json({"ok": False, "erreur": "non connecte"}, 401)
                    frais["donnees"] = fusionner_donnees(frais.get("donnees"), d["donnees"])
                    frais["maj"] = int(time.time())
                    _ecrire(fichier, frais)
                return self._json({"ok": True})
        except OSError:
            return self._json({"ok": False, "erreur": "écriture impossible"}, 500)
        self.send_error(404)


    def send_head(self):
        if not self.autorise():

            self.send_error(404)
            return None
        if urllib.parse.unquote(urllib.parse.urlsplit(self.path).path).lstrip("/") == MANIFESTE:
            rafraichir_fiches()
            # l'index pese plusieurs Mo de texte: compresse, il en fait dix fois moins
            if "gzip" in (self.headers.get("Accept-Encoding") or "") and not self.headers.get("Range"):
                corps = _index_compresse()
                if corps is not None:
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Encoding", "gzip")
                    self.send_header("Content-Length", str(len(corps)))
                    self.send_header("Vary", "Accept-Encoding")
                    self.end_headers()
                    return io.BytesIO(corps)


        # une affiche demandee en petit: la copie reduite, si elle vaut le coup
        morceaux = urllib.parse.urlsplit(self.path)
        mini = urllib.parse.parse_qs(morceaux.query).get("mini", [""])[0]
        if mini in ("400", "1280"):
            chemin = self.translate_path(self.path)
            ext = chemin.rsplit(".", 1)[-1].lower() if "." in chemin else ""
            if ext in IMAGE_EXT and os.path.isfile(chemin):
                reduite = affiche_reduite(chemin, int(mini))
                if reduite:
                    try:
                        f = open(reduite, "rb")
                    except OSError:
                        f = None
                    if f:
                        self._garder = True
                        self.send_response(200)
                        self.send_header("Content-Type", "image/jpeg")
                        self.send_header("Content-Length", str(os.path.getsize(reduite)))
                        self.end_headers()
                        return f

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
    threading.Thread(target=reindexer_en_continu, daemon=True).start()
    sauves = sauvegarder_au_lancement()
    if chemin is None:
        print(couleur("aucun dossier videos/ trouve", "91"))
        return 1
    print(couleur("%d fichiers" % nb, "92") + " en %.1fs" % (time.time() - debut))
    print("       " + couleur("%d fiches et comptes sauvegardes dans %s/" % (sauves, SAUVEGARDES), "90"))


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
    print("  " + couleur("Comptes de tes potes : http://127.0.0.1:%d/comptes.html" % port, "90"))
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
    print("       " + couleur("Comptes de tes potes : http://127.0.0.1:%d/comptes.html" % port, "90"))


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
        print("  Verifie ta connexion: le tunnel sera retente tout seul.")
    attendre(serveur, proc, lambda: ouvrir_tunnel(exe, port, sur_lien))
    return 0


def attendre(serveur, proc, relancer=None):
    """Jusqu'a Ctrl+C. Si le tunnel tombe (coupure, mise en veille), on le
    rouvre: le serveur, lui, n'a pas bouge, et le nouveau lien s'affiche et
    se copie comme le premier. On abandonne apres 5 echecs d'affilee."""
    print(couleur("  Ctrl+C pour arreter le partage.", "90"))
    essais, stable_depuis = 0, time.time()
    try:
        while True:
            if proc is not None and proc.poll() is not None:
                if relancer is None or essais >= 5:
                    print(couleur("\n  Le tunnel s'est ferme.", "91"))
                    break
                if time.time() - stable_depuis > 600:
                    essais = 0                       # il avait tenu: on repart de zero
                essais += 1
                attente = min(60, 5 * 2 ** (essais - 1))
                print(couleur("\n  Le tunnel s'est ferme : nouvel essai dans %d s (%d/5)..." % (attente, essais), "93"))
                time.sleep(attente)
                print("  Reouverture du tunnel...", end=" ", flush=True)
                proc = relancer()
                stable_depuis = time.time()
                print(couleur("  (le lien change: renvoie le nouveau a tes potes)", "90"))
                continue
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
