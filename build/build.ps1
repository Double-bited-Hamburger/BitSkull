# Rebuilds BitSkull.exe from the app files. Uses the C# compiler that ships with Windows.
# Run:  powershell -ExecutionPolicy Bypass -File build\build.ps1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }

$resArgs = @()
foreach ($dir in 'css', 'js', 'assets') {
  Get-ChildItem (Join-Path $root $dir) -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($root.Length + 1).Replace('\', '/')
    $resArgs += "/resource:`"$($_.FullName)`",app/$rel"
  }
}
$resArgs += "/resource:`"$(Join-Path $root 'index.html')`",app/index.html"

$out = Join-Path $root 'BitSkull.exe'
& $csc /nologo /target:winexe /optimize+ /platform:anycpu "/win32icon:$(Join-Path $here 'bitskull.ico')" `
  /reference:System.Windows.Forms.dll "/out:$out" @resArgs (Join-Path $here 'Launcher.cs')
if ($LASTEXITCODE -ne 0) { throw "Build failed" }
Get-Item $out | Select-Object Name, Length
