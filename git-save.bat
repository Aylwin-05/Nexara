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
if errorlevel 1 (
    echo.
    echo *** COMMIT FAILED - NOTHING WAS PUSHED ***
    pause
    exit /b 1
)
git pull --rebase origin main
if errorlevel 1 (
    echo.
    echo *** PULL FAILED - resolve the conflict, then run "git push origin main" ***
    pause
    exit /b 1
)
git push -u origin main
if errorlevel 1 (
    echo.
    echo *** PUSH FAILED - your commit is saved locally but NOT on GitHub ***
    echo *** Fix it, then run "git push origin main" ***
    pause
    exit /b 1
)
echo.
echo Pushed successfully.
pause