@echo off
REM Starts the ClickForest dashboard. Trains the model first if it has not been trained yet.
cd /d "%~dp0"
if not exist artifacts\model.joblib (
    echo Training model, this takes about a minute...
    python -m ml.train || goto :error
)
echo.
echo Dashboard running at http://127.0.0.1:5000  (press Ctrl+C to stop)
start "" http://127.0.0.1:5000
python app\app.py
goto :eof

:error
echo Training failed. Run: pip install -r requirements.txt
pause
