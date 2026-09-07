$ErrorActionPreference = 'Stop'

$testRoot = Join-Path $env:TEMP "snn-notify-action-$([Guid]::NewGuid())"
$helper = Join-Path $testRoot 'notify-action.ps1'
$process = $null

try {
    New-Item -ItemType Directory -Path $testRoot | Out-Null
    $sourceHelper = Join-Path $PSScriptRoot 'notify-action.ps1'
    $helperSource = Get-Content -LiteralPath $sourceHelper -Raw
    if ($helperSource -notmatch '(?s)SetWindowPos\(target, HWND_TOPMOST.*SetWindowPos\(target, HWND_NOTOPMOST') {
        throw 'FAIL one-shot focus does not restore a reversible z-order raise'
    }
    Write-Output 'PASS one-shot focus restores its z-order raise'
    if ($helperSource -match 'add_Activated|Wait\(120000\)') {
        throw 'FAIL notification delivery still retains an activation callback'
    }
    Write-Output 'PASS notification delivery retains no activation callback'
    $suppressionSource = [regex]::Match($helperSource,
        '(?s)if \(\$Payload\.suppressPopup -is \[bool\] -and \$Payload\.suppressPopup\) \{.*?\r?\n    \}')
    if (-not $suppressionSource.Success) { throw 'FAIL popup suppression block not found' }
    $toastCreation = $helperSource.IndexOf('$toast = New-Object Windows.UI.Notifications.ToastNotification')
    $suppressionAt = $helperSource.IndexOf($suppressionSource.Value)
    $showAt = $helperSource.IndexOf('.Show($toast)')
    if ($toastCreation -lt 0 -or $suppressionAt -le $toastCreation -or $showAt -le $suppressionAt) {
        throw 'FAIL popup suppression is not applied between toast creation and Show'
    }
    $applySuppression = [scriptblock]::Create(
        'param($Payload, $toast)' + "`n" + $suppressionSource.Value + "`n" + '$toast.SuppressPopup')
    $suppressionCases = @(
        @{ Name = 'boolean true'; Json = '{"suppressPopup":true}'; Expected = $true },
        @{ Name = 'boolean false'; Json = '{"suppressPopup":false}'; Expected = $false },
        @{ Name = 'missing'; Json = '{}'; Expected = $false },
        @{ Name = 'string true'; Json = '{"suppressPopup":"true"}'; Expected = $false },
        @{ Name = 'number one'; Json = '{"suppressPopup":1}'; Expected = $false },
        @{ Name = 'null'; Json = '{"suppressPopup":null}'; Expected = $false }
    )
    foreach ($case in $suppressionCases) {
        $payload = $case.Json | ConvertFrom-Json
        $toast = [pscustomobject]@{ SuppressPopup = $false }
        $actual = & $applySuppression $payload $toast
        if ($actual -cne $case.Expected) {
            throw "FAIL popup suppression for $($case.Name): expected $($case.Expected), got $actual"
        }
    }
    Write-Output 'PASS production popup suppression block accepts only JSON boolean true before delivery'
    if ($helperSource -notmatch '\[string\]\$FocusKind') {
        throw 'FAIL helper has no route-aware focus mode'
    }
    Write-Output 'PASS helper has route-aware focus mode'
    if ($helperSource -notmatch 'steam://steam-native-notify/notification/\$\(\$Matches\[1\]\)') {
        throw 'FAIL helper does not persist the durable click envelope in the activation URI'
    }
    Write-Output 'PASS helper persists the durable click envelope in the activation URI'
    if ($helperSource -match 'steam://snn/') {
        throw 'FAIL helper retains the legacy steam://snn/ activation URI'
    }
    Write-Output 'PASS helper contains no legacy steam://snn/ activation URI'
    $attributeSource = [regex]::Match($helperSource,
        "(?s)\`$ToastAttrs = ''\r?\nif .*?\r?\n}\r?\n(?=\`$ImageXml)")
    if (-not $attributeSource.Success) { throw 'FAIL activation XML block not found' }
    $attributes = [scriptblock]::Create('param([string]$Route)' + "`n" +
        $attributeSource.Value + "`n" + '$ToastAttrs')
    foreach ($length in @(1, 8192)) {
        $encoded = 'a' * $length
        $actual = & $attributes "click:$encoded"
        $expected = " activationType=`"protocol`" launch=`"steam://steam-native-notify/notification/$encoded`""
        if ($actual -cne $expected) { throw "FAIL activation XML at payload length $length" }
    }
    foreach ($route in @('', 'click:', 'click:a/b', 'CLICK:abc', "click:abc`n",
        'steam://nav/games', ('click:' + ('a' * 8193)))) {
        if ((& $attributes $route) -ne '') { throw 'FAIL invalid route creates activation XML' }
    }
    Write-Output 'PASS activation XML bounds payloads and leaves invalid routes inert'
    Copy-Item -LiteralPath $sourceHelper -Destination $helper

    $steamDir = (Get-ItemProperty -LiteralPath 'HKCU:\Software\Valve\Steam').SteamPath
    Set-Content -LiteralPath (Join-Path $testRoot 'steam-dir') -Value $steamDir -Encoding utf8

    $id = 'routed-lifetime'
    @{
        title = 'Steam Native Notify lifetime test'
        body = 'This notification may be ignored.'
        image = ''
        route = 'click:eyJ2IjoxLCJ0b2tlbiI6IjAwMTEyMjMzNDQ1NTY2Nzc4ODk5YWFiYmNjZGRlZWZmIiwiY2FwdHVyZUFwcElkIjowLCJmYWxsYmFjayI6bnVsbCwiZm9jdXMiOiJtYWluIn0'
        ingame = ''
    } | ConvertTo-Json -Compress |
        Set-Content -LiteralPath (Join-Path $testRoot "$id.notify") -Encoding utf8

    $process = Start-Process powershell.exe -PassThru -WindowStyle Hidden -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', $helper,
        '-Id', $id
    )
    if (-not $process.WaitForExit(10000)) {
        throw 'FAIL routed delivery retained an activation process'
    }
    if ($process.ExitCode -ne 0) { throw "FAIL routed delivery exited with $($process.ExitCode)" }
    Write-Output 'PASS routed delivery exited after Show'
    $process = $null

    $id = 'unrouted-lifetime'
    @{
        title = 'Steam Native Notify lifetime test'
        body = 'This notification may be ignored.'
        image = ''
        route = ''
        ingame = ''
    } | ConvertTo-Json -Compress |
        Set-Content -LiteralPath (Join-Path $testRoot "$id.notify") -Encoding utf8

    $process = Start-Process powershell.exe -PassThru -WindowStyle Hidden -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', $helper,
        '-Id', $id
    )
    if (-not $process.WaitForExit(10000)) {
        throw 'FAIL unrouted helper retained an activation window'
    }
    if ($process.ExitCode -ne 0) { throw "FAIL unrouted delivery exited with $($process.ExitCode)" }

    Write-Output 'PASS unrouted helper exited after delivery'
} finally {
    if ($process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
