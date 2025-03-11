#!/bin/bash -x

files=(*.vcm);
PROJECT=$(basename "${files[0]}" .vcm)

function override_build()
{
    touch empty.py
    manage -p $PROJECT --python-repository --add empty.py
    manage -p $PROJECT --build-script empty.py
}

function build_project()
{
    manage -p $PROJECT --build
    ls -l $PROJECT/build/*
}

function main()
{
    override_build
    build_project
}

main
# EOF