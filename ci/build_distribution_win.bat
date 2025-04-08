cd c:\r2t
.\venv\Scripts\pyinstaller autoreq.spec
deactivate
cd dist
move autoreq distribution
tar -cf c:\r2t\dcheck-windows.tar.gz distribution