#!/bin/sh
ROOT=$(dirname "$(realpath "$0")")

activate_24_release () {
  export VECTORCAST_DIR=/home/vcast_user/software/vcast/release24
  export PATH=/home/vcast_user/software/vcast/release24:$PATH
  export ENABLE_ATG_FEATURE=TRUE
  echo "Vcast 24 is activated"
}

cd $ROOT
if [ ! -d "node_modules" ]; then
  npm install
fi

if [ "$USE_VCAST_24" = "True" ] ; then
  activate_24_release
fi

if [ "$GITHUB_ACTIONS" = "true" ] || [ "$TESTING_IN_CONTAINER" = "True" ] ; then
    if [ "$GITHUB_ACTIONS" = "true" ] ; then
      source /home/vcast_user/.bashrc
    fi
    if [ "$(pidof /usr/bin/Xvfb)" == "" ]; then
        echo "Starting xvfb..."
        Xvfb :99 -screen 0 1920x1080x24 &
    fi
    xvfb-run --server-num=99 --auto-servernum --server-args="-screen 0 1920x1080x24+32" npx wdio run test/wdio.conf.ts | tee output.txt
    if [ "$GITHUB_ACTIONS" = "true" ] && [ -f output.txt ] ; then
      export LANG="C.UTF-8"
      python get_e2e_summary_for_gh_actions.py output.txt
    fi
else
    npx wdio run test/wdio.conf.ts
fi
