# One-shot host ownership probe; stdout is a three-state verdict.
# Both hosts terminate this process after two seconds and retain Steam focus.
param([uint32]$AppId, [string]$SteamDir, [string]$Result, [switch]$Library)
$ErrorActionPreference = 'Stop'

function Select-GameFocus($Requested, $Before, $After, $Tracked, $Overlay) {
    if (-not $Requested -or -not $Before -or $Before -ne $After) { return 'unknown' }
    $owners = @{}
    foreach ($map in @($Tracked, $Overlay)) {
        foreach ($key in $map.Keys) {
            if ($owners.ContainsKey($key) -and $owners[$key] -ne $map[$key]) { return 'unknown' }
            $owners[$key] = $map[$key]
        }
    }
    if (@($owners.Values | Where-Object { $_ -eq $Requested }).Count -eq 0) { return 'unknown' }
    $foregroundId = [uint32](($Before -split ':')[1])
    if ($owners[$foregroundId] -eq $Requested) { return 'game' }
    if ($owners.ContainsKey($foregroundId)) { return 'unknown' }
    return 'desktop'
}

function Get-TrackedGames([string]$Text, $Processes, $Executables = $null) {
    $records = @{}; $live = @{}
    foreach ($line in ($Text -split "`n")) {
        if ($line -match '^\[(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\].*Game process (added|removed)\s?: AppID (\d+) .*ProcID (\d+)') {
            $stamp = [datetime]::ParseExact($Matches[1], 'yyyy-MM-dd HH:mm:ss', [cultureinfo]::InvariantCulture)
            $processId = [uint32]$Matches[4]
            if ($Matches[2] -eq 'removed') { $records.Remove($processId) }
            else {
                $record = @{ App = [uint32]$Matches[3]; Time = $stamp; Executable = $null }
                if ($line -match 'AppID \d+\s+"+([^"\r\n]+)"') { $record.Executable = $Matches[1] }
                $records[$processId] = $record
            }
        }
    }
    foreach ($key in $records.Keys) {
        # Whole-second Steam timestamps require independent current Steam ancestry.
        if ($Processes.ContainsKey($key) -and $Processes[$key].AddTicks(-($Processes[$key].Ticks % [TimeSpan]::TicksPerSecond)) -le $records[$key].Time) {
            if ($null -eq $Executables -or ($records[$key].Executable -and $Executables[$key] -ieq $records[$key].Executable)) { $live[$key] = $records[$key].App }
        }
    }
    return $live
}

function Test-SteamAncestry($ProcessId, $Native, [string]$Steam, $SessionId = $null) {
    $cursor = $ProcessId; $seen = @{}
    while ($Native.ContainsKey($cursor) -and -not $seen.ContainsKey($cursor)) {
        $seen[$cursor] = $true; $node = $Native[$cursor]
        if ($node.Name -ieq 'steam.exe' -and $node.ExecutablePath -ieq (Join-Path $Steam 'steam.exe')) { return ($null -eq $SessionId -or $node.SessionId -eq $SessionId) }
        $parentId = [uint32]$node.ParentProcessId
        if (-not $Native.ContainsKey($parentId) -or $Native[$parentId].CreationDate -gt $node.CreationDate) { break }
        $cursor = $parentId
    }
    return $false
}

function Test-SteamOverlay($Process, $Native, [string]$Steam, $SessionId = $null) {
    if ($Process.ExecutablePath -ine (Join-Path $Steam 'gameoverlayui.exe')) { return $false }
    return Test-SteamAncestry ([uint32]$Process.ProcessId) $Native $Steam $SessionId
}

function Invoke-GameFocus {
    if (-not $AppId -or -not $SteamDir) { return 'unknown' }
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SnnGameFocus {
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
 public static string Snapshot() {
  var window = GetForegroundWindow(); uint processId;
  if(window == IntPtr.Zero || GetWindowThreadProcessId(window, out processId) == 0 || processId == 0) return null;
  return window.ToInt64() + ":" + processId;
 }
}
'@
    $sessionId = (Get-Process -Id $PID).SessionId
    $before = [SnnGameFocus]::Snapshot()
    if (-not $before) { return 'unknown' }
    $processes = @{}; $executables = @{}
    foreach ($proc in (Get-Process)) {
        try { $processes[[uint32]$proc.Id] = $proc.StartTime; $executables[[uint32]$proc.Id] = $proc.Path } catch {}
    }
    $path = Join-Path $SteamDir 'logs\console_log.txt'
    $stream = [IO.File]::Open($path, 'Open', 'Read', ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    $reader = New-Object IO.StreamReader($stream)
    try { $tracked = Get-TrackedGames $reader.ReadToEnd() $processes $executables } finally { $reader.Dispose() }
    # Steam logs only seconds: identical executable/PID reuse inside the same
    # live Steam tree and second cannot be distinguished by these records.
    # Prove tracked entries belong to this live Steam process tree. A reused
    # unrelated PID cannot acquire ownership from an old console record.
    $native = @{}
    foreach ($proc in @(Get-CimInstance Win32_Process)) { $native[[uint32]$proc.ProcessId] = $proc }
    foreach ($key in @($tracked.Keys)) {
        if (-not (Test-SteamAncestry $key $native $SteamDir $sessionId)) { $tracked.Remove($key) }
    }
    $overlay = @{}
    foreach ($proc in @(Get-CimInstance Win32_Process -Filter "Name='gameoverlayui.exe'")) {
        if (-not (Test-SteamOverlay $proc $native $SteamDir $sessionId)) { return 'unknown' }
        if ($proc.CommandLine -notmatch '-gameid\s+(\d+).*?-pid\s+(\d+)') { return 'unknown' }
        $gameId = [uint64]$Matches[1]; $targetId = [uint32]$Matches[2]
        $owner = if ($gameId -gt [uint32]::MaxValue) { [uint32]($gameId -shr 32) } else { [uint32]$gameId }
        # A live overlay cannot attest to a process created after the overlay.
        if (-not $processes.ContainsKey($targetId) -or $processes[$targetId] -gt $proc.CreationDate) { return 'unknown' }
        if ($overlay.ContainsKey($targetId) -and $overlay[$targetId] -ne $owner) { return 'unknown' }
        try { if ((Get-Process -Id $proc.ProcessId).StartTime -ne $processes[[uint32]$proc.ProcessId]) { return 'unknown' } } catch { return 'unknown' }
        $overlay[$targetId] = $owner
    }
    # Recheck process birth times as well as foreground HWND/PID after discovery.
    foreach ($key in @($tracked.Keys) + @($overlay.Keys) + @([uint32](($before -split ':')[1]))) {
        try { if ((Get-Process -Id $key).StartTime -ne $processes[$key]) { return 'unknown' } } catch { return 'unknown' }
    }
    return Select-GameFocus $AppId $before ([SnnGameFocus]::Snapshot()) $tracked $overlay
}

if ($Library) { return }
try { $verdict = Invoke-GameFocus } catch { $verdict = 'unknown' }
if ($verdict -notin @('game', 'desktop', 'unknown')) { $verdict = 'unknown' }
if ($Result) { [IO.File]::WriteAllText($Result, $verdict, (New-Object Text.UTF8Encoding $false)) }
else { Write-Output $verdict }
