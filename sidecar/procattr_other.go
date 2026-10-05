//go:build !windows

package main

import "os/exec"

// hideWindow 非 Windows 平台无控制台窗口概念。
func hideWindow(cmd *exec.Cmd) {}
