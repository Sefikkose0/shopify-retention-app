$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
Set-Location $PSScriptRoot

Write-Host "Retention Engine baslatiliyor..." -ForegroundColor Cyan

# Tunnel
Start-Job -Name "tunnel" -ScriptBlock {
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
    Set-Location $using:PSScriptRoot
    lt --port 3000 --subdomain retention-engine-sefik 2>&1
} | Out-Null

# Sunucu
Start-Job -Name "server" -ScriptBlock {
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
    Set-Location $using:PSScriptRoot
    npx tsx src/server.ts 2>&1
} | Out-Null

Start-Sleep -Seconds 5

Write-Host ""
Write-Host "Uygulama HAZIR!" -ForegroundColor Green
Write-Host "Yerel:  http://localhost:3000" -ForegroundColor Yellow
Write-Host "Public: https://retention-engine-sefik.loca.lt" -ForegroundColor Yellow
Write-Host ""
Write-Host "Durdurmak icin: Get-Job | Remove-Job -Force" -ForegroundColor Gray

# Canlı log göster
while ($true) {
    $serverOutput = Receive-Job -Name "server" -ErrorAction SilentlyContinue
    if ($serverOutput) { Write-Host $serverOutput }
    Start-Sleep -Seconds 2
}
