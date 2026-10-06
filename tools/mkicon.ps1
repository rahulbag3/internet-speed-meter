<#
    mkicon.ps1 - draws the app icon and writes Assets/app.ico plus a 1024px master PNG.

    The art is the card itself translated down to 16px: the #121212 surface, and the reference's
    two arrow glyphs filled with the colours of the chips that carry them (download #6fb3c7,
    upload #b8491c). Nothing is invented, so the icon and the widget read as the same object.

    Run: powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\mkicon.ps1
    Writes:  Assets/app.ico, Assets/app-icon.png, verify/icon-proofs/*.png (gitignored)
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$masterSize = 1024
# 20 and 40 are what a 125% and 150% DPI tray actually samples; 256 covers Explorer and shortcuts.
$sizes = 16, 20, 24, 32, 40, 48, 64, 128, 256

$icoPath = Join-Path $root 'Assets/app.ico'
$pngPath = Join-Path $root 'Assets/app-icon.png'
$proofDir = Join-Path $root 'verify/icon-proofs'

$tileColor = [System.Drawing.Color]::FromArgb(255, 18, 18, 18)     # .card
$downloadColor = [System.Drawing.Color]::FromArgb(255, 111, 179, 199)  # .ic background, #t-dl
$uploadColor = [System.Drawing.Color]::FromArgb(255, 184, 73, 28)      # .ic background, #t-up

function New-RoundedPath {
    param([single]$X, [single]$Y, [single]$W, [single]$H, [single]$R)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $R * 2
    [void]$path.AddArc($X, $Y, $d, $d, 180, 90)
    [void]$path.AddArc($X + $W - $d, $Y, $d, $d, 270, 90)
    [void]$path.AddArc($X + $W - $d, $Y + $H - $d, $d, $d, 0, 90)
    [void]$path.AddArc($X, $Y + $H - $d, $d, $d, 90, 90)
    [void]$path.CloseFigure()
    $path
}

# The two <path d="..."> outlines from the reference's .ic arrows, in its 24-unit viewBox.
$arrowShapes = @{
    Download = @(@(12, 20.8), @(5.8, 14.6), @(9.7, 14.6), @(9.7, 5.4), @(14.3, 5.4), @(14.3, 14.6), @(18.2, 14.6))
    Upload   = @(@(12, 3.2), @(18.2, 9.4), @(14.3, 9.4), @(14.3, 18.6), @(9.7, 18.6), @(9.7, 9.4), @(5.8, 9.4))
}

function Get-ArrowPoints {
    param([string]$Name, [single]$Cx, [single]$Cy, [single]$Scale)
    $shape = $arrowShapes[$Name]
    $stats = ($shape | ForEach-Object { [double]$_[1] } | Measure-Object -Minimum -Maximum)
    $midY = ($stats.Minimum + $stats.Maximum) / 2
    $points = New-Object 'System.Drawing.PointF[]' $shape.Count
    for ($i = 0; $i -lt $shape.Count; $i++) {
        $px = [single]($Cx + ($shape[$i][0] - 12) * $Scale)
        $py = [single]($Cy + ($shape[$i][1] - $midY) * $Scale)
        $points[$i] = [System.Drawing.PointF]::new($px, $py)
    }
    $points
}

function New-MasterIcon {
    $format = [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    $bmp = [System.Drawing.Bitmap]::new($masterSize, $masterSize, $format)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $inset = 40
    $edge = $masterSize - 2 * $inset
    $tile = New-RoundedPath $inset $inset $edge $edge 168
    $brush = [System.Drawing.SolidBrush]::new($tileColor)
    $g.FillPath($brush, $tile)

    $scale = 30
    $span = 216
    $dl = [System.Drawing.SolidBrush]::new($downloadColor)
    $ul = [System.Drawing.SolidBrush]::new($uploadColor)
    # Download left, upload right, matching the order the expanded card uses.
    $g.FillPolygon($dl, (Get-ArrowPoints 'Download' (512 - $span) 512 $scale))
    $g.FillPolygon($ul, (Get-ArrowPoints 'Upload' (512 + $span) 512 $scale))

    foreach ($d in @($brush, $dl, $ul, $tile)) { $d.Dispose() }
    $g.Dispose()
    $bmp
}

function Resize-Icon {
    <# Halve repeatedly before the final draw; a single 1024->16 bicubic pass loses the arrows. #>
    param([System.Drawing.Bitmap]$Source, [int]$Target)
    $format = [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    $current = $Source
    while ($current.Width / 2 -ge $Target) {
        $half = [int]($current.Width / 2)
        $next = [System.Drawing.Bitmap]::new($half, $half, $format)
        $g = [System.Drawing.Graphics]::FromImage($next)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $dest = [System.Drawing.Rectangle]::new(0, 0, $half, $half)
        $g.DrawImage($current, $dest, 0, 0, $current.Width, $current.Height,
            [System.Drawing.GraphicsUnit]::Pixel)
        $g.Dispose()
        if ($current -ne $Source) { $current.Dispose() }
        $current = $next
    }
    if ($current.Width -eq $Target) { return $current }

    $final = [System.Drawing.Bitmap]::new($Target, $Target, $format)
    $g2 = [System.Drawing.Graphics]::FromImage($final)
    $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g2.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $dest2 = [System.Drawing.Rectangle]::new(0, 0, $Target, $Target)
    $g2.DrawImage($current, $dest2, 0, 0, $current.Width, $current.Height,
        [System.Drawing.GraphicsUnit]::Pixel)
    $g2.Dispose()
    if ($current -ne $Source) { $current.Dispose() }
    $final
}

function Get-DibBytes {
    <# 32bpp BGRA device-independent bitmap, bottom-up, with a cleared AND mask so the alpha
        channel carries transparency. GDI+ hands back premultiplied pixels; icon readers want
        straight alpha, so undo it before writing. #>
    param([System.Drawing.Bitmap]$Bitmap)
    $w = $Bitmap.Width
    $h = $Bitmap.Height
    $rowBytes = $w * 4
    $rect = [System.Drawing.Rectangle]::new(0, 0, $w, $h)
    $flags = [System.Drawing.Imaging.ImageLockMode]::ReadOnly
    $format = [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    $data = $Bitmap.LockBits($rect, $flags, $format)
    try {
        $top = New-Object 'byte[]' ($data.Stride * $h)
        $src = [System.IntPtr]$data.Scan0
        for ($y = 0; $y -lt $h; $y++) {
            [System.Runtime.InteropServices.Marshal]::Copy(
                [System.IntPtr]($src.ToInt64() + $y * $data.Stride), $top, $y * $data.Stride, $rowBytes)
        }
        for ($i = 0; $i -lt $top.Length; $i += 4) {
            $a = [int]$top[$i + 3]
            if ($a -gt 0 -and $a -lt 255) {
                for ($c = 0; $c -lt 3; $c++) {
                    $v = [int]([int]$top[$i + $c] * 255 / $a)
                    if ($v -gt 255) { $v = 255 }
                    $top[$i + $c] = [byte]$v
                }
            }
        }
    }
    finally {
        [void]$Bitmap.UnlockBits($data)
    }

    $bottom = New-Object 'byte[]' ($rowBytes * $h)
    for ($y = 0; $y -lt $h; $y++) {
        [Array]::Copy($top, $y * $data.Stride, $bottom, ($h - 1 - $y) * $rowBytes, $rowBytes)
    }

    $maskRow = [int](([Math]::Floor(($w + 31) / 32)) * 4)
    $msk = New-Object 'byte[]' ($maskRow * $h)

    $ms = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter($ms)
    $bw.Write([uint32]40)          # biSize
    $bw.Write([int32]$w)
    $bw.Write([int32]($h * 2))     # colour image + mask
    $bw.Write([uint16]1)           # biPlanes
    $bw.Write([uint16]32)
    $bw.Write([uint32]0)           # BI_RGB
    $bw.Write([uint32]($rowBytes * $h))
    $bw.Write([int32]0); $bw.Write([int32]0); $bw.Write([uint32]0); $bw.Write([uint32]0)
    $bw.Write($bottom)
    $bw.Write($msk)
    $bw.Flush()
    $ms.ToArray()
}

function Write-Ico {
    param([string]$Path, [object[]]$Images)
    $ms = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter($ms)
    $bw.Write([uint16]0)
    $bw.Write([uint16]1)           # type: icon
    $bw.Write([uint16]$Images.Count)
    $offset = 6 + 16 * $Images.Count
    foreach ($entry in $Images) {
        $s = [int]$entry.Size
        $bytes = [byte[]]$entry.Bytes
        # 256 is encoded as 0 in a one-byte dimension field.
        $dim = if ($s -ge 256) { 0 } else { $s }
        $bw.Write([byte]$dim)
        $bw.Write([byte]$dim)
        $bw.Write([byte]0)         # palette count
        $bw.Write([byte]0)         # reserved
        $bw.Write([uint16]1)       # planes
        $bw.Write([uint16]32)      # bit count
        $bw.Write([uint32]$bytes.Length)
        $bw.Write([uint32]$offset)
        $offset += $bytes.Length
    }
    foreach ($entry in $Images) { $bw.Write([byte[]]$entry.Bytes) }
    $bw.Flush()
    [System.IO.File]::WriteAllBytes($Path, $ms.ToArray())
    $bw.Dispose(); $ms.Dispose()
}

function Write-Proof {
    <# One row of every size on a shared top line, each blown up by $Zoom so a 16px entry can be
       judged without squinting. $Zoom 1 is the honest pixel view. #>
    param([object[]]$BySize, [string]$Path, [System.Drawing.Color]$Backdrop, [int]$Zoom)
    $pad = 18
    $gap = 26
    $totalWidth = 0
    $maxHeight = 0
    foreach ($entry in $BySize) {
        $side = [int]$entry.Size * $Zoom
        $totalWidth += $side + $gap
        if ($side -gt $maxHeight) { $maxHeight = $side }
    }
    $width = $totalWidth + $pad
    $height = $maxHeight + $pad * 2 + 22
    $format = [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    $bmp = [System.Drawing.Bitmap]::new($width, $height, $format)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear($Backdrop)
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
    $font = [System.Drawing.Font]::new('Segoe UI', 11)
    $label = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 138, 138, 138))
    $x = $pad
    foreach ($entry in $BySize) {
        $side = [int]$entry.Size * $Zoom
        $g.DrawImage($entry.Bitmap, $x, $pad, $side, $side)
        $g.DrawString("$($entry.Size)", $font, $label, $x, ($pad + $maxHeight + 6))
        $x += $side + $gap
    }
    $font.Dispose(); $label.Dispose(); $g.Dispose()
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

$master = New-MasterIcon
$master.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

# Keep the resized bitmaps alive for the proof strip, then dispose.
$resized = @()
foreach ($s in $sizes) {
    $small = Resize-Icon -Source $master -Target $s
    if ($small.Width -ne $s) { throw "resize produced $($small.Width)px for a ${s}px request" }
    $resized += [pscustomobject]@{ Size = $s; Bitmap = $small }
}

# The .ico wants the largest image first so readers that ignore the directory pick well.
$dibs = foreach ($entry in ($resized | Sort-Object -Property Size -Descending)) {
    [pscustomobject]@{ Size = $entry.Size; Bytes = (Get-DibBytes $entry.Bitmap) }
}
Write-Ico -Path $icoPath -Images $dibs

New-Item -ItemType Directory -Force -Path $proofDir | Out-Null
foreach ($zoom in 3, 1) {
    foreach ($backdrop in @{
        'dark' = [System.Drawing.Color]::FromArgb(255, 43, 43, 43)
        'light' = [System.Drawing.Color]::FromArgb(255, 241, 242, 243)
    }.GetEnumerator()) {
        Write-Proof -BySize $resized -Zoom $zoom -Backdrop $backdrop.Value `
            -Path (Join-Path $proofDir ("proof-{0}-{1}x.png" -f $backdrop.Key, $zoom))
    }
}

foreach ($entry in $resized) { $entry.Bitmap.Dispose() }
$master.Dispose()

Write-Host "wrote $icoPath ($((Get-Item $icoPath).Length) bytes) and $pngPath"
Write-Host "proofs: $proofDir"
