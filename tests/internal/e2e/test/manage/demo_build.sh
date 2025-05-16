#!/bin/bash

set -e

# Variables
mp="Test"
ts="BlackBox"
ts2="WhiteBox"
comp="GNU_Native_Automatic_C++"
tmp="input"

# Create and navigate to temporary directory
mkdir -p "${tmp}"
cd "${tmp}"

# Run clicast template command
"${VECTORCAST_DIR}/clicast" -lc template GNU_CPP_X
"${VECTORCAST_DIR}/clicast" -lc option VCAST_CODED_TESTS_SUPPORT TRUE

# Create environment files, CPP files, and header files in a loop for QUACK, FOO, and BAR
for env in QUACK FOO BAR; do
    lower_env=$(echo "$env" | tr '[:upper:]' '[:lower:]')  # Convert to lowercase for filenames and function names

    # Create the environment file
    cat > "${env}.env" << EOF
ENVIRO.NEW
ENVIRO.NAME:${env}
ENVIRO.STUB_BY_FUNCTION:${lower_env}
ENVIRO.MAX_VARY_RANGE: 20
ENVIRO.STUB: ALL_BY_PROTOTYPE
ENVIRO.TYPE_HANDLED_DIRS_ALLOWED:
ENVIRO.LIBRARY_STUBS:
ENVIRO.SEARCH_LIST: $(readlink -f .)
ENVIRO.END
EOF

    # Create the .h file with function prototype
    cat > "${lower_env}.h" << EOF
#ifndef ${env}_H
#define ${env}_H

int ${lower_env} (int param);

#endif
EOF

    # Create the .cpp file implementing the function
    cat > "${lower_env}.cpp" << EOF
#include "${lower_env}.h"

int ${lower_env} (int param) {
    return param;
}
EOF

done

# Return to parent directory
cd ..

# Create project and configure environment
"${VECTORCAST_DIR}/manage" --project="${mp}" --create
"${VECTORCAST_DIR}/manage" --project="${mp}" --cfg-to-compiler="${tmp}/CCAST_.CFG"

# Create testsuite ts1 and import environments into it
"${VECTORCAST_DIR}/manage" --project="${mp}" --compiler="${comp}" --testsuite="${ts}" --create
for env in QUACK FOO BAR; do
    "${VECTORCAST_DIR}/manage" --project="${mp}" --level="${comp}/${ts}" --import "$(readlink -f "${tmp}/${env}.env")" --force --migrate
done

# Create testsuite ts2
"${VECTORCAST_DIR}/manage" --project="${mp}" --compiler="${comp}" --testsuite="${ts2}" --create

# Add each environment to testsuite ts2, specifying ts1 as the parent
for env in QUACK FOO BAR; do
    "${VECTORCAST_DIR}/manage" --project="${mp}" --level="${comp}/${ts2}" --add="${env}"
done

