# Exercise the production helper with isolated per-user registrations and files.
$ErrorActionPreference = 'Stop'
$token = [Guid]::NewGuid().ToString('N')
$testRoot = Join-Path $env:TEMP ("snn lifecycle $([char]0x03a9) $token")
$testId = "me.tysmith.snn-lifecycle-$token"
$testAumidKey = "HKCU:\Software\Classes\AppUserModelId\$testId"
$testSchemeKey = "HKCU:\Software\Classes\snn-lifecycle-$token"
$neighborKey = "HKCU:\Software\Classes\snn-neighbor-$token"
$helper = Join-Path $testRoot 'notify-action.ps1'
$icon = Join-Path $testRoot 'steam.ico'
$originalLocation = Get-Location

# PowerShell's Resolve-Path can retain 8.3 aliases from the runner's TEMP.
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class SnnLifecyclePaths {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern uint GetLongPathName(string path, StringBuilder expanded, uint capacity);
    public static string Expand(string path) {
        var expanded = new StringBuilder(32768);
        uint length = GetLongPathName(path, expanded, (uint)expanded.Capacity);
        if (length == 0 || length >= expanded.Capacity) throw new InvalidOperationException("Cannot expand fixture path: " + path);
        return expanded.ToString();
    }
}
'@

function Assert-That([bool]$Condition, [string]$Message) {
    if (-not $Condition) {
        $log = Join-Path $testRoot 'plugin.log'
        if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log | Write-Output }
        throw "FAIL $Message"
    }
}
function Invoke-Helper([string[]]$Arguments, [int]$Expected = 0) {
    & "$PSHOME\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File $helper @Arguments
    Assert-That ($LASTEXITCODE -eq $Expected) "helper $Arguments returned $LASTEXITCODE, expected $Expected"
}

try {
    New-Item -ItemType Directory -Path $testRoot | Out-Null
    $source = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'notify-action.ps1') -Raw
    $identityLine = '$Aumid = ''me.tysmith.steam-native-notifications'''
    $schemeLine = '$SchemeKey = ''HKCU:\Software\Classes\snn'''
    Assert-That ($source.Contains($identityLine) -and $source.Contains($schemeLine)) 'isolated helper identity anchors exist'
    $source = $source.Replace($identityLine, ('$Aumid = ''' + $testId + ''''))
    $source = $source.Replace($schemeLine, ('$SchemeKey = ''' + $testSchemeKey + ''''))
    [IO.File]::WriteAllText($helper, $source, (New-Object Text.UTF8Encoding($true)))

    $steam = Join-Path $testRoot ("Steam space $([char]0x00e9)")
    New-Item -ItemType Directory -Path $steam | Out-Null
    # Extract a real executable icon without requiring or launching Steam.
    $exe = Join-Path $steam 'steam.exe'
    Copy-Item -LiteralPath "$PSHOME\powershell.exe" -Destination $exe
    Set-Content -LiteralPath (Join-Path $testRoot 'steam-dir') -Value $steam -Encoding UTF8
    New-Item -Path $neighborKey | Out-Null
    New-ItemProperty -Path $neighborKey -Name Marker -Value 'preserve' | Out-Null
    New-Item -Path $testSchemeKey | Out-Null
    Set-Location $env:SystemRoot

    foreach ($iteration in 1..2) {
        Invoke-Helper -Arguments @('-Setup')
        $registration = Get-ItemProperty -LiteralPath $testAumidKey
        Assert-That ($registration.DisplayName -ceq 'Steam') 'setup registers branding'
        Assert-That (Test-Path -LiteralPath $icon) 'setup writes the icon'
        $registeredIcon = [SnnLifecyclePaths]::Expand($registration.IconUri)
        $expectedIcon = [SnnLifecyclePaths]::Expand($icon)
        Assert-That ($registeredIcon -ieq $expectedIcon) 'setup registers the extracted icon after resolving Windows path aliases'
        Assert-That (-not (Test-Path -LiteralPath $testSchemeKey)) 'setup removes the legacy scheme'
    }
    Write-Output 'PASS repeated setup from an unrelated cwd with space/non-ASCII paths and icon extraction'

    New-Item -Path $testSchemeKey | Out-Null
    foreach ($iteration in 1..2) {
        Invoke-Helper -Arguments @('-Teardown')
        foreach ($path in @($testAumidKey, $testSchemeKey, $icon)) {
            Assert-That (-not (Test-Path -LiteralPath $path)) "teardown removes $path"
        }
        Assert-That (Test-Path -LiteralPath $exe) 'teardown preserves the source executable'
        Assert-That ((Get-ItemProperty -LiteralPath $neighborKey).Marker -ceq 'preserve') 'teardown preserves neighboring registration'
    }
    Write-Output 'PASS repeated teardown removes only fixture branding, legacy registration and icon'

    Set-Content -LiteralPath (Join-Path $testRoot 'steam-dir') -Value (Join-Path $testRoot 'missing Steam') -Encoding UTF8
    Invoke-Helper -Arguments @('-Setup')
    $registration = Get-ItemProperty -LiteralPath $testAumidKey
    Assert-That ($registration.DisplayName -ceq 'Steam') 'missing executable retains display-name branding'
    Assert-That ($null -eq $registration.IconUri -and -not (Test-Path -LiteralPath $icon)) 'missing executable creates no icon registration'
    Invoke-Helper -Arguments @('-Teardown')
    Write-Output 'PASS setup tolerates a missing executable and teardown cleans partial branding'

    Invoke-Helper -Arguments @('-Id', 'absent') -Expected 1
    $payload = Join-Path $testRoot 'malformed.notify'
    Set-Content -LiteralPath $payload -Value '{broken' -Encoding UTF8
    Invoke-Helper -Arguments @('-Id', 'malformed') -Expected 1
    Assert-That (-not (Test-Path -LiteralPath $payload)) 'unreadable payload is consumed'
    Assert-That ((Get-Content -LiteralPath (Join-Path $testRoot 'plugin.log') -Raw) -match 'payload malformed unreadable') 'unreadable payload is diagnosed'
    Write-Output 'PASS missing/unreadable payloads fail without delivery or retained work'
} finally {
    Set-Location $originalLocation
    foreach ($path in @($testAumidKey, $testSchemeKey, $neighborKey, $testRoot)) {
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
    }
}
