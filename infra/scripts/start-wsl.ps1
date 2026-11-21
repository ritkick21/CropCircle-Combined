param(
  [string]$Distro = 'Ubuntu'
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$windowsPath = $projectRoot.Replace('\', '/')
$linuxPath = (& wsl -d $Distro -u root -- wslpath -a $windowsPath).Trim()
if ($LASTEXITCODE -ne 0 -or -not $linuxPath) { throw 'Could not locate the workspace in WSL.' }

$stagePath = '/tmp/cropcircle-combined-' + (Get-Date -Format 'yyyyMMddHHmmss')
$startEngine = 'docker info >/dev/null 2>&1 || (nohup dockerd >/tmp/cropcircle-dockerd.log 2>&1 </dev/null & sleep 5); docker info >/dev/null 2>&1'
& wsl -d $Distro -u root -- sh -lc $startEngine
if ($LASTEXITCODE -ne 0) { throw 'Docker Engine did not start in WSL.' }

# A native WSL build context avoids very slow Docker context transfer from /mnt/c.
$syncAndStart = "mkdir -p '$stagePath' && cd '$linuxPath' && tar --exclude=./node_modules --exclude=*/node_modules --exclude=./.git --exclude=*/.venv --exclude=*/dist --exclude=*/.next --exclude=*/__pycache__ --exclude=*/.pytest_cache --exclude=*.egg-info -cf - . | tar -xf - -C '$stagePath' && cd '$stagePath' && docker compose up --build -d --wait"
& wsl -d $Distro -u root -- sh -lc $syncAndStart
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose failed to start the stack.' }

function Get-DemoPort([string]$Service, [int]$InternalPort) {
  $binding = (& wsl -d $Distro -u root -- sh -lc "cd '$stagePath' && docker compose port $Service $InternalPort") -join ""
  if ($LASTEXITCODE -ne 0 -or $binding.Trim() -notmatch ":(\d+)$") { throw "Could not find the port for $Service." }
  return $Matches[1]
}

$webPort = Get-DemoPort web 3000
$apiPort = Get-DemoPort api 3001
$mlPort = Get-DemoPort ml-service 8000
$env:WEB_HEALTH_URL = "http://localhost:${webPort}/api/health"
$env:API_HEALTH_URL = "http://localhost:${apiPort}/api/v1/health/ready"
$env:ML_HEALTH_URL = "http://localhost:${mlPort}/health/ready"
$env:SOCKET_URL = "ws://localhost:${apiPort}/realtime/?EIO=4&transport=websocket"

Push-Location $projectRoot
try {
  node infra/scripts/smoke.mjs
  if ($LASTEXITCODE -ne 0) { throw 'HTTP smoke check failed.' }
  node infra/scripts/socket-smoke.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Socket.IO smoke check failed.' }
} finally {
  Pop-Location
}
