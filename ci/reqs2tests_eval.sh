#!/bin/bash

set -e

export PATH=$VECTORCAST_DIR:$PATH

SANITY_ENVS="https://rds-vtc-docker-dev-local.vegistry.vg.vector.int/artifactory/rds-build-packages-generic-dev-local/code2reqs2tests/sanity.tar.gz"
PIINNOVO_ENVS="https://rds-vtc-docker-dev-local.vegistry.vg.vector.int/artifactory/rds-build-packages-generic-dev-local/code2reqs2tests/piinnovo-real-reqs.tar.gz"
HALLA_ENVS="https://rds-vtc-docker-dev-local.vegistry.vg.vector.int/artifactory/rds-build-packages-generic-dev-local/code2reqs2tests/atg-customer-fixed.tar.gz"

ENVS=("sanity" "piinnovo" "atg-customer")
if [[ "$ENV_SET_NAME" == "sanity" ]]; then
  ENV_SET_URL=$SANITY_ENVS
  BENCH_ENVS_DIR="sanity"
elif [[ "$ENV_SET_NAME" == "piinnovo" ]]; then
  ENV_SET_URL=$PIINNOVO_ENVS
  BENCH_ENVS_DIR="piinnovo-real-reqs"
elif [[ "$ENV_SET_NAME" == "atg-customer" ]]; then
  ENV_SET_URL=$HALLA_ENVS
  BENCH_ENVS_DIR="atg-customer"
fi

if [[ -z "$ENV_SET_URL" ]]; then
  echo "Error: ENV_SET_NAME must be set to one of the following: ${ENVS[*]}"
  exit 1
fi
echo "Running evaluation for $ENV_SET_NAME"

MAX_COST_CHECK=$(echo $MAX_COST | python3.10 -c "import sys;exec('try:obj=float(str(sys.stdin.read().strip()))\nexcept:obj=-1');print(obj > 0)")
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

  echo "Downloading $downloaded_file"
  wget "$url" -O "$downloaded_file" > /dev/null 2>&1
  tar -xvf "$downloaded_file" > /dev/null 2>&1
  rm "$downloaded_file"
  echo "Downloaded $downloaded_file"
}

setup() {
  mkdir $VCAST_USER_HOME/.envs
  mkdir $VCAST_USER_HOME/.src

  cd $VCAST_USER_HOME/.src
  process_url $PIINNOVO_SRC
  export PI_INNOVO_SRC_PATH=$PWD/piinnovo-source
  process_url $HALLA_SRC
  export HALLA_MODMGR4A_SRC_PATH=$PWD/halla-modmgr4a-source

  cd $VCAST_USER_HOME/.envs
  process_url $ENV_SET_URL
}

main () {
  export REPO_DIR=$PWD
  setup

  cd $VCAST_USER_HOME/.envs
  source $VCAST_USER_HOME/.venv/bin/activate
 
  python $REPO_DIR/autoreq/evaluate_reqs2tests.py @$BENCH_ENVS_DIR/bench_envs.txt --batched --allow-partial --timeout 30 $MAX_COST_STR r2t_eval_results
  deactivate
  if [[ -d "r2t_eval_results" ]]; then
    echo "Results folder exists at: $(realpath r2t_eval_results)"
  else
    echo "Error: Results folder 'r2t_eval_results' was not generated"
    exit 1
  fi
}

main
# EOF