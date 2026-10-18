$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\game-focus.ps1" -Library
function Expect($Actual, $Expected) { if ($Actual -ne $Expected) { throw "Expected $Expected, got $Actual" } }
Expect (Select-GameFocus 17 '100:20' '100:20' @{ ([uint32]20)=17 } @{}) 'game'
Expect (Select-GameFocus 17 '101:21' '101:21' @{ ([uint32]20)=17 } @{}) 'desktop'
Expect (Select-GameFocus 17 '101:21' '101:22' @{ ([uint32]20)=17 } @{}) 'unknown'
Expect (Select-GameFocus 17 '101:21' '102:21' @{ ([uint32]20)=17 } @{}) 'unknown'
Expect (Select-GameFocus 17 $null $null @{ ([uint32]20)=17 } @{}) 'unknown'
Expect (Select-GameFocus 17 '100:20' '100:20' @{ ([uint32]20)=17 } @{ ([uint32]20)=18 }) 'unknown'
Expect (Select-GameFocus 17 '100:21' '100:21' @{ ([uint32]20)=17; ([uint32]21)=18 } @{}) 'unknown'
Expect (Select-GameFocus 17 '100:21' '100:21' @{} @{}) 'unknown'
$line = '[2026-09-11 13:42:22] Game process added : AppID 17 "game", ProcID 20, IP 0.0.0.0:0'
Expect (Get-TrackedGames $line @{ ([uint32]20)=[datetime]'2026-09-11 13:42:21' }).Count 1
Expect (Get-TrackedGames $line @{ ([uint32]20)=[datetime]'2026-09-11 13:42:22.900' }).Count 1
Expect (Get-TrackedGames $line @{ ([uint32]20)=[datetime]'2026-09-11 13:42:23' }).Count 0
Expect (Get-TrackedGames $line @{}).Count 0
Expect (Get-TrackedGames ($line + "`n[2026-09-11 13:43:00] Game process removed: AppID 17 x ProcID 20") @{ ([uint32]20)=[datetime]'2026-09-11 13:42:21' }).Count 0
$uncorroborated = Get-TrackedGames $line @{ ([uint32]20)=[datetime]'2026-09-11 13:42:21' } @{ ([uint32]20)='different.exe' }
Expect $uncorroborated[[uint32]20] 0
Expect (Get-TrackedGames $line @{ ([uint32]20)=[datetime]'2026-09-11 13:42:21' } @{ ([uint32]20)='game' }).Count 1
$tree = @{
 ([uint32]20) = @{ Name='game.exe'; ParentProcessId=10; CreationDate=[datetime]'2026-09-11 13:42:22' }
 ([uint32]10) = @{ Name='steam.exe'; ExecutablePath='C:\Steam\steam.exe'; ParentProcessId=1; CreationDate=[datetime]'2026-09-11 13:40:00' }
}
Expect (Test-SteamAncestry ([uint32]20) $tree 'C:\Steam') $true
Expect (Test-SteamAncestry ([uint32]20) $tree 'C:\Other') $false
$tree[[uint32]10].CreationDate = [datetime]'2026-09-11 13:43:00'
Expect (Test-SteamAncestry ([uint32]20) $tree 'C:\Steam') $false
$tree[[uint32]20].ParentProcessId = 20
Expect (Test-SteamAncestry ([uint32]20) $tree 'C:\Steam') $false
$tree[[uint32]10].CreationDate = [datetime]'2026-09-11 13:40:00'
$overlayProcess = @{ Name='gameoverlayui.exe'; ExecutablePath='C:\Steam\gameoverlayui.exe'; ProcessId=30; ParentProcessId=10; CreationDate=[datetime]'2026-09-11 13:42:22' }
$tree[[uint32]30] = $overlayProcess
Expect (Test-SteamOverlay $overlayProcess $tree 'C:\Steam') $true
$overlayProcess.ExecutablePath = 'C:\Other\gameoverlayui.exe'
Expect (Test-SteamOverlay $overlayProcess $tree 'C:\Steam') $false
$overlayProcess.ExecutablePath = 'C:\Steam\gameoverlayui.exe'
$tree[[uint32]10].SessionId = 2
Expect (Test-SteamOverlay $overlayProcess $tree 'C:\Steam' 1) $false
Expect (Test-SteamOverlay $overlayProcess $tree 'C:\Steam' 2) $true
$overlayProcess.ParentProcessId = 99
Expect (Test-SteamOverlay $overlayProcess $tree 'C:\Steam') $false
Expect (Select-GameFocus 17 '100:20' '100:20' @{ ([uint32]20)=0; ([uint32]21)=17 } @{}) 'unknown'
$mismatch = Get-TrackedGames $line @{ ([uint32]20)=[datetime]'2026-09-11 13:42:21' } @{ ([uint32]20)='different.exe' }
$mismatch[[uint32]21] = 17
Expect (Select-GameFocus 17 '100:20' '100:20' $mismatch @{}) 'unknown'
$lostParent = Confirm-TrackedGames @{ ([uint32]20)=18; ([uint32]21)=17 } @{ ([uint32]20)=@{ Name='game.exe'; ParentProcessId=99; CreationDate=[datetime]'2026-09-11 13:42:22' }; ([uint32]21)=@{ Name='steam.exe'; ExecutablePath='C:\Steam\steam.exe'; SessionId=2 } } 'C:\Steam' 2
Expect $lostParent[[uint32]20] 0
Expect (Select-GameFocus 17 '100:20' '100:20' $lostParent @{}) 'unknown'
Write-Output 'PASS game focus policy'
