@echo off
setlocal

cd c:\r2t
source venv\Scripts\activate
pip install --no-cache pyinstaller==6.12.0
pyinstaller autoreq.spec
cd dist
move autoreq distribution
tar -cf c:\r2t\dcheck-windows.tar.gz distribution

echo Process complete.
endlocal