package main

// insights.go：架构 insights 端点 —— 在与 arch spec 完全一致的组件划分
// （同一 groupDirs + sortCompDirs + kebabID）之上叠加：行数统计、顶层符号
// 提取（Go 文件走 go/ast，其余语言按正则）、Electron IPC 通道配对边、
// git churn 热度与 Tarjan 环检测。
// 结果缓存于 <项目>/.timber/arch/<sha>.insights.json（tmp+rename 原子写）。

import (
	"bytes"
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ---- 响应 schema ----

type insightsResp struct {
	OK         bool           `json:"ok"`
	Sha        string         `json:"sha"`
	Components []*insightComp `json:"components"`
	Edges      []*insightEdge `json:"edges"`
	Cycles     [][]string     `json:"cycles"`
	Stats      insightStats   `json:"stats"`
}

type insightComp struct {
	ID       string         `json:"id"`
	Label    string         `json:"label"`
	Dir      string         `json:"dir"` // 项目相对目录，根组件为 "."
	Type     string         `json:"type"`
	Files    int            `json:"files"`
	Lines    int            `json:"lines"` // 组件内源码总行数（\n 计数）
	Lang     string         `json:"lang"`
	Heat     int            `json:"heat"` // git churn：近 300 提交窗口内触及该组件文件的提交数
	Symbols  []*insightSym  `json:"symbols"`
	TopFiles []*insightFile `json:"topFiles"`
}

type insightSym struct {
	Name string `json:"name"`
	Kind string `json:"kind"` // func|class|type|const
	File string `json:"file"`
}

type insightFile struct {
	Path  string `json:"path"`
	Lines int    `json:"lines"`
}

type insightEdge struct {
	From     string   `json:"from"`
	To       string   `json:"to"`
	Count    int      `json:"count"`
	Kind     string   `json:"kind"` // import|ipc
	Channels []string `json:"channels,omitempty"`
}

type insightStats struct {
	Components  int `json:"components"`
	Edges       int `json:"edges"`
	Cycles      int `json:"cycles"`
	IpcChannels int `json:"ipcChannels"`
	Hotspots    int `json:"hotspots"` // heat >= 5 的组件数
}

const (
	maxCompSymbols = 10  // 每组件符号上限
	maxTopFiles    = 5   // 每组件代表文件上限
	maxIpcChannels = 20  // 单条 ipc 边列出的通道名上限
	churnWindow    = 300 // heat 统计的提交窗口
	heatHotspot    = 5   // hotspot 热度阈值
)

func (s *server) handleArchInsights(w http.ResponseWriter, r *http.Request) {
	p := s.project(w, r)
	if p == nil {
		return
	}
	if !isGitRepo(p.Path) {
		writeNotRepo(w)
		return
	}
	ref := r.URL.Query().Get("ref")
	if ref == "" {
		ref = "HEAD"
	}
	if strings.HasPrefix(ref, "-") { // 防选项注入
		writeJSON(w, 200, map[string]any{"ok": false, "error": "unknown-ref"})
		return
	}
	shaOut, err := gitRun(p.Path, 15*time.Second, "rev-parse", "--verify", ref+"^{commit}")
	if err != nil {
		if ref == "HEAD" {
			writeJSON(w, 200, map[string]any{"ok": false, "error": "no-commits"})
		} else {
			writeJSON(w, 200, map[string]any{"ok": false, "error": "unknown-ref"})
		}
		return
	}
	sha := strings.TrimSpace(shaOut)

	// 缓存命中直接回传
	cacheDir := filepath.Join(p.Path, ".timber", "arch")
	cacheFile := filepath.Join(cacheDir, sha+".insights.json")
	if data, err := os.ReadFile(cacheFile); err == nil {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = w.Write(data)
		return
	}

	files, err := collectSourceFiles(p, ref, sha)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	if len(files) == 0 {
		writeJSON(w, 200, map[string]any{"ok": false, "error": "no-source"})
		return
	}
	resp := buildInsights(p, files, sha)
	data, err := json.Marshal(resp)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	// 原子写缓存：tmp + rename
	if err := os.MkdirAll(cacheDir, 0o755); err == nil {
		tmp := cacheFile + ".tmp"
		if err := os.WriteFile(tmp, data, 0o644); err == nil {
			_ = os.Rename(tmp, cacheFile)
		}
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_, _ = w.Write(data)
}

// fileInfo 单文件预分析结果（import / 顶层符号 / 行数）。
type fileInfo struct {
	imports []string
	syms    []*insightSym
	lines   int
}

func buildInsights(p *Project, files []srcFile, sha string) *insightsResp {
	groups := groupDirs(files)
	dirs := make([]string, 0, len(groups))
	for d := range groups {
		dirs = append(dirs, d)
	}
	sortCompDirs(dirs)

	// 预分析每个文件：import / 符号 / 行数（Go 文件走 go/ast）
	infos := make(map[string]*fileInfo, len(files))
	for _, f := range files {
		infos[f.path] = analyzeFile(f)
	}

	// git churn：近 300 提交窗口内各文件的触及提交数（项目相对路径为键）
	churn := gitChurn(p.Path, sha)

	resp := &insightsResp{
		OK: true, Sha: sha,
		Components: []*insightComp{},
		Edges:      []*insightEdge{},
		Cycles:     [][]string{},
	}
	idOf := map[string]string{}
	hotspots := 0
	// IPC 通道表：channel → 组件 id 集（按角色分三张表）
	rendCh := map[string]map[string]bool{} // ipcRenderer.invoke/send/on（消费方，含 preload）
	mainCh := map[string]map[string]bool{} // ipcMain.handle/on（提供方）
	wcCh := map[string]map[string]bool{}   // webContents.send（主→渲染推送方）

	for _, d := range dirs {
		fs := groups[d]
		id := kebabID(d)
		idOf[d] = id
		label := path.Base(d)
		if d == "." {
			label = p.Name
		}
		comp := &insightComp{
			ID: id, Label: label, Dir: d, Type: componentType(d),
			Files: len(fs), Lang: primaryLang(fs),
			Symbols: []*insightSym{}, TopFiles: []*insightFile{},
		}
		tf := make([]*insightFile, 0, len(fs))
		for _, f := range fs {
			fi := infos[f.path]
			comp.Lines += fi.lines
			comp.Heat += churn[f.path]
			tf = append(tf, &insightFile{Path: f.path, Lines: fi.lines})
			for _, sym := range fi.syms { // 按文件序、文件内顺序，上限 10
				if len(comp.Symbols) >= maxCompSymbols {
					break
				}
				comp.Symbols = append(comp.Symbols, sym)
			}
			scanIpc(f, id, rendCh, mainCh, wcCh)
		}
		sort.Slice(tf, func(i, j int) bool { // 行数降序，并列按路径
			if tf[i].Lines != tf[j].Lines {
				return tf[i].Lines > tf[j].Lines
			}
			return tf[i].Path < tf[j].Path
		})
		if len(tf) > maxTopFiles {
			tf = tf[:maxTopFiles]
		}
		comp.TopFiles = tf
		if comp.Heat >= heatHotspot {
			hotspots++
		}
		resp.Components = append(resp.Components, comp)
	}

	// import 边：与 spec 同一 resolver 聚合逻辑，import 来自预分析（Go 为 AST 结果）
	extract := func(f srcFile) []string { return infos[f.path].imports }
	counts := importEdges(p, groups, dirs, files, idOf, extract)
	ie := make([]dirEdge, 0, len(counts))
	for e := range counts {
		ie = append(ie, e)
	}
	sort.Slice(ie, func(i, j int) bool {
		if ie[i].from != ie[j].from {
			return ie[i].from < ie[j].from
		}
		return ie[i].to < ie[j].to
	})
	adj := map[string]map[string]bool{} // 环检测邻接表（组件 id）
	for _, e := range ie {
		from, to := idOf[e.from], idOf[e.to]
		resp.Edges = append(resp.Edges, &insightEdge{From: from, To: to, Count: counts[e], Kind: "import"})
		addAdj(adj, from, to)
	}

	// ipc 边：同一 channel 两侧配对 —— invoke/send/on(ipcRenderer) 方 → handle/on(ipcMain)
	// 所在组件；webContents.send 反向（主→渲染）。同组件自环丢弃，
	// 同一对组件的多条 channel 聚合成一条边（count=通道数，channels 排序去重≤20）。
	type pair struct{ from, to string }
	ipcAgg := map[pair]map[string]bool{}
	link := func(from, to, ch string) {
		if from == to {
			return
		}
		k := pair{from, to}
		if ipcAgg[k] == nil {
			ipcAgg[k] = map[string]bool{}
		}
		ipcAgg[k][ch] = true
	}
	for ch, consumers := range rendCh {
		for m := range mainCh[ch] {
			for c := range consumers {
				link(c, m, ch)
			}
		}
		for m := range wcCh[ch] {
			for c := range consumers {
				link(m, c, ch)
			}
		}
	}
	pairs := make([]pair, 0, len(ipcAgg))
	for k := range ipcAgg {
		pairs = append(pairs, k)
	}
	sort.Slice(pairs, func(i, j int) bool {
		if pairs[i].from != pairs[j].from {
			return pairs[i].from < pairs[j].from
		}
		return pairs[i].to < pairs[j].to
	})
	ipcChanSet := map[string]bool{}
	for _, k := range pairs {
		chs := make([]string, 0, len(ipcAgg[k]))
		for ch := range ipcAgg[k] {
			chs = append(chs, ch)
			ipcChanSet[ch] = true
		}
		sort.Strings(chs)
		count := len(chs)
		if len(chs) > maxIpcChannels {
			chs = chs[:maxIpcChannels]
		}
		resp.Edges = append(resp.Edges, &insightEdge{From: k.from, To: k.to, Count: count, Kind: "ipc", Channels: chs})
		addAdj(adj, k.from, k.to)
	}

	// 环检测：import+ipc 有向图上跑 Tarjan SCC，输出所有 size>1 的分量
	ids := make([]string, 0, len(dirs))
	for _, d := range dirs {
		ids = append(ids, idOf[d])
	}
	resp.Cycles = tarjanCycles(ids, adj)

	resp.Stats = insightStats{
		Components:  len(resp.Components),
		Edges:       len(resp.Edges),
		Cycles:      len(resp.Cycles),
		IpcChannels: len(ipcChanSet),
		Hotspots:    hotspots,
	}
	return resp
}

func addAdj(adj map[string]map[string]bool, from, to string) {
	if adj[from] == nil {
		adj[from] = map[string]bool{}
	}
	adj[from][to] = true
}

// ---- 单文件分析 ----

// analyzeFile 单文件预分析：行数（\n 计数）、import 列表、顶层符号。
// Go 文件用 go/ast 一次解析拿到精确 import 与符号；失败退回正则。
func analyzeFile(f srcFile) *fileInfo {
	fi := &fileInfo{lines: bytes.Count(f.content, []byte{'\n'})}
	if strings.ToLower(path.Ext(f.path)) == ".go" {
		if imports, syms, ok := goAnalyze(f); ok {
			fi.imports, fi.syms = imports, syms
			return fi
		}
	}
	fi.imports = extractImports(f)
	fi.syms = regexSymbols(f)
	return fi
}

// goAnalyze 用 go/ast 解析 Go 文件：精确 import 列表 + 顶层符号
// （func 含方法、type 含 struct/interface）。语法错误时返回部分 AST 结果；
// 仅硬失败（af 为 nil）才返回 ok=false 让调用方退回正则。
func goAnalyze(f srcFile) (imports []string, syms []*insightSym, ok bool) {
	fset := token.NewFileSet()
	af, _ := parser.ParseFile(fset, f.path, f.content, parser.SkipObjectResolution)
	if af == nil {
		return nil, nil, false
	}
	for _, imp := range af.Imports {
		if v, err := strconv.Unquote(imp.Path.Value); err == nil {
			imports = append(imports, v)
		}
	}
	for _, decl := range af.Decls {
		switch d := decl.(type) {
		case *ast.FuncDecl:
			syms = append(syms, &insightSym{Name: d.Name.Name, Kind: "func", File: f.path})
		case *ast.GenDecl:
			if d.Tok == token.TYPE {
				for _, sp := range d.Specs {
					if ts, ok := sp.(*ast.TypeSpec); ok {
						syms = append(syms, &insightSym{Name: ts.Name.Name, Kind: "type", File: f.path})
					}
				}
			}
		}
	}
	return imports, syms, true
}

// ---- 非 Go 语言顶层符号（正则，务实近似） ----

// symRule 一条符号提取规则：正则第一捕获组为符号名。
type symRule struct {
	re   *regexp.Regexp
	kind string
}

var symRulesByExt = map[string][]symRule{
	// js/ts 系（含 vue/svelte 的 script 段）
	".ts": {
		{regexp.MustCompile(`(?:export\s+)?(?:async\s+)?function\s+(\w+)`), "func"},
		{regexp.MustCompile(`(?:export\s+)?(?:default\s+)?class\s+(\w+)`), "class"},
		{regexp.MustCompile(`(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=`), "const"},
	},
	// python：顶层 def/class（无缩进锚定行首）
	".py": {
		{regexp.MustCompile(`(?m)^(?:async\s+def|def)\s+(\w+)`), "func"},
		{regexp.MustCompile(`(?m)^class\s+(\w+)`), "class"},
	},
	// rust：fn → func；struct/enum/trait → type
	".rs": {
		{regexp.MustCompile(`(?m)^\s*(?:pub(?:\(\w+\))?\s+)?fn\s+(\w+)`), "func"},
		{regexp.MustCompile(`(?m)^\s*(?:pub(?:\(\w+\))?\s+)?(?:struct|enum|trait)\s+(\w+)`), "type"},
	},
	// java/kt/scala：class/object → class；interface/enum → type（同一匹配集按类拆分）
	".java": {
		{regexp.MustCompile(`(?:class|object)\s+(\w+)`), "class"},
		{regexp.MustCompile(`(?:interface|enum)\s+(\w+)`), "type"},
	},
	// c/c++：宽松匹配函数定义（行尾断行、不含分号），抓不到就略过
	".c": {
		{regexp.MustCompile(`(?m)^(?:[\w:*&<>]+\s+)+(\w+)\s*\([^;]*$`), "func"},
	},
}

func init() {
	// 同族扩展名共享规则表
	for _, ext := range []string{".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte"} {
		symRulesByExt[ext] = symRulesByExt[".ts"]
	}
	for _, ext := range []string{".kt", ".scala"} {
		symRulesByExt[ext] = symRulesByExt[".java"]
	}
	for _, ext := range []string{".cc", ".cpp", ".h", ".hpp"} {
		symRulesByExt[ext] = symRulesByExt[".c"]
	}
}

// regexSymbols 按语言规则正则提取顶层符号，按文件内出现位置排序（跨 kind 保序）。
func regexSymbols(f srcFile) []*insightSym {
	rules, ok := symRulesByExt[strings.ToLower(path.Ext(f.path))]
	if !ok {
		return nil
	}
	text := string(f.content)
	type hit struct {
		off int
		sym *insightSym
	}
	var hits []hit
	for _, rule := range rules {
		for _, m := range rule.re.FindAllStringSubmatchIndex(text, -1) {
			hits = append(hits, hit{m[0], &insightSym{Name: text[m[2]:m[3]], Kind: rule.kind, File: f.path}})
		}
	}
	sort.SliceStable(hits, func(i, j int) bool { return hits[i].off < hits[j].off })
	out := make([]*insightSym, 0, len(hits))
	for _, h := range hits {
		out = append(out, h.sym)
	}
	return out
}

// ---- Electron IPC 通道 ----

var (
	reIpcMainProvide = regexp.MustCompile(`ipcMain\.(?:handle|on)\(\s*['"]([^'"]+)`)
	reWebContSend    = regexp.MustCompile(`webContents\.send\(\s*['"]([^'"]+)`)
	reIpcRendConsume = regexp.MustCompile(`ipcRenderer\.(?:invoke|send|on)\(\s*['"]([^'"]+)`)
)

// scanIpc 提取文件内的 Electron IPC 通道名，按角色记入通道表（compID 为所属组件）。
func scanIpc(f srcFile, compID string, rend, mainC, wc map[string]map[string]bool) {
	text := string(f.content)
	add := func(tab map[string]map[string]bool, ch string) {
		if tab[ch] == nil {
			tab[ch] = map[string]bool{}
		}
		tab[ch][compID] = true
	}
	for _, m := range reIpcRendConsume.FindAllStringSubmatch(text, -1) {
		add(rend, m[1])
	}
	for _, m := range reIpcMainProvide.FindAllStringSubmatch(text, -1) {
		add(mainC, m[1])
	}
	for _, m := range reWebContSend.FindAllStringSubmatch(text, -1) {
		add(wc, m[1])
	}
}

// ---- git churn ----

// gitChurn 统计近 300 提交窗口内每个文件的触及提交数（键为项目相对路径）。
// 失败（如仓库过浅）时返回空表，heat 退化为 0。
func gitChurn(projectPath, sha string) map[string]int {
	counts := map[string]int{}
	out, err := gitRun(projectPath, 30*time.Second, "log", "--no-merges", "-n", itoa(churnWindow),
		"--pretty=format:", "--name-only", sha)
	if err != nil {
		return counts
	}
	prefix := repoPrefix(projectPath)
	for _, ln := range strings.Split(out, "\n") {
		repoRel := strings.TrimRight(ln, "\r")
		if repoRel == "" {
			continue
		}
		rel := strings.TrimPrefix(repoRel, prefix)
		if prefix != "" && rel == repoRel {
			continue // 不在项目子树内
		}
		counts[rel]++
	}
	return counts
}

// ---- 环检测（Tarjan SCC） ----

// tarjanCycles 在组件有向图上跑 Tarjan 强连通分量，输出所有 size>1 的分量：
// 每个分量内按 id 排序、首尾相接表示环；分量间按内容排序保证输出确定。
func tarjanCycles(nodes []string, adj map[string]map[string]bool) [][]string {
	index := map[string]int{}
	low := map[string]int{}
	onStack := map[string]bool{}
	stack := []string{}
	counter := 0
	cycles := [][]string{}
	var visit func(v string)
	visit = func(v string) {
		index[v] = counter
		low[v] = counter
		counter++
		stack = append(stack, v)
		onStack[v] = true
		ns := make([]string, 0, len(adj[v]))
		for w := range adj[v] {
			ns = append(ns, w)
		}
		sort.Strings(ns)
		for _, w := range ns {
			if _, ok := index[w]; !ok {
				visit(w)
				if low[w] < low[v] {
					low[v] = low[w]
				}
			} else if onStack[w] && index[w] < low[v] {
				low[v] = index[w]
			}
		}
		if low[v] == index[v] {
			var scc []string
			for {
				w := stack[len(stack)-1]
				stack = stack[:len(stack)-1]
				onStack[w] = false
				scc = append(scc, w)
				if w == v {
					break
				}
			}
			if len(scc) > 1 {
				sort.Strings(scc)
				cycles = append(cycles, append(scc, scc[0]))
			}
		}
	}
	for _, v := range nodes { // nodes 已按组件序传入
		if _, ok := index[v]; !ok {
			visit(v)
		}
	}
	sort.Slice(cycles, func(i, j int) bool {
		return strings.Join(cycles[i], "\x00") < strings.Join(cycles[j], "\x00")
	})
	return cycles
}
