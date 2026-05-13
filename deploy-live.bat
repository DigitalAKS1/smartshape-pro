@echo off
echo.
echo ==========================================
echo   SmartShape Pro — Deploy to Live
echo ==========================================
echo.
echo This will deploy all changes to http://187.127.167.10
echo Enter your VPS password when prompted.
echo.
echo [~5-8 minutes to complete]
echo.
ssh root@187.127.167.10 "cd /var/www/smartshape && git pull origin main && docker compose -f docker-compose.prod.yml down --remove-orphans ; REACT_APP_BACKEND_URL=http://187.127.167.10 docker compose -f docker-compose.prod.yml up -d --build && sleep 15 && curl -s http://localhost:8000/api/health && echo Backend OK && docker compose -f docker-compose.prod.yml ps"
echo.
echo ==========================================
echo   LIVE at: http://187.127.167.10
echo ==========================================
pause
