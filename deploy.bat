@echo off
cd /d "F:\SMARTSHAPE APP"

echo.
echo ==========================================
echo   SmartShape Pro — Deploy to Live
echo ==========================================
echo.

:: Ask for commit message
set /p MSG="What did you change? (brief description): "
if "%MSG%"=="" set MSG=update

:: Stage and push
echo.
echo [1/3] Pushing to GitHub...
git add -A
git commit -m "%MSG%"
git push
if errorlevel 1 (
  echo.
  echo ERROR: Git push failed. Check your internet connection.
  pause
  exit /b 1
)
echo       Done.

:: Deploy on VPS
echo.
echo [2/3] Deploying to VPS (this takes 4-6 minutes)...
ssh root@187.127.167.10 "cd /var/www/smartshape && git pull origin main && REACT_APP_BACKEND_URL=http://187.127.167.10 docker compose -f docker-compose.prod.yml up -d --build"
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
echo   LIVE at: http://187.127.167.10
echo ==========================================
echo.
pause
