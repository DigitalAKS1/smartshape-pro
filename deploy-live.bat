@echo off
echo.
echo ==========================================
echo   SmartShape Pro - Deploy to Live
echo ==========================================
echo.
echo This rebuilds backend + frontend on the VPS and goes live at
echo https://app.smartshape.in
echo Enter your VPS password when prompted.
echo.
echo [~5-10 minutes to complete]
echo.
ssh root@srv1667373.hstgr.cloud "cd /var/www/smartshape && git fetch origin main && git reset --hard origin/main && REACT_APP_BACKEND_URL=https://app.smartshape.in docker compose -f docker-compose.prod.yml build --no-cache backend frontend && REACT_APP_BACKEND_URL=https://app.smartshape.in docker compose -f docker-compose.prod.yml up -d backend frontend && sleep 12 && curl -s http://localhost:8000/api/health && echo. && docker compose -f docker-compose.prod.yml ps"
echo.
echo ==========================================
echo   LIVE at: https://app.smartshape.in
echo ==========================================
pause
