[CmdletBinding()]
param(
  [switch]$DryRun,
  [string]$DataDir = "",
  [string]$SessionToken = "",
  [string]$OneTimeCode = "",
  [string]$CodeExpiresAt = "",
  [int]$FrontendPort = 5173,
  [int]$BackendPort = 8021,
  [int]$BridgePort = 8791,
  [string]$PythonPath = "python",
  [string]$NpmPath = "npm",
  [string]$CloudflaredPath = "cloudflared",
  [string]$NodePath = "",
  [string]$LogDir = "",
  [ValidateSet("stable", "dev")]
  [string]$FrontendMode = "stable",
  [int]$TunnelUrlWaitSeconds = 120,
  [switch]$VerifyTunnelUrl,
  [int]$TunnelVerifyAttempts = 12,
  [int]$TunnelVerifyDelaySeconds = 3,
  [switch]$SkipBridge,
  [switch]$SkipBackend,
  [switch]$SkipFrontend
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# --- Fail-closed auth validation: if any one is provided, all three must be non-empty ---
$authProvided = @(
  ![string]::IsNullOrWhiteSpace($SessionToken),
  ![string]::IsNullOrWhiteSpace($OneTimeCode),
  ![string]::IsNullOrWhiteSpace($CodeExpiresAt)
)
if ($authProvided -contains $true -and $authProvided -contains $false) {
  throw "Auth fail-closed: when any of -SessionToken, -OneTimeCode, -CodeExpiresAt is provided, all three must be non-empty."
}

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$FrontendUrl = "http://127.0.0.1:$FrontendPort"
$BackendUrl = "http://127.0.0.1:$BackendPort"
$BridgeUrl = "http://127.0.0.1:$BridgePort"

function New-EnvMap {
  param([hashtable]$Extra)

  $base = @{}

  # Only set data-dir env vars when caller supplies an explicit DataDir.
  # Empty/null means "use the real default data directory" (no override).
  if (![string]::IsNullOrWhiteSpace($DataDir)) {
    $base["LIFE_INDEX_DATA_DIR"] = $DataDir
    $base["WSLENV"] = "LIFE_INDEX_DATA_DIR"
  }

  foreach ($key in $Extra.Keys) {
    $base[$key] = $Extra[$key]
  }
  return $base
}

function Get-EnvOrDefault {
  param(
    [string]$Name,
    [string]$Default
  )
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $Default
  }
  return $value
}

function New-LaunchPlan {
  $bridgeEnv = New-EnvMap @{
    LIFE_INDEX_HOST_AGENT_TIMEOUT_SECONDS = (Get-EnvOrDefault -Name "LIFE_INDEX_HOST_AGENT_TIMEOUT_SECONDS" -Default "600")
    LIFE_INDEX_HOST_AGENT_TOOL_HINT = (Get-EnvOrDefault -Name "LIFE_INDEX_HOST_AGENT_TOOL_HINT" -Default "")
  }
  if ($env:LIFE_INDEX_HOST_AGENT_ARGV_JSON) {
    $bridgeEnv["LIFE_INDEX_HOST_AGENT_ARGV_JSON_CONFIGURED"] = "true"
  } else {
    $bridgeEnv["LIFE_INDEX_HOST_AGENT_ARGV_JSON_CONFIGURED"] = "false"
  }

  $backendEnv = New-EnvMap @{
    LIFE_INDEX_HOST_AGENT_URL = $BridgeUrl
    LIFE_INDEX_HOST_AGENT_HTTP_TIMEOUT_SECONDS = (Get-EnvOrDefault -Name "LIFE_INDEX_HOST_AGENT_HTTP_TIMEOUT_SECONDS" -Default "600")
    LIFE_INDEX_PUBLIC_LINK_OPS_DISABLED = "1"
  }

  # Pass public-link auth env vars when provided.
  if ($authProvided -notcontains $false) {
    $backendEnv["LIFE_INDEX_PUBLIC_LINK_SESSION_TOKEN"] = $SessionToken
    $backendEnv["LIFE_INDEX_PUBLIC_LINK_ONE_TIME_CODE"] = $OneTimeCode
    $backendEnv["LIFE_INDEX_PUBLIC_LINK_CODE_EXPIRES_AT"] = $CodeExpiresAt
  }

  $frontendEnv = @{
    BACKEND_URL = $BackendUrl
    LIFE_INDEX_ALLOW_TRYCLOUDFLARE_HOSTS = "1"
    VITE_LIFE_INDEX_AI_PLUS_GROUNDED_QUERY = "true"
    VITE_LIFE_INDEX_AI_PLUS_SMART_METADATA = "true"
  }

  if ($FrontendMode -eq "stable") {
    $frontendArgs = @(
      "run", "mobile:acceptance", "--",
      "--host", "127.0.0.1",
      "--port", [string]$FrontendPort,
      "--backend", $BackendUrl,
      "--dist", "dist"
    )
    $frontendHmr = $false
  } else {
    $frontendArgs = @("run", "dev", "--", "--host", "127.0.0.1", "--port", [string]$FrontendPort)
    $frontendHmr = $true
  }

  return [ordered]@{
    mode = $(if ($DryRun) { "dry-run" } else { "launch" })
    repoRoot = [string]$RepoRoot
    dataDir = if (![string]::IsNullOrWhiteSpace($DataDir)) { $DataDir } else { $null }
    frontendUrl = $FrontendUrl
    backendUrl = $BackendUrl
    bridgeUrl = $BridgeUrl
    bridge = [ordered]@{
      skip = [bool]$SkipBridge
      command = $PythonPath
      args = @("-m", "uvicorn", "host_agent_bridge.server:app", "--host", "127.0.0.1", "--port", [string]$BridgePort)
      env = $bridgeEnv
    }
    backend = [ordered]@{
      skip = [bool]$SkipBackend
      command = $PythonPath
      args = @("-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", [string]$BackendPort)
      env = $backendEnv
    }
    frontend = [ordered]@{
      skip = [bool]$SkipFrontend
      mode = $FrontendMode
      command = $NpmPath
      args = $frontendArgs
      env = $frontendEnv
      hmr = $frontendHmr
      nodePath = $NodePath
    }
    cloudflared = [ordered]@{
      command = $CloudflaredPath
      args = @("tunnel", "--url", $FrontendUrl)
    }
    tunnelVerification = [ordered]@{
      enabled = [bool]$VerifyTunnelUrl
      status = "not_checked"
      attempts = $TunnelVerifyAttempts
      delaySeconds = $TunnelVerifyDelaySeconds
      lastError = $null
    }
  }
}

function Quote-PowerShellString {
  param([string]$Value)
  return "'" + ($Value -replace "'", "''") + "'"
}

function New-EncodedCommand {
  param(
    [string]$Command,
    [string[]]$Arguments,
    [hashtable]$Environment,
    [string]$StdoutPath,
    [string]$StderrPath,
    [string]$ExtraPathPrefix = ""
  )

  $lines = @(
    "`$ErrorActionPreference = 'Stop'",
    "Set-Location -LiteralPath $(Quote-PowerShellString ([string]$RepoRoot))"
  )

  foreach ($key in $Environment.Keys) {
    $lines += "`$env:$key = $(Quote-PowerShellString ([string]$Environment[$key]))"
  }

  if ($ExtraPathPrefix) {
    $lines += "`$env:PATH = $(Quote-PowerShellString $ExtraPathPrefix) + ';' + `$env:PATH"
  }

  $quotedArgs = ($Arguments | ForEach-Object { Quote-PowerShellString $_ }) -join ", "
  $lines += "`$argsList = @($quotedArgs)"
  $lines += "& $(Quote-PowerShellString $Command) @argsList 1>> $(Quote-PowerShellString $StdoutPath) 2>> $(Quote-PowerShellString $StderrPath)"
  $script = $lines -join "`r`n"
  return [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
}

function Start-LoggedProcess {
  param(
    [string]$Name,
    [string]$Command,
    [string[]]$Arguments,
    [hashtable]$Environment,
    [string]$LogRoot,
    [string]$ExtraPathPrefix = ""
  )

  $stdout = Join-Path $LogRoot "$Name.out.log"
  $stderr = Join-Path $LogRoot "$Name.err.log"
  New-Item -ItemType File -Force -Path $stdout | Out-Null
  New-Item -ItemType File -Force -Path $stderr | Out-Null

  # Real executables (python.exe, cloudflared.exe) launch DIRECTLY: a direct
  # child survives the reaping that kills wrapped powershell.exe children when a
  # controlling agent issues tool calls (the backend/bridge were dying this way).
  # Start-Process has no -Environment parameter, so apply env to the current
  # session and let the child inherit it.
  # Non-exe shims (npm resolves to a .ps1) keep the powershell -EncodedCommand
  # wrapper: their long-lived node grandchild re-parents and survives anyway, and
  # the wrapper runs the VITE-flagged `npm run build` before serving.
  if ($Command -match '\.exe$') {
    foreach ($key in $Environment.Keys) {
      Set-Item -Path ("env:" + $key) -Value ([string]$Environment[$key])
    }
    if ($ExtraPathPrefix) {
      $env:PATH = "$ExtraPathPrefix;" + $env:PATH
    }
    $process = Start-Process `
      -FilePath $Command `
      -ArgumentList $Arguments `
      -RedirectStandardOutput $stdout `
      -RedirectStandardError $stderr `
      -WindowStyle Hidden `
      -PassThru
  } else {
    $encoded = New-EncodedCommand `
      -Command $Command `
      -Arguments $Arguments `
      -Environment $Environment `
      -StdoutPath $stdout `
      -StderrPath $stderr `
      -ExtraPathPrefix $ExtraPathPrefix

    $process = Start-Process `
      -FilePath "powershell.exe" `
      -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encoded) `
      -WindowStyle Hidden `
      -PassThru
  }

  return [ordered]@{
    name = $Name
    pid = $process.Id
    stdout = $stdout
    stderr = $stderr
  }
}

function Assert-CommandAvailable {
  param([string]$Command)

  if ($Command -match "[\\/]" -or $Command -match "^[A-Za-z]:") {
    if (!(Test-Path -LiteralPath $Command)) {
      throw "Required command not found: $Command"
    }
    return
  }

  if (!(Get-Command $Command -ErrorAction SilentlyContinue)) {
    throw "Required command not found on PATH: $Command"
  }
}

function Resolve-CommandPath {
  param([string]$Command)

  if ($Command -match "[\\/]" -or $Command -match "^[A-Za-z]:") {
    if (!(Test-Path -LiteralPath $Command)) {
      throw "Required command not found: $Command"
    }
    return (Resolve-Path -LiteralPath $Command).Path
  }

  $resolved = Get-Command $Command -ErrorAction SilentlyContinue | Select-Object -First 1
  if (!$resolved) {
    throw "Required command not found on PATH: $Command"
  }
  return $resolved.Source
}

function Get-PortListenerDetails {
  param([int]$Port)

  $connections = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
  if ($connections.Count -eq 0) {
    return @()
  }

  $details = @()
  $owners = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
  foreach ($ownerProcessId in $owners) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ownerProcessId" -ErrorAction SilentlyContinue
    $details += [ordered]@{
      pid = [int]$ownerProcessId
      name = $(if ($process) { $process.Name } else { "unknown" })
      commandLine = $(if ($process) { $process.CommandLine } else { "" })
    }
  }
  return $details
}

function Assert-FrontendPortAvailable {
  param(
    [int]$Port,
    [bool]$Skip
  )

  if ($Skip) {
    return
  }

  $listeners = @(Get-PortListenerDetails -Port $Port)
  if ($listeners.Count -eq 0) {
    return
  }

  $summary = ($listeners | ForEach-Object {
    "pid=$($_.pid) name=$($_.name) command=$($_.commandLine)"
  }) -join "; "

  $message = @(
    "Frontend port $Port is already in use;"
    "refusing to launch Cloudflare tunnel because it would expose the existing listener instead of the requested frontend."
    "Stop the process, choose a different -FrontendPort, or pass -SkipFrontend when intentionally reusing an existing frontend."
    "Listeners: $summary"
  ) -join " "
  throw $message
}

function Stop-StartedProcesses {
  param([object[]]$Processes)

  foreach ($startedProcess in $Processes) {
    try {
      $runningProcess = Get-Process -Id ([int]$startedProcess.pid) -ErrorAction SilentlyContinue
      if ($runningProcess) {
        Stop-Process -Id ([int]$startedProcess.pid) -Force -ErrorAction SilentlyContinue
      }
    } catch {
      # Best-effort cleanup after failed tunnel startup.
    }
  }
}

function Test-TunnelUrlReachability {
  param(
    [string]$Url,
    [int]$Attempts,
    [int]$DelaySeconds
  )

  $result = [ordered]@{
    enabled = $true
    status = "unreachable"
    attempts = $Attempts
    delaySeconds = $DelaySeconds
    httpStatus = $null
    bytes = $null
    lastError = $null
  }

  for ($i = 1; $i -le $Attempts; $i++) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 20
      $result.status = "reachable"
      $result.httpStatus = [int]$response.StatusCode
      $result.bytes = $response.Content.Length
      $result.lastError = $null
      return $result
    } catch {
      $result.lastError = $_.Exception.Message
      if ($i -lt $Attempts) {
        Start-Sleep -Seconds $DelaySeconds
      }
    }
  }

  return $result
}

$plan = New-LaunchPlan

if ($DryRun) {
  $plan | ConvertTo-Json -Depth 12
  exit 0
}

Assert-CommandAvailable $CloudflaredPath
Assert-CommandAvailable $PythonPath
Assert-CommandAvailable $NpmPath

$CloudflaredPath = Resolve-CommandPath $CloudflaredPath
$PythonPath = Resolve-CommandPath $PythonPath
$NpmPath = Resolve-CommandPath $NpmPath

# Only validate DataDir existence when explicitly provided.
if (![string]::IsNullOrWhiteSpace($DataDir) -and !(Test-Path -LiteralPath $DataDir)) {
  throw "DataDir does not exist: $DataDir"
}

Assert-FrontendPortAvailable -Port $FrontendPort -Skip ([bool]$SkipFrontend)

if (!$LogDir) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $LogDir = Join-Path ([string]$RepoRoot) ".tmp\mobile-tunnel-logs\$stamp"
}
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$started = @()
if (!$SkipBridge) {
  if (!$env:LIFE_INDEX_HOST_AGENT_ARGV_JSON) {
    Write-Warning "LIFE_INDEX_HOST_AGENT_ARGV_JSON is not configured. Smart AI+ endpoints will report unavailable until a host runtime is configured."
  }
  $started += Start-LoggedProcess -Name "bridge" -Command $PythonPath -Arguments $plan.bridge.args -Environment $plan.bridge.env -LogRoot $LogDir
}
if (!$SkipBackend) {
  $started += Start-LoggedProcess -Name "backend" -Command $PythonPath -Arguments $plan.backend.args -Environment $plan.backend.env -LogRoot $LogDir
}
if (!$SkipFrontend) {
  $nodePrefix = ""
  if ($NodePath) {
    if (!(Test-Path -LiteralPath $NodePath)) {
      throw "NodePath does not exist: $NodePath"
    }
    $nodePrefix = Split-Path -Parent $NodePath
  }
  $started += Start-LoggedProcess -Name "frontend" -Command $NpmPath -Arguments $plan.frontend.args -Environment $plan.frontend.env -LogRoot $LogDir -ExtraPathPrefix $nodePrefix
}

$cloudflared = Start-LoggedProcess -Name "cloudflared" -Command $CloudflaredPath -Arguments $plan.cloudflared.args -Environment @{} -LogRoot $LogDir
$started += $cloudflared

$combinedLog = $cloudflared.stdout
$tunnelUrl = $null
$cloudflaredExitedEarly = $false
for ($i = 0; $i -lt $TunnelUrlWaitSeconds; $i++) {
  Start-Sleep -Seconds 1
  $content = ""
  if (Test-Path -LiteralPath $combinedLog) {
    $content += Get-Content -LiteralPath $combinedLog -Raw -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $cloudflared.stderr) {
    $content += "`n" + (Get-Content -LiteralPath $cloudflared.stderr -Raw -ErrorAction SilentlyContinue)
  }
  $match = [regex]::Match($content, "https://[a-zA-Z0-9-]+\.trycloudflare\.com")
  if ($match.Success) {
    $tunnelUrl = $match.Value
    break
  }

  $cloudflaredProcess = Get-Process -Id ([int]$cloudflared.pid) -ErrorAction SilentlyContinue
  if (!$cloudflaredProcess) {
    $cloudflaredExitedEarly = $true
    break
  }
}

if (!$tunnelUrl) {
  Stop-StartedProcesses -Processes $started
  $failureMessage = "Cloudflare Quick Tunnel URL was not found within $TunnelUrlWaitSeconds seconds."
  if ($cloudflaredExitedEarly) {
    $failureMessage += " cloudflared exited before emitting a URL."
  }
  throw "$failureMessage Check logs: $LogDir"
} else {
  Write-Host "Mobile Cloudflare Quick Tunnel ready:"
  Write-Host $tunnelUrl
}

$tunnelVerification = [ordered]@{
  enabled = [bool]$VerifyTunnelUrl
  status = "not_checked"
  attempts = $TunnelVerifyAttempts
  delaySeconds = $TunnelVerifyDelaySeconds
  lastError = $null
}

if ($VerifyTunnelUrl -and $tunnelUrl) {
  $tunnelVerification = Test-TunnelUrlReachability `
    -Url $tunnelUrl `
    -Attempts $TunnelVerifyAttempts `
    -DelaySeconds $TunnelVerifyDelaySeconds
}

[ordered]@{
  frontendUrl = $FrontendUrl
  backendUrl = $BackendUrl
  bridgeUrl = $BridgeUrl
  tunnelUrl = $tunnelUrl
  cloudflaredExitedEarly = $cloudflaredExitedEarly
  tunnelVerification = $tunnelVerification
  logDir = $LogDir
  processes = $started
} | ConvertTo-Json -Depth 8
