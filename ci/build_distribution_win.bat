cd c:\r2t
.\venv\Scripts\python setup.py build_ext --inplace
.\venv\Scripts\pyinstaller autoreq.spec
cd dist
move autoreq distribution
mkdir distribution\_internal\monitors4codegen\multilspy\language_servers\clangd_language\
cd distribution\_internal\monitors4codegen\multilspy\language_servers\clangd_language\
curl -o clangd-linux-18.1.3.zip https://rds-vtc-docker-dev-local.vegistry.vg.vector.int:443/artifactory/rds-build-packages-generic-dev-local/code2reqs2tests/clangd/clangd-windows-18.1.3.zip
powershell -command "Expand-Archive -Path clangd-windows-18.1.3.zip -DestinationPath ."
mkdir clangd
move clangd_18.1.3 clangd\
del clangd-windows-18.1.3.zip
cd ..\..\..\..\..\..
tar -cf c:\r2t\dcheck-windows.tar.gz distribution