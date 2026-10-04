@echo off
chcp 65001 >nul
title Partage de la bibliotheque
cd /d "%~dp0"

set "PY="
where python >nul 2>&1 && set "PY=python"
if not defined PY where py >nul 2>&1 && set "PY=py"
if not defined PY (
    echo.
    echo   Python est introuvable. Installe-le depuis python.org, puis relance.
    echo.
    pause
    exit /b 1
)

%PY% "outils\partager.py" %*
echo.
pause
