cd c:\r2t
.\venv\Scripts\python setup.py build_ext --inplace
.\venv\Scripts\pyinstaller autoreq.spec
cd dist
move autoreq distribution
tar -cf c:\r2t\dcheck-windows.tar.gz distribution