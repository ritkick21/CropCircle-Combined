param(
  [string]$Distro = 'Ubuntu'
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$windowsPath = $projectRoot.Replace('\', '/')
$linuxPath = (& wsl -d $Distro -u root -- wslpath -a $windowsPath).Trim()
if ($LASTEXITCODE -ne 0 -or -not $linuxPath) { throw 'Could not locate the workspace in WSL.' }

$stagePath = '/tmp/cropcircle-stage2-' + (Get-Date -Format 'yyyyMMddHHmmss')
$startEngine = 'docker info >/dev/null 2>&1 || (nohup dockerd >/tmp/cropcircle-dockerd.log 2>&1 </dev/null & sleep 5); docker info >/dev/null 2>&1'
& wsl -d $Distro -u root -- sh -lc $startEngine
if ($LASTEXITCODE -ne 0) { throw 'Docker Engine did not start in WSL.' }

# A native WSL build context avoids very slow Docker context transfer from /mnt/c.
$syncAndStart = "mkdir -p '$stagePath' && cd '$linuxPath' && tar --exclude=./node_modules --exclude=*/node_modules --exclude=./.git --exclude=*/.venv --exclude=*/dist --exclude=*/.next --exclude=*/__pycache__ --exclude=*/.pytest_cache --exclude=*.egg-info -cf - . | tar -xf - -C '$stagePath' && cd '$stagePath' && docker compose up --build -d --wait"
& wsl -d $Distro -u root -- sh -lc $syncAndStart
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose failed to start the stack.' }

Push-Location $projectRoot
try {
  node infra/scripts/smoke.mjs
  if ($LASTEXITCODE -ne 0) { throw 'HTTP smoke check failed.' }
  node infra/scripts/socket-smoke.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Socket.IO smoke check failed.' }
} finally {
  Pop-Location
}
