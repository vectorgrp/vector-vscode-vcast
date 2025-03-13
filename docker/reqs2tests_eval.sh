#!/bin/bash

export PATH=$VECTORCAST_DIR:$PATH

SANITY_ENVS="https://rds-vtc-docker-dev-local.vegistry.vg.vector.int/artifactory/rds-build-packages-generic-dev-local/code2reqs2tests/sanity.tar.gz"
PIINNOVO_ENVS="https://rds-vtc-docker-dev-local.vegistry.vg.vector.int/artifactory/rds-build-packages-generic-dev-local/code2reqs2tests/piinnovo-real-reqs.tar.gz"
HALLA_ENVS="https://rds-vtc-docker-dev-local.vegistry.vg.vector.int/artifactory/rds-build-packages-generic-dev-local/code2reqs2tests/atg-customer.tar.gz"

ENVS=("sanity" "piinnovo" "atg-customer")
if [[ "$ENV_SET_NAME" == "sanity" ]]; then
  ENV_SET_URL=$SANITY_ENVS
elif [[ "$ENV_SET_NAME" == "piinnovo" ]]; then
  ENV_SET_URL=$PIINNOVO_ENVS
elif [[ "$ENV_SET_NAME" == "atg-customer" ]]; then
  ENV_SET_URL=$HALLA_ENVS
fi

if [[ -z "$ENV_SET_URL" ]]; then
  echo "Error: ENV_SET_NAME must be set to one of the following: ${ENVS[*]}"
  exit 1
fi
echo "Running evaluation for $ENV_SET_NAME"

MAX_COST_CHECK=$(echo "$MAX_COST" | python3.10 -c "import sys;exec('try:obj=float(str(sys.stdin.read().strip()))\nexcept:obj=-1');print(obj > 0)")
if [[ "$MAX_COST_CHECK" == "False" ]]; then
  MAX_COST_STR=""
  echo "No max-cost set"
else
  echo "Max cost set to $MAX_COST"
  MAX_COST_STR="--max-cost $MAX_COST"
fi

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
  reqs2tests_eval @bench_envs.txt --batched --allow-partial --timeout 30 "$MAX_COST_STR" r2t_eval_results
  deactivate
  rm -rf /.envs /.src
}

main
# EOF