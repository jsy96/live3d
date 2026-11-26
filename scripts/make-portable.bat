@echo off
rem Build a portable zip of the desktop pet that runs WITHOUT Node.js:
rem the renderer is a prebuilt single-file bundle (dist\bundle.js) and only
rem node_modules\electron\dist is needed at runtime (electron.exe embeds its
rem own Node runtime). Recipients unzip, double-click start-pet.bat, done.
rem Output: dist\ai-live3d-portable-<version>.zip
setlocal enabledelayedexpansion
cd /d "%~dp0.."

rem --- read APP_VERSION from main\version.js (const APP_VERSION = 'vX';)
rem /b anchors at line start: the "module.exports = { APP_VERSION }" line must
rem NOT match (a second for /f iteration overwrote the version with garbage).
set APP_VERSION=
for /f "tokens=2 delims==" %%a in ('findstr /b /c:"const APP_VERSION" main\version.js') do (
  set V=%%a
  set V=!V:'=!
  set V=!V:;=!
  set V=!V: =!
  set APP_VERSION=!V!
)
if "%APP_VERSION%"=="" set APP_VERSION=dev
echo Version: %APP_VERSION%

echo Building renderer bundle...
call npm run build
if errorlevel 1 (
  echo npm run build failed.
  exit /b 1
)

set STAGE=dist\portable-stage\ai-live3d
echo Staging portable tree...
if exist dist\portable-stage rmdir /s /q dist\portable-stage
mkdir "%STAGE%" || exit /b 1

rem --- app code, assets, content, entry files
xcopy /e /i /q main "%STAGE%\main" >nul || exit /b 1
xcopy /e /i /q src "%STAGE%\src" >nul || exit /b 1
xcopy /e /i /q assets "%STAGE%\assets" >nul || exit /b 1
xcopy /e /i /q models "%STAGE%\models" >nul || exit /b 1
xcopy /e /i /q animations "%STAGE%\animations" >nul || exit /b 1
mkdir "%STAGE%\dist" 2>nul
copy /y dist\bundle.js "%STAGE%\dist\" >nul || exit /b 1
copy /y package.json "%STAGE%\" >nul || exit /b 1
copy /y start-pet.bat "%STAGE%\" >nul || exit /b 1
copy /y README.md "%STAGE%\" >nul || exit /b 1

rem --- runtime: ONLY electron binaries, no Node.js needed on the target PC
xcopy /e /i /q node_modules\electron\dist "%STAGE%\node_modules\electron\dist" >nul || exit /b 1

set ZIPNAME=ai-live3d-portable-%APP_VERSION%.zip
echo Compressing to dist\%ZIPNAME% ...
powershell -NoProfile -Command "Compress-Archive -Path 'dist/portable-stage/ai-live3d' -DestinationPath 'dist/%ZIPNAME%' -Force" || exit /b 1

echo Done: dist\%ZIPNAME%
endlocal
