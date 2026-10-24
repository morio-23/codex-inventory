param()
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$repo=Split-Path $PSScriptRoot -Parent
$assetBase=Join-Path $repo 'dist\win-unpacked\resources\inventory\public'
$resources=@('index.html','styles.css','app.js','split-pane.js')
$missing=@($resources | Where-Object {
    -not (Test-Path -LiteralPath (Join-Path $assetBase $_) -PathType Leaf)
})
if ($missing.Count -gt 0) {
    Write-Host 'PACKAGED_ASSETS_MISSING'
    exit 2
}
Write-Host 'PACKAGED_ASSETS_FOUND'

$settingsPath=Join-Path $env:APPDATA 'codex-inventory-desktop\settings.json'
if (-not (Test-Path -LiteralPath $settingsPath -PathType Leaf)) {
    Write-Host 'LOCAL_SERVER_SETTINGS_NOT_FOUND'
    exit 2
}
try {
    $settings=Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $port=[int]$settings.httpPort
    if ($port -lt 1 -or $port -gt 65535) { throw 'Invalid port' }
} catch {
    Write-Host 'LOCAL_SERVER_PORT_UNAVAILABLE'
    exit 2
}

$routes=@(
  [pscustomobject]@{Name='HTML';Path='/';Needle='<main class="shell">'},
  [pscustomobject]@{Name='CSS';Path='/styles.css';Needle='.shell'},
  [pscustomobject]@{Name='JS';Path='/app.js';Needle='SplitPane'}
)
foreach ($route in $routes) {
  try {
    $response=Invoke-WebRequest -Uri ('http://127.0.0.1:'+$port+$route.Path) -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -ne 200 -or
        -not ([string]$response.Content).Contains($route.Needle)) {
      Write-Host ('LOCAL_'+$route.Name+'_BAD_RESPONSE')
      exit 2
    }
    Write-Host ('LOCAL_'+$route.Name+'_OK')
  } catch {
    Write-Host ('LOCAL_'+$route.Name+'_UNREACHABLE_OR_INVALID')
    exit 2
  }
}
Write-Host 'HTTP_UI_OK: static HTML/CSS/JS were served. Renderer or GPU issue remains possible.'
