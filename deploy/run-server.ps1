[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ExePath,
  [Parameter(Mandatory = $true)]
  [string]$DataDir,
  [string]$Address = ':8787',
  [int]$HealthTimeoutSeconds = 45,
  [int]$StabilitySeconds = 12
)

$ErrorActionPreference = 'Stop'
$exe = [IO.Path]::GetFullPath($ExePath)
$data = [IO.Path]::GetFullPath($DataDir)
$logDir = Join-Path $data 'logs'
$updateDir = Join-Path $data 'updates'
$applyScript = Join-Path $PSScriptRoot 'apply-update.ps1'

New-Item -ItemType Directory -Path $data -Force | Out-Null
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
New-Item -ItemType Directory -Path $updateDir -Force | Out-Null

$env:XYZ_ADDR = $Address
$env:XYZ_DATA_DIR = $data
$env:XYZ_MANAGED_RUNNER = '1'

$cutoff = (Get-Date).AddDays(-14)
Get-ChildItem -LiteralPath $logDir -Filter 'server-*.log' -File -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -lt $cutoff } |
  Remove-Item -Force -ErrorAction SilentlyContinue

function Get-LogPath {
  return Join-Path $logDir ("server-{0}.log" -f (Get-Date -Format 'yyyyMMdd'))
}

function Write-ServerLog {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Message,
    [string]$Level = 'INFO'
  )

  $line = '[{0}] [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
  Add-Content -LiteralPath (Get-LogPath) -Value $line -Encoding utf8
}

function Get-HealthUrl {
  $port = '8787'
  if ($Address -match ':([0-9]+)$') {
    $port = $Matches[1]
  }
  return "http://127.0.0.1:$port/api/health"
}

function Invoke-PendingUpdate {
  if (-not (Test-Path -LiteralPath (Join-Path $updateDir 'pending-update.json') -PathType Leaf)) {
    return $null
  }
  try {
    $result = & $applyScript -ExePath $exe -UpdateDir $updateDir | ConvertFrom-Json
    if ($result.applied) {
      Write-ServerLog ("在线更新已替换程序：{0} -> {1}" -f $result.fromVersion, $result.toVersion)
    } elseif ($result.error) {
      Write-ServerLog ("在线更新替换失败：{0}" -f $result.error) 'ERROR'
    }
    return $result
  } catch {
    Write-ServerLog ("调用更新替换脚本失败：{0}" -f $_.Exception.Message) 'ERROR'
    return $null
  }
}

function Invoke-UpdateRollback {
  param([string]$Reason)
  try {
    $result = & $applyScript -ExePath $exe -UpdateDir $updateDir -Rollback | ConvertFrom-Json
    if ($result.rolledBack) {
      Write-ServerLog ("在线更新健康检查失败，已回滚：{0}" -f $Reason) 'ERROR'
      return $true
    }
  } catch {
    Write-ServerLog ("在线更新回滚失败：{0}" -f $_.Exception.Message) 'ERROR'
  }
  return $false
}

function Start-ServerProcess {
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $exe
  $startInfo.WorkingDirectory = Split-Path $exe -Parent
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.StandardOutputEncoding = [Text.Encoding]::UTF8
  $startInfo.StandardErrorEncoding = [Text.Encoding]::UTF8
  $startInfo.CreateNoWindow = $true

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  if (-not $process.Start()) {
    throw '服务进程未能启动'
  }
  return [pscustomobject]@{
    Process = $process
    OutputTask = $process.StandardOutput.ReadLineAsync()
    ErrorTask = $process.StandardError.ReadLineAsync()
    OutputDone = $false
    ErrorDone = $false
    LogPath = Get-LogPath
  }
}

function Write-ProcessOutput {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Line,
    [Parameter(Mandatory = $true)]
    [string]$LogPath
  )

  if ([string]::IsNullOrWhiteSpace($Line)) {
    return
  }
  $formatted = '[{0}] [APP] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Line
  [IO.File]::AppendAllText(
    $LogPath,
    $formatted + [Environment]::NewLine,
    (New-Object System.Text.UTF8Encoding($false))
  )
}

function Pump-ServerOutput {
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject]$Server
  )

  try {
    while (-not $Server.OutputDone -and $Server.OutputTask.IsCompleted) {
      $line = $Server.OutputTask.GetAwaiter().GetResult()
      if ($null -eq $line) {
        $Server.OutputDone = $true
        break
      }
      Write-ProcessOutput -Line $line -LogPath $Server.LogPath
      $Server.OutputTask = $Server.Process.StandardOutput.ReadLineAsync()
    }
    while (-not $Server.ErrorDone -and $Server.ErrorTask.IsCompleted) {
      $line = $Server.ErrorTask.GetAwaiter().GetResult()
      if ($null -eq $line) {
        $Server.ErrorDone = $true
        break
      }
      Write-ProcessOutput -Line $line -LogPath $Server.LogPath
      $Server.ErrorTask = $Server.Process.StandardError.ReadLineAsync()
    }
  } catch {
    Write-ServerLog ("读取服务进程输出失败：{0}" -f $_.Exception.Message) 'ERROR'
    $Server.OutputDone = $true
    $Server.ErrorDone = $true
  }
}

function Wait-ForHealth {
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject]$Server
  )

  $deadline = (Get-Date).AddSeconds($HealthTimeoutSeconds)
  $healthUrl = Get-HealthUrl
  while ((Get-Date) -lt $deadline) {
    Pump-ServerOutput -Server $Server
    if ($Server.Process.HasExited) {
      return $false
    }
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 2
      if ($response.StatusCode -eq 200) {
        return $true
      }
    } catch {
      # The process may still be opening SQLite or binding the port.
    }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

while ($true) {
  $appliedUpdate = Invoke-PendingUpdate
  try {
    $server = Start-ServerProcess
    $process = $server.Process
  } catch {
    Write-ServerLog ("服务启动失败：{0}" -f $_.Exception.Message) 'ERROR'
    if ($appliedUpdate -and $appliedUpdate.applied) {
      Invoke-UpdateRollback -Reason '新版本无法启动' | Out-Null
    }
    Start-Sleep -Seconds 5
    continue
  }

  $healthy = Wait-ForHealth -Server $server
  if ($appliedUpdate -and $appliedUpdate.applied) {
    if (-not $healthy) {
      if (-not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        $process.WaitForExit()
      }
      Invoke-UpdateRollback -Reason '新版本未通过健康检查' | Out-Null
      Start-Sleep -Seconds 2
      continue
    }

    $stableUntil = (Get-Date).AddSeconds($StabilitySeconds)
    while ((Get-Date) -lt $stableUntil -and -not $process.HasExited) {
      Pump-ServerOutput -Server $server
      Start-Sleep -Seconds 1
    }
    if ($process.HasExited) {
      Invoke-UpdateRollback -Reason '新版本启动后提前退出' | Out-Null
      Start-Sleep -Seconds 2
      continue
    }
    & $applyScript -ExePath $exe -UpdateDir $updateDir -MarkSuccess | Out-Null
    Write-ServerLog ("在线更新验证成功：v{0}" -f $appliedUpdate.toVersion)
  } elseif ($healthy) {
    Write-ServerLog '本机服务已启动并通过健康检查'
  } else {
    Write-ServerLog '本机服务启动后未通过健康检查' 'ERROR'
  }

  while (-not $process.HasExited) {
    Pump-ServerOutput -Server $server
    Start-Sleep -Milliseconds 500
  }
  for ($index = 0; $index -lt 20; $index += 1) {
    Pump-ServerOutput -Server $server
    if ($server.OutputDone -and $server.ErrorDone) {
      break
    }
    Start-Sleep -Milliseconds 100
  }
  Write-ServerLog ("服务进程已退出，退出码 {0}；5 秒后重启" -f $process.ExitCode)
  Start-Sleep -Seconds 5
}
