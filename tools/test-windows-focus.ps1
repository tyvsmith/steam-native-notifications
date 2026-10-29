$ErrorActionPreference = 'Stop'
$root = Join-Path $env:TEMP ('snn-focus-' + [Guid]::NewGuid().ToString('N'))
$processes = @()
try {
    New-Item -ItemType Directory -Path $root | Out-Null
    $source = Get-Content (Join-Path $PSScriptRoot 'notify-action.ps1') -Raw
    $match = [regex]::Match($source, '(?s)\$FocusSinkSource = @''\r?\n(.*?)\r?\n''@')
    if (-not $match.Success) { throw 'FAIL focus source missing' }
    Add-Type -TypeDefinition $match.Groups[1].Value
    $find = [SnnToastFocus].GetMethod('FindSteamWindow', [Reflection.BindingFlags]'NonPublic,Static')
    if ($find.GetParameters().Count -ne 2) { throw 'FAIL chat selection has no exact target identity' }
    $fixture = @'
using System;
using System.Windows.Forms;
public class FocusFixture {
    [STAThread] public static void Main(string[] args) {
        foreach (string title in args) { var f = new Form(); f.Text = title; f.Show(); }
        Application.Run();
    }
}
'@
    $exe = Join-Path $root 'steamwebhelper.exe'
    Add-Type -TypeDefinition $fixture -ReferencedAssemblies System.Windows.Forms -OutputAssembly $exe -OutputType WindowsApplication
    $title = 'Chat-' + [Guid]::NewGuid().ToString('N') + [char]0x03a9
    function Select-Chat([string]$Target) { $find.Invoke($null, @($true, $Target)).ToInt64() }
    function Start-Fixture([string]$Program, [string[]]$Titles) {
        $p = Start-Process -FilePath $Program -ArgumentList $Titles -PassThru -NoNewWindow
        $script:processes += $p
        if (-not $p.WaitForInputIdle(10000)) { throw 'FAIL fixture did not become idle' }
        return $p
    }
    Start-Fixture $exe @($title, 'Settings-' + [Guid]::NewGuid().ToString('N')) | Out-Null
    $deadline = (Get-Date).AddSeconds(5)
    while ((Select-Chat $title) -eq 0 -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 100 }
    if ((Select-Chat $title) -eq 0) { Get-Process -Id $processes.Id | Select-Object ProcessName,SessionId,MainWindowTitle,HasExited | ConvertTo-Json -Compress | Write-Output; throw 'FAIL intended chat was not selected alongside another dialog' }
    if ((Select-Chat '') -ne 0) { throw 'FAIL chat without identity selects an arbitrary window' }
    if ((Select-Chat ($title + '-missing')) -ne 0) { throw 'FAIL missing chat selects another window' }
    if ((Select-Chat $title.ToLowerInvariant()) -ne 0) { throw 'FAIL title comparison is not exact' }
    Write-Output 'PASS exact Unicode chat target excludes unrelated dialogs and absent identities'

    Start-Fixture $exe @($title) | Out-Null
    $deadline = (Get-Date).AddSeconds(5)
    while ((Select-Chat $title) -ne 0 -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 100 }
    if ((Select-Chat $title) -ne 0) { throw 'FAIL duplicate chat titles select an arbitrary window' }
    Write-Output 'PASS duplicate native chat titles refuse selection'

    $longTitle = ('Long-' + [Guid]::NewGuid().ToString('N')).PadRight(512, 'x')
    Start-Fixture $exe @($longTitle + '-suffix') | Out-Null
    if ((Select-Chat $longTitle) -ne 0) { throw 'FAIL truncated title selects a different window' }
    Write-Output 'PASS overlong native titles cannot match a truncated prefix'

    $other = Join-Path $root 'unrelated.exe'
    Copy-Item $exe $other
    $otherTitle = 'Other-' + [Guid]::NewGuid().ToString('N')
    Start-Fixture $other @($otherTitle) | Out-Null
    if ((Select-Chat $otherTitle) -ne 0) { throw 'FAIL unrelated process can become a chat target' }
    Write-Output 'PASS exact title in an unrelated process refuses selection'
} finally {
    foreach ($p in $processes) { if (-not $p.HasExited) { $p.Kill(); $p.WaitForExit() } }
    if (Test-Path $root) { Remove-Item $root -Recurse -Force }
}
