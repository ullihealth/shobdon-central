# Shobdon Central - local loopback relay
#
# Runs on ATC PC2 only. Listens on http://localhost:8791/adisp and, on each
# request, fetches the real WeatherLink station page server-side (not subject
# to any browser restriction) and returns the raw body. This exists solely
# because browsers block a direct fetch() from the HTTPS-served dashboard to
# the station's plain-HTTP private-network address - localhost is exempt from
# that block, so the dashboard talks to this relay instead of the station
# directly. See project README for the full diagnosis.
#
# Fixed, single-purpose by design: one upstream URL, GET only, no auth.

$Port = 8791
$Path = "/adisp"
$UpstreamUrl = "http://192.168.2.1/disp/adisp.php"
$UpstreamTimeoutMs = 8000

$listener = New-Object System.Net.HttpListener
$prefix = "http://localhost:$Port/"
$listener.Prefixes.Add($prefix)

try {
    $listener.Start()
} catch {
    Write-Host "Could not start listener on $prefix"
    Write-Host "Error: $($_.Exception.Message)"
    Write-Host ""
    Write-Host "If this says 'Access is denied', either run this script as Administrator,"
    Write-Host "or run this once from an elevated prompt and try again:"
    Write-Host "  netsh http add urlacl url=$prefix user=Everyone"
    exit 1
}

Write-Host "Relay listening on http://localhost:$Port$Path"
Write-Host "Forwarding to: $UpstreamUrl"
Write-Host "Leave this window open while using Shobdon Central. Press Ctrl+C to stop."
Write-Host ""

function Add-CorsHeaders($response) {
    $response.Headers.Add("Access-Control-Allow-Origin", "*")
    $response.Headers.Add("Access-Control-Allow-Private-Network", "true")
}

while ($listener.IsListening) {
    $context = $null
    try {
        $context = $listener.GetContext()
    } catch {
        break
    }

    $request = $context.Request
    $response = $context.Response
    $timestamp = Get-Date -Format "HH:mm:ss"

    try {
        Add-CorsHeaders $response

        if ($request.HttpMethod -eq "OPTIONS") {
            $response.Headers.Add("Access-Control-Allow-Methods", "GET, OPTIONS")
            $response.StatusCode = 204
            $response.OutputStream.Close()
            continue
        }

        if ($request.HttpMethod -ne "GET" -or $request.Url.AbsolutePath -ne $Path) {
            $response.StatusCode = 404
            $bytes = [System.Text.Encoding]::UTF8.GetBytes("Not found")
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            $response.OutputStream.Close()
            continue
        }

        Write-Host "$timestamp GET $Path -> forwarding to $UpstreamUrl"

        $httpClient = New-Object System.Net.Http.HttpClient
        $httpClient.Timeout = [TimeSpan]::FromMilliseconds($UpstreamTimeoutMs)

        try {
            $upstreamResponse = $httpClient.GetAsync($UpstreamUrl).GetAwaiter().GetResult()
            $body = $upstreamResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            $contentType = $upstreamResponse.Content.Headers.ContentType
            if ($contentType) {
                $response.ContentType = $contentType.ToString()
            } else {
                $response.ContentType = "text/html"
            }
            $response.StatusCode = [int]$upstreamResponse.StatusCode
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            Write-Host "$timestamp Upstream responded $([int]$upstreamResponse.StatusCode), $($bytes.Length) bytes"
        } catch {
            $response.StatusCode = 504
            $errorMessage = "Relay error: $($_.Exception.Message)"
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($errorMessage)
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            Write-Host "$timestamp Upstream error: $($_.Exception.Message)"
        } finally {
            $httpClient.Dispose()
        }

        $response.OutputStream.Close()
    } catch {
        Write-Host "$timestamp Request handling error: $($_.Exception.Message)"
        try { $response.OutputStream.Close() } catch {}
    }
}
