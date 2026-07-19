param(
  [string]$DatabaseName = "neev-identity-db",
  [string]$BucketName = "neev-identity-documents"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$wrangler = Join-Path $repoRoot "node_modules\.bin\wrangler.cmd"
$vinext = Join-Path $repoRoot "node_modules\.bin\vinext.cmd"
$secretFile = Join-Path $repoRoot ".env.local"
$generatedConfig = Join-Path $repoRoot "dist\server\wrangler.json"

Set-Location $repoRoot
$env:WRANGLER_WRITE_LOGS = "false"
$env:WRANGLER_LOG_PATH = Join-Path $repoRoot ".wrangler\logs"
$env:MINIFLARE_REGISTRY_PATH = Join-Path $repoRoot ".wrangler\registry"

if (-not (Test-Path $wrangler)) {
  throw "Dependencies are missing. Run npm install first."
}

if (-not (Test-Path $secretFile)) {
  throw "Missing .env.local. Copy .env.example to .env.local and add your API keys."
}

Write-Host "Checking Cloudflare authentication..."
$savedErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$authenticationOutput = (& $wrangler whoami 2>&1 | Out-String)
$authenticationExitCode = $LASTEXITCODE
$ErrorActionPreference = $savedErrorActionPreference
$authenticationOutput | Write-Host
if (
  $authenticationExitCode -ne 0 -or
  $authenticationOutput -match "not authenticated"
) {
  throw "Cloudflare is not authenticated. Run: npx wrangler login"
}

Write-Host "Finding or creating D1 database '$DatabaseName'..."
$databaseListText = (& $wrangler d1 list --json 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) {
  throw "Unable to list Cloudflare D1 databases.`n$databaseListText"
}
$databaseList = $databaseListText | ConvertFrom-Json
$database = $databaseList | Where-Object { $_.name -eq $DatabaseName } | Select-Object -First 1

if (-not $database) {
  $createOutput = (& $wrangler d1 create $DatabaseName --location apac 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to create the D1 database.`n$createOutput"
  }
  $databaseIdMatch = [regex]::Match(
    $createOutput,
    "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
  )
  if (-not $databaseIdMatch.Success) {
    throw "D1 was created, but its database ID could not be read. Run 'npx wrangler d1 list --json' and try again."
  }
  $databaseId = $databaseIdMatch.Value
} else {
  $databaseId = $database.uuid
  if (-not $databaseId) { $databaseId = $database.id }
}

if (-not $databaseId) {
  throw "Could not determine the D1 database ID."
}

Write-Host "Finding or creating R2 bucket '$BucketName'..."
$savedErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$bucketList = (& $wrangler r2 bucket list 2>&1 | Out-String)
$bucketListExitCode = $LASTEXITCODE
$ErrorActionPreference = $savedErrorActionPreference
if ($bucketListExitCode -ne 0) {
  if ($bucketList -match "enable R2|code:\s*10042") {
    throw @"
R2 is not enabled for this Cloudflare account.
Open https://dash.cloudflare.com/?to=%2F%3Aaccount%2Fr2%2Foverview,
select Storage & databases > R2 > Overview, and complete the R2 subscription
checkout. Cloudflare includes free monthly R2 usage. Then rerun:
npm run deploy:cloudflare
"@
  }
  throw "Unable to list R2 buckets. Enable R2 in the Cloudflare dashboard, then try again.`n$bucketList"
}
if ($bucketList -notmatch [regex]::Escape($BucketName)) {
  & $wrangler r2 bucket create $BucketName --location apac | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to create the R2 bucket."
  }
}

$env:CLOUDFLARE_D1_DATABASE_NAME = $DatabaseName
$env:CLOUDFLARE_D1_DATABASE_ID = $databaseId
$env:CLOUDFLARE_R2_BUCKET_NAME = $BucketName

Write-Host "Building the Cloudflare Worker..."
& $vinext build | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw "The production build failed."
}

Write-Host "Applying D1 database migrations..."
& $wrangler d1 migrations apply DB --remote --config $generatedConfig | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw "The D1 migrations failed."
}

Write-Host "Deploying Worker and encrypted secrets..."
& $wrangler deploy --config $generatedConfig --secrets-file $secretFile | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw "Cloudflare deployment failed."
}

Write-Host "Deployment complete. The live URL is shown above."
