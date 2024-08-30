

REM Get the directory of the current script
for %%I in ("%~dp0") do set SCRIPT_DIR=%%~fI

REM Define the path to the specs file relative to the script directory
set SPEC_PATH="%SCRIPT_DIR%test\specs_env_exporter.ts"

REM Check if the specs file exists
if not exist %SPEC_PATH% (
  echo The file %SPEC_PATH% does not exist.
  exit /b 1
)

REM Compile the specs file 
call npx tsc %SPEC_PATH%

REM Path to the compiled JavaScript files
set JS_FILE=./test/specs_env_exporter.js
set SPECS_CONFIG_FILE=./test/specs_config.js
set OLD_PATH=%PATH%

cd /d "%SCRIPT_DIR%"
if not exist "node_modules" (
  call npm install
)

if "%USE_VCAST_24%"=="True" (
  call :activate_24_release
)

call :set_specs_params
setlocal enabledelayedexpansion
if "%RUN_GROUP_NAME%" == "ALL" (
  for %%a in (%ALL_GROUP_NAMES%) do (
    echo Running %%a
    set RUN_GROUP_NAME=%%a
    
    for /f "delims=" %%i in ('node %JS_FILE% env_vars') do (
      set %%i
      echo %%i
    )
    
    npx wdio run test/wdio.conf.ts
    
    if %ERRORLEVEL% NEQ 0 (
      echo Error occurred, stopping the script.
      exit /B 1
    )
    set "PATH=%OLD_PATH%"
  )
) else (
  npx wdio run test/wdio.conf.ts
)

echo Done calling wdio
set "PATH=%OLD_PATH%"
del "%JS_FILE%" 
del "%SPECS_CONFIG_FILE%"
:end


:set_specs_params
  REM Check if RUN_GROUP_NAME is set
  if not defined RUN_GROUP_NAME (
    echo RUN_GROUP_NAME is not set. Please set it and try again.
    exit /b 1
  )
 

  REM Check if the compiled JavaScript file exists
  if not exist "%JS_FILE%" (
    echo Compiled specs_env_exporter.js file not found!
    exit /b 1
  )

  REM Check if the compiled JavaScript file exists
  if not exist "%SPECS_CONFIG_FILE%" (
    echo Compiled specs_config.js file not found!
    exit /b 1
  )

  if "%RUN_GROUP_NAME%" == "ALL" (
    echo Getting group names
    set ALL_GROUP_NAMES=
    for /f "delims=" %%i in ('node %JS_FILE% group_names') do (
      set ALL_GROUP_NAMES=%%i,%ALL_GROUP_NAMES%
    )
    echo finished setting group names
    echo %ALL_GROUP_NAMES%
  ) else (
    REM Extract environment variables for the given group using the compiled JavaScript file
    echo Extract environment variables for the given group using the compiled JavaScript file
    for /f "delims=" %%i in ('node %JS_FILE% env_vars') do (
      set %%i
      echo %%i
    )
  )
  exit /b 0
  
:activate_24_release
  if not exist "%VECTORCAST_DIR%" (
    set VECTORCAST_DIR=D:\\Programs\\VectorCAST\\vc24\\release
  )
  set PATH=%VECTORCAST_DIR%;%PATH%
  set ENABLE_ATG_FEATURE=TRUE
  echo Vcast 24 is activated
  exit /b 0

:end
