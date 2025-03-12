#!/bin/bash

export PATH=$VECTORCAST_DIR:$PATH

process_url() {
  local url="$1"
  local downloaded_file
  downloaded_file=$(basename "$url")

  wget "$url" -O "$downloaded_file"
  tar -xvf "$downloaded_file"
  rm "$downloaded_file"
}

setup() {
  mkdir /.envs
  mkdir /.src

  if [ "$ENV_SET_NAME" == "piinovo" ] || [ "$ENV_SET_NAME" == "atg-customer" ]; then
    # shellcheck disable=SC2164
    cd /.src
    process_url "$PIINNOVO_SRC"
    export PI_INNOVO_SRC_PATH=$PWD/piinnovo-source
    if [ "$ENV_SET_NAME" == "atg-customer" ]; then
      process_url "$HALLA_SRC"
      export HALLA_MODMGR4A_SRC_PATH=$PWD/halla-modmgr4a-source
    fi
  fi

  # shellcheck disable=SC2164
  cd /.envs
  process_url "$ENV_SET_URL"
}

main () {
  setup

  find . -iname '*.env' > bench_envs.txt
  source /.venv/bin/activate
  reqs2tests_eval @bench_envs.txt --batched --allow-partial --timeout 30 r2t_eval_results
  deactivate
  rm -rf /.envs /.src
}

main
# EOF