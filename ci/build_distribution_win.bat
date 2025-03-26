cd c:\r2t
.\venv\Scripts\pip install --no-cache pyinstaller==6.12.0
.\venv\Scripts\pyinstaller autoreq.spec
deactivate
cd dist
move autoreq distribution
tar -cf c:\r2t\dcheck-windows.tar.gz distribution