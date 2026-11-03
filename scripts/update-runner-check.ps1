[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$applyScript = Join-Path $root 'deploy\apply-update.ps1'
$runnerScript = Join-Path $root 'deploy\run-server.ps1'
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('xyz-update-check-' + [guid]::NewGuid().ToString('N'))
$exePath = Join-Path $tempRoot 'xyz-server.exe'
$updateDir = Join-Path $tempRoot 'updates'
$updateFileName = 'xyz-server-9.9.9.exe'
$updatePath = Join-Path $updateDir $updateFileName
$utf8 = New-Object System.Text.UTF8Encoding($false)
$runnerRoot = $null
$runnerProcess = $null

function Write-TestJson {
  param([string]$Path, [object]$Value)
  [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 8), $utf8)
}

function Get-Sha256Hex {
  param([string]$Path)
  $stream = [IO.File]::OpenRead($Path)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = $algorithm.ComputeHash($stream)
    return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
  } finally {
    $algorithm.Dispose()
    $stream.Dispose()
  }
}

function Test-RunnerStartup {
  $script:runnerRoot = Join-Path ([IO.Path]::GetTempPath()) ('xyz-runner-check-' + [guid]::NewGuid().ToString('N'))
  $runnerExe = Join-Path $script:runnerRoot 'xyz-server.exe'
  $runnerData = Join-Path $script:runnerRoot 'data'
  $port = 8799
  New-Item -ItemType Directory -Path $script:runnerRoot -Force | Out-Null

  Push-Location $root
  try {
    & go build -trimpath -o $runnerExe ./server
    if ($LASTEXITCODE -ne 0) {
      throw "构建守护脚本测试程序失败：go build 退出码 $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }

  $runnerArguments = @(
    '-NoProfile'
    '-ExecutionPolicy Bypass'
    '-WindowStyle Hidden'
    '-File'
    "`"$runnerScript`""
    '-ExePath'
    "`"$runnerExe`""
    '-DataDir'
    "`"$runnerData`""
    '-Address'
    '127.0.0.1:8799'
    '-HealthTimeoutSeconds'
    '15'
    '-StabilitySeconds'
    '1'
  ) -join ' '

  $script:runnerProcess = Start-Process `
    -FilePath (Get-Command powershell.exe -ErrorAction Stop).Source `
    -ArgumentList $runnerArguments `
    -WindowStyle Hidden `
    -PassThru

  $healthUrl = "http://127.0.0.1:$port/api/health"
  $deadline = (Get-Date).AddSeconds(25)
  $healthy = $false
  while ((Get-Date) -lt $deadline) {
    try {
      $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
      if ($health.ok -eq $true) {
        $healthy = $true
        break
      }
    } catch {
      # The runner may still be starting the service.
    }
    Start-Sleep -Milliseconds 300
  }
  if (-not $healthy) {
    throw '守护脚本没有启动可用的服务进程'
  }

  $logPath = Join-Path $runnerData ('logs\server-{0}.log' -f (Get-Date -Format 'yyyyMMdd'))
  $logDeadline = (Get-Date).AddSeconds(8)
  do {
    $logText = if (Test-Path -LiteralPath $logPath -PathType Leaf) {
      Get-Content -LiteralPath $logPath -Raw -Encoding UTF8
    } else {
      ''
    }
    if ($logText -match '本机服务已启动并通过健康检查' -and $logText -match '\[APP\]') {
      return
    }
    Start-Sleep -Milliseconds 300
  } while ((Get-Date) -lt $logDeadline)

  throw '守护脚本没有正确记录服务启动日志'
}

try {
  New-Item -ItemType Directory -Path $updateDir -Force | Out-Null
  [IO.File]::WriteAllBytes($exePath, [Text.Encoding]::UTF8.GetBytes('old-version'))
  [IO.File]::WriteAllBytes($updatePath, [Text.Encoding]::UTF8.GetBytes('new-version'))
  $hash = Get-Sha256Hex -Path $updatePath
  $size = (Get-Item -LiteralPath $updatePath).Length

  Write-TestJson -Path (Join-Path $updateDir 'prepared-update.json') -Value ([pscustomobject]@{
    version = '9.9.9'
    fileName = $updateFileName
    sha256 = $hash
    size = $size
    fromVersion = '9.9.8'
    preparedAt = (Get-Date).ToUniversalTime().ToString('o')
  })
  Write-TestJson -Path (Join-Path $updateDir 'pending-update.json') -Value ([pscustomobject]@{
    version = '9.9.9'
    fileName = $updateFileName
    sha256 = $hash
    size = $size
    fromVersion = '9.9.8'
    preparedAt = (Get-Date).ToUniversalTime().ToString('o')
  })

  $applied = & $applyScript -ExePath $exePath -UpdateDir $updateDir | ConvertFrom-Json
  if (-not $applied.applied) {
    throw "更新替换失败：$($applied.error)"
  }
  if ((Get-Content -LiteralPath $exePath -Raw) -ne 'new-version') {
    throw '更新后目标程序内容不正确'
  }
  if (-not (Test-Path -LiteralPath $applied.rollbackExe -PathType Leaf)) {
    throw '没有生成旧版本回滚文件'
  }
  if ((Get-Content -LiteralPath $applied.rollbackExe -Raw) -ne 'old-version') {
    throw '回滚文件内容不正确'
  }
  if (Test-Path -LiteralPath (Join-Path $updateDir 'pending-update.json')) {
    throw '安装完成后仍残留待安装标记'
  }

  & $applyScript -ExePath $exePath -UpdateDir $updateDir -MarkSuccess | Out-Null
  $record = Get-Content -LiteralPath (Join-Path $updateDir 'last-update.json') -Raw | ConvertFrom-Json
  if ($record.status -ne 'success') {
    throw '更新成功状态没有写入'
  }
  if (Test-Path -LiteralPath (Join-Path $updateDir 'prepared-update.json')) {
    throw '更新成功后仍残留已下载标记'
  }

  $rolledBack = & $applyScript -ExePath $exePath -UpdateDir $updateDir -Rollback | ConvertFrom-Json
  if (-not $rolledBack.rolledBack) {
    throw '回滚没有成功执行'
  }
  if ((Get-Content -LiteralPath $exePath -Raw) -ne 'old-version') {
    throw '回滚后的程序内容不正确'
  }

  Test-RunnerStartup

  [pscustomobject]@{
    apply = 'passed'
    checksum = 'passed'
    rollbackCopy = 'passed'
    healthStatus = 'passed'
    rollback = 'passed'
    runnerStartup = 'passed'
  } | ConvertTo-Json
} finally {
  $runnerListener = Get-NetTCPConnection -LocalPort 8799 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($runnerListener) {
    $child = Get-Process -Id $runnerListener.OwningProcess -ErrorAction SilentlyContinue
    if ($child -and $runnerRoot -and $child.Path -like "$runnerRoot*") {
      Stop-Process -Id $child.Id -Force -ErrorAction SilentlyContinue
    }
  }
  if ($runnerProcess -and -not $runnerProcess.HasExited) {
    Stop-Process -Id $runnerProcess.Id -Force -ErrorAction SilentlyContinue
  }
  $resolvedTemp = [IO.Path]::GetFullPath($tempRoot)
  $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if ($resolvedTemp.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($runnerRoot) {
    $resolvedRunner = [IO.Path]::GetFullPath($runnerRoot)
    if ($resolvedRunner.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) {
      Remove-Item -LiteralPath $resolvedRunner -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}
