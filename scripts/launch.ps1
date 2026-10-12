[CmdletBinding()]
param(
    [ValidateRange(1, 65535)][int]$Port = 5180,
    [switch]$NoBrowser,
    [switch]$CheckOnly,
    [string]$NodePath,
    [ValidateRange(3, 120)][int]$StartupTimeoutSeconds = 25
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$baseUrl = "http://127.0.0.1:$Port"
$startedProcess = $null
$startedAtUtc = $null
$oldPort = [Environment]::GetEnvironmentVariable('PORT', 'Process')

function Get-RootFingerprint([string]$Directory) {
    $normal = [IO.Path]::GetFullPath($Directory).TrimEnd([char[]]'\/').Replace('\', '/').ToLowerInvariant()
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return -join ($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($normal)) | ForEach-Object { $_.ToString('x2') }) }
    finally { $hash.Dispose() }
}

function Get-Health {
    $handler = $null
    $client = $null
    try {
        $handler = [Net.Http.HttpClientHandler]::new()
        $handler.UseProxy = $false
        $handler.AllowAutoRedirect = $false
        $client = [Net.Http.HttpClient]::new($handler)
        $client.Timeout = [TimeSpan]::FromSeconds(2)
        $client.MaxResponseContentBufferSize = 65536
        $response = $client.GetAsync("$baseUrl/api/health").GetAwaiter().GetResult()
        try {
            if (-not $response.IsSuccessStatusCode) { return $null }
            return ($response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json)
        } finally { $response.Dispose() }
    } catch { return $null }
    finally { if ($client) { $client.Dispose() } elseif ($handler) { $handler.Dispose() } }
}

function Test-PortInUse {
    $connection = New-Object Net.Sockets.TcpClient
    try {
        $pending = $connection.ConnectAsync('127.0.0.1', $Port)
        return ($pending.Wait(500) -and $connection.Connected)
    } catch { return $false }
    finally { $connection.Dispose() }
}

function Test-Identity($Health) {
    return $null -ne $Health -and $Health.id -eq 'afterlight-local' -and
        $Health.version -eq $appVersion -and $Health.rootFingerprint -eq $expectedRoot -and
        ($Health.pid -is [int] -or $Health.pid -is [long]) -and $Health.pid -gt 0 -and $Health.pid -le 2147483647
}

function Open-Afterlight {
    if (-not $NoBrowser -and -not $CheckOnly) {
        try { Start-Process -FilePath $baseUrl }
        catch { Write-Warning "The server is ready, but Windows could not open the default browser. Open $baseUrl manually." }
    }
}

try {
    $packagePath = Join-Path $projectRoot 'package.json'
    $lockPath = Join-Path $projectRoot 'package-lock.json'
    $serverPath = Join-Path $projectRoot 'server.js'
    if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $lockPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $serverPath -PathType Leaf)) {
        throw 'The application files are missing. Extract the complete Afterlight folder before launching.'
    }
    $application = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
    if ($application.name -ne 'afterlight' -or -not $application.version) { throw 'This folder is not a recognized Afterlight application.' }
    $appVersion = [string]$application.version
    $expectedRoot = Get-RootFingerprint $projectRoot

    if ($NodePath) {
        $nodeExecutable = (Get-Item -LiteralPath $NodePath -ErrorAction Stop).FullName
    } else {
        $nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $nodeCommand) { throw 'Node.js is missing. Install Node.js 24 LTS (or 22.13+) from https://nodejs.org/, then double-click Start-Afterlight.bat again. An existing runtime can be selected explicitly with -NodePath.' }
        $nodeExecutable = $nodeCommand.Source
    }
    $nodeVersion = (& $nodeExecutable --version 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$') { throw 'The selected Node executable did not return a valid version. Install Node.js 24 LTS (or 22.13+).' }
    $nodeMajor = [int]$Matches[1]
    $nodeMinor = [int]$Matches[2]
    if (-not (($nodeMajor -eq 22 -and $nodeMinor -ge 13) -or $nodeMajor -ge 23)) { throw "Node $nodeVersion is too old for the locked PDF dependency. Install Node.js 24 LTS (or 22.13+) from https://nodejs.org/." }

    $health = Get-Health
    if (Test-Identity $health) {
        Write-Host "Afterlight $appVersion is already running at $baseUrl (verified PID $($health.pid))."
        Open-Afterlight
        exit 0
    }
    if (Test-PortInUse) {
        if ($health -and $health.id -eq 'afterlight-local') {
            throw "Port $Port is serving a different Afterlight version or folder. Close that server from its own terminal and retry. This launcher will not stop it. To select another port explicitly, use -Port; browser records belong to their original port."
        }
        throw "Port $Port is already used by another application. Close that application yourself or select an explicit -Port. This launcher will not stop it or silently move your browser data."
    }

    # Windows PowerShell 5.1 cannot deserialize npm's empty root-package key.
    # Rename that one key in memory; the checked-in lockfile is never changed.
    $lockText = Get-Content -LiteralPath $lockPath -Raw
    $lock = ($lockText -replace '("packages"\s*:\s*\{\s*)""\s*:', '$1"_root_package":') | ConvertFrom-Json
    $lockedPdf = $lock.packages.'node_modules/pdfjs-dist'.version
    $installedPdfPath = Join-Path $projectRoot 'node_modules\pdfjs-dist\package.json'
    $installedPdfModule = Join-Path $projectRoot 'node_modules\pdfjs-dist\legacy\build\pdf.mjs'
    $dependenciesReady = $false
    if ((Test-Path -LiteralPath $installedPdfPath -PathType Leaf) -and (Test-Path -LiteralPath $installedPdfModule -PathType Leaf)) {
        try { $installedPdf = Get-Content -LiteralPath $installedPdfPath -Raw | ConvertFrom-Json; $dependenciesReady = $installedPdf.version -eq $lockedPdf }
        catch { $dependenciesReady = $false }
    }
    if (-not $lockedPdf) { throw 'The dependency lockfile is incomplete. Re-extract the original application archive.' }
    if ($CheckOnly) {
        if (-not $dependenciesReady) { throw 'Node is ready, but the locked dependencies are missing. Run Start-Afterlight.bat normally to install them with npm ci, or run npm ci in the application folder.' }
        Write-Host "Checks passed: Afterlight $appVersion, Node $nodeVersion, locked dependencies and free port $Port. Nothing was installed or started."
        exit 0
    }

    if (-not $dependenciesReady) {
        $npmExecutable = Join-Path (Split-Path -Parent $nodeExecutable) 'npm.cmd'
        if (-not (Test-Path -LiteralPath $npmExecutable -PathType Leaf)) {
            $npmCommand = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
            if (-not $npmCommand) { throw 'npm is missing. Install the standard Node.js 24 LTS (or 22.13+) distribution, which includes npm.' }
            $npmExecutable = $npmCommand.Source
        }
        Write-Host 'Installing the exact package-lock.json dependencies with npm ci. First launch needs internet access.'
        Push-Location -LiteralPath $projectRoot
        try { & $npmExecutable ci --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed. Check internet access and the npm error above, then retry. No application server was started.' } }
        finally { Pop-Location }
    }

    # Runtime files are local to this extracted copy and excluded from the release.
    $runtime = Join-Path $projectRoot '.runtime'
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    $tag = [Guid]::NewGuid().ToString('N')
    $outputLog = Join-Path $runtime "server-$Port-$tag.log"
    $errorLog = Join-Path $runtime "server-$Port-$tag.error.log"
    [Environment]::SetEnvironmentVariable('PORT', [string]$Port, 'Process')
    # A quoted filename remains one native argument when the extracted path contains spaces.
    $startedProcess = Start-Process -FilePath $nodeExecutable -ArgumentList ('"' + $serverPath + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $outputLog -RedirectStandardError $errorLog -PassThru
    $startedAtUtc = $startedProcess.StartTime.ToUniversalTime()
    $deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
    do {
        $startedProcess.Refresh()
        if ($startedProcess.HasExited) { throw "The local server exited before it was ready. Read $errorLog and $outputLog for details." }
        $health = Get-Health
        if (Test-Identity $health) {
            if ($health.pid -ne $startedProcess.Id) { throw 'Another server took the port during startup. It was left running; this launcher only owns its new process.' }
            $record = [ordered]@{ id = 'afterlight-local'; version = $appVersion; port = $Port; pid = $startedProcess.Id; processStartedUtc = $startedAtUtc.ToString('o'); rootFingerprint = $expectedRoot; outputLog = [IO.Path]::GetFileName($outputLog); errorLog = [IO.Path]::GetFileName($errorLog) }
            $record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtime "server-$Port.json") -Encoding UTF8
            Write-Host "Afterlight $appVersion is ready at $baseUrl. The local server keeps running after this launcher closes."
            Open-Afterlight
            exit 0
        }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "The server did not become ready within $StartupTimeoutSeconds seconds. Read $errorLog and $outputLog."
} catch {
    # Only this invocation's process may be cleaned up. Reused servers and port owners are never terminated.
    if ($startedProcess -and $startedAtUtc) {
        try {
            $current = Get-Process -Id $startedProcess.Id -ErrorAction Stop
            if ($current.StartTime.ToUniversalTime() -eq $startedAtUtc) { Stop-Process -InputObject $current -ErrorAction Stop }
        } catch { }
    }
    Write-Host "Afterlight: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    [Environment]::SetEnvironmentVariable('PORT', $oldPort, 'Process')
}
