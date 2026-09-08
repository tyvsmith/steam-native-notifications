# Deliver one Steam notification as a Windows toast, and register what a
# click needs. EXPERIMENTAL: validated on one Windows 11 VM;
# docs/platforms.md records the tested surface and remaining gaps.
#
# Windows PowerShell 5.1 only: pwsh (6+) removed WinRT projection support
# entirely, so [Windows.UI.Notifications...] type activation throws there.
#
# Spawned by backend/main.lua (CreateProcessW, CREATE_NO_WINDOW), one process
# per notification. Delivery exits after Show(). The toast carries
# activationType="protocol" launching Steam's canonical notification URI,
# which Steam hands to the client's JS. After routing, the backend starts this script once
# more with -FocusKind to raise the matching main or chat window briefly; no
# resident process, registered COM activator, or binary.
#
# Usage: notify-action.ps1 -Setup            register AUMID branding (idempotent)
#        notify-action.ps1 -Teardown         remove the registration and the icon
#        notify-action.ps1 -Id <id>          deliver <id>.notify from the runtime directory
#        notify-action.ps1 -FocusKind <kind> pulse the main or chat window
#
# The .notify file carries the five POSIX slots plus the Windows-only boolean
# suppressPopup. A file, not a command line, so quoting stays out of the contract.

param(
    [string]$Id,
    [ValidateSet('chat', 'main')]
    [string]$FocusKind,
    [switch]$Setup,
    [switch]$Teardown
)

$ErrorActionPreference = 'Stop'

# Materialized into the runtime directory next to plugin.log and .click, so
# the script's own location is the runtime directory.
$RuntimeDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Aumid = 'me.tysmith.steam-native-notifications'
$AumidKey = "HKCU:\Software\Classes\AppUserModelId\$Aumid"
$SchemeKey = 'HKCU:\Software\Classes\snn'
$IconPath = Join-Path $RuntimeDir 'steam.ico'
$LogFile = Join-Path $RuntimeDir 'plugin.log'

function Write-PluginLog([string]$Line) {
    # Same shape as backend/main.lua's mirror, so tools/capture-style triage
    # reads one vocabulary. Best-effort: logging must never break delivery.
    try {
        $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
        Add-Content -LiteralPath $LogFile -Value "[$stamp] [steam-native-notifications] $Line" -Encoding UTF8
    } catch {}
}

function Get-SteamDir {
    # The backend publishes millennium.steam_path() here at every load.
    $file = Join-Path $RuntimeDir 'steam-dir'
    if (Test-Path -LiteralPath $file) {
        $dir = (Get-Content -LiteralPath $file -First 1).Trim()
        if ($dir) { return $dir }
    }
    return $null
}

if ($Setup) {
    # Branding: a registry-only AppUserModelId (DisplayName + IconUri) is how
    # Microsoft's own ToastNotificationManagerCompat registers unpackaged
    # apps; no Start-menu shortcut is involved. HKCU merges over HKLM in the
    # classes view, so no elevation is needed.
    New-Item -Path $AumidKey -Force | Out-Null
    New-ItemProperty -Path $AumidKey -Name DisplayName -Value 'Steam' -PropertyType String -Force | Out-Null
    # The icon is extracted from the user's own steam.exe rather than shipped:
    # branding should show Steam's identity without this plugin distributing
    # Valve's artwork. IconUri is cosmetic; failure leaves DisplayName-only.
    try {
        $steam = Get-SteamDir
        $exe = if ($steam) { Join-Path $steam 'steam.exe' } else { $null }
        if ($exe -and (Test-Path -LiteralPath $exe)) {
            Add-Type -AssemblyName System.Drawing
            $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exe)
            $stream = [System.IO.File]::Open($IconPath, 'Create')
            $icon.Save($stream)
            $stream.Close()
            New-ItemProperty -Path $AumidKey -Name IconUri -Value $IconPath -PropertyType String -Force | Out-Null
        }
    } catch {
        Write-PluginLog "setup: icon extraction failed, DisplayName-only branding: $($_.Exception.Message)"
    }
    # No URI scheme of our own: clicks ride Steam's canonical notification URI
    # (see the launch attribute below). An earlier build registered an "snn:"
    # scheme here;
    # remove it so an upgrade leaves nothing behind.
    if (Test-Path -Path $SchemeKey) { Remove-Item -Path $SchemeKey -Recurse -Force }
    Write-PluginLog 'setup: AUMID branding registered'
    exit 0
}

if ($Teardown) {
    foreach ($key in @($AumidKey, $SchemeKey)) {
        if (Test-Path -Path $key) { Remove-Item -Path $key -Recurse -Force }
    }
    if (Test-Path -LiteralPath $IconPath) { Remove-Item -LiteralPath $IconPath -Force }
    Write-PluginLog 'teardown: registrations removed'
    exit 0
}

if (-not $Id -and -not $FocusKind) { exit 2 }

# ---------------------------------------------------------------- delivery

$Payload = $null
if ($Id) {
    $NotifyFile = Join-Path $RuntimeDir "$Id.notify"
    if (-not (Test-Path -LiteralPath $NotifyFile)) { exit 1 }
    try {
        # The backend writes UTF-8; Windows PowerShell 5.1 otherwise assumes ANSI.
        $Payload = Get-Content -LiteralPath $NotifyFile -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        Write-PluginLog "payload $Id unreadable, notification dropped: $($_.Exception.Message)"
        Remove-Item -LiteralPath $NotifyFile -Force -ErrorAction SilentlyContinue
        exit 1
    }
    Remove-Item -LiteralPath $NotifyFile -Force
}

# The notification platform can wedge under bursts ("The notification
# platform is unavailable", recovery is service restart or reboot). After
# one such failure every send inside the back-off window is dropped with a
# log line instead of hammering the service.
$Backoff = Join-Path $RuntimeDir '.wpn-backoff'
if ($Id -and (Test-Path -LiteralPath $Backoff) -and
    ((Get-Date) - (Get-Item -LiteralPath $Backoff).LastWriteTime).TotalSeconds -lt 60) {
    Write-PluginLog "delivery suppressed during platform back-off: $($Payload.title)"
    exit 1
}

# Icon resolution, mirroring the POSIX helper: library-cache art needs no
# fetch, CDN avatars are downloaded once into the same sha1-named cache with
# the same 30-day prune. Toast images are dropped silently by Windows when
# oversized, so anything past ~190KB is re-encoded down to a 256px PNG.
function Resolve-Icon([string]$Raw) {
    if (-not $Raw) { return $null }
    $steam = Get-SteamDir
    if ($Raw -match 'steamloopback\.host/assets/(.+)$') {
        if (-not $steam) { return $null }
        $tail = ($Matches[1] -split '\?')[0] -replace '/', '\'
        $path = Join-Path (Join-Path (Join-Path $steam 'appcache') 'librarycache') $tail
        if (Test-Path -LiteralPath $path) { return $path }
        return $null
    }
    if ($Raw -match '^https?://') {
        $cache = Join-Path $RuntimeDir 'icons'
        New-Item -ItemType Directory -Path $cache -Force | Out-Null
        try {
            Get-ChildItem -LiteralPath $cache -File |
                Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
                Remove-Item -Force -ErrorAction SilentlyContinue
        } catch {}
        $stem = ($Raw -split '\?')[0]
        $ext = [System.IO.Path]::GetExtension($stem)
        if ($ext -notmatch '^\.(jpg|jpeg|png|gif|webp)$') { $ext = '.img' }
        $sha = [System.BitConverter]::ToString(
            [System.Security.Cryptography.SHA1]::Create().ComputeHash(
                [System.Text.Encoding]::UTF8.GetBytes($stem))).Replace('-', '').ToLower()
        $cached = Join-Path $cache "$sha$ext"
        if (-not (Test-Path -LiteralPath $cached)) {
            try {
                Invoke-WebRequest -Uri $Raw -OutFile "$cached.part" -UseBasicParsing -TimeoutSec 5
                Move-Item -LiteralPath "$cached.part" -Destination $cached -Force
            } catch {
                Remove-Item -LiteralPath "$cached.part" -Force -ErrorAction SilentlyContinue
                return $null
            }
        }
        return $cached
    }
    if ((Test-Path -LiteralPath $Raw) -and [System.IO.Path]::IsPathRooted($Raw)) { return $Raw }
    return $null
}

function Limit-IconSize([string]$Path) {
    if (-not $Path) { return $null }
    if ((Get-Item -LiteralPath $Path).Length -le 190KB) { return $Path }
    try {
        Add-Type -AssemblyName System.Drawing
        $img = [System.Drawing.Image]::FromFile($Path)
        $side = [Math]::Min(256, [Math]::Max($img.Width, $img.Height))
        $scale = $side / [Math]::Max($img.Width, $img.Height)
        $small = New-Object System.Drawing.Bitmap $img, ([int]($img.Width * $scale)), ([int]($img.Height * $scale))
        # Into the plugin's own cache, never beside the source: the source
        # can be Steam's library cache, which is not this plugin's to write
        # into, and only RuntimeDir\icons is swept by the 30-day prune.
        $cache = Join-Path $RuntimeDir 'icons'
        New-Item -ItemType Directory -Path $cache -Force | Out-Null
        $out = Join-Path $cache "$([System.IO.Path]::GetFileName($Path)).256.png"
        $small.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
        $small.Dispose(); $img.Dispose()
        return $out
    } catch {
        return $null
    }
}

$Title = [string]$Payload.title
$Body = [string]$Payload.body
$Route = [string]$Payload.route
$Icon = Limit-IconSize (Resolve-Icon ([string]$Payload.image))

function Esc([string]$Text) { [System.Security.SecurityElement]::Escape($Text) }

$FocusSinkSource = @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class SnnToastFocus
{
    private delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr window, IntPtr insertAfter,
        int x, int y, int width, int height, uint flags);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr window, StringBuilder text, int count);

    private static IntPtr FindSteamWindow(bool chat)
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr window, IntPtr parameter)
        {
            if (!IsWindowVisible(window))
            {
                return true;
            }

            StringBuilder title = new StringBuilder(256);
            GetWindowText(window, title, title.Capacity);
            string windowTitle = title.ToString();
            if (String.IsNullOrWhiteSpace(windowTitle))
            {
                return true;
            }
            bool main = String.Equals(windowTitle, "Steam", StringComparison.Ordinal);
            if (chat == main) return true;

            uint processId;
            GetWindowThreadProcessId(window, out processId);
            try
            {
                Process process = Process.GetProcessById((int)processId);
                if (String.Equals(process.ProcessName, "steamwebhelper",
                    StringComparison.OrdinalIgnoreCase))
                {
                    found = window;
                    return false;
                }
            }
            catch {}
            return true;
        }, IntPtr.Zero);
        return found;
    }

    private static string DescribeWindow(IntPtr window)
    {
        if (window == IntPtr.Zero) return "none";
        uint processId;
        GetWindowThreadProcessId(window, out processId);
        StringBuilder title = new StringBuilder(256);
        GetWindowText(window, title, title.Capacity);
        string processName = "missing";
        try { processName = Process.GetProcessById((int)processId).ProcessName; }
        catch {}
        return processId + ":" + processName + ":" + title.ToString();
    }

    public static string Raise(string kind)
    {
        try
        {
            const uint SWP_NOSIZE = 0x0001;
            const uint SWP_NOMOVE = 0x0002;
            const uint SWP_SHOWWINDOW = 0x0040;
            IntPtr HWND_TOPMOST = new IntPtr(-1);
            IntPtr HWND_NOTOPMOST = new IntPtr(-2);

            bool chat = String.Equals(kind, "chat", StringComparison.Ordinal);
            IntPtr target = IntPtr.Zero;
            DateTime deadline = DateTime.UtcNow.AddSeconds(4);
            while (target == IntPtr.Zero && DateTime.UtcNow < deadline)
            {
                target = FindSteamWindow(chat);
                if (target == IntPtr.Zero) Thread.Sleep(100);
            }
            if (target == IntPtr.Zero)
            {
                return "target-missing kind=" + kind;
            }
            IntPtr before = GetForegroundWindow();
            bool topmost = SetWindowPos(target, HWND_TOPMOST, 0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
            Thread.Sleep(350);
            bool restored = SetWindowPos(target, HWND_NOTOPMOST, 0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
            Thread.Sleep(250);
            return "raised kind=" + kind
                + " topmost=" + topmost
                + " restored=" + restored
                + " target=" + DescribeWindow(target)
                + " before=" + DescribeWindow(before)
                + " after=" + DescribeWindow(GetForegroundWindow());
        }
        catch (Exception error)
        {
            return "focus-error: " + error.GetType().Name;
        }
    }
}
'@

if ($FocusKind) {
    try {
        Add-Type -TypeDefinition $FocusSinkSource
        $result = [SnnToastFocus]::Raise($FocusKind)
        Write-PluginLog "focus: $result"
        if ($result -like 'raised *') { exit 0 }
    } catch {
        Write-PluginLog "focus: helper failed: $($_.Exception.Message)"
    }
    exit 1
}

# activationType="protocol": Windows launches the URI on a banner or Action
# Center click. The scheme is Steam's own -- measured on Windows 11, a toast
# launches schemes Windows already knows (ms-settings:, http:, steam:) and
# silently refuses one this plugin registers itself. Steam hands the canonical
# notification URI to the client's JS, where frontend/steamurl.ts dispatches
# the envelope.
# No route means the toast is deliberately inert, mirroring Steam's own.
$ToastAttrs = ''
if ($Route -cmatch '\Aclick:([A-Za-z0-9_-]{1,8192})\z') {
    $ToastAttrs = " activationType=`"protocol`" launch=`"steam://steam-native-notifications/notification/$($Matches[1])`""
}
$ImageXml = ''
if ($Icon) {
    # Avatars render circle-cropped the way Steam draws them; game art stays square.
    $crop = if (([string]$Payload.image) -match 'avatars\.') { " hint-crop=`"circle`"" } else { '' }
    $uri = ([System.Uri]$Icon).AbsoluteUri
    $ImageXml = "<image placement=`"appLogoOverride`"$crop src=`"$(Esc $uri)`"/>"
}
$Xml = "<toast$ToastAttrs><visual><binding template=`"ToastGeneric`">" +
    "<text>$(Esc $Title)</text><text>$(Esc $Body)</text>$ImageXml" +
    '</binding></visual></toast>'

try {
    $null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
    $null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime]
    $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
    $doc.LoadXml($Xml)
    $toast = New-Object Windows.UI.Notifications.ToastNotification $doc
    if ($Payload.suppressPopup -is [bool] -and $Payload.suppressPopup) {
        $toast.SuppressPopup = $true
    }
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($Aumid).Show($toast)
} catch {
    if ($_.Exception.Message -match 'notification platform') {
        New-Item -ItemType File -Path $Backoff -Force | Out-Null
        Write-PluginLog "notification platform unavailable, backing off 60s: $($_.Exception.Message)"
    } else {
        Write-PluginLog "toast delivery failed: $($_.Exception.Message)"
    }
    exit 1
}
exit 0
