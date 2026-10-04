@echo off
powershell -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0Convertir-Video.ps1" %*
