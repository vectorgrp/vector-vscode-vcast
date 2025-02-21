@echo off
setlocal

REM Remove directories if they exist
if exist dist rmdir /s /q dist
if exist build rmdir /s /q build

REM Run PyInstaller
pyinstaller autoreq.spec

REM Change to the dist directory and create the tar.gz file
cd dist
move autoreq distribution
tar -cf dcheck-windows.tar.gz distribution

echo Process complete.
endlocal