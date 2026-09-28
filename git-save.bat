@echo off
cd /d "%~dp0"
if not exist .git (
    git init
    git remote add origin https://github.com/Aylwin-05/Nexara.git
    git branch -M main
)
git add -A
git diff --cached --quiet
if not errorlevel 1 (
    echo Nothing to commit.
    pause
    exit /b 0
)
echo.
echo --- Staged changes ---
git status --short
echo ---------------------
set /p choice=Commit and push these changes? [y/n]: 
if /i not "%choice%"=="y" (
    echo Cancelled - nothing was pushed.
    pause
    exit /b 1
)
git commit -m "chore: auto save"
git push -u origin main
pause