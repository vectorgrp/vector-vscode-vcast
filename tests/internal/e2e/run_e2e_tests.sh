#!/bin/bash
ROOT=$(dirname "$(realpath "$0")")

activate_24_release () {
  export VECTORCAST_DIR=/vcast/release24
  export PATH=/vcast/release24:$PATH
  export ENABLE_ATG_FEATURE=TRUE
  echo "Vcast 24 is activated"
}

cd $ROOT
n 18
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
fi