param(
    [ValidateSet("help", "install", "dev", "test", "lint", "format", "migrate", "seed", "reset-db", "e2e", "docker-up", "docker-down")]
    [string]$Task = "help"
)

$ErrorActionPreference = "Stop"
$ApiDir = Join-Path $PSScriptRoot "apps/api"
$WebDir = Join-Path $PSScriptRoot "apps/web"
$VenvDir = Join-Path $ApiDir ".venv"
$ApiPython = Join-Path $VenvDir "Scripts/python.exe"
$LocalDatabaseUrl = if ($env:LOCAL_DATABASE_URL) { $env:LOCAL_DATABASE_URL } else { "sqlite:///./gym.db" }
$LocalApiPort = if ($env:LOCAL_API_PORT) { $env:LOCAL_API_PORT } else { "8001" }
$LocalWebPort = if ($env:LOCAL_WEB_PORT) { $env:LOCAL_WEB_PORT } else { "5174" }

function Invoke-Checked {
    param([string]$Directory, [scriptblock]$Command)
    Push-Location $Directory
    try {
        & $Command
        if ($LASTEXITCODE -ne 0) { throw "Command failed with exit code $LASTEXITCODE" }
    }
    finally {
        Pop-Location
    }
}

function Assert-ApiEnvironment {
    if (-not (Test-Path -LiteralPath $ApiPython)) {
        throw "API environment not found. Run './tasks.ps1 install' first."
    }
}

switch ($Task) {
    "help" {
        @(
            "install      Install API and web dependencies"
            "dev          Run API and web locally with SQLite"
            "test         Run backend and frontend tests"
            "lint         Run configured linters"
            "format       Run configured formatters"
            "migrate      Apply local database migrations"
            "seed         Load development seed data"
            "reset-db     Recreate the local SQLite database"
            "e2e          Run the frontend end-to-end script"
            "docker-up    Build and start the Compose stack"
            "docker-down  Stop the Compose stack"
        )
    }
    "install" {
        if (-not (Test-Path -LiteralPath $ApiPython)) {
            python -m venv $VenvDir
            if ($LASTEXITCODE -ne 0) { throw "Could not create the API virtual environment" }
        }
        if (Test-Path (Join-Path $ApiDir "requirements.txt")) {
            Invoke-Checked $ApiDir { & $ApiPython -m pip install -r requirements.txt }
        }
        elseif (Test-Path (Join-Path $ApiDir "pyproject.toml")) {
            Invoke-Checked $ApiDir { & $ApiPython -m pip install -e ".[dev]" }
        }
        else {
            throw "API dependency manifest not found"
        }
        Invoke-Checked $ApiDir { & $ApiPython -m app.download_models }
        Invoke-Checked $WebDir { npm install }
    }
    "dev" {
        Assert-ApiEnvironment
        $env:DATABASE_URL = $LocalDatabaseUrl
        $env:VITE_PROXY_TARGET = "http://localhost:$LocalApiPort"
        $api = Start-Process $ApiPython -ArgumentList "-m", "uvicorn", "app.main:app", "--reload", "--host", "0.0.0.0", "--port", $LocalApiPort -WorkingDirectory $ApiDir -NoNewWindow -PassThru
        $web = Start-Process npm.cmd -ArgumentList "run", "dev", "--", "--host", "0.0.0.0", "--port", $LocalWebPort -WorkingDirectory $WebDir -NoNewWindow -PassThru
        try {
            while (-not $api.HasExited -and -not $web.HasExited) { Start-Sleep -Seconds 1 }
            if ($api.HasExited -and $api.ExitCode -ne 0) { throw "API exited with code $($api.ExitCode)" }
            if ($web.HasExited -and $web.ExitCode -ne 0) { throw "Web exited with code $($web.ExitCode)" }
        }
        finally {
            @($api, $web) | Where-Object { $_ -and -not $_.HasExited } | Stop-Process
        }
    }
    "test" {
        Assert-ApiEnvironment
        Invoke-Checked $ApiDir { & $ApiPython -m pytest }
        Invoke-Checked $WebDir { npm test }
    }
    "lint" {
        Assert-ApiEnvironment
        Invoke-Checked $ApiDir { & $ApiPython -m ruff check . }
        Invoke-Checked $WebDir { npm run lint }
    }
    "format" {
        Assert-ApiEnvironment
        Invoke-Checked $ApiDir { & $ApiPython -m ruff format . }
        Invoke-Checked $WebDir { npm exec -- eslint . --fix }
    }
    "migrate" {
        Assert-ApiEnvironment
        $env:DATABASE_URL = $LocalDatabaseUrl
        Invoke-Checked $ApiDir { & $ApiPython -m alembic upgrade head }
    }
    "seed" {
        Assert-ApiEnvironment
        $env:DATABASE_URL = $LocalDatabaseUrl
        Invoke-Checked $ApiDir { & $ApiPython -m app.seed }
    }
    "reset-db" {
        @("gym.db", "gym.db-shm", "gym.db-wal") | ForEach-Object {
            $path = Join-Path $ApiDir $_
            if (Test-Path $path) { Remove-Item -LiteralPath $path -Force }
        }
        & $PSCommandPath migrate
        & $PSCommandPath seed
    }
    "e2e" {
        $package = Get-Content (Join-Path $WebDir "package.json") -Raw | ConvertFrom-Json
        if (-not $package.scripts.e2e) { throw "Frontend e2e script is not configured yet" }
        Invoke-Checked $WebDir { npm run e2e }
    }
    "docker-up" { Invoke-Checked $PSScriptRoot { docker compose up --build } }
    "docker-down" { Invoke-Checked $PSScriptRoot { docker compose down } }
}
