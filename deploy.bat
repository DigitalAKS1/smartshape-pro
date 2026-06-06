@echo off
cd /d "F:\SMARTSHAPE APP"

echo.
echo ==========================================
echo   SmartShape Pro - Commit, Push and Deploy
echo ==========================================
echo.

:: Ask for commit message
set /p MSG="What did you change? (brief description): "
if "%MSG%"=="" set MSG=update

:: Stage and push
echo.
echo [1/3] Pushing to GitHub (main)...
git add -A
git commit -m "%MSG%"
git push origin main
if errorlevel 1 (
  echo.
  echo ERROR: Git push failed. Check your internet connection.
  pause
  exit /b 1
)
echo       Done.

:: Deploy on VPS (rebuild backend + frontend; never touches DB / WhatsApp stack)
echo.
echo [2/3] Deploying to VPS (this takes 5-10 minutes)...
ssh root@srv1667373.hstgr.cloud "cd /var/www/smartshape && git fetch origin main && git reset --hard origin/main && REACT_APP_BACKEND_URL=https://app.smartshape.in docker compose -f docker-compose.prod.yml build --no-cache backend frontend && REACT_APP_BACKEND_URL=https://app.smartshape.in docker compose -f docker-compose.prod.yml up -d backend frontend"
if errorlevel 1 (
  echo.
  echo ERROR: VPS deploy failed. Check SSH connection.
  pause
  exit /b 1
)

echo.
echo [3/3] Done!
echo.
echo ==========================================
echo   LIVE at: https://app.smartshape.in
echo ==========================================
echo.
pause
