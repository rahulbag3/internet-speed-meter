@echo off
setlocal
rem Card size: default is --scale=0.6. Try --scale=0.5 for smaller or --scale=1 for full size.
rem Add --no-live after --stack to show only on-demand test results.
start "" "%~dp0bin\Release\net8.0-windows\InternetSpeedMeter.exe" --stack
endlocal
