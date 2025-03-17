#!/bin/bash

set -e

source $VCAST_USER_HOME/.venv/bin/activate
pip install --no-cache pyinstaller==6.12.0
pyinstaller autoreq.spec
deactivate
cd dist
mv autoreq distribution
tar -cf $VCAST_USER_HOME/autoreq-linux.tar.gz distribution

# EOF
