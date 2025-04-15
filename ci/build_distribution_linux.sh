#!/bin/bash

set -e

source $VCAST_USER_HOME/.venv/bin/activate
python setup.py build_ext --inplace
pyinstaller autoreq.spec
deactivate
cd dist
mv autoreq distribution
tar -cf $VCAST_USER_HOME/autoreq-linux.tar.gz distribution

# EOF
