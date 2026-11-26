@echo off
rem AI Live3D desktop pet launcher (double-click to show the pet on the desktop)
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
  echo First run: installing dependencies, please wait...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo npm install failed. Check network or node installation.
    pause
    exit /b 1
  )
)

if not exist "dist\bundle.js" (
  echo Building renderer bundle...
  call npm run build
  if errorlevel 1 (
    echo Build failed.
    pause
    exit /b 1
  )
)

rem NOTE: the app path is a bare "." on purpose — appending "%~dp0" would end
rem with \" which cmd parses as an escaped quote and breaks the electron launch.
rem Any arguments are forwarded to the app (remote-control channel, see
rem README "Command-line remote control"): --show --hide --quit --model <name>
rem --animation <name|none> --play <name> --facing <deg> --devtools
start "" "node_modules\electron\dist\electron.exe" . %*
