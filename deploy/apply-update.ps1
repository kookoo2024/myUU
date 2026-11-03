[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ExePath,
  [Parameter(Mandatory = $true)]
  [string]$UpdateDir,
  [switch]$Rollback,
  [switch]$MarkSuccess
)

$ErrorActionPreference = 'Stop'

function Write-JsonFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [object]$Value
  )

  $encoding = New-Object System.Text.UTF8Encoding($false)
  $json = $Value | ConvertTo-Json -Depth 8
  [IO.File]::WriteAllText($Path, $json, $encoding)
}

function Read-JsonFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Test-PathInside {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$Directory
  )

  $prefix = $Directory.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) +
    [IO.Path]::DirectorySeparatorChar
  return $Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
}

function Get-Sha256Hex {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

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

$resolvedExe = [IO.Path]::GetFullPath($ExePath)
$resolvedUpdate = [IO.Path]::GetFullPath($UpdateDir)
$pendingPath = Join-Path $resolvedUpdate 'pending-update.json'
$preparedPath = Join-Path $resolvedUpdate 'prepared-update.json'
$recordPath = Join-Path $resolvedUpdate 'last-update.json'
$rollbackDir = Join-Path $resolvedUpdate 'rollback'

New-Item -ItemType Directory -Path $resolvedUpdate -Force | Out-Null
New-Item -ItemType Directory -Path $rollbackDir -Force | Out-Null

if ($Rollback) {
  if (-not (Test-Path -LiteralPath $recordPath -PathType Leaf)) {
    throw '没有可回滚的更新记录'
  }
  $record = Read-JsonFile -Path $recordPath
  $rollbackExe = [IO.Path]::GetFullPath([string]$record.rollbackExe)
  if (-not (Test-PathInside -Path $rollbackExe -Directory $rollbackDir)) {
    throw '回滚文件路径超出更新目录'
  }
  if (-not (Test-Path -LiteralPath $rollbackExe -PathType Leaf)) {
    throw '回滚程序文件不存在'
  }
  Copy-Item -LiteralPath $rollbackExe -Destination $resolvedExe -Force
  $record | Add-Member -NotePropertyName status -NotePropertyValue 'rolled_back' -Force
  $record | Add-Member -NotePropertyName rolledBackAt -NotePropertyValue (Get-Date).ToUniversalTime().ToString('o') -Force
  Write-JsonFile -Path $recordPath -Value $record
  if (Test-Path -LiteralPath $preparedPath -PathType Leaf) {
    Remove-Item -LiteralPath $preparedPath -Force
  }
  [pscustomobject]@{
    rolledBack = $true
    restoredFrom = $rollbackExe
    target = $resolvedExe
  } | ConvertTo-Json -Compress
  exit 0
}

if ($MarkSuccess) {
  if (-not (Test-Path -LiteralPath $recordPath -PathType Leaf)) {
    throw '没有更新记录可标记'
  }
  $record = Read-JsonFile -Path $recordPath
  $record | Add-Member -NotePropertyName status -NotePropertyValue 'success' -Force
  $record | Add-Member -NotePropertyName healthyAt -NotePropertyValue (Get-Date).ToUniversalTime().ToString('o') -Force
  Write-JsonFile -Path $recordPath -Value $record
  if (Test-Path -LiteralPath $preparedPath -PathType Leaf) {
    Remove-Item -LiteralPath $preparedPath -Force
  }
  [pscustomobject]@{
    marked = $true
    version = [string]$record.toVersion
  } | ConvertTo-Json -Compress
  exit 0
}

if (-not (Test-Path -LiteralPath $pendingPath -PathType Leaf)) {
  [pscustomobject]@{ applied = $false } | ConvertTo-Json -Compress
  exit 0
}

try {
  $pending = Read-JsonFile -Path $pendingPath
  $fileName = [IO.Path]::GetFileName([string]$pending.fileName)
  if ([string]::IsNullOrWhiteSpace($fileName) -or $fileName -ne [string]$pending.fileName) {
    throw '待安装更新文件名不正确'
  }
  $source = [IO.Path]::GetFullPath((Join-Path $resolvedUpdate $fileName))
  if (-not (Test-PathInside -Path $source -Directory $resolvedUpdate)) {
    throw '待安装更新路径超出更新目录'
  }
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw '待安装更新程序不存在'
  }
  if (-not (Test-Path -LiteralPath $resolvedExe -PathType Leaf)) {
    throw '当前服务程序不存在，无法备份'
  }

  $actualHash = Get-Sha256Hex -Path $source
  $actualSize = (Get-Item -LiteralPath $source).Length
  if ($actualHash -ne ([string]$pending.sha256).ToLowerInvariant()) {
    throw '待安装更新 SHA256 校验失败'
  }
  if ($actualSize -ne [int64]$pending.size) {
    throw '待安装更新大小校验失败'
  }

  $fromVersion = ([string]$pending.fromVersion -replace '[^0-9A-Za-z._-]', '-')
  if ([string]::IsNullOrWhiteSpace($fromVersion)) {
    $fromVersion = 'current'
  }
  $backupExe = Join-Path $rollbackDir ("xyz-server-{0}.exe" -f $fromVersion)
  Copy-Item -LiteralPath $resolvedExe -Destination $backupExe -Force
  Copy-Item -LiteralPath $source -Destination $resolvedExe -Force

  $record = [pscustomobject]@{
    status = 'testing'
    fromVersion = [string]$pending.fromVersion
    toVersion = [string]$pending.version
    rollbackExe = $backupExe
    appliedAt = (Get-Date).ToUniversalTime().ToString('o')
    sha256 = $actualHash
    size = $actualSize
  }
  Write-JsonFile -Path $recordPath -Value $record
  Remove-Item -LiteralPath $pendingPath -Force

  [pscustomobject]@{
    applied = $true
    fromVersion = $record.fromVersion
    toVersion = $record.toVersion
    rollbackExe = $backupExe
  } | ConvertTo-Json -Compress
} catch {
  $failedName = 'pending-update.failed-{0}.json' -f (Get-Date -Format 'yyyyMMdd-HHmmss')
  $failedPath = Join-Path $resolvedUpdate $failedName
  if (Test-Path -LiteralPath $pendingPath -PathType Leaf) {
    Move-Item -LiteralPath $pendingPath -Destination $failedPath -Force
  }
  [pscustomobject]@{
    applied = $false
    error = $_.Exception.Message
    failedMarker = $failedPath
  } | ConvertTo-Json -Compress
}
