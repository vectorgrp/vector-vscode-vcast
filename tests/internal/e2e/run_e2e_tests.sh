#!/bin/bash
ROOT=$(dirname "$(realpath "$0")")

activate_24_release () {
  export VECTORCAST_DIR=/vcast/release24
  export PATH=/vcast/release24:$PATH
  export ENABLE_ATG_FEATURE=TRUE
  echo "Vcast 24 is activated"
}

set_specs_params() {
  # Path to the JSON file
  JSON_FILE="spec_groups.json"

  # Check if RUN_GROUP_NAME is set
  if [ -z "$RUN_GROUP_NAME" ]; then
    echo "RUN_GROUP_NAME is not set. Please set it and try again."
    exit 1
  fi

  # Check if the JSON file exists
  if [ ! -f "$JSON_FILE" ]; then
    echo "spec_groups.json file not found!"
    exit 1
  fi

  # Extract environment variables for the given group using jq
  # Handle cases where the 'env' might be null or missing
  env_vars=$(jq -r --arg group "$RUN_GROUP_NAME" '
    .[$group].env // {} | 
    to_entries | 
    .[] | 
    "\(.key)=\(.value // "")"' "$JSON_FILE")

  # Check if env_vars is empty, indicating either the group or env section might be missing
  if [ -z "$env_vars" ]; then
    echo "Spec group $RUN_GROUP_NAME not found or has no environment variables in spec_groups.json."
  fi

  # Export each environment variable
  while IFS= read -r line; do
    export "$line"
  done <<< "$env_vars"

  # Print the values to verify (optional)
  echo "Environment variables for $RUN_GROUP_NAME have been set:"
  while IFS= read -r line; do
    echo "$line"
  done <<< "$env_vars"
}

cd $ROOT
if [ ! -d "node_modules" ]; then
  npm install
fi

if [ "$USE_VCAST_24" = "True" ] ; then
  activate_24_release
fi

if [ "$GITHUB_ACTIONS" = "true" ] ; then
  source /home/vcast_user/.bashrc
fi
if [ "$GITHUB_ACTIONS" = "true" ] || [ "$TESTING_IN_CONTAINER" = "True" ] ; then
    if [ "$(pidof /usr/bin/Xvfb)" == "" ]; then
        echo "Starting xvfb..."
        Xvfb :99 -screen 0 1920x1080x24 &
    fi
    set_specs_params
    xvfb-run --server-num=99 --auto-servernum --server-args="-screen 0 1920x1080x24+32" npx wdio run test/wdio.conf.ts | tee output.txt
    if [ "$GITHUB_ACTIONS" = "true" ] ; then
      if [ -f output.txt ] ; then
        export LANG="C.UTF-8"
        python3 get_e2e_summary_for_gh_actions.py output.txt
        failed_tests=$(sed -n 's/.*Spec Files:.* \([0-9]\+\) failed,.*/\1/p' output.txt)
        for failed in $failed_tests; do
            if [[ $failed -ne 0 ]]; then
                exit 1
            fi
        done
      else
        echo "output.txt not found"
        exit 1
      fi
    fi
else
    set_specs_params
    npx wdio run test/wdio.conf.ts
fi