@echo off
echo Starting Backend Server...
cd backend
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8888
pause


