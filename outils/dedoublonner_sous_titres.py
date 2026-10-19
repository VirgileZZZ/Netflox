# -*- coding: utf-8 -*-
"""Repere et retire les repliques en double dans les sous-titres .vtt.

Une replique en double: le meme texte (balises et espaces mis a part) affiche
en meme temps — deux repliques qui se chevauchent. Souvent un reste de
conversion depuis l'ASS, ou une ligne et son ombre faisaient deux evenements:
a l'ecran, la phrase apparait deux fois. Les deux ne font plus qu'une, du
debut de la premiere a la fin de la derniere. Une phrase redite juste apres
(« Tuez-la ! » ... « Tuez-la ! ») ne se chevauche pas: elle reste.

    python outils/dedoublonner_sous_titres.py            # rapport seulement
    python outils/dedoublonner_sous_titres.py --corriger  # corrige

Avant de toucher a un fichier, sa copie part dans
sauvegardes-sous-titres/<date>/<meme chemin>, hors de videos/: un .vtt laisse
a cote serait pris pour une piste de plus.
"""
import os, re, shutil, sys, time

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VIDEOS = os.path.join(RACINE, "videos")

TEMPS = re.compile(r"^\s*((?:\d+:)?\d+:\d+[.,]\d+)\s*-->\s*((?:\d+:)?\d+:\d+[.,]\d+)(.*)$")


def secondes(s):
    s = s.replace(",", ".")
    p = s.split(":")
    return sum(float(x) * 60 ** i for i, x in enumerate(reversed(p)))


def horodatage(t):
    ms = int(round(t * 1000))
    return "%02d:%02d:%02d.%03d" % (ms // 3600000, ms // 60000 % 60, ms // 1000 % 60, ms % 1000)


def normal(texte):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", texte)).strip().lower()


def lire(chemin):
    """(en-tete, [blocs]): un bloc est soit une replique {debut, fin, reglages,
    texte, id}, soit un bloc a garder tel quel (NOTE, STYLE, REGION)."""
    brut = open(chemin, encoding="utf-8-sig").read().replace("\r\n", "\n").replace("\r", "\n")
    morceaux = re.split(r"\n\s*\n", brut.strip("\n"))
    entete, blocs = morceaux[0], []
    for m in morceaux[1:]:
        lignes = m.split("\n")
        for i, l in enumerate(lignes[:2]):
            r = TEMPS.match(l)
            if r:
                blocs.append({"debut": secondes(r[1]), "fin": secondes(r[2]), "reglages": r[3].rstrip(),
                              "id": "\n".join(lignes[:i]), "texte": "\n".join(lignes[i + 1:])})
                break
        else:
            blocs.append({"brut": m})
    return entete, blocs


def dedoublonner(blocs):
    """Fusionne les repliques au meme texte qui se chevauchent.
    Renvoie (blocs, nombre de doublons retires)."""
    garde, retires = [], 0
    ouvertes = {}                             # texte normalise -> la replique gardee
    for b in blocs:
        if "brut" in b:
            garde.append(b)
            continue
        cle = normal(b["texte"])
        prec = ouvertes.get(cle)
        if cle and prec is not None and b["debut"] < prec["fin"]:
            prec["fin"] = max(prec["fin"], b["fin"])
            prec["debut"] = min(prec["debut"], b["debut"])
            retires += 1
            continue
        ouvertes[cle] = b
        garde.append(b)
    return garde, retires


def ecrire(chemin, entete, blocs):
    out = [entete.rstrip("\n")]
    for b in blocs:
        if "brut" in b:
            out.append(b["brut"])
        else:
            tete = (b["id"] + "\n") if b["id"] else ""
            out.append(tete + horodatage(b["debut"]) + " --> " + horodatage(b["fin"]) + b["reglages"] + "\n" + b["texte"])
    tmp = chemin + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n\n".join(out) + "\n")
    os.replace(tmp, chemin)


def main():
    corriger = "--corriger" in sys.argv
    sauvegarde = os.path.join(RACINE, "sauvegardes-sous-titres", time.strftime("%Y-%m-%d_%H-%M-%S"))
    total = fichiers = touches = erreurs = 0
    par_serie = {}
    for dossier, _, noms in os.walk(VIDEOS):
        for nom in noms:
            if not nom.lower().endswith(".vtt"):
                continue
            chemin = os.path.join(dossier, nom)
            fichiers += 1
            try:
                entete, blocs = lire(chemin)
            except (OSError, UnicodeDecodeError) as e:
                erreurs += 1
                print("  illisible:", os.path.relpath(chemin, VIDEOS), e)
                continue
            garde, n = dedoublonner(blocs)
            if not n:
                continue
            rel = os.path.relpath(chemin, VIDEOS)
            serie = rel.split(os.sep)[0]
            par_serie[serie] = par_serie.get(serie, 0) + n
            total += n
            touches += 1
            if corriger:
                copie = os.path.join(sauvegarde, rel)
                os.makedirs(os.path.dirname(copie), exist_ok=True)
                shutil.copy2(chemin, copie)
                ecrire(chemin, entete, garde)
    print("%d fichier(s) .vtt lus, %d avec des doublons, %d replique(s) en double%s"
          % (fichiers, touches, total, " retiree(s)" if corriger else ""))
    for serie, n in sorted(par_serie.items(), key=lambda x: -x[1]):
        print("  %-55s %d" % (serie, n))
    if corriger and touches:
        print("copies d'avant:", os.path.relpath(sauvegarde, RACINE))
    if erreurs:
        print("%d fichier(s) illisible(s), laisses tels quels" % erreurs)


if __name__ == "__main__":
    main()
