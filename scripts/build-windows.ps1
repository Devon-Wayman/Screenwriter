param(
    [string]$Preset = "windows-release",
    [string]$BuildType = "Release",
    [string]$Architecture = "x64",
    [string]$QtDir = "",
    [switch]$Clean
)

$ErrorActionPreference = "Stop"

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$BuildDir = Join-Path $RootDir "build\windows-release"
$DistDir = Join-Path $RootDir "dist\windows"

function Assert-NativeCommandSucceeded {
    param([string]$Step)

    if ($LASTEXITCODE -ne 0) {
        throw "$Step failed with exit code $LASTEXITCODE"
    }
}

function Import-BatchEnvironment {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BatchFile,
        [string]$Arguments = ""
    )

    if (-not (Test-Path $BatchFile)) {
        throw "Batch file was not found: $BatchFile"
    }

    $command = "`"$BatchFile`" $Arguments >nul && set"
    $environment = & cmd.exe /s /c $command
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to initialize environment with $BatchFile $Arguments"
    }

    foreach ($line in $environment) {
        if ($line -match "^(.*?)=(.*)$") {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
        }
    }
}

function Initialize-MSVCEnvironment {
    param([string]$Architecture)

    if (Get-Command cl.exe -ErrorAction SilentlyContinue) {
        return
    }

    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (-not (Test-Path $vswhere)) {
        throw @"
No C++ compiler was found in PATH, and vswhere.exe was not found.
Install "Desktop development with C++" from Visual Studio Installer, then rerun this script.
"@
    }

    $vsInstall = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if (-not $vsInstall) {
        throw @"
No Visual Studio C++ toolchain was found.
Install "Desktop development with C++" from Visual Studio Installer, then rerun this script.
"@
    }

    $vcvars = Join-Path $vsInstall "VC\Auxiliary\Build\vcvarsall.bat"
    Import-BatchEnvironment -BatchFile $vcvars -Arguments $Architecture
}

function Resolve-QtDirectory {
    param([string]$RequestedQtDir)

    $candidates = @()
    if ($RequestedQtDir) {
        $candidates += $RequestedQtDir
    }
    if ($env:Qt6_DIR) {
        $candidates += (Split-Path (Split-Path $env:Qt6_DIR -Parent) -Parent)
    }
    if ($env:QTDIR) {
        $candidates += $env:QTDIR
    }
    $candidates += @(
        "C:\Qt\6.11.1\msvc2022_64",
        "C:\Qt\6.10.0\msvc2022_64",
        "C:\Qt\6.9.3\msvc2022_64"
    )

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path (Join-Path $candidate "lib\cmake\Qt6\Qt6Config.cmake"))) {
            return (Resolve-Path $candidate).Path
        }
    }

    return $null
}

Initialize-MSVCEnvironment -Architecture $Architecture
$ResolvedQtDir = Resolve-QtDirectory -RequestedQtDir $QtDir

if (-not $ResolvedQtDir) {
    throw @"
Qt 6 for MSVC was not found.
Install Qt 6 with the MSVC 2022 64-bit kit, or pass -QtDir C:\Path\To\Qt\msvc2022_64.
"@
}

if ($Clean -and (Test-Path $BuildDir)) {
    cmake -E rm -rf $BuildDir
    Assert-NativeCommandSucceeded "Clean build directory"
}

cmake --preset $Preset "-DCMAKE_BUILD_TYPE=$BuildType" "-DCMAKE_PREFIX_PATH=$ResolvedQtDir"
Assert-NativeCommandSucceeded "Configure"
cmake --build --preset $Preset --config $BuildType
Assert-NativeCommandSucceeded "Build"
cmake -E rm -rf $DistDir
Assert-NativeCommandSucceeded "Clean dist directory"
cmake --install $BuildDir --prefix $DistDir --config $BuildType
Assert-NativeCommandSucceeded "Install"

$ExePath = Join-Path $DistDir "Screenwriter.exe"
$DeployTool = Get-Command windeployqt -ErrorAction SilentlyContinue
if ($DeployTool) {
    $DeployToolPath = $DeployTool.Source
} else {
    $QtDeployTool = Join-Path $ResolvedQtDir "bin\windeployqt.exe"
    if (Test-Path $QtDeployTool) {
        $DeployToolPath = $QtDeployTool
    }
}
if ($DeployToolPath -and (Test-Path $ExePath)) {
    & $DeployToolPath --release $ExePath
    Assert-NativeCommandSucceeded "Qt deployment"
} else {
    Write-Host "windeployqt was not found or the executable was not staged. Run from a Qt command prompt to bundle Qt DLLs."
}

Write-Host "Windows build staged at $DistDir"
Write-Host "Run $ExePath"
