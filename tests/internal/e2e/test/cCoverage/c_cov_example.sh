#!/bin/sh -ex

# Always start with a clean working directory
rm -fr work
mkdir work
cd work
export WORK_DIRECTORY=$PWD
# export VECTORCAST_DIR=/home/JOBDATA/VectorCAST/vc20__86806_vcwrap__87490_inst_mod/deliver/linux64/debug

# Download lua 5.3.5 for instrumentation
time wget https://www.lua.org/ftp/lua-5.4.0.tar.gz
time tar -zxvf lua-5.4.0.tar.gz


# Configuration VectorCAST, including the compiler
$VECTORCAST_DIR/clicast template GNU_CPP11_X
$VECTORCAST_DIR/clicast option VCAST_COVERAGE_FOR_HEADERS TRUE
$VECTORCAST_DIR/clicast option VCAST_COVERAGE_FOR_AGGREGATE_INIT TRUE


# Create the cover environment 
time $VECTORCAST_DIR/clicast cover environment script_run ../env.enc


$VECTORCAST_DIR/clicast -e env cover env disable_instrumentation


# These commands will be put into a single clicast build command

    # Single step instrument and build
    cd lua-5.4.0/src

    # The command that instruments and builds
    time make generic -j16 -B

    # Add the instrumentation data into the cover environment
    cd $WORK_DIRECTORY

# Run the tests
mkdir lua_tests
cd lua_tests
time wget https://www.lua.org/tests/lua-5.4.0-tests.tar.gz
time tar -zxvf lua-5.4.0-tests.tar.gz
cd lua-5.4.0-tests
set +e
../../lua-5.4.0/src/lua all.lua
mv TESTINSS.DAT TESTINSS.DAT.all.lua
../../lua-5.4.0/src/lua api.lua
mv TESTINSS.DAT TESTINSS.DAT.api.lua
set -e

# Add the test suite result to the cover environment
cd $WORK_DIRECTORY
time $VECTORCAST_DIR/clicast -e env cover result add lua_tests/lua-5.4.0-tests/TESTINSS.DAT.all.lua all.lua
time $VECTORCAST_DIR/clicast -e env cover result add lua_tests/lua-5.4.0-tests/TESTINSS.DAT.api.lua api.lua