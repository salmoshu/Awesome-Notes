// Awesome-Notes sidecar：本地文档扫描 / 读写 / 批注存储服务。
// 标准库 + golang.org/x/crypto/ssh（SSH 远程部署）。由 Electron 主进程拉起，也可独立运行（供纯 Web 预览）。
//
// 启动参数：
//   -addr   监听地址（默认 127.0.0.1:0，0 表示自动分配端口）
//   -token  访问令牌（除 /api/health 外所有请求需携带 X-Notes-Token）
//   -data   数据目录（项目注册表 projects.json 存放处）
//   -assets 资源目录（内含 notesd-linux-amd64 / notesd-linux-arm64，用于向 WSL/SSH 远端部署）
//
// 就绪后向 stdout 打印一行：NOTESD_READY port=<port>
package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
)

// version 远端部署校验依据：远端 notesd 版本不一致时重新部署。
const version = "0.2.0"

func main() {
	addr := flag.String("addr", "127.0.0.1:0", "listen address")
	token := flag.String("token", "dev-token", "access token")
	dataDir := flag.String("data", filepath.Join("sidecar", "data"), "data directory")
	assets := flag.String("assets", "", "assets directory (notesd linux binaries for remote deploy)")
	flag.Parse()

	if err := os.MkdirAll(*dataDir, 0o755); err != nil {
		log.Fatalf("创建数据目录失败: %v", err)
	}

	s := &server{
		token:    *token,
		registry: newRegistry(filepath.Join(*dataDir, "projects.json")),
		assets:   *assets,
		remotes:  newRemoteRegistry(),
	}

	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		log.Fatalf("监听失败: %v", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	fmt.Printf("NOTESD_READY port=%d\n", port)

	mux := http.NewServeMux()
	s.routes(mux)
	log.Printf("notesd %s  listening on http://127.0.0.1:%d", version, port)
	if err := http.Serve(ln, withCORS(mux)); err != nil {
		log.Fatalf("服务退出: %v", err)
	}
}

// withCORS 全局 CORS（本地工具，仅监听 127.0.0.1）：预检请求在路由层之前应答。
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Notes-Token")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(204)
			return
		}
		next.ServeHTTP(w, r)
	})
}
