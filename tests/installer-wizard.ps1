param([Parameter(Mandatory=$true)][string]$Setup, [Parameter(Mandatory=$true)][string]$InstallDir)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class WizardUI {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr arg);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hwnd, EnumProc callback, IntPtr arg);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr wparam, IntPtr lparam);
  [DllImport("user32.dll", EntryPoint="SendMessageW", CharSet=CharSet.Unicode)] public static extern IntPtr SetText(IntPtr hwnd, uint msg, IntPtr wparam, string text);
}
'@
$process = Start-Process -FilePath $Setup -PassThru
function Find-Control([string]$Text, [string]$Class = '') {
  $deadline = (Get-Date).AddSeconds(120)
  do {
    $process.Refresh()
    if ($process.HasExited) { throw "Installer exited before control appeared: $Text" }
    $script:found = $null
    if ($process.MainWindowHandle -ne [IntPtr]::Zero) {
      $callback = [WizardUI+EnumProc] {
        param($handle, $arg)
        if ([WizardUI]::IsWindowVisible($handle)) {
          $label = New-Object System.Text.StringBuilder 2048
          $type = New-Object System.Text.StringBuilder 256
          [void][WizardUI]::GetWindowText($handle, $label, $label.Capacity)
          [void][WizardUI]::GetClassName($handle, $type, $type.Capacity)
          if ($label.ToString().Replace('&', '') -match $Text -and ($Class -eq '' -or $type.ToString() -eq $Class)) {
            $script:found = $handle
            return $false
          }
        }
        return $true
      }
      [void][WizardUI]::EnumChildWindows($process.MainWindowHandle, $callback, [IntPtr]::Zero)
      if ($null -ne $script:found) { return $script:found }
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  throw "Installer control did not appear: $Text ($Class)"
}
function Click-Control([string]$Text) {
  $handle = Find-Control $Text 'Button'
  [void][WizardUI]::SendMessage($handle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
}
try {
  [void](Find-Control 'Welcome to Form Entry Desktop Setup')
  Write-Output 'Welcome page verified'
  Click-Control '^Next'
  [void](Find-Control 'Choose Install Location')
  $edit = Find-Control '.*' 'Edit'
  [void][WizardUI]::SetText($edit, 0x000C, [IntPtr]::Zero, $InstallDir)
  Write-Output 'Custom installation directory selected'
  Click-Control '^Install$'
  [void](Find-Control 'Completing.*Setup')
  $launch = Find-Control '^Run Form Entry Desktop$' 'Button'
  $checked = [WizardUI]::SendMessage($launch, 0x00F0, [IntPtr]::Zero, [IntPtr]::Zero)
  if ($checked.ToInt32() -ne 1) { throw 'Launch app checkbox should be checked by default' }
  [void][WizardUI]::SendMessage($launch, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
  Write-Output 'Finish page and launch checkbox verified'
  Click-Control '^Finish$'
  if (-not $process.WaitForExit(30000)) { throw 'Installer did not finish' }
  if ($process.ExitCode -ne 0) { throw "Installer exit code: $($process.ExitCode)" }
  if (-not (Test-Path (Join-Path $InstallDir 'FormEntryDesktop.exe'))) { throw 'App missing from selected directory' }
} finally {
  if (-not $process.HasExited) { $process.Kill() }
}
