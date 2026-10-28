@echo off
REM Arranca o Portal de Aplicacoes na porta 5050.
REM Corre este ficheiro (duplo-clique) no servidor 128.0.0.82.
REM Depois acede em: http://128.0.0.82:5050
cd /d "%~dp0"
python -m http.server 5050
pause
