#!/bin/sh
ROOT=$(dirname "$(realpath "$0")")

activate_24_release () {
  export VECTORCAST_DIR=/home/vcast_user/software/vcast/release24
  export PATH=/home/vcast_user/software/vcast/release24:$PATH
  export ENABLE_ATG_FEATURE=TRUE
  echo "Vcast 24 is activated"
}

set_forward_proxy () {
  echo "Setting forward proxy..."

  sudo /usr/sbin/squid

  NEW_PROXY="http://$(hostname --ip-address):3128"
  export HTTP_PROXY=$NEW_PROXY HTTPS_PROXY=$NEW_PROXY http_proxy=$NEW_PROXY https_proxy=$NEW_PROXY GLOBAL_AGENT_HTTP_PROXY=$NEW_PROXY GLOBAL_AGENT_HTTP_PROXY=$NEW_PROXY
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
    set_forward_proxy
    if [ "$(pidof /usr/bin/Xvfb)" == "" ]; then
        echo "Starting xvfb..."
        Xvfb :99 -screen 0 1920x1080x24 &
    fi
    xvfb-run --server-num=99 --auto-servernum --server-args="-screen 0 1920x1080x24+32" npx wdio run test/wdio.conf.ts | tee output.txt
    if [ "$GITHUB_ACTIONS" = "true" ] && [ -f output.txt ] ; then
        {
          echo '```'
          sed -n '/"spec" Reporter:/,$p' output.txt
          echo '```'
        } > gh_output.txt
    fi
else
    npx wdio run test/wdio.conf.ts
fi
