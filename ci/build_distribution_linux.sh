#!/bin/bash

set -e

source $VCAST_USER_HOME/.venv/bin/activate
python setup.py build_ext --inplace -j 6
python collect_imports.py
pyinstaller autoreq.spec
deactivate
cd dist
mv autoreq distribution
mkdir -p distribution/_internal/monitors4codegen/multilspy/language_servers/clangd_language/
cd distribution/_internal/monitors4codegen/multilspy/language_servers/clangd_language/
wget --no-proxy https://artifactory.vi.vector.int:443/artifactory/rds-build-packages-generic-dev-local/code2reqs2tests/clangd/clangd-linux-18.1.3.zip
unzip clangd-linux-18.1.3.zip
mkdir -p clangd
mv clangd_18.1.3 clangd/
rm clangd-linux-18.1.3.zip
cd ../../../../../..

tar -cf $VCAST_USER_HOME/autoreq-linux.tar.gz distribution

# EOF
