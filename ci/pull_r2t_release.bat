cd c:\r2t
python ./ci/get_most_recent_reqs2tests_distribution.py

IF NOT EXIST "autoreq-win.tar.gz" (
    echo Error: autoreq-win.tar.gz not found.
    exit /b 1
)
tar -xf autoreq-win.tar.gz
del *.tar.gz
