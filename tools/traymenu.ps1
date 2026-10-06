<#
    traymenu.ps1 - opens Internet Speed Meter's tray context menu and picks an item.

    Why this exists: the card has no title bar and no taskbar button, so the menu is its only
    Exit path, and "Keep on top" has to stay in step with the pin button inside the card.

    Coordinates come from UI Automation on every run because the hidden-icons flyout moves, and
    the script makes itself per-monitor-v2 aware first: PowerShell is DPI-unaware by default, so
    SetCursorPos would otherwise receive virtualised coordinates that land 1.5x off.

    Every lookup is scoped to the shell's own windows. A desktop-wide search by name also
    matches the card, whose document is called "Internet Speed Meter" too.

    Run:  powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\traymenu.ps1 `
              -Item "Keep on top" -Method invoke
#>
param(
    [Parameter(Mandatory = $true)][string]$Item,
    # 'click' is what a user does. 'invoke' drives the item through UI Automation instead,
    # which separates the app's behaviour from whether synthetic mouse input can reach a
    # WinForms popup - that popup drops mouse capture when the pointer arrives in one jump.
    [ValidateSet('click', 'invoke')][string]$Method = 'invoke',
    [ValidateSet('toggle', 'show', 'hide', 'none')][string]$Card = 'none'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Input {
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int index);
    public const uint LEFTDOWN = 0x2, LEFTUP = 0x4, RIGHTDOWN = 0x8, RIGHTUP = 0x10;
}
'@

[void][Input]::SetProcessDpiAwarenessContext([IntPtr](-4))   # PER_MONITOR_AWARE_V2

$ae = [System.Windows.Automation.AutomationElement]
$root = $ae::RootElement
$children = [System.Windows.Automation.TreeScope]::Children
$descendants = [System.Windows.Automation.TreeScope]::Descendants
$trueCond = [System.Windows.Automation.Condition]::TrueCondition

function ByName([string]$name) {
    New-Object System.Windows.Automation.PropertyCondition($ae::NameProperty, $name)
}

function Center($element) {
    $r = $element.Current.BoundingRectangle
    if ($r.Width -le 0 -or $r.Height -le 0) { throw "$($element.Current.Name): element has no on-screen rect" }
    return @([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2))
}

function Click([int]$X, [int]$Y, [switch]$Right) {
    [void][Input]::SetCursorPos($X, $Y)
    Start-Sleep -Milliseconds 150
    if ($Right) {
        [Input]::mouse_event([Input]::RIGHTDOWN, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 150
        [Input]::mouse_event([Input]::RIGHTUP, 0, 0, 0, [UIntPtr]::Zero)
    }
    else {
        [Input]::mouse_event([Input]::LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 120
        [Input]::mouse_event([Input]::LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
    }
    Start-Sleep -Milliseconds 450
}

function ShellWindow([string]$classPattern) {
    foreach ($w in $root.FindAll($children, $trueCond)) {
        if ($w.Current.ClassName -match $classPattern) { return $w }
    }
    return $null
}

function TrayButton([string]$name) {
    # Either promoted into Shell_TrayWnd or parked in the hidden-icons flyout. The flyout's
    # window keeps existing after it closes and still reports its last layout, so an element
    # that UIA calls off-screen is a stale rect: clicking it would hit whatever is behind.
    foreach ($cls in 'Shell_TrayWnd', 'TopLevelWindowForOverflowXamlIsland') {
        $host5 = ShellWindow $cls
        if (-not $host5) { continue }
        $hit = $host5.FindFirst($descendants, (ByName $name))
        if ($hit -and -not $hit.Current.IsOffscreen) { return $hit }
    }
    return $null
}

function CardWindow {
    foreach ($w in $root.FindAll($children, $trueCond)) {
        if ($w.Current.Name -eq 'Internet Speed Meter' -and $w.Current.ClassName -eq 'Window') { return $w }
    }
    return $null
}

function TopmostOfCard {
    $card = CardWindow
    if (-not $card) { return 'card-hidden' }
    $ex = [Input]::GetWindowLong([IntPtr]($card.Current.NativeWindowHandle), -20)
    return (($ex -band 0x8) -ne 0)      # WS_EX_TOPMOST
}

function MenuItems {
    $menu = ShellWindow 'WindowsForms'
    if (-not $menu) { return @() }
    $cond = New-Object System.Windows.Automation.PropertyCondition(
        $ae::ControlTypeProperty, [System.Windows.Automation.ControlType]::MenuItem)
    return @($menu.FindAll($descendants, $cond))
}

function TrayButtonOrOpen([string]$name) {
    $hit = TrayButton $name
    if ($hit) { return $hit }
    # The flyout is a window that only exists while open, and any click on one of its icons
    # closes it again.
    $chevron = TrayButton 'Show Hidden Icons'
    if (-not $chevron) { return $null }
    $p = Center $chevron
    Click $p[0] $p[1]
    return TrayButton $name
}

# The tray icon is the only way back once the card is hidden, so bring it up first if asked.
$visible = [bool](CardWindow)
$shouldClick = switch ($Card) {
    'show' { -not $visible }
    'hide' { $visible }
    'toggle' { $true }
    default { $false }
}
if ($shouldClick) {
    $icon = TrayButtonOrOpen 'Internet Speed Meter'
    if (-not $icon) { throw 'no tray icon and no chevron to open the flyout' }
    $p = Center $icon
    Click $p[0] $p[1]
    Start-Sleep -Milliseconds 700
    "card after left-clicking the tray icon: $(if (CardWindow) { 'visible' } else { 'hidden' })"
}

$icon = TrayButtonOrOpen 'Internet Speed Meter'
if (-not $icon) { throw "tray button 'Internet Speed Meter' not found" }
$c = Center $icon
"tray icon at $($c -join ',')"

# The flyout can swallow the first right-click while it is animating in, so retry rather than
# report a failure that belongs to the harness and not to the app.
$found = @()
for ($attempt = 1; $attempt -le 3 -and $found.Count -eq 0; $attempt++) {
    Click $c[0] $c[1] -Right
    $found = @(MenuItems)
    if ($found.Count -eq 0) {
        "attempt ${attempt}: no menu yet, reopening the flyout"
        $retry = TrayButtonOrOpen 'Internet Speed Meter'
        if ($retry) { $c = Center $retry }
    }
}
if ($found.Count -eq 0) { throw 'no context menu opened after 3 attempts' }
"menu items: $(($found | ForEach-Object { $_.Current.Name }) -join ' | ')"

$wanted = $found | Where-Object { $_.Current.Name -eq $Item } | Select-Object -First 1
if (-not $wanted) { throw "menu has no item named '$Item'" }
$c = Center $wanted
"topmost before: $(TopmostOfCard)"
if ($Method -eq 'invoke') {
    $pattern = $wanted.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $pattern.Invoke()
    Start-Sleep -Milliseconds 600
}
else {
    Click $c[0] $c[1]
}
"topmost after:  $(TopmostOfCard)"
