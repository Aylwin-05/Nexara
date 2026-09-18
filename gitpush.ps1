Set-Location $PSScriptRoot

if (-not (Test-Path .git)) {
    git init
    git remote add origin https://github.com/Aylwin-05/Nexara.git
    git branch -M main
}

git add -A
$msg = if ($args) { $args -join ' ' } else { "Update " + (Get-Date -Format 'yyyy-MM-dd HH:mm') }

if (git diff --cached --quiet) {
    Write-Host "Nothing to commit."
} else {
    git commit -m $msg
}

git push -u origin main