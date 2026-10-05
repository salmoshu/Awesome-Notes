$code = @'
using System;
using System.Runtime.InteropServices;
public static class VolKey {
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
'@
Add-Type -TypeDefinition $code

# VK_VOLUME_DOWN = 0xAE, KEYEVENTF_KEYUP = 0x0002
$VK_VOLUME_DOWN = 0xAE
$KEYEVENTF_KEYUP = 0x0002

# 每按一次约降 2 格，连按 60 次可确保从任意音量降到 0
for ($i = 0; $i -lt 60; $i++) {
    [VolKey]::keybd_event($VK_VOLUME_DOWN, 0, 0, [UIntPtr]::Zero)
    [VolKey]::keybd_event($VK_VOLUME_DOWN, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 15
}
Write-Output "done: volume set to minimum"
