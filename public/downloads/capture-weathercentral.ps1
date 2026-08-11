<#
This script reads the local weather station page at 192.168.2.1 and sends
the data to a Cloudflare address (shobdon-central-capture.jeffthompson.workers.dev).

It does not modify any files on this computer, does not read anything else
on this computer or network, and does not install anything. It now runs
continuously, capturing on the interval below, until this window is closed
or the process is stopped (Ctrl+C) - it should be left running (minimizing
the window is fine, closing it stops the data feed).
#>

# Starting value only now, not the sole place this can change - see the
# live-reload check inside the loop below. Still used as-is until the
# first successful check, and as the fallback whenever a check fails, so
# this default matters exactly as much as it always did.
$IntervalSeconds = 60

$StationUrl = "http://192.168.2.1/disp/adisp.php"
$WorkerUrl = "https://shobdon-central-capture.jeffthompson.workers.dev/?key=49f761797d8e1fe76898e079b997980f"
# Same Worker, same key, a different endpoint - lets an admin change the
# interval above from /developertools without this script needing to be
# re-downloaded/restarted every time (only once, to pick up this
# live-reload capability itself). Checked roughly once a minute
# (IntervalCheckSeconds below), independent of $IntervalSeconds itself -
# a short capture interval would otherwise mean checking far more often
# than needed, and a long one would mean waiting a full cycle to notice
# a change.
$IntervalCheckUrl = "https://shobdon-central-capture.jeffthompson.workers.dev/capture-interval?key=49f761797d8e1fe76898e079b997980f"
$IntervalCheckSeconds = 60
# Deliberately a date far in the past, not (Get-Date) - forces the very
# first loop iteration to check immediately (and sync up with whatever
# is actually configured right now) instead of running at the hardcoded
# default above for up to a full minute first.
$lastIntervalCheckAt = Get-Date -Year 2000

# The station serves Windows-1252 / ISO-8859-1 text (its degree symbol is
# byte 0xB0), but PowerShell's automatic encoding detection can misread
# that as UTF-8, turning the degree symbol into a corrupted replacement
# character - which then breaks wind parsing downstream. Reading the raw
# response bytes and explicitly decoding them with this encoding avoids
# that guesswork.
$StationEncoding = [System.Text.Encoding]::GetEncoding("Windows-1252")

Write-Host "Starting continuous capture every $IntervalSeconds seconds. Minimize this window - do not close it. Press Ctrl+C to stop."

while ($true) {
    # Live-reload check - deliberately time-based, not iteration-count-
    # based, so it fires at roughly the same real-world cadence
    # (~once/minute) no matter what $IntervalSeconds currently is. Any
    # failure here (network hiccup, endpoint down, unexpected response
    # shape) leaves $IntervalSeconds completely untouched - this block
    # never lets a problem here affect the capture loop below, only
    # possibly updates the number or leaves it exactly as it was.
    if (((Get-Date) - $lastIntervalCheckAt).TotalSeconds -ge $IntervalCheckSeconds) {
        try {
            $intervalResponse = Invoke-RestMethod -Uri $IntervalCheckUrl -Method Get
            $rawValue = $intervalResponse.captureIntervalSeconds
            if ($null -ne $rawValue) {
                $newInterval = [int]$rawValue
                if ($newInterval -gt 0 -and $newInterval -ne $IntervalSeconds) {
                    Write-Host "Capture interval changed: $IntervalSeconds -> $newInterval seconds"
                    $IntervalSeconds = $newInterval
                }
            }
        } catch {
            Write-Host "Interval check failed, keeping current interval ($IntervalSeconds seconds): $($_.Exception.Message)"
        }
        $lastIntervalCheckAt = Get-Date
    }

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
