[CmdletBinding()]
param(
  [string]$ExePath,
  [string]$DataDir,
  [string]$TaskName = 'XYZ Classroom Server',
  [string]$Address = ':8787',
  [switch]$RunAtStartup,
  [switch]$ConfigureFirewall,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ExePath) -or [string]::IsNullOrWhiteSpace($DataDir)) {
  $projectRoot = Split-Path $PSCommandPath -Parent | Split-Path -Parent
  if ([string]::IsNullOrWhiteSpace($ExePath)) {
    $ExePath = Join-Path $projectRoot 'release\xyz-server.exe'
  }
  if ([string]::IsNullOrWhiteSpace($DataDir)) {
    $DataDir = Join-Path $projectRoot 'release\data'
  }
}

if (-not (Test-Path -LiteralPath $ExePath -PathType Leaf)) {
  throw "找不到服务程序：$ExePath。请先运行 npm run server:build。"
}

$resolvedExe = (Resolve-Path -LiteralPath $ExePath).Path
$resolvedData = [IO.Path]::GetFullPath($DataDir)
$runner = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'run-server.ps1')).Path
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$arguments = @(
  '-NoProfile'
  '-ExecutionPolicy Bypass'
  '-WindowStyle Hidden'
  '-File'
  "`"$runner`""
  '-ExePath'
  "`"$resolvedExe`""
  '-DataDir'
  "`"$resolvedData`""
  '-Address'
  "`"$Address`""
) -join ' '

$summary = [pscustomobject]@{
  TaskName = $TaskName
  ExePath = $resolvedExe
  DataDir = $resolvedData
  Address = $Address
  Trigger = if ($RunAtStartup) { 'Windows 启动时' } else { '当前教师登录后' }
  Runner = $runner
}

if ($DryRun) {
  $summary | ConvertTo-Json
  return
}

New-Item -ItemType Directory -Path $resolvedData -Force | Out-Null

$action = New-ScheduledTaskAction `
  -Execute $powershell `
  -Argument $arguments `
  -WorkingDirectory (Split-Path $resolvedExe -Parent)

if ($RunAtStartup) {
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal `
    -UserId 'SYSTEM' `
    -LogonType ServiceAccount `
    -RunLevel Highest
} else {
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Limited
}

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description '题场课堂竞技场本机服务，异常退出后自动重启。' `
  -Force | Out-Null

if ($ConfigureFirewall) {
  $ruleName = 'XYZ Classroom Server TCP 8787'
  if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule `
      -DisplayName $ruleName `
      -Direction Inbound `
      -Action Allow `
      -Protocol TCP `
      -LocalPort 8787 `
      -Profile Private | Out-Null
  }
}

Start-ScheduledTask -TaskName $TaskName
$summary | Add-Member -NotePropertyName Status -NotePropertyValue '已安装并启动'
$summary | ConvertTo-Json
