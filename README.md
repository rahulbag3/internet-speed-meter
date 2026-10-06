# Internet Speed Meter

A small floating network meter for Windows. It shows live system throughput in the two
directions, keeps a short scrolling history, and can run an on-demand benchmark when you ask
it to. No window border, no title bar, no background panel, no taskbar button — just the card
on your desktop and an icon in the system tray.

| Expanded | Compact |
| --- | --- |
| ![Expanded](docs/preview.png) | ![Compact](docs/preview-compact.png) |

## Download

Grab the latest build from [Releases](../../releases):

- **`InternetSpeedMeter-Setup-x64.exe`** — installer. Per-user, so it asks for no administrator
  rights; adds an entry in *Add or remove programs* and a Start Menu shortcut.
- **`InternetSpeedMeter-portable-win-x64.zip`** — extract anywhere and run
  `InternetSpeedMeter.exe`. Self-contained: no .NET installation needed.

**Requires** Windows 10 or 11, 64-bit, and the [Evergreen Microsoft Edge WebView2 Runtime][webview2],
which is already present on current Windows 11 installs. The UI is rendered by WebView2.

## Using it

| | |
| --- | --- |
| Drag it | Press and drag anywhere on the card that is not a button |
| Live rates | Update once a second from the OS interface counters; drop to `Kbps` below 1 Mbps |
| Dot grid | The last 12 seconds of traffic per direction, oldest on the left |
| Run a benchmark | Press `↻` — it downloads and uploads against Cloudflare, then reports the sustained rate |
| Switch layout | The pill next to the status line toggles expanded / compact |
| Keep it on top | The pin button left of the layout switcher holds the card above other windows. A small LED lights green when it is on, and the choice is remembered between runs. The tray menu's `Keep on top` is the same switch, not a second one |
| Fade out when left alone | Three seconds after the pointer leaves, the card drops to 55% opacity; move back over it and it returns. Live traffic updates do not count as interaction |
| Hide it | Left-click the tray icon. Left-click again to bring it back — same window, so it returns where you left it |
| Close it | Right-click the tray icon → `Exit`. The card has no title bar and no taskbar button, so the tray menu is where the app is managed; `Alt` + `F4` also quits while the card has focus |

On Windows 11 a new tray icon usually starts out in the hidden-icons flyout: press the `^`
chevron in the tray to see it, and drag it onto the taskbar if you want it always visible.

The benchmark only ever runs on press. While it runs, and for five seconds afterwards, it owns
the readout; then live traffic resumes.

Command line:

```
InternetSpeedMeter.exe                      expanded layout, 0.6 scale, live traffic on
InternetSpeedMeter.exe --stack              compact layout
InternetSpeedMeter.exe --scale=1            full size (0.35 to 1.5)
InternetSpeedMeter.exe --no-live            benchmark results only, no continuous sampling
```

Leaving live sampling on costs about 1.25% of one core and 16 MB of working set.

## How it is built

WPF hosts a WebView2 control that renders the UI, so the card is HTML/CSS/JS rather than a
re-implementation in XAML. `Assets/speed-meter.html` is a verbatim copy of the design it
recreates and is deliberately never edited; every app-only behaviour (the frameless
transparent window, drag-to-move, non-selecting text, the live readout, the narrower compact
card) is layered on from `Assets/app-shell.js`, which the host injects at document creation.

Traffic comes from the `\Network Interface(*)\Bytes Received|Sent/sec` performance counters,
summed across adapters — see `TrafficSampler.cs`.

A layered transparent window is hit-tested from the WPF surface, so an almost-invisible plate in
that surface is what makes the card clickable at all. The page reports the card's live size to
the host, which resizes the plate to match and rounds it to the card's 28 px radius; without that
the plate is an invisible rectangle larger than the card and swallows clicks beside it. Anything
outside the card passes clicks straight through to the desktop.

The tray icon is a WinForms `NotifyIcon` in `TrayIcon.cs`, the only WinForms type in the build;
the desktop framework pack already carries that assembly, so it costs 205 KB compressed.
`ShowInTaskbar="False"` makes WPF re-parent the card to an invisible helper window, which is why
the screenshot probe treats a window as top-level whenever its owner is off screen.

`Assets/app.ico` is drawn rather than sourced: `tools/mkicon.ps1` renders the card's own surface
and the two arrow glyphs from the reference at 1024 px, then writes a 32-bit multi-size icon
(16 to 256 px, including the 20 and 40 px frames a 125% or 150% tray actually samples).

```
dotnet build -c Release                                    # debug build
powershell -File tools\mkicon.ps1                          # redraw Assets\app.ico + size proofs
dotnet publish -c Release -r win-x64 --self-contained true \
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true \
  -o publish/portable-win-x64                              # portable
ISCC.exe installer\installer.iss                           # installer -> dist\
```

## Verifying it against the reference

The point of this project is that the app is indistinguishable from the HTML design it
recreates, so the repo carries the harness that proves it rather than asking you to trust a
glance. It drives both the reference page (in a real browser window, so text antialiasing
matches) and the app over CDP, then compares every rectangle and computed style:

```
node tools/verify.mjs all --scale=1    # geometry, styles, and the layout-transition timing
node tools/verify.mjs onscreen         # pixel-diffs both windows as the desktop paints them
node tools/verify.mjs responsive       # six viewports, including both breakpoints
node tools/livetest.mjs                # live readout, benchmark handover, history scroll
```

Pass `--scale=1`: the suite attaches to the app over CDP by port, so an instance left running
from an earlier session answers instead of the one it just started, and at the shipping 0.6
scale every measurement lands on a 0.9 device-pixel ratio and the report fills with sub-pixel
rounding. `taskkill /IM InternetSpeedMeter.exe /F` first if anything is already running.

It needs the reference HTML, which is not in this repo: copy `tools/paths.local.example.json`
to `tools/paths.local.json` and point `referenceHtml` at it, or set `SM_REFERENCE_HTML`.
`tools/winshot` is a small C# probe used for window geometry, screen grabs, pixel diffs and
synthetic input.

## Acknowledgements

The idea of a network meter as a small self-contained desktop widget — rather than a window
with chrome around it — was inspired by Collect UI's
[Widget UI Design Inspiration](https://collectui.com/designs/widget-ui-design-inspiration/bc972294-314c-4ee0-b817-407061e33ac6)
collection. The card's own visual design comes from the HTML reference described above, not
from that gallery.

## Layout notes

The card's own design — dimensions, corner radius, shadow, typography, spacing, the
expanded/compact transition and its 450 ms `cubic-bezier(.22, 1, .36, 1)` easing — is the
reference's, unmodified. Deliberate departures exist, all declared in `app-shell.js`: the page
backdrop is transparent so the card can float, text does not select, a keep-on-top pin button is
inserted left of the layout switcher, and the whole card fades to 55% when idle. The fade is
applied to `<body>` rather than `.card` because the reference's layout transition assigns
`card.style.transition` and would drop it mid-animation — for the same reason none of the compact
overrides use `!important`: an `!important` rule outranks the inline `width`/`height` that the
transition pins, which collapses the resize into an instant jump.

The compact layout additionally drops the `DOWNLOAD` / `UPLOAD` labels and the status line,
keeping only the icons, the values and the controls — each row and the control group centred —
and narrows to 210 × 175 px. Consequence worth knowing: the status line is also where
"Measuring download…" and connection errors appear, so in compact mode the retest spinner is the
only progress feedback.

[webview2]: https://developer.microsoft.com/microsoft-edge/webview2/
