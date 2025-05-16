cd c:\r2t
curl -o TUTORIAL_C.zip https://rds-vtc-docker-dev-local.vegistry.vg.vector.int/artifactory/rds-build-packages-generic-dev/code2reqs2tests/demo-data/TUTORIAL_C.zip
powershell -Command "Expand-Archive -Path TUTORIAL_C.zip -DestinationPath ."
del TUTORIAL_C.zip
set USE_CLICAST_SERVER=0
"%RELEASE_DIR%\reqs2tests" "TUTORIAL_C\TUTORIAL_C.env" "TUTORIAL_C\reqs.xlsx" --batched --no-requirement-keys --export-tst out.tst
