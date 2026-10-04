@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo   ANIME DOWNLOADER - toutes les saisons, un terminal chacune
echo ============================================================
echo.

set "URL="
set /p "URL=URL du catalogue (ex: https://anime-sama.to/catalogue/re-zero): "
if "%URL%"=="" (
    echo Aucune URL saisie, abandon.
    pause
    exit /b 1
)

set "PLAYER="
set /p "PLAYER=Player (AnsEmbed, sibnet, vidmoly... vide = auto): "

echo.
echo Format de sortie :
echo   1 = .ts privilegie, .mp4 seulement si la source n'a pas de HLS (defaut)
echo   2 = .ts uniquement (une source sans HLS est ignoree)
echo   3 = .mp4 (conversion apres telechargement)
set "FMT="
set /p "FMT=Ton choix (1/2/3, defaut 1): "
set "FORMAT="
if "%FMT:~0,1%"=="2" set "FORMAT=--ts"
if "%FMT:~0,1%"=="3" set "FORMAT=--mp4"

set "SPLITMODE=--split season"
set "NBTERM="
set "PEREP="
set /p "PEREP=Un terminal par paquet d'episodes au lieu d'un par saison ? (o/N): "
if /i "%PEREP:~0,1%"=="o" (
    set "SPLITMODE=--split episode"
    set /p "NBTERM=Combien de terminaux par saison ? (defaut 4): "
)

set "DRY="
set "PREVIEW="
set /p "PREVIEW=Juste un apercu, sans rien lancer ? (o/N): "
if /i "%PREVIEW:~0,1%"=="o" set "DRY=--dry-run"

set "ARGS=--url "%URL%" --all-seasons %SPLITMODE% %FORMAT% --episodes all --no-mal %DRY%"
if not "%PLAYER%"=="" set "ARGS=%ARGS% --player "%PLAYER%""
if not "%NBTERM%"=="" set "ARGS=%ARGS% --terminals %NBTERM%"

echo.
echo ^> python main.py %ARGS%
echo.
python main.py %ARGS%

echo.
pause
endlocal
