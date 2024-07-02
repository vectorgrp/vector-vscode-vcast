#!/bin/bash

ROOT=$(dirname "$(realpath "$0")")
cp $ROOT/pre-commit $ROOT/../.git/hooks/
