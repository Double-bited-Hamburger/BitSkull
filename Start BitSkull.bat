@echo off
rem Opens BitSkull as its own app window (Microsoft Edge app mode). Falls back to the default browser.
set "APP=%~dp0index.html"
where msedge >nul 2>nul
start "" msedge --app="%APP%" --window-size=1500,950 2>nul || start "" "%APP%"
