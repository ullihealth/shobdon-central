// Single source of truth for capture-weathercentral.ps1's contents - both the
// downloadable file and the on-screen preview in AtcDeveloperTools.tsx render
// from this exact string, so they can never drift out of sync with each other.
export const CAPTURE_SCRIPT_FILENAME = 'capture-weathercentral.ps1'

export const CAPTURE_SCRIPT_CONTENTS = `<#
This script reads the local weather station page at 192.168.2.1 and sends
the data to a Cloudflare address (shobdon-central-capture.jeffthompson.workers.dev).

It does not modify any files on this computer, does not read anything else
on this computer or network, and does not install anything. It now runs
continuously, capturing on the interval below, until this window is closed
or the process is stopped (Ctrl+C) - it should be left running (minimizing
the window is fine, closing it stops the data feed).
#>

# Change this number to adjust how often it captures - e.g. 30 for every 30 seconds
$IntervalSeconds = 60

$StationUrl = "http://192.168.2.1/disp/adisp.php"
$WorkerUrl = "https://shobdon-central-capture.jeffthompson.workers.dev/?key=49f761797d8e1fe76898e079b997980f"

Write-Host "Starting continuous capture every $IntervalSeconds seconds. Minimize this window - do not close it. Press Ctrl+C to stop."

while ($true) {
    try {
        $response = Invoke-WebRequest -Uri $StationUrl -UseBasicParsing
        $capturedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

        $body = @{
            html       = $response.Content
            capturedAt = $capturedAt
        } | ConvertTo-Json

        Invoke-RestMethod -Uri $WorkerUrl -Method Post -Body $body -ContentType "application/json" | Out-Null

        Write-Host "Capture sent successfully at $capturedAt"
    } catch {
        Write-Host "Capture failed: $($_.Exception.Message)"
    }

    Start-Sleep -Seconds $IntervalSeconds
}
`
