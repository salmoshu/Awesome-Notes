//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

// hideWindow 隐藏子进程控制台窗口（wsl.exe 等控制台程序否则会弹 CMD 窗口）。
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
