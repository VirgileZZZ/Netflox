<#
    Convertir-Video.ps1  -  n'importe quelle video  ->  MP4 ou MKV

    - MP4 : lisible dans un navigateur. L'audio AC3/DTS y est reencode en AAC
      et les sous-titres passent en mov_text (invisibles dans Chrome : pour le
      site il faut des .vtt a cote, voir Extraire-Sous-titres).
    - MKV : garde tout tel quel, pistes AC3/DTS et sous-titres ASS ou image
      compris. Aucun navigateur ne lit le MKV : VLC, MPC, archivage.
    - la video peut etre copiee telle quelle (remux) : aucune perte, instantane

    - accepte .ts .m2ts .mp4 .mkv .mov .avi .wmv .flv .webm .mpg .vob ...
    - detecte les fichiers vides, tronques ou illisibles et les met de cote
    - affiche pour chaque fichier : resolution, encodeur source, profil,
      profondeur, fps, debit, HDR, entrelacement, pistes audio et sous-titres
    - detecte si une "1080p" est en realite de la 720p etiree (test PSNR)
    - reencode en CRF, garde audio / sous-titres / chapitres / metadonnees

    Usage :  double-clic sur Convertir-Video.bat
             glisser-deposer des fichiers OU des dossiers sur le .bat
             .\Convertir-Video.ps1 fichier1.mkv dossier\
             (sans argument : tous les fichiers video du dossier du script)
#>
[CmdletBinding()]
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Entrees)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- outils ----
function Trouver-Outil([string]$nom) {
    $c = Get-Command $nom -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    $pistes = @(
        "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Gyan.FFmpeg*\ffmpeg-*\bin\$nom.exe"
        "$env:LOCALAPPDATA\Microsoft\WinGet\Links\$nom.exe"
        "$env:LOCALAPPDATA\Programs\ffmpeg\bin\$nom.exe"
        "$env:USERPROFILE\scoop\apps\ffmpeg\current\bin\$nom.exe"
        "$env:ProgramData\chocolatey\bin\$nom.exe"
        "$env:ProgramFiles\ffmpeg\bin\$nom.exe"
        "C:\ffmpeg\bin\$nom.exe"
    )
    foreach ($p in $pistes) {
        $t = Get-ChildItem -Path $p -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($t) { return $t.FullName }
    }
    return $null
}

$ffmpeg  = Trouver-Outil ffmpeg
$ffprobe = Trouver-Outil ffprobe
if (-not $ffmpeg -or -not $ffprobe) {
    Write-Host "ffmpeg/ffprobe introuvable. Installe-le :  winget install Gyan.FFmpeg" -ForegroundColor Red
    Read-Host "Entree pour fermer"; exit 1
}

function Titre($t) {
    Write-Host ""
    Write-Host ("-" * 74) -ForegroundColor DarkGray
    Write-Host "  $t" -ForegroundColor Cyan
    Write-Host ("-" * 74) -ForegroundColor DarkGray
}
function Mo($octets) {
    if ($octets -ge 1GB) { return "{0:N2} Go" -f ($octets / 1GB) }
    "{0:N0} Mo" -f ($octets / 1MB)
}
function Duree($s) { "{0:hh\:mm\:ss}" -f [TimeSpan]::FromSeconds([double]$s) }
function Demander($question, $defaut) {
    $r = Read-Host $question
    if ([string]::IsNullOrWhiteSpace($r)) { return $defaut }
    return $r.Trim()
}

# ------------------------------------------------------------- selection ----
$ExtVideo = @('.ts','.m2ts','.mts','.trp','.tp','.mp4','.m4v','.mkv','.mov','.qt',
              '.avi','.wmv','.asf','.flv','.f4v','.webm','.mpg','.mpeg','.mpe',
              '.m2v','.m1v','.vob','.ogv','.ogm','.rm','.rmvb','.divx','.3gp',
              '.3g2','.mxf','.dv','.y4m','.nsv','.amv','.mod','.tod')

$base = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$brut = @()

if (-not $Entrees -or $Entrees.Count -eq 0) {
    $r = Demander "  Inclure les sous-dossiers ? (o/N)" 'n'
    $recursif = $r -match '^[oOyY]'
    $brut = Get-ChildItem -Path $base -File -Recurse:$recursif -ErrorAction SilentlyContinue
}
else {
    foreach ($e in $Entrees) {
        if (-not (Test-Path -LiteralPath $e)) {
            Write-Host "  introuvable : $e" -ForegroundColor Yellow
            continue
        }
        $it = Get-Item -LiteralPath $e
        if ($it.PSIsContainer) {
            $brut += Get-ChildItem -LiteralPath $it.FullName -File -Recurse -ErrorAction SilentlyContinue
        }
        else { $brut += $it }
    }
}

$Fichiers = @($brut |
    Where-Object { $ExtVideo -contains $_.Extension.ToLower() } |
    Sort-Object FullName -Unique |
    Select-Object -ExpandProperty FullName)

if ($Fichiers.Count -eq 0) {
    Write-Host "Aucun fichier video trouve." -ForegroundColor Yellow
    Write-Host "Extensions reconnues : $($ExtVideo -join ' ')" -ForegroundColor DarkGray
    Read-Host "Entree pour fermer"; exit
}

# --------------------------------------------------------------- analyse ----

# codecs d'image fixe : jamais la vraie piste video d'un episode
$ImageFixe = @('png','mjpeg','bmp','gif','webp','tiff','ppm')
# Ce que chaque conteneur sait porter tel quel.
# L'AC3 et l'E-AC3 TIENNENT dans un MP4, mais aucun navigateur ne sait les
# decoder : un episode converti comme ca s'ouvre sans le moindre son. On les
# laisse donc hors de la liste MP4, pour qu'ils soient reencodes en AAC.
$AudioMp4  = @('aac','mp3','alac')
$AudioMkv  = @('aac','ac3','eac3','mp3','alac','flac','opus','vorbis','dts',
               'truehd','mp2','pcm_s16le','pcm_s24le')
$SousTexte = @('subrip','ass','ssa','mov_text','webvtt','text','srt')
$SousImage = @('dvb_subtitle','hdmv_pgs_subtitle','dvd_subtitle','xsub','dvbsub')

function Sonde([string]$f, [string]$format) {
    $p = @('-v','quiet','-print_format','json','-show_format','-show_streams',
           '-show_chapters','-analyzeduration','200M','-probesize','200M')
    if ($format) { $p += @('-f', $format) }
    $p += @('-i', $f)
    $txt = & $ffprobe @p
    if (-not $txt) { return $null }
    try { return ($txt | ConvertFrom-Json) } catch { return $null }
}

# vraies pistes video : pas une pochette d'album, pas un timbre-poste
function Pistes-Video($json) {
    if (-not $json) { return @() }
    @($json.streams | Where-Object {
        $_.codec_type -eq 'video' -and
        $_.disposition.attached_pic -ne 1 -and
        [int]$_.width -ge 64 -and [int]$_.height -ge 64
    })
}

function Profondeur($pix) {
    if (-not $pix) { return 8 }
    if ($pix -match 'p(1[0246])') { return [int]$Matches[1] }
    return 8
}
function Fps($v) {
    $r = $v.avg_frame_rate
    if (-not $r -or $r -eq '0/0') { $r = $v.r_frame_rate }
    if (-not $r -or $r -eq '0/0') { return 0 }
    $p = $r -split '/'
    if ($p.Count -ne 2 -or [double]$p[1] -eq 0) { return 0 }
    return [math]::Round([double]$p[0] / [double]$p[1], 3)
}

function Analyser([string]$f) {
    $item = Get-Item -LiteralPath $f
    $ext  = $item.Extension.ToLower()

    $info = [pscustomobject]@{
        Path = $f; Nom = $item.Name; Taille = $item.Length
        Etat = 'OK'; Raison = ''
        Duree = 0.0; Largeur = 0; Hauteur = 0; VIdx = 0; Forcer = $null
        Codec = ''; Profil = ''; Bits = 8; Fps = 0; Debit = 0
        Hdr = $false; Entrelace = $false; PixFmt = ''
        ColPrim = ''; ColTrc = ''; ColSpc = ''
        Format = ''; Audios = @(); SousTitres = @(); Chapitres = 0
        Psnr = $null; Verdict = $null
    }

    # --- fichier vide : inutile d'appeler ffprobe
    if ($item.Length -eq 0) {
        $info.Etat = 'VIDE'; $info.Raison = 'fichier de 0 octet'
        return $info
    }
    if ($item.Length -lt 100KB) { $info.Raison = 'tres petit fichier' }

    $json = Sonde $f $null
    $vids = @(Pistes-Video $json)

    # Certains .ts (segments HLS recolles, debut tronque) font choisir a ffmpeg
    # un demultiplexeur d'images : il lit alors les paquets TS comme des PNG et
    # invente un flux 2x1 qui fait exploser l'encodeur. On force mpegts.
    if ($vids.Count -eq 0 -and @('.ts','.m2ts','.mts','.trp','.tp') -contains $ext) {
        $j2 = Sonde $f 'mpegts'
        $v2 = @(Pistes-Video $j2)
        if ($v2.Count -gt 0) { $json = $j2; $vids = $v2; $info.Forcer = 'mpegts' }
    }

    if (-not $json) {
        $info.Etat = 'ILLISIBLE'; $info.Raison = 'ffprobe ne reconnait aucun format'
        return $info
    }
    $info.Format = $json.format.format_name

    $tousV = @($json.streams | Where-Object { $_.codec_type -eq 'video' })
    $info.Audios     = @($json.streams | Where-Object { $_.codec_type -eq 'audio' })
    $info.SousTitres = @($json.streams | Where-Object { $_.codec_type -eq 'subtitle' })
    if ($json.chapters) { $info.Chapitres = @($json.chapters).Count }

    # la bonne piste = pas une image fixe, puis la plus grande
    $v = $vids |
         Sort-Object @{ Expression = { if ($ImageFixe -contains $_.codec_name) { 1 } else { 0 } } },
                     @{ Expression = { - ([int]$_.width * [int]$_.height) } } |
         Select-Object -First 1

    if (-not $v) {
        $info.Etat = 'ILLISIBLE'
        $info.Raison = "aucune piste video exploitable (format vu : $($info.Format))"
        return $info
    }

    for ($k = 0; $k -lt $tousV.Count; $k++) { if ($tousV[$k].index -eq $v.index) { $info.VIdx = $k } }

    if     ($json.format.duration) { $info.Duree = [double]$json.format.duration }
    elseif ($v.duration)           { $info.Duree = [double]$v.duration }

    $info.Largeur   = [int]$v.width
    $info.Hauteur   = [int]$v.height
    $info.Codec     = $v.codec_name
    $info.Profil    = $v.profile
    $info.PixFmt    = $v.pix_fmt
    $info.Bits      = Profondeur $v.pix_fmt
    $info.Fps       = Fps $v
    $info.ColPrim   = $v.color_primaries
    $info.ColTrc    = $v.color_transfer
    $info.ColSpc    = $v.color_space
    $info.Hdr       = @('smpte2084','arib-std-b67') -contains $v.color_transfer
    $info.Entrelace = @('tt','bb','tb','bt') -contains $v.field_order

    if     ($json.format.bit_rate) { $info.Debit = [double]$json.format.bit_rate }
    elseif ($v.bit_rate)           { $info.Debit = [double]$v.bit_rate }
    elseif ($info.Duree -gt 0)     { $info.Debit = $item.Length * 8 / $info.Duree }

    if ($info.Duree -le 0) {
        $info.Etat = 'ILLISIBLE'; $info.Raison = 'duree nulle ou inconnue (fichier tronque ?)'
    }
    return $info
}

# PSNR du aller-retour  source -> 720p -> source.
# Si l'image n'a pas de vrai detail au-dela du 720p, l'aller-retour la restitue
# presque a l'identique  =>  PSNR tres eleve  =>  faux 1080p (upscale).
function Test-Upscale($info) {
    if ($info.Etat -ne 'OK') { return }
    if ($info.Hauteur -lt 900) { return }        # deja <= 720p : rien a tester
    $mesures = @()
    foreach ($frac in 0.25, 0.50, 0.75) {
        $p = [int]($info.Duree * $frac)
        $fg = "[0:v:$($info.VIdx)]split=2[a][b];" +
              "[b]scale=1280:720:flags=bicubic,scale=$($info.Largeur):$($info.Hauteur):flags=bicubic[c];" +
              "[a][c]psnr=stats_file=-"
        $pre = @('-v','quiet','-ss',$p,'-t','4')
        if ($info.Forcer) { $pre += @('-f', $info.Forcer) }
        $lignes = & $ffmpeg @pre -i $info.Path -an -sn -dn -filter_complex $fg -f null -
        $y = $lignes |
             Select-String 'psnr_y:([0-9.]+|inf)' -AllMatches |
             ForEach-Object { $_.Matches } |
             ForEach-Object { if ($_.Groups[1].Value -eq 'inf') { 99.0 } else { [double]$_.Groups[1].Value } }
        if ($y) { $mesures += ($y | Measure-Object -Average).Average }
    }
    if (-not $mesures) { return }
    $info.Psnr = [math]::Round(($mesures | Measure-Object -Average).Average, 1)
    if     ($info.Psnr -ge 43) { $info.Verdict = 'FAUX'    }   # aller-retour quasi parfait
    elseif ($info.Psnr -ge 39) { $info.Verdict = 'DOUTEUX' }
    else                       { $info.Verdict = 'VRAI'    }
}

# ------------------------------------------------------------ inventaire ----
Titre "Analyse de $($Fichiers.Count) fichier(s)"
$lot = @()
foreach ($f in $Fichiers) {
    $i = Analyser $f
    Write-Host ("  {0}" -f $i.Nom) -ForegroundColor White
    if ($i.Etat -ne 'OK') {
        Write-Host ("     {0} : {1}  -  ignore" -f $i.Etat, $i.Raison) -ForegroundColor Red
        $lot += $i
        continue
    }

    $codecTxt = $i.Codec
    if ($i.Profil)     { $codecTxt += " ($($i.Profil))" }
    if ($i.Bits -gt 8) { $codecTxt += " $($i.Bits) bits" }
    Write-Host ("     {0}x{1}  {2}  {3:0.###} fps  {4:N1} Mb/s  -  {5}  -  {6}" -f
        $i.Largeur, $i.Hauteur, $codecTxt, $i.Fps, ($i.Debit / 1000000), (Duree $i.Duree), (Mo $i.Taille)) `
        -ForegroundColor Gray

    $flags = @()
    $ta = "$($i.Audios.Count) audio"
    if ($i.Audios.Count -gt 0) {
        $ta += " (" + (($i.Audios | ForEach-Object { $_.codec_name }) -join ', ') + ")"
    }
    $flags += $ta
    $flags += "$($i.SousTitres.Count) sous-titre(s)"
    if ($i.Chapitres -gt 0) { $flags += "$($i.Chapitres) chapitres" }
    if ($i.Hdr)             { $flags += "HDR ($($i.ColTrc))" }
    if ($i.Entrelace)       { $flags += "ENTRELACE" }
    if ($i.Forcer)          { $flags += "demux force : $($i.Forcer)" }
    if ($i.Raison)          { $flags += $i.Raison }
    Write-Host ("     " + ($flags -join '  |  ')) -ForegroundColor DarkGray
    $lot += $i
}

$valides = @($lot | Where-Object { $_.Etat -eq 'OK' })
$rejets  = @($lot | Where-Object { $_.Etat -ne 'OK' })
if ($valides.Count -eq 0) {
    Write-Host ""
    Write-Host "Aucun fichier exploitable." -ForegroundColor Red
    Read-Host "Entree pour fermer"; exit 1
}

# -------------------------------------------------------------- reglages ----
Titre "Conteneur de sortie"
Write-Host "  [1] MP4   lisible partout, navigateur compris (le site, un telephone, une TV)"
Write-Host "            l'AC3/DTS y est reencode en AAC, les sous-titres image sont perdus"
Write-Host "  [2] MKV   garde tout tel quel : AC3, DTS, sous-titres ASS et image, chapitres"
Write-Host "            mais AUCUN navigateur ne lit le MKV" -ForegroundColor DarkGray
$rep = Demander "  Choix [1 par defaut]" '1'
if ($rep -eq '2') { $conteneur = 'mkv' } else { $conteneur = 'mp4' }
$extSortie = ".$conteneur"
if ($conteneur -eq 'mkv') { $AudioPortable = $AudioMkv } else { $AudioPortable = $AudioMp4 }

Titre "Codec de sortie"
$encodeursDispo = & $ffmpeg -hide_banner -encoders
function A-Encodeur($nom) { return [bool]($encodeursDispo | Select-String -SimpleMatch " $nom ") }

$optEnc = @()
$optEnc += [pscustomobject]@{ Cle='0'; Enc='copy';    Txt='Copier la video telle quelle   aucune perte, quasi instantane (remux)' }
$optEnc += [pscustomobject]@{ Cle='1'; Enc='libx264'; Txt='H.264 (libx264)   compatible partout, reference qualite/taille' }
$optEnc += [pscustomobject]@{ Cle='2'; Enc='libx265'; Txt='H.265 (libx265)   ~30 % plus petit a qualite egale, encodage plus lent' }
$nn = 3
if (A-Encodeur 'h264_nvenc') { $optEnc += [pscustomobject]@{ Cle="$nn"; Enc='h264_nvenc'; Txt='H.264 NVENC (NVIDIA)   tres rapide, fichier un peu plus gros' }; $nn++ }
if (A-Encodeur 'hevc_nvenc') { $optEnc += [pscustomobject]@{ Cle="$nn"; Enc='hevc_nvenc'; Txt='H.265 NVENC (NVIDIA)   tres rapide' }; $nn++ }
if (A-Encodeur 'h264_qsv')   { $optEnc += [pscustomobject]@{ Cle="$nn"; Enc='h264_qsv';   Txt='H.264 QuickSync (Intel)  tres rapide' }; $nn++ }
if (A-Encodeur 'h264_amf')   { $optEnc += [pscustomobject]@{ Cle="$nn"; Enc='h264_amf';   Txt='H.264 AMF (AMD)          tres rapide' }; $nn++ }
foreach ($o in $optEnc) { Write-Host ("  [{0}] {1}" -f $o.Cle, $o.Txt) }
$rep = Demander "  Choix [1 par defaut]" '1'
$sel = $optEnc | Where-Object { $_.Cle -eq $rep } | Select-Object -First 1
if (-not $sel) { $sel = $optEnc | Where-Object { $_.Cle -eq '1' } | Select-Object -First 1 }
$encodeur = $sel.Enc
$remux    = ($encodeur -eq 'copy')
$materiel = (-not $remux) -and ($encodeur -notmatch '^libx')

# la presence de l'encodeur ne garantit pas que la carte reponde : on teste
if ($materiel) {
    Write-Host "  verification de l'encodeur materiel..." -NoNewline -ForegroundColor DarkGray
    & $ffmpeg -hide_banner -loglevel quiet -f lavfi -i color=black:s=256x256:d=0.2 -c:v $encodeur -f null -
    if ($LASTEXITCODE -ne 0) {
        Write-Host "`r  encodeur materiel indisponible, bascule sur libx264            " -ForegroundColor Yellow
        $encodeur = 'libx264'; $materiel = $false
    }
    else { Write-Host "`r  encodeur materiel operationnel                                " -ForegroundColor DarkGray }
}

if ($remux) {
    # on ne redimensionne pas un flux qu'on recopie: il faudrait le reencoder
    $hCible = 0
    Write-Host ""
    Write-Host "  video copiee telle quelle : ni resolution, ni qualite, ni vitesse a regler." -ForegroundColor DarkGray
}
else {

Titre "Resolution de sortie"
Write-Host "  [1] Garder la resolution source     qualite maximale, fichier plus gros"
Write-Host "  [2] Maximum 720p                    environ moitie moins lourd"
Write-Host "  [3] Maximum 1080p                   ne redimensionne que ce qui est plus grand"
Write-Host "  [4] Maximum 480p                    tres compact"
Write-Host "  [5] Auto par fichier                720p si la 1080p est fausse ou douteuse"
$rep = Demander "  Choix [2 par defaut]" '2'
switch ($rep) {
    '1'     { $hCible = 0    }
    '3'     { $hCible = 1080 }
    '4'     { $hCible = 480  }
    '5'     { $hCible = -1   }   # decide fichier par fichier
    default { $hCible = 720  }
}

Titre "Qualite (CRF : plus bas = meilleur et plus gros)"
if ($encodeur -match 'x265|hevc') {
    Write-Host "  [1] CRF 20   quasi transparent"
    Write-Host "  [2] CRF 23   recommande en H.265"
    Write-Host "  [3] CRF 26   compact"
    $rep = Demander "  Choix, ou une valeur directe (ex : 24) [2 par defaut]" '2'
    switch ($rep) {
        '1'     { $crf = 20 }
        '2'     { $crf = 23 }
        '3'     { $crf = 26 }
        default { if ($rep -match '^\d{1,2}$') { $crf = [int]$rep } else { $crf = 23 } }
    }
}
else {
    Write-Host "  [1] CRF 18   quasi transparent    environ -25 % de taille"
    Write-Host "  [2] CRF 21   recommande           environ -50 % de taille"
    Write-Host "  [3] CRF 23   compact              environ -60 % de taille"
    $rep = Demander "  Choix, ou une valeur directe (ex : 20) [2 par defaut]" '2'
    switch ($rep) {
        '1'     { $crf = 18 }
        '2'     { $crf = 21 }
        '3'     { $crf = 23 }
        default { if ($rep -match '^\d{1,2}$') { $crf = [int]$rep } else { $crf = 21 } }
    }
}

$preset = 'medium'
if (-not $materiel) {
    Titre "Vitesse d'encodage"
    Write-Host "  [1] fast      rapide, fichier un peu plus gros"
    Write-Host "  [2] medium    equilibre (defaut)"
    Write-Host "  [3] slow      plus lent, environ 5 a 10 % plus petit"
    $rep = Demander "  Choix [2 par defaut]" '2'
    switch ($rep) { '1' { $preset = 'fast' } '3' { $preset = 'slow' } default { $preset = 'medium' } }
}

}

$rep = Demander "  Sauter les fichiers deja conformes (bon codec, bonne resolution, deja au bon format) ? (O/n)" 'o'
$sauterConformes = $rep -match '^[oOyY]'

if ($remux) { $desentrelacer = $false }
else {
    $rep = Demander "  Desentrelacer automatiquement quand c'est detecte ? (O/n)" 'o'
    $desentrelacer = $rep -match '^[oOyY]'
}

Titre "Fichiers de sortie"
Write-Host "  [1] A cote de la source, nom suffixe (ex : episode.720p.x264-crf21$extSortie)"
Write-Host "  [2] Dans un sous-dossier 'converti'"
Write-Host "  [3] Remplacer la source (suppression apres verification de la duree)"
$rep = Demander "  Choix [1 par defaut]" '1'
switch ($rep) { '2' { $modeSortie = 2 } '3' { $modeSortie = 3 } default { $modeSortie = 1 } }
if ($modeSortie -eq 3) {
    $rep = Demander "  Confirmer la suppression des sources apres succes ? (o/N)" 'n'
    if ($rep -notmatch '^[oOyY]') { $modeSortie = 1 }
}

# -------------------------------------------------------------- encodage ----
function Args-Encodeur($enc, $crf, $preset, $bits10, $conteneur) {
    # hvc1 ne veut rien dire hors MP4: c'est ce tag qui rend le HEVC lisible
    # par Safari et par le lecteur du site, le MKV n'en a pas besoin
    if ($conteneur -eq 'mp4') { $tagHevc = @('-tag:v','hvc1') } else { $tagHevc = @() }
    switch ($enc) {
        'copy' {
            return @('-c:v','copy')
        }
        'libx264' {
            return @('-c:v','libx264','-preset',$preset,'-crf',"$crf",
                     '-profile:v','high','-pix_fmt','yuv420p')
        }
        'libx265' {
            if ($bits10) { $pf = 'yuv420p10le'; $pr = 'main10' } else { $pf = 'yuv420p'; $pr = 'main' }
            return @('-c:v','libx265','-preset',$preset,'-crf',"$crf",
                     '-profile:v',$pr,'-pix_fmt',$pf) + $tagHevc
        }
        'h264_nvenc' {
            return @('-c:v','h264_nvenc','-preset','p5','-tune','hq','-rc','vbr',
                     '-cq',"$crf",'-b:v','0','-profile:v','high','-pix_fmt','yuv420p')
        }
        'hevc_nvenc' {
            if ($bits10) { $pf = 'p010le'; $pr = 'main10' } else { $pf = 'yuv420p'; $pr = 'main' }
            return @('-c:v','hevc_nvenc','-preset','p5','-tune','hq','-rc','vbr',
                     '-cq',"$crf",'-b:v','0','-profile:v',$pr,'-pix_fmt',$pf) + $tagHevc
        }
        'h264_qsv' {
            return @('-c:v','h264_qsv','-global_quality',"$crf",'-preset','medium',
                     '-profile:v','high','-pix_fmt','nv12')
        }
        'h264_amf' {
            return @('-c:v','h264_amf','-rc','cqp','-qp_i',"$crf",'-qp_p',"$crf",
                     '-quality','balanced','-profile:v','high','-pix_fmt','yuv420p')
        }
        default {
            return @('-c:v','libx264','-preset',$preset,'-crf',"$crf",'-pix_fmt','yuv420p')
        }
    }
}

$etiqEnc = switch ($encodeur) {
    'copy'       { 'remux' }
    'libx264'    { 'x264' }
    'libx265'    { 'x265' }
    'h264_nvenc' { 'nvenc-h264' }
    'hevc_nvenc' { 'nvenc-h265' }
    'h264_qsv'   { 'qsv-h264' }
    'h264_amf'   { 'amf-h264' }
    default      { $encodeur }
}
if ($remux) { $codecCible = $null }
elseif ($encodeur -match 'hevc|265') { $codecCible = 'hevc' }
else { $codecCible = 'h264' }

$total = $valides.Count; $n = 0; $avant = 0; $apres = 0
$echecs = @(); $sautes = @()
$chrono = [Diagnostics.Stopwatch]::StartNew()

foreach ($i in $valides) {
    $n++
    Titre "[$n/$total] $($i.Nom)"

    # ---- resolution voulue pour ce fichier
    $h = $hCible
    if ($h -eq -1) {
        if ($i.Hauteur -gt 720) {
            Write-Host "  test de resolution reelle en cours..." -NoNewline -ForegroundColor DarkGray
            Test-Upscale $i
            if ($i.Verdict) {
                $col = switch ($i.Verdict) { 'VRAI' { 'Green' } 'DOUTEUX' { 'Yellow' } 'FAUX' { 'Red' } }
                $txt = switch ($i.Verdict) {
                    'VRAI'    { "VRAIE $($i.Hauteur)p, du detail reel est present -> resolution gardee" }
                    'DOUTEUX' { "DOUTEUX, sans doute upscale -> passage en 720p" }
                    'FAUX'    { "FAUX $($i.Hauteur)p, c'est du 720p etire -> passage en 720p" }
                }
                Write-Host ("`r  {0}  (PSNR-Y {1} dB)                              " -f $txt, $i.Psnr) -ForegroundColor $col
            }
            else { Write-Host "`r  test impossible, resolution source gardee              " -ForegroundColor DarkGray }
        }
        if ($i.Verdict -eq 'DOUTEUX' -or $i.Verdict -eq 'FAUX') { $h = 720 } else { $h = 0 }
    }
    $redim = ($h -gt 0 -and $i.Hauteur -gt $h)

    # ---- deja conforme ?
    $bonCodec = $remux -or ($i.Codec -eq $codecCible)
    if ($sauterConformes -and -not $redim -and $bonCodec -and
        [IO.Path]::GetExtension($i.Path).ToLower() -eq $extSortie -and -not $i.Entrelace) {
        Write-Host "  DEJA CONFORME ($($i.Codec), $($i.Largeur)x$($i.Hauteur), $conteneur) -> saute" -ForegroundColor DarkGray
        $sautes += $i.Nom
        continue
    }

    # ---- nom de sortie
    $dossier = [IO.Path]::GetDirectoryName($i.Path)
    $racine  = [IO.Path]::GetFileNameWithoutExtension($i.Path)
    if ($modeSortie -eq 2) {
        $dossier = Join-Path $dossier 'converti'
        if (-not (Test-Path -LiteralPath $dossier)) { New-Item -ItemType Directory -Path $dossier | Out-Null }
        $nomSortie = "$racine$extSortie"
    }
    elseif ($modeSortie -eq 3) {
        $nomSortie = "$racine.tmp-encode$extSortie"
    }
    else {
        $hFinale = if ($redim) { $h } else { $i.Hauteur }
        if ($remux) { $nomSortie = "$racine.remux$extSortie" }
        else        { $nomSortie = "$racine.${hFinale}p.$etiqEnc-crf$crf$extSortie" }
    }
    $sortie = Join-Path $dossier $nomSortie
    $k = 1
    while (Test-Path -LiteralPath $sortie) {
        $sortie = Join-Path $dossier ("{0} ({1}){2}" -f [IO.Path]::GetFileNameWithoutExtension($nomSortie), $k, $extSortie)
        $k++
    }

    # ---- construction de la ligne ffmpeg
    $a = @('-hide_banner','-nostdin','-y','-loglevel','warning','-stats',
           '-analyzeduration','200M','-probesize','200M','-fflags','+genpts')
    if ($i.Forcer) { $a += @('-f', $i.Forcer) }   # demultiplexeur impose si mal detecte
    $a += @('-i', $i.Path)

    # sous-titres externes portant le meme nom de base
    $sidecars = @()
    foreach ($ext in '.srt','.ass','.ssa','.vtt') {
        $p = [IO.Path]::ChangeExtension($i.Path, $ext)
        if (Test-Path -LiteralPath $p) { $sidecars += $p; $a += @('-i', $p) }
    }

    $a += @('-map', "0:v:$($i.VIdx)")
    if ($i.Audios.Count -gt 0) { $a += @('-map','0:a') }

    # Le MP4 ne porte que du texte, et il l'aplatit en mov_text. Le MKV prend
    # tout tel quel : c'est la vraie raison de le choisir.
    $nbSous = 0
    $codecsSous = @()
    for ($j = 0; $j -lt $i.SousTitres.Count; $j++) {
        $cs = $i.SousTitres[$j].codec_name
        if ($SousImage -contains $cs) {
            if ($conteneur -eq 'mkv') {
                $a += @('-map', "0:s:$j"); $nbSous++; $codecsSous += $cs
            }
            else {
                Write-Host "  sous-titre image '$cs' ignore (incompatible MP4)" -ForegroundColor DarkYellow
            }
        }
        elseif ($SousTexte -contains $cs) {
            $a += @('-map', "0:s:$j"); $nbSous++; $codecsSous += $cs
            if (($cs -eq 'ass' -or $cs -eq 'ssa') -and $conteneur -eq 'mp4') {
                Write-Host "  sous-titre ASS converti en texte simple (mise en forme perdue)" -ForegroundColor DarkYellow
            }
        }
        else {
            Write-Host "  sous-titre '$cs' ignore (non gere en $conteneur)" -ForegroundColor DarkYellow
        }
    }
    for ($m = 1; $m -le $sidecars.Count; $m++) {
        $a += @('-map', "${m}:0"); $nbSous++; $codecsSous += 'subrip'
    }

    $a += @('-dn','-map_metadata','0','-map_chapters','0')

    # ---- video
    $bits10 = ($i.Bits -gt 8 -and ($encodeur -eq 'libx265' -or $encodeur -eq 'hevc_nvenc'))
    $a += Args-Encodeur $encodeur $crf $preset $bits10 $conteneur

    $vf = @()
    if ($desentrelacer -and $i.Entrelace) { $vf += 'bwdif=mode=0' }
    if ($redim) { $vf += "scale=w=-2:h='min($h,ih)':flags=lanczos" }
    elseif (($i.Largeur % 2) -ne 0 -or ($i.Hauteur % 2) -ne 0) {
        # x264/x265 refusent les dimensions impaires : arrondi au pair inferieur
        $vf += 'scale=w=trunc(iw/2)*2:h=trunc(ih/2)*2'
    }
    if ($vf.Count -gt 0) { $a += @('-vf', ($vf -join ',')) }

    # tags colorimetriques conserves (sinon le BT.709 / HDR est perdu)
    if ($i.ColPrim -and $i.ColPrim -ne 'unknown') { $a += @('-color_primaries', $i.ColPrim) }
    if ($i.ColTrc  -and $i.ColTrc  -ne 'unknown') { $a += @('-color_trc',       $i.ColTrc)  }
    if ($i.ColSpc  -and $i.ColSpc  -ne 'unknown') { $a += @('-colorspace',      $i.ColSpc)  }
    if ($i.Hdr -and -not $bits10) {
        Write-Host "  ATTENTION source HDR encodee en 8 bits : les couleurs peuvent delaver." -ForegroundColor Yellow
        Write-Host "            pour garder le HDR, relance en choisissant H.265 (libx265)." -ForegroundColor DarkYellow
    }

    # ---- audio, piste par piste
    $descAudio = @()
    if ($i.Audios.Count -eq 0) { $a += @('-an'); $descAudio += 'aucune' }
    else {
        for ($j = 0; $j -lt $i.Audios.Count; $j++) {
            $ca = $i.Audios[$j].codec_name
            $ch = [int]$i.Audios[$j].channels
            if ($AudioPortable -contains $ca) {
                $a += @("-c:a:$j", 'copy')
                $descAudio += "$ca copie"
            }
            else {
                $br = if ($ch -gt 2) { '384k' } else { '192k' }
                $a += @("-c:a:$j", 'aac', "-b:a:$j", $br)
                $descAudio += "$ca -> aac $br"
            }
        }
    }

    if ($nbSous -gt 0) {
        if ($conteneur -eq 'mkv') {
            # tout se recopie dans un MKV, sauf le mov_text qui n'y a pas sa place
            for ($j = 0; $j -lt $nbSous; $j++) {
                if ($codecsSous[$j] -eq 'mov_text') { $a += @("-c:s:$j", 'srt') }
                else                                { $a += @("-c:s:$j", 'copy') }
            }
        }
        else { $a += @('-c:s','mov_text') }
    }
    if ($conteneur -eq 'mp4') { $a += @('-movflags','+faststart') }
    $a += @('-max_muxing_queue_size','4096',
            '-avoid_negative_ts','make_zero', $sortie)

    $cible = if ($redim) { "hauteur ramenee a ${h}p" } else { "$($i.Largeur)x$($i.Hauteur)" }
    Write-Host "  source : $($i.Codec) $($i.Largeur)x$($i.Hauteur) $($i.Bits) bits, $(Mo $i.Taille)" -ForegroundColor DarkGray
    Write-Host "  -> $([IO.Path]::GetFileName($sortie))" -ForegroundColor Gray
    if ($remux) { $recapV = "video copiee telle quelle" } else { $recapV = "$etiqEnc CRF $crf" }
    Write-Host "     $recapV, $cible, audio : $($descAudio -join ' + '), $nbSous sous-titre(s), $conteneur" -ForegroundColor Gray
    Write-Host ""

    & $ffmpeg @a

    $existe = Test-Path -LiteralPath $sortie
    $vide   = $existe -and (Get-Item -LiteralPath $sortie).Length -eq 0
    if ($LASTEXITCODE -ne 0 -or -not $existe -or $vide) {
        Write-Host "  ECHEC (code $LASTEXITCODE)  -  la source est conservee" -ForegroundColor Red
        if ($vide) { Remove-Item -LiteralPath $sortie -Force -ErrorAction SilentlyContinue }
        $echecs += $i.Nom
        continue
    }

    # controle : la duree de sortie doit coller a celle de la source
    $dOut = [double](& $ffprobe -v quiet -show_entries format=duration -of csv=p=0 -i $sortie)
    $tol  = [math]::Max(2, $i.Duree * 0.02)
    $ok   = [math]::Abs($dOut - $i.Duree) -lt $tol
    $tOut = (Get-Item -LiteralPath $sortie).Length
    $avant += $i.Taille; $apres += $tOut

    $note = if ($ok) { '' } else { "   ATTENTION duree source $(Duree $i.Duree)" }
    Write-Host ""
    Write-Host ("  OK   {0}  ->  {1}   ({2:+0.0;-0.0} %)   duree {3}{4}" -f
        (Mo $i.Taille), (Mo $tOut), (($tOut - $i.Taille) / $i.Taille * 100), (Duree $dOut), $note) `
        -ForegroundColor $(if ($ok) { 'Green' } else { 'Yellow' })

    # ---- remplacement de la source
    if ($modeSortie -eq 3) {
        if ($ok) {
            Remove-Item -LiteralPath $i.Path -Force
            $final = Join-Path ([IO.Path]::GetDirectoryName($i.Path)) "$racine.mp4"
            $z = 1
            while (Test-Path -LiteralPath $final) {
                $final = Join-Path ([IO.Path]::GetDirectoryName($i.Path)) "$racine ($z).mp4"; $z++
            }
            Move-Item -LiteralPath $sortie -Destination $final -Force
            Write-Host "  source remplacee par $([IO.Path]::GetFileName($final))" -ForegroundColor DarkGray
        }
        else {
            Write-Host "  duree incoherente : source conservee, sortie laissee en .tmp-encode.mp4" -ForegroundColor Yellow
        }
    }
}

# ----------------------------------------------------------------- bilan ----
Titre ("Termine en {0:hh\:mm\:ss}" -f $chrono.Elapsed)
if ($avant -gt 0) {
    Write-Host ("  Total : {0}  ->  {1}   soit {2:0.0} % d'espace gagne" -f
        (Mo $avant), (Mo $apres), (($avant - $apres) / $avant * 100)) -ForegroundColor Green
}
if ($sautes.Count -gt 0) {
    Write-Host "  Deja conformes, non touches : $($sautes.Count)" -ForegroundColor DarkGray
}
if ($rejets.Count -gt 0) {
    Write-Host "  Vides / illisibles :" -ForegroundColor Red
    foreach ($r in $rejets) { Write-Host ("    {0}  -  {1}" -f $r.Nom, $r.Raison) -ForegroundColor DarkGray }
}
if ($echecs.Count -gt 0) { Write-Host "  Echecs d'encodage : $($echecs -join ', ')" -ForegroundColor Red }
Write-Host ""
Read-Host "Entree pour fermer"
