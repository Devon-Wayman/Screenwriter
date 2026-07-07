param(
    [string]$Generator = "Ninja",
    [string]$BuildType = "Release"
)

$ErrorActionPreference = "Stop"

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$BuildDir = Join-Path $RootDir "build\windows-release"
$DistDir = Join-Path $RootDir "dist\windows"

cmake -S $RootDir -B $BuildDir -G $Generator -DCMAKE_BUILD_TYPE=$BuildType
cmake --build $BuildDir --config $BuildType
cmake -E rm -rf $DistDir
cmake --install $BuildDir --prefix $DistDir

$ExePath = Join-Path $DistDir "bin\Screenwriter.exe"
$DeployTool = Get-Command windeployqt -ErrorAction SilentlyContinue
if ($DeployTool -and (Test-Path $ExePath)) {
    & $DeployTool.Source $ExePath
} else {
    Write-Host "windeployqt was not found or the executable was not staged. Run from a Qt command prompt to bundle Qt DLLs."
}

Write-Host "Windows build staged at $DistDir"
