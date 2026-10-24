param()

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WxShotDpi {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
[WxShotDpi]::SetProcessDPIAware() | Out-Null

[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$stdin = [Console]::In
$stdout = [Console]::Out
$stdout.WriteLine('READY')
$stdout.Flush()

while ($true) {
  $line = $stdin.ReadLine()
  if ($null -eq $line) { break }
  if ($line -eq 'QUIT') { break }
  if ([string]::IsNullOrWhiteSpace($line)) { continue }

  $id = 0
  try {
    $cmd = $line | ConvertFrom-Json
    $id = [int]$cmd.id
    foreach ($shot in $cmd.shots) {
      $w = [int]$shot.width
      $h = [int]$shot.height
      if ($w -le 0 -or $h -le 0) { throw 'invalid size' }
      $bmp = New-Object System.Drawing.Bitmap $w, $h
      try {
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try {
          $g.CopyFromScreen([int]$shot.x, [int]$shot.y, 0, 0, (New-Object System.Drawing.Size $w, $h))
        } finally {
          $g.Dispose()
        }
        $bmp.Save([string]$shot.file, [System.Drawing.Imaging.ImageFormat]::Png)
      } finally {
        $bmp.Dispose()
      }
    }
    $stdout.WriteLine("DONE $id 1")
  } catch {
    $stdout.WriteLine("DONE $id 0")
  }
  $stdout.Flush()
}
