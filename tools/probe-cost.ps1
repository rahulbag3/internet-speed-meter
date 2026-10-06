param([string]$Extra = '', [int]$Seconds = 20)

$exe = Join-Path (Split-Path $PSScriptRoot -Parent) 'bin\Release\net8.0-windows\InternetSpeedMeter.exe'
Stop-Process -Name InternetSpeedMeter -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800

if ($Extra) { Start-Process -FilePath $exe -ArgumentList ($Extra -split ' ') | Out-Null }
else        { Start-Process -FilePath $exe | Out-Null }
Start-Sleep -Seconds 6   # let WebView2 finish starting up

function Snap {
  $ps = @(Get-Process -Name InternetSpeedMeter -ErrorAction SilentlyContinue)
  [pscustomobject]@{
    Cpu = ($ps | Measure-Object CPU -Sum).Sum
    Mem = ($ps | Measure-Object WorkingSet64 -Sum).Sum / 1MB
    N   = $ps.Count
  }
}

$a = Snap
Start-Sleep -Seconds $Seconds
$b = Snap

"args        : '$Extra'"
"processes   : $($b.N)"
"cpu over $Seconds`s : $('{0:N2}' -f ($b.Cpu - $a.Cpu)) s  ->  $('{0:N2}' -f (($b.Cpu - $a.Cpu) / $Seconds * 100))% of one core"
"working set : $('{0:N0}' -f $b.Mem) MB"
