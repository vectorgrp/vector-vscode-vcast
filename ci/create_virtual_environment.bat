@echo off
setlocal

cd c:\r2t
python -m venv venv
source venv\Scripts\activate
pip install --no-cache --upgrade pip
pip install --no-cache --editable .
deactivate

endlocal