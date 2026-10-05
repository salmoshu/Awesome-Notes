package main

// wsl.go：WSL 发行版探测 —— 列出已安装发行版、取用户家目录（映射为 Windows UNC 路径）。
// wsl.exe 的输出是 UTF-16LE（历史包袱），需要手工解码。

import (
	"context"
	"encoding/binary"
	"io"
	"net/http"
	"os/exec"
	"strings"
	"time"
	"unicode/utf16"
)

// runWsl 执行 wsl.exe（隐藏窗口）并解码输出（UTF-16LE → UTF-8）。
func runWsl(timeout time.Duration, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	return runWslCtx(ctx, args...)
}

// runWslCtx 同 runWsl，但由调用方控制超时/取消。
func runWslCtx(ctx context.Context, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "wsl.exe", args...)
	hideWindow(cmd)
	b, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return decodeWslOutput(string(b)), nil
}

// runWslStdin 带标准输入执行 wsl.exe（用于经管道上传二进制文件），捕获合并输出。
func runWslStdin(ctx context.Context, stdin io.Reader, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "wsl.exe", args...)
	hideWindow(cmd)
	cmd.Stdin = stdin
	b, err := cmd.CombinedOutput()
	if err != nil {
		return decodeWslOutput(string(b)), err
	}
	return decodeWslOutput(string(b)), nil
}

// decodeWslOutput：wsl.exe 输出 UTF-16LE（含 BOM）；若无 null 字节则按 UTF-8 处理。
func decodeWslOutput(b string) string {
	nulls := 0
	for i := 0; i < len(b) && i < 200; i++ {
		if b[i] == 0 {
			nulls++
		}
	}
	if nulls < 4 {
		return strings.TrimSpace(strings.ReplaceAll(b, "\r", ""))
	}
	u16 := make([]uint16, 0, len(b)/2)
	for i := 0; i+1 < len(b); i += 2 {
		u16 = append(u16, binary.LittleEndian.Uint16([]byte{b[i], b[i+1]}))
	}
	return strings.TrimSpace(strings.ReplaceAll(string(utf16.Decode(u16)), "\r", ""))
}

func (s *server) handleWslDistros(w http.ResponseWriter, r *http.Request) {
	out, err := runWsl(10*time.Second, "-l", "-q")
	if err != nil {
		writeError(w, 500, "WSL 不可用："+err.Error())
		return
	}
	distros := []string{}
	for _, line := range strings.Split(out, "\n") {
		name := strings.TrimSpace(line)
		if name != "" {
			distros = append(distros, name)
		}
	}
	writeJSON(w, 200, map[string]any{"distros": distros})
}

// handleWslHome 返回指定发行版的用户家目录（Windows UNC 形式，可直接注册为本地项目）。
func (s *server) handleWslHome(w http.ResponseWriter, r *http.Request) {
	distro := strings.TrimSpace(r.URL.Query().Get("distro"))
	if distro == "" {
		writeError(w, 400, "缺少 distro 参数")
		return
	}
	out, err := runWsl(10*time.Second, "-d", distro, "-e", "sh", "-c", "echo $HOME")
	if err != nil {
		writeError(w, 500, "读取家目录失败："+err.Error())
		return
	}
	home := strings.TrimSpace(strings.Split(out, "\n")[0])
	if home == "" {
		writeError(w, 500, "未能取得家目录")
		return
	}
	unc := `\\wsl.localhost\` + distro + strings.ReplaceAll(home, "/", `\`)
	writeJSON(w, 200, map[string]string{"home": home, "unc": unc})
}
