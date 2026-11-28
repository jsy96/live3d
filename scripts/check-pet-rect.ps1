Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class PetRect2 {
  public delegate bool CB(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(CB cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  public struct R { public int L, T, Rt, B; }
  public static IntPtr Hit = IntPtr.Zero;
  public static bool Vis = false;
}
'@
$cb = [PetRect2+CB] {
  param($h, $l)
  $p = [uint32]0
  [PetRect2]::GetWindowThreadProcessId($h, [ref]$p) | Out-Null
  $proc = ''
  try { $proc = (Get-Process -Id ([int]$p) -ErrorAction Stop).ProcessName } catch {}
  $sb = New-Object System.Text.StringBuilder 128
  [PetRect2]::GetWindowText($h, $sb, 128) | Out-Null
  if ($proc -eq 'electron' -and $sb.ToString() -eq 'AI Live3D') {
    [PetRect2]::Hit = $h
    [PetRect2]::Vis = [PetRect2]::IsWindowVisible($h)
  }
  return $true
}
[PetRect2]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
$r = New-Object PetRect2+R
[PetRect2]::GetWindowRect([PetRect2]::Hit, [ref]$r) | Out-Null
Write-Output ("visible={0} rect={1},{2} {3}x{4}" -f [PetRect2]::Vis, $r.L, $r.T, ($r.Rt-$r.L), ($r.B-$r.T))
