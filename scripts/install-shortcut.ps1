# Create a desktop shortcut for the AI Live3D desktop pet launcher.
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-shortcut.ps1

$ws = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$sc = $ws.CreateShortcut("$desktop\AI Live3D Pet.lnk")
$sc.TargetPath = 'D:\cc\codex\ai-live3d\start-pet.bat'
$sc.WorkingDirectory = 'D:\cc\codex\ai-live3d'
$sc.Description = 'AI Live3D desktop pet'
$sc.Save()
Write-Output "shortcut created: $desktop\AI Live3D Pet.lnk"
