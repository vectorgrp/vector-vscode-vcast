#!/bin/bash
ROOT=$(dirname "$(realpath "$0")")

# Get the directory of the current script
SCRIPT_DIR=$(dirname "$0")

# Define the path to the specs file relative to the script directory
SPEC_PATH="$SCRIPT_DIR/test/specs_env_exporter.ts"


# Check if the specs file exists
if [ ! -f "$SPEC_PATH" ]; then
  echo "The file $SPEC_PATH does not exist."
  exit 1
fi

# Compile the specs file 
npx tsc "$SPEC_PATH"

# Path to the compiled JavaScript files
JS_FILE="./test/specs_env_exporter.js"
SPECS_CONFIG_FILE="./test/specs_config.js"

set_specs_params() {
  # Check if RUN_GROUP_NAME is set
  if [ -z "$RUN_GROUP_NAME" ]; then
    echo "RUN_GROUP_NAME is not set. Please set it and try again."
    exit 1
  fi

  #Check if the compiled JavaScript file exists
  if [ ! -f "$JS_FILE" ]; then
    echo "Compiled specs_env_exporter.js file not found!"
    exit 1
  fi

  #Check if the compiled JavaScript file exists
  if [ ! -f "$SPECS_CONFIG_FILE" ]; then
    echo "Compiled specs_config.js file not found!"
    exit 1
  fi

  # Extract environment variables for the given group using the compiled JavaScript file
  env_vars=$(node $JS_FILE)

  # Check if env_vars is empty, indicating either the group or env section might be missing

  # Export every env from the group
  for env_var_val in $env_vars; do
    export "$env_var_val"
  done

  # Print the values to verify exported env variables
  echo "Environment variables for $RUN_GROUP_NAME have been set:"
  while IFS= read -r line; do
    echo "$line"
  done <<< "$env_vars"

}


cd $ROOT
if [ ! -d "node_modules" ]; then
  npm install
fi

if [ "$GITHUB_ACTIONS" = "true" ] ; then
  source /home/vcast_user/.bashrc
fi
set_specs_params
if [ "$GITHUB_ACTIONS" = "true" ] || [ "$TESTING_IN_CONTAINER" = "True" ] ; then
    if [ "$(pidof /usr/bin/Xvfb)" == "" ]; then
        echo "Starting xvfb..."
        Xvfb :99 -screen 0 1920x1080x24 &
    fi
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
    npx wdio run test/wdio.conf.ts
    rm "$JS_FILE" 
    rm "$SPECS_CONFIG_FILE"
fi