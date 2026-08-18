param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 7777
)

$ErrorActionPreference = "Stop"
$bridgeDirectory = $PSScriptRoot
$projectDirectory = Split-Path -Parent $bridgeDirectory
$tokenFile = Join-Path $bridgeDirectory ".codex-bridge-token"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "未找到 Node.js 18+。请先安装 Node.js，再启动本机桥接。"
}

if (Test-Path -LiteralPath $tokenFile) {
  $token = (Get-Content -LiteralPath $tokenFile -Raw).Trim()
} else {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  $token = [Convert]::ToHexString($bytes).ToLowerInvariant()
  Set-Content -LiteralPath $tokenFile -Value $token -NoNewline -Encoding utf8
}

$env:VW_CODEX_BRIDGE_TOKEN = $token
$env:VW_CODEX_BRIDGE_PORT = [string]$Port

Write-Host ""
Write-Host "pixel-blue Workspace Codex 本机桥接"
Write-Host "地址：http://127.0.0.1:$Port"
Write-Host "桥接令牌已保存在本地忽略文件中，不会打印到终端。"
Write-Host "请把令牌粘贴到 Obsidian → pixel-blue Workspace → 桥接令牌。"
Write-Host "关闭此窗口即可停止桥接。"
Write-Host ""

Push-Location $projectDirectory
try {
  & node (Join-Path $bridgeDirectory "codex-bridge.mjs")
} finally {
  Pop-Location
}
