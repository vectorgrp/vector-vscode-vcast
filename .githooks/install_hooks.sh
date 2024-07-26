#!/bin/bash

ROOT=$(dirname "$(realpath "$0")")
cd $ROOT/..
git config core.hooksPath .githooks
