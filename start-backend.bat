@echo off
cd /d "f:\SMARTSHAPE APP\backend"
:loop
echo Starting backend...
python -m uvicorn main:app --host 0.0.0.0 --port 8000
echo Backend stopped. Restarting in 3 seconds...
timeout /t 3 /nobreak
goto loop
