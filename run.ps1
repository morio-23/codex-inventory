param(
  [string]$Workspace,
  [switch]$Demo
)
$ErrorActionPreference = 'Stop'
if ($PSBoundParameters.ContainsKey('Workspace') -and -not [string]::IsNullOrWhiteSpace($Workspace)) {
  $resolvedWorkspace = (Resolve-Path -LiteralPath $Workspace -ErrorAction Stop).Path
  $env:CODEX_WORKSPACE = $resolvedWorkspace
  Write-Host ('Fixed project: ' + $resolvedWorkspace)
} else {
  Remove-Item Env:CODEX_WORKSPACE -ErrorAction SilentlyContinue
  Write-Host 'Projects: auto-detect from Codex App Server chat history'
}
if ($Demo) {
  $env:CODEX_DEMO = '1'
} else {
  Remove-Item Env:CODEX_DEMO -ErrorAction SilentlyContinue
  $codex = Get-Command codex -ErrorAction SilentlyContinue
  if (-not $codex) {
    throw 'Codex CLIが見つかりません。npm install -g @openai/codex でインストールし、codex login を実行してください。'
  }
}
Set-Location $PSScriptRoot
Write-Host 'Codex Inventory: http://127.0.0.1:8765'
node server.mjs
