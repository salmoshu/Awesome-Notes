package main

// remote.go：zcode 式远程接入 —— 把 linux 版 notesd 自动部署到 WSL 发行版 / SSH 远端并启动，
// 之后客户端按普通 notesd 远程连接使用。进度以 NDJSON 流式回传（连接中日志面板）。
//
// 关键设计：WSL 会话语义会杀死 wsl.exe 退出后的后台进程（nohup/setsid 均无效），
// 因此远端 notesd 以「前台子进程」形式运行，生命周期由 sidecar 持有：
//   - WSL：sidecar 常驻一个 wsl.exe 子进程（notesd 在其内前台运行），就绪行直接读 stdout
//   - SSH：notesd 跑在保活的 ssh 会话里（该连接同时承载 127.0.0.1 端口转发）
// 重连 = 重新 setup：二进制按 sha256 跳过重复上传，启动前按 token pkill 清理旧实例。

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/crypto/ssh"
)

const remoteDir = "$HOME/.awesome-notes"

var tokenRe = regexp.MustCompile(`^[A-Za-z0-9_-]{8,128}$`)

// ---- NDJSON 进度流 ----

type streamLogger struct {
	enc *json.Encoder
	fl  http.Flusher
}

func newStreamLogger(w http.ResponseWriter) *streamLogger {
	w.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	fl, _ := w.(http.Flusher)
	return &streamLogger{enc: json.NewEncoder(w), fl: fl}
}

func (l *streamLogger) send(v map[string]any) {
	_ = l.enc.Encode(v)
	if l.fl != nil {
		l.fl.Flush()
	}
}

func (l *streamLogger) log(step, level, msg string) {
	l.send(map[string]any{"step": step, "level": level, "msg": msg})
}

// ---- 远端 shell 抽象（部署阶段共用：WSL / SSH） ----

type remoteShell interface {
	run(ctx context.Context, script string) (string, error)
	upload(ctx context.Context, local string) error
}

// ---- 已建立连接的句柄（teardown 关闭） ----

type remoteHandle interface{ close() }

// ---- 请求/响应 ----

type setupRequest struct {
	Kind  string `json:"kind"` // wsl | ssh
	Token string `json:"token"`
	Wsl   *struct {
		Distro string `json:"distro"`
	} `json:"wsl"`
	SSH *struct {
		Host     string `json:"host"`
		Port     int    `json:"port"`
		User     string `json:"user"`
		Auth     string `json:"auth"` // password | key
		Password string `json:"password"`
		KeyPath  string `json:"keyPath"`
	} `json:"ssh"`
}

type remoteResult struct {
	Host    string `json:"host"`
	Port    int    `json:"port"`
	Token   string `json:"token"`
	Version string `json:"version"`
	ConnID  string `json:"connId,omitempty"`
}

func (s *server) handleRemoteSetup(w http.ResponseWriter, r *http.Request) {
	var req setupRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, 400, "请求体解析失败")
		return
	}
	if !tokenRe.MatchString(req.Token) {
		writeError(w, 400, "token 需为 8-128 位字母数字/-/_")
		return
	}

	lg := newStreamLogger(w)
	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()

	var res *remoteResult
	var err error
	switch req.Kind {
	case "wsl":
		if req.Wsl == nil || strings.TrimSpace(req.Wsl.Distro) == "" {
			writeError(w, 400, "缺少 wsl.distro")
			return
		}
		res, err = s.setupWsl(ctx, lg, strings.TrimSpace(req.Wsl.Distro), req.Token)
	case "ssh":
		if req.SSH == nil || strings.TrimSpace(req.SSH.Host) == "" || strings.TrimSpace(req.SSH.User) == "" {
			writeError(w, 400, "缺少 ssh.host / ssh.user")
			return
		}
		res, err = s.setupSsh(ctx, lg, &req, req.Token)
	default:
		writeError(w, 400, "kind 仅支持 wsl / ssh（docker/custom 请直接连接已有 notesd 地址）")
		return
	}

	if err != nil {
		lg.log("done", "err", err.Error())
		lg.send(map[string]any{"done": true, "ok": false, "error": err.Error()})
		return
	}
	lg.send(map[string]any{"done": true, "ok": true, "result": res})
}

func (s *server) handleRemoteTeardown(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ConnID string `json:"connId"`
	}
	if err := readJSON(r, &req); err != nil || req.ConnID == "" {
		writeError(w, 400, "缺少 connId")
		return
	}
	if s.remotes.close(req.ConnID) {
		writeJSON(w, 200, map[string]bool{"ok": true})
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": false})
}

// ---- 部署阶段（WSL / SSH 共用）：架构探测 + 按 sha256 增量上传 ----

const uploadScript = `mkdir -p ` + remoteDir + `/data && cat > ` + remoteDir + `/notesd.tmp && chmod 755 ` + remoteDir + `/notesd.tmp && mv -f ` + remoteDir + `/notesd.tmp ` + remoteDir + `/notesd`

func (s *server) deployBinary(ctx context.Context, lg *streamLogger, sh remoteShell) error {
	unameOut, err := sh.run(ctx, "uname -sm")
	if err != nil {
		return fmt.Errorf("探测远端系统失败：%v", err)
	}
	lg.log("detect", "info", "远端系统："+firstLine(unameOut))
	asset, err := s.assetFor(unameOut)
	if err != nil {
		return err
	}

	localSum, sizeMB, err := fileSHA256(asset)
	if err != nil {
		return fmt.Errorf("读取部署二进制失败：%v", err)
	}
	remoteSum, _ := sh.run(ctx, "sha256sum "+remoteDir+"/notesd 2>/dev/null | cut -d' ' -f1")
	if strings.TrimSpace(remoteSum) == localSum {
		lg.log("deploy", "ok", "远端 notesd 已是最新，跳过上传")
		return nil
	}
	lg.log("deploy", "info", fmt.Sprintf("上传 notesd（%s，%.1f MB）…", filepath.Base(asset), sizeMB))
	if err := sh.upload(ctx, asset); err != nil {
		return fmt.Errorf("上传失败：%v", err)
	}
	lg.log("deploy", "ok", "上传完成")
	return nil
}

// assetFor 按远端 uname 选择本地部署二进制。
func (s *server) assetFor(unameOut string) (string, error) {
	fields := strings.Fields(strings.ToLower(unameOut))
	if len(fields) == 0 || fields[0] != "linux" {
		return "", fmt.Errorf("仅支持 Linux 远端（检测到：%s）", firstLine(unameOut))
	}
	machine := ""
	if len(fields) > 1 {
		machine = fields[1]
	}
	var name string
	switch machine {
	case "x86_64", "amd64":
		name = "notesd-linux-amd64"
	case "aarch64", "arm64":
		name = "notesd-linux-arm64"
	default:
		return "", fmt.Errorf("不支持的远端架构：%s", machine)
	}
	p := filepath.Join(s.assets, name)
	if _, err := os.Stat(p); err != nil {
		return "", fmt.Errorf("缺少部署二进制 %s（%v）", p, err)
	}
	return p, nil
}

// pkillStale 清理同一 token 的旧 notesd 实例（上次运行残留；token 唯一，不会误伤他人）。
func pkillStale(ctx context.Context, sh remoteShell, token string) {
	_, _ = sh.run(ctx, `pkill -f "notesd -addr 127.0.0.1:0 -token `+token+`" 2>/dev/null; true`)
}

// startCmd 远端 notesd 前台命令（shell 展开 $HOME）。
func startCmd(token string) string {
	return remoteDir + `/notesd -addr 127.0.0.1:0 -token ` + token + ` -data ` + remoteDir + `/data`
}

var readyRe = regexp.MustCompile(`NOTESD_READY port=(\d+)`)

// waitReady 从 stdout 流中读就绪行拿端口；超时/进程提前退出报错（附带 stderr 摘要）。
func waitReady(stdout io.Reader, stderr *boundedBuf, timeout time.Duration) (int, error) {
	type result struct {
		port int
		err  error
	}
	ch := make(chan result, 1)
	go func() {
		sc := bufio.NewScanner(stdout)
		for sc.Scan() {
			if m := readyRe.FindStringSubmatch(sc.Text()); m != nil {
				port, _ := strconv.Atoi(m[1])
				ch <- result{port: port}
				return
			}
		}
		ch <- result{err: fmt.Errorf("进程未打印就绪行")}
	}()
	select {
	case r := <-ch:
		if r.err != nil && stderr.String() != "" {
			return 0, fmt.Errorf("%v；stderr: %s", r.err, firstLine(stderr.String()))
		}
		return r.port, r.err
	case <-time.After(timeout):
		return 0, fmt.Errorf("等待 notesd 就绪超时（%s）；stderr: %s", timeout, firstLine(stderr.String()))
	}
}

// boundedBuf 限量 stderr 缓冲（错误诊断用），写满后丢弃。
type boundedBuf struct {
	buf strings.Builder
	n   int
}

func (b *boundedBuf) Write(p []byte) (int, error) {
	if b.n < 4096 {
		b.buf.Write(p)
		b.n += len(p)
	}
	return len(p), nil
}

func (b *boundedBuf) String() string { return b.buf.String() }

// waitHealthy 健康检查可能滞后于就绪行，轮询确认。
func waitHealthy(ctx context.Context, probe func() (bool, bool, string)) error {
	for i := 0; i < 10; i++ {
		healthOK, tokenOK, _ := probe()
		if healthOK && tokenOK {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
	return fmt.Errorf("notesd 已启动但健康检查未通过")
}

// ---- WSL ----

type wslShell struct{ distro string }

func (w *wslShell) run(ctx context.Context, script string) (string, error) {
	return runWslCtx(ctx, "-d", w.distro, "-e", "sh", "-c", script)
}

func (w *wslShell) upload(ctx context.Context, local string) error {
	f, err := os.Open(local)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = runWslStdin(ctx, f, "-d", w.distro, "-e", "sh", "-c", uploadScript)
	return err
}

// wslHandle：常驻 wsl.exe 子进程（notesd 在其会话内前台运行）。
type wslHandle struct{ cmd *exec.Cmd }

func (h *wslHandle) close() {
	if h.cmd.Process != nil {
		_ = h.cmd.Process.Kill()
	}
	_ = h.cmd.Wait()
}

func (s *server) setupWsl(ctx context.Context, lg *streamLogger, distro, token string) (*remoteResult, error) {
	lg.log("check", "info", fmt.Sprintf("检查 WSL 发行版 %s …", distro))
	out, err := runWslCtx(ctx, "-l", "-q")
	if err != nil {
		return nil, fmt.Errorf("WSL 不可用：%v", err)
	}
	found := false
	for _, line := range strings.Split(out, "\n") {
		if strings.TrimSpace(line) == distro {
			found = true
			break
		}
	}
	if !found {
		return nil, fmt.Errorf("发行版 %s 不存在（wsl -l -q 中未找到）", distro)
	}
	lg.log("check", "ok", "发行版存在")

	sh := &wslShell{distro: distro}
	if err := s.deployBinary(ctx, lg, sh); err != nil {
		return nil, err
	}
	pkillStale(ctx, sh, token)

	// 前台启动：wsl.exe 常驻为 sidecar 子进程（WSL 会话语义不允许脱离的后台进程）
	lg.log("start", "info", "启动远端 notesd …")
	cmd := exec.Command("wsl.exe", "-d", distro, "-e", "sh", "-c", startCmd(token))
	hideWindow(cmd)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr := &boundedBuf{}
	cmd.Stderr = stderr
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("启动 wsl.exe 失败：%v", err)
	}
	handle := &wslHandle{cmd: cmd}

	port, err := waitReady(stdout, stderr, 15*time.Second)
	if err != nil {
		handle.close()
		return nil, err
	}
	go io.Copy(io.Discard, stdout) // 持续排空，防管道写满

	probe := func() (bool, bool, string) {
		return probeNotesd(fmt.Sprintf("http://127.0.0.1:%d", port), token)
	}
	if err := waitHealthy(ctx, probe); err != nil {
		handle.close()
		return nil, err
	}
	lg.log("start", "ok", fmt.Sprintf("notesd 就绪（端口 %d）", port))

	connID := "rc-" + randHex(6)
	s.remotes.add(connID, handle)
	return &remoteResult{Host: "127.0.0.1", Port: port, Token: token, Version: version, ConnID: connID}, nil
}

// ---- SSH ----

type sshShell struct{ client *ssh.Client }

func (s *sshShell) run(ctx context.Context, script string) (string, error) {
	sess, err := s.client.NewSession()
	if err != nil {
		return "", err
	}
	defer sess.Close()
	type out struct {
		b   []byte
		err error
	}
	ch := make(chan out, 1)
	go func() {
		b, err := sess.CombinedOutput(script)
		ch <- out{b, err}
	}()
	select {
	case o := <-ch:
		return string(o.b), o.err
	case <-ctx.Done():
		_ = sess.Close()
		return "", ctx.Err()
	}
}

func (s *sshShell) upload(ctx context.Context, local string) error {
	f, err := os.Open(local)
	if err != nil {
		return err
	}
	defer f.Close()
	sess, err := s.client.NewSession()
	if err != nil {
		return err
	}
	defer sess.Close()
	sess.Stdin = f
	ch := make(chan error, 1)
	go func() { ch <- sess.Run(uploadScript) }()
	select {
	case err := <-ch:
		return err
	case <-ctx.Done():
		_ = sess.Close()
		return ctx.Err()
	}
}

// sshHandle：保活会话（notesd 前台）+ 端口转发；close 级联关闭 client。
type sshHandle struct {
	sess *ssh.Session
	fwd  *sshForward
}

func (h *sshHandle) close() {
	_ = h.sess.Close()
	h.fwd.close()
}

func (s *server) setupSsh(ctx context.Context, lg *streamLogger, req *setupRequest, token string) (*remoteResult, error) {
	cfg := req.SSH
	port := cfg.Port
	if port <= 0 {
		port = 22
	}

	lg.log("connect", "info", fmt.Sprintf("连接 %s@%s:%d …", cfg.User, cfg.Host, port))
	auth, err := sshAuthMethods(cfg.Auth, cfg.Password, cfg.KeyPath)
	if err != nil {
		return nil, err
	}
	clientCfg := &ssh.ClientConfig{
		User:            cfg.User,
		Auth:            auth,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // 局域网工具：不做主机密钥校验
		Timeout:         15 * time.Second,
	}
	dialer := &net.Dialer{Timeout: 15 * time.Second}
	addr := net.JoinHostPort(strings.TrimSpace(cfg.Host), strconv.Itoa(port))
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("TCP 连接失败：%v", err)
	}
	sc, chans, reqs, err := ssh.NewClientConn(conn, addr, clientCfg)
	if err != nil {
		return nil, fmt.Errorf("SSH 握手/认证失败：%v", err)
	}
	client := ssh.NewClient(sc, chans, reqs)
	lg.log("connect", "ok", "SSH 已连接")

	sh := &sshShell{client: client}
	if err := s.deployBinary(ctx, lg, sh); err != nil {
		_ = client.Close()
		return nil, err
	}
	pkillStale(ctx, sh, token)

	// 本地端口转发 → 远端 notesd 端口（目标端口待就绪后设定）
	fwd := newSshForward(client)
	localPort, err := fwd.start()
	if err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("本地端口转发建立失败：%v", err)
	}

	// notesd 前台跑在保活会话里（连接断开即随之退出）
	lg.log("start", "info", "启动远端 notesd …")
	sess, err := client.NewSession()
	if err != nil {
		fwd.close()
		return nil, err
	}
	stdout, err := sess.StdoutPipe()
	if err != nil {
		fwd.close()
		return nil, err
	}
	stderr := &boundedBuf{}
	sess.Stderr = stderr
	if err := sess.Start(startCmd(token)); err != nil {
		fwd.close()
		return nil, fmt.Errorf("启动远端 notesd 失败：%v", err)
	}
	handle := &sshHandle{sess: sess, fwd: fwd}

	remotePort, err := waitReady(stdout, stderr, 15*time.Second)
	if err != nil {
		handle.close()
		return nil, err
	}
	go io.Copy(io.Discard, stdout)
	fwd.setTarget(remotePort)

	probe := func() (bool, bool, string) {
		return probeNotesd(fmt.Sprintf("http://127.0.0.1:%d", localPort), token)
	}
	if err := waitHealthy(ctx, probe); err != nil {
		handle.close()
		return nil, err
	}
	lg.log("start", "ok", fmt.Sprintf("notesd 就绪（远端端口 %d）", remotePort))
	lg.log("forward", "ok", fmt.Sprintf("端口转发：127.0.0.1:%d → 远端 127.0.0.1:%d", localPort, remotePort))

	connID := "rc-" + randHex(6)
	s.remotes.add(connID, handle)
	return &remoteResult{Host: "127.0.0.1", Port: localPort, Token: token, Version: version, ConnID: connID}, nil
}

func sshAuthMethods(auth, password, keyPath string) ([]ssh.AuthMethod, error) {
	if auth == "key" {
		keyPath = strings.TrimSpace(keyPath)
		if keyPath == "" {
			return nil, fmt.Errorf("未指定私钥文件")
		}
		data, err := os.ReadFile(keyPath)
		if err != nil {
			return nil, fmt.Errorf("读取私钥失败：%v", err)
		}
		signer, err := ssh.ParsePrivateKey(data)
		if err != nil {
			if password != "" {
				if s2, err2 := ssh.ParsePrivateKeyWithPassphrase(data, []byte(password)); err2 == nil {
					return []ssh.AuthMethod{ssh.PublicKeys(s2)}, nil
				}
			}
			return nil, fmt.Errorf("解析私钥失败：%v", err)
		}
		return []ssh.AuthMethod{ssh.PublicKeys(signer)}, nil
	}
	if password == "" {
		return nil, fmt.Errorf("未填写密码（或改用私钥方式）")
	}
	return []ssh.AuthMethod{
		ssh.Password(password),
		ssh.KeyboardInteractive(func(_ string, _ string, questions []string, _ []bool) ([]string, error) {
			ans := make([]string, len(questions))
			for i := range ans {
				ans[i] = password
			}
			return ans, nil
		}),
	}, nil
}

// ---- 就绪探测 ----

func probeNotesd(base, token string) (healthOK, tokenOK bool, ver string) {
	client := &http.Client{Timeout: 2 * time.Second}
	if code, body := httpGet(client, base+"/api/health", ""); code == 200 {
		healthOK = true
		ver, _ = body["version"].(string)
	}
	if code, _ := httpGet(client, base+"/api/projects", token); code == 200 {
		tokenOK = true
	}
	return
}

func httpGet(client *http.Client, url, token string) (int, map[string]any) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return 0, nil
	}
	if token != "" {
		req.Header.Set("X-Notes-Token", token)
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, nil
	}
	defer resp.Body.Close()
	var body map[string]any
	_ = json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&body)
	return resp.StatusCode, body
}

func fileSHA256(p string) (sum string, sizeMB float64, err error) {
	f, err := os.Open(p)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()
	h := sha256.New()
	n, err := io.Copy(h, f)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(h.Sum(nil)), float64(n) / (1 << 20), nil
}

func firstLine(s string) string {
	return strings.TrimSpace(strings.SplitN(strings.TrimSpace(s), "\n", 2)[0])
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// ---- SSH 端口转发（进程内，无外部 ssh 进程） ----

type sshForward struct {
	client *ssh.Client
	ln     net.Listener
	target atomic.Int64 // 0 = 未就绪
	done   chan struct{}
	once   sync.Once
	wg     sync.WaitGroup
}

func newSshForward(client *ssh.Client) *sshForward {
	return &sshForward{client: client, done: make(chan struct{})}
}

func (f *sshForward) start() (int, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	f.ln = ln
	f.wg.Add(1)
	go f.acceptLoop()
	return ln.Addr().(*net.TCPAddr).Port, nil
}

func (f *sshForward) setTarget(port int) {
	f.target.Store(int64(port))
}

func (f *sshForward) acceptLoop() {
	defer f.wg.Done()
	for {
		c, err := f.ln.Accept()
		if err != nil {
			return
		}
		select {
		case <-f.done:
			_ = c.Close()
			return
		default:
		}
		f.wg.Add(1)
		go f.handle(c)
	}
}

func (f *sshForward) handle(local net.Conn) {
	defer f.wg.Done()
	defer local.Close()
	port := f.target.Load()
	if port <= 0 {
		return
	}
	remote, err := f.client.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return
	}
	defer remote.Close()
	go func() {
		_, _ = io.Copy(remote, local)
		if cw, ok := remote.(interface{ CloseWrite() error }); ok {
			_ = cw.CloseWrite()
		}
	}()
	_, _ = io.Copy(local, remote)
}

func (f *sshForward) close() {
	f.once.Do(func() {
		close(f.done)
		if f.ln != nil {
			_ = f.ln.Close()
		}
		_ = f.client.Close()
	})
	f.wg.Wait()
}

// ---- 连接注册表（teardown 用） ----

type remoteRegistry struct {
	mu sync.Mutex
	m  map[string]remoteHandle
}

func newRemoteRegistry() *remoteRegistry {
	return &remoteRegistry{m: map[string]remoteHandle{}}
}

func (r *remoteRegistry) add(id string, h remoteHandle) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if old := r.m[id]; old != nil {
		old.close()
	}
	r.m[id] = h
}

func (r *remoteRegistry) close(id string) bool {
	r.mu.Lock()
	h := r.m[id]
	delete(r.m, id)
	r.mu.Unlock()
	if h == nil {
		return false
	}
	h.close()
	return true
}
