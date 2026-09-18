@echo off
cd /d "%~dp0"
if not exist .git (
    git init
    git remote add origin https://github.com/Aylwin-05/Nexara.git
    git branch -M main
)
git add -A
git commit -m "chore: auto save"
git push