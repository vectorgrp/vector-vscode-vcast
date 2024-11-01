#!/bin/bash
ROOT=$(dirname "$(realpath "$0")")

VCAST_24_REFERENCE_DATE=$(date -d "04/03/24" +%Y%m%d)  # This is the release date for vcast 2024sp1

THIS_RELEASE_DATE_STR=$(grep -oP '\(\K[^)]+' "$VECTORCAST_DIR/DATA/tool_version.txt")
THIS_RELEASE_DATE=$(date -d "$THIS_RELEASE_DATE_STR" +%Y%m%d)

if [[ $THIS_RELEASE_DATE -lt $VCAST_24_REFERENCE_DATE ]]; then
    echo "This VectorCAST release does not support clicast server."
    exit 0
fi

export PYTHONPATH=$(realpath $ROOT/../../python)
$VECTORCAST_DIR/vpython $ROOT/../../python/vcastDataServer.py &
SERVER_PID=$!

echo "Waiting for the Flask server to start..."
max_retries=10
retry_count=0
while true; do
    if [[ $retry_count -ge $max_retries ]]; then
        echo "Failed to get server port."
        kill $SERVER_PID
        exit 1
    fi
    if [[ -f "vcastDataServer.log" ]]; then
        SERVER_PORT=$(grep "vcastDataServer" vcastDataServer.log | sed -n 's/.*port: \([0-9]*\).*/\1/p')
        if [[ -n "$SERVER_PORT" ]]; then
            echo "Port number found: $SERVER_PORT"
            break
        fi
    fi
    retry_count=$((retry_count+1))
    sleep 1
done


health_check_url="http://127.0.0.1:$SERVER_PORT"
max_retries=10
retry_count=0
echo "Waiting for the Flask server to start..."
while ! curl -s $health_check_url > /dev/null; do
    if [[ $retry_count -ge $max_retries ]]; then
        echo "Flask server failed to start."
        kill $SERVER_PID
        exit 1
    fi
    retry_count=$((retry_count+1))
    sleep 1
done

$VECTORCAST_DIR/vpython $ROOT/client.py --port=$SERVER_PORT --test=full

kill $SERVER_PID
