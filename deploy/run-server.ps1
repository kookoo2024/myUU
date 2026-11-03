[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ExePath,
  [Parameter(Mandatory = $true)]
  [string]$DataDir,
  [string]$Address = ':8787'
)

$ErrorActionPreference = 'Stop'
$exe = [IO.Path]::GetFullPath($ExePath)
$data = [IO.Path]::GetFullPath($DataDir)
$logDir = Join-Path $data 'logs'

New-Item -ItemType Directory -Path $data -Force | Out-Null
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$env:XYZ_ADDR = $Address
$env:XYZ_DATA_DIR = $data

$cutoff = (Get-Date).AddDays(-14)
Get-ChildItem -LiteralPath $logDir -Filter 'server-*.log' -File -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -lt $cutoff } |
  Remove-Item -Force -ErrorAction SilentlyContinue

while ($true) {
  $logPath = Join-Path $logDir ("server-{0}.log" -f (Get-Date -Format 'yyyyMMdd'))
  try {
    & $exe 2>&1 | ForEach-Object {
      $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $_
      Add-Content -LiteralPath $logPath -Value $line -Encoding utf8
    }
  } catch {
    $line = "[{0}] 服务启动失败：{1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $_
    Add-Content -LiteralPath $logPath -Value $line -Encoding utf8
  }

  $line = "[{0}] 服务进程已退出，5 秒后重启。" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
  Add-Content -LiteralPath $logPath -Value $line -Encoding utf8
  Start-Sleep -Seconds 5
}
