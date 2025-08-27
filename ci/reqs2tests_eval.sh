#!/bin/bash

set -e

export PATH=$VECTORCAST_DIR:$PATH

SANITY_ENVS="https://rds-vtc-docker-dev-local.vegistry.vg.vector.int/artifactory/rds-build-packages-generic-dev-local/code2reqs2tests/sanity.tar.gz"
PIINNOVO_ENVS="https://rds-vtc-docker-dev-local.vegistry.vg.vector.int/artifactory/rds-build-packages-generic-dev-local/code2reqs2tests/piinnovo-real-reqs.tar.gz"
HALLA_ENVS="https://rds-vtc-docker-dev-local.vegistry.vg.vector.int/artifactory/rds-build-packages-generic-dev-local/code2reqs2tests/atg-customer-fixed.tar.gz"
SANITY_RC_ENVS="https://rds-vtc-docker-dev-local.vegistry.vg.vector.int/artifactory/rds-build-packages-generic-dev-local/code2reqs2tests/sanity-rc.tar.gz"
ATG_CUSTOMER_RC_ENVS="https://rds-vtc-docker-dev-local.vegistry.vg.vector.int/artifactory/rds-build-packages-generic-dev-local/code2reqs2tests/atg-customer-rc.tar.gz"

ENV_SET_NAME=$(echo "$EVAL_ENVS" | grep -oP 'ENV_SET=\K[^;]*' || echo "")
ENVS_TO_SKIP=$(echo "$EVAL_ENVS" | grep -oP 'ENVS_TO_SKIP=\K[^;]*' || echo "")
ENVS_TO_TEST=$(echo "$EVAL_ENVS" | grep -oP 'ENVS_TO_TEST=\K[^;]*' || echo "")

ENVS=("sanity" "piinnovo" "atg-customer" "sanity-rc" "atg-customer-rc")
if [[ "$ENV_SET_NAME" == "sanity" ]]; then
  ENV_SET_URL=$SANITY_ENVS
  BENCH_ENVS_DIR="sanity"
elif [[ "$ENV_SET_NAME" == "piinnovo" ]]; then
  ENV_SET_URL=$PIINNOVO_ENVS
  BENCH_ENVS_DIR="piinnovo-real-reqs"
elif [[ "$ENV_SET_NAME" == "atg-customer" ]]; then
  ENV_SET_URL=$HALLA_ENVS
  BENCH_ENVS_DIR="atg-customer"
elif [[ "$ENV_SET_NAME" == "sanity-rc" ]]; then
  ENV_SET_URL=$SANITY_RC_ENVS
  BENCH_ENVS_DIR="sanity-rc"
elif [[ "$ENV_SET_NAME" == "atg-customer-rc" ]]; then
  ENV_SET_URL=$ATG_CUSTOMER_RC_ENVS
  BENCH_ENVS_DIR="atg-customer-rc"
fi

if [[ -z "$ENV_SET_URL" ]]; then
  echo "Error: ENV_SET_NAME must be set to one of the following: ${ENVS[*]}"
  exit 1
fi
echo "Running evaluation for $ENV_SET_NAME"


EXTRA_ARGS=()
get_extra_args() {
  max_cost_check=$(echo $MAX_COST | python3.10 -c "import sys;exec('try:obj=float(str(sys.stdin.read().strip()))\nexcept:obj=-1');print(obj > 0)")
  if [[ "$max_cost_check" != "False" ]]; then
    echo "Max cost set to $MAX_COST"
    EXTRA_ARGS+=("--max-cost" "$MAX_COST")
  fi

  # Parse evaluation flags
  if [[ -n "$EVALUATION_FLAGS" ]]; then
    IFS=',' read -ra FLAGS <<< "$EVALUATION_FLAGS"
    for flag in "${FLAGS[@]}"; do
      # Trim whitespace
      flag=$(echo "$flag" | xargs)
      case "$flag" in
        "batched-mode")
          echo "Batched mode enabled"
          EXTRA_ARGS+=("--batched")
          ;;
        "individual-decomposition")
          echo "Individual decomposition enabled"
          EXTRA_ARGS+=("--individual-decomposition")
          ;;
        "blackbox")
          echo "Blackbox mode enabled"
          EXTRA_ARGS+=("--blackbox")
          ;;
        *)
          if [[ -n "$flag" ]]; then
            echo "Warning: Unknown evaluation flag '$flag'"
          fi
          ;;
      esac
    done
  fi
  
  if [[ -n "$MIN_PRUNING_LINES" ]]; then
    min_pruning_check=$(echo $MIN_PRUNING_LINES | python3.10 -c "import sys;exec('try:obj=int(str(sys.stdin.read().strip()))\nexcept:obj=-1');print(obj > 0)")
    if [[ "$min_pruning_check" != "False" ]]; then
      echo "Min pruning lines set to $MIN_PRUNING_LINES"
      EXTRA_ARGS+=("--min-pruning-lines" "$MIN_PRUNING_LINES")
    fi
  fi

  if [[ -n "$ENVS_TO_SKIP" ]]; then
    echo "Environments to skip: $ENVS_TO_SKIP"
    EXTRA_ARGS+=("--envs-to-skip" "$ENVS_TO_SKIP")
  fi

  if [[ -n "$ENVS_TO_TEST" ]]; then
    echo "Environments to test: $ENVS_TO_TEST"
    EXTRA_ARGS+=("--envs-to-test" "$ENVS_TO_TEST")
  fi
}

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

  get_extra_args
  cmd="python $REPO_DIR/autoreq/evaluate_reqs2tests.py @$BENCH_ENVS_DIR/bench_envs.txt --allow-partial --timeout 30 ${EXTRA_ARGS[*]} r2t_eval_results"
  echo "Running command: $cmd"
  eval $cmd
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