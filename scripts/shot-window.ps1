# Screenshot a top-level window by title AND owner process name.
# Usage: powershell -NoProfile -File scripts\shot-window.ps1 <title> <procName> <outPng>
param(
  [Parameter(Mandatory = $true)][string]$Title,
  [Parameter(Mandatory = $true)][string]$ProcName,
  [Parameter(Mandatory = $true)][string]$OutPng
)

Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinShot {
  public delegate bool CB(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(CB cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  public struct R { public int L, T, Rt, B; }
  public static IntPtr Hit = IntPtr.Zero;
  public static uint HitPid = 0;
}
'@

$cb = [WinShot+CB] {
  param($h, $l)
  $pid2 = [uint32]0
  [WinShot]::GetWindowThreadProcessId($h, [ref]$pid2) | Out-Null
  $sb = New-Object System.Text.StringBuilder 128
  [WinShot]::GetWindowText($h, $sb, 128) | Out-Null
  if ($sb.ToString() -eq $Title) {
    $proc = Get-Process -Id ([int]$pid2) -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -eq $ProcName) {
      [WinShot]::Hit = $h
      [WinShot]::HitPid = $pid2
    }
  }
  return $true
}
[WinShot]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null

if ([WinShot]::Hit -eq [IntPtr]::Zero) {
  Write-Output "window NOT found: [$ProcName] $Title"
  exit 1
}

$r = New-Object WinShot+R
[WinShot]::GetWindowRect([WinShot]::Hit, [ref]$r) | Out-Null
$w = [int]($r.Rt - $r.L)
$ht = [int]($r.B - $r.T)
$bmp = New-Object System.Drawing.Bitmap $w, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen([int]$r.L, [int]$r.T, 0, 0, (New-Object System.Drawing.Size $w, $ht))
$bmp.Save($OutPng)
$g.Dispose()
$bmp.Dispose()
Write-Output "saved $w x $ht to $OutPng (pid $($script:x = [WinShot]::HitPid; $x))"
