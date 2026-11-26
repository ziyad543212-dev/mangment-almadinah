[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][uri]$Url,
    [ValidateRange(1, 180)][int]$TimeoutSeconds = 90,
    [switch]$HealthJson
)

$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
do {
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            if (-not $HealthJson -or (($response.Content | ConvertFrom-Json).status -eq 'ok')) {
                exit 0
            }
        }
    } catch {
        # The server may still be connecting to PostgreSQL or starting Vite.
    }
    if ([DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 400 }
} while ([DateTime]::UtcNow -lt $deadline)

Write-Error "Service did not become ready: $Url" -ErrorAction Continue
exit 1
