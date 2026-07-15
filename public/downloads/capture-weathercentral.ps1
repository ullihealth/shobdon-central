<#
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

# The station serves Windows-1252 / ISO-8859-1 text (its degree symbol is
# byte 0xB0), but PowerShell's automatic encoding detection can misread
# that as UTF-8, turning the degree symbol into a corrupted replacement
# character - which then breaks wind parsing downstream. Reading the raw
# response bytes and explicitly decoding them with this encoding avoids
# that guesswork.
$StationEncoding = [System.Text.Encoding]::GetEncoding("Windows-1252")

Write-Host "Starting continuous capture every $IntervalSeconds seconds. Minimize this window - do not close it. Press Ctrl+C to stop."

while ($true) {
    try {
        $response = Invoke-WebRequest -Uri $StationUrl -UseBasicParsing
        $html = $StationEncoding.GetString($response.RawContentStream.ToArray())

        # Safety net: even with the correct encoding above, replace any
        # still-unrecognized character sitting between a wind direction
        # and its speed (e.g. a leftover mangled byte) with a plain degree
        # sign - the exact character the Worker's parser already expects.
        $html = $html -replace '(\d+)[^\d/]*\/\s*([\d.]+)\s*kt', '$1°/$2kt'

        $capturedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

        $body = @{
            html       = $html
            capturedAt = $capturedAt
        } | ConvertTo-Json

        Invoke-RestMethod -Uri $WorkerUrl -Method Post -Body $body -ContentType "application/json" | Out-Null

        Write-Host "Capture sent successfully at $capturedAt"
    } catch {
        Write-Host "Capture failed: $($_.Exception.Message)"
    }

    Start-Sleep -Seconds $IntervalSeconds
}
