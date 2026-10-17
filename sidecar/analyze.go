package main

// analyze.go：架构 spec 生成 —— 枚举源码文件、正则提取 import、目录级组件
// 划分与连接聚合，产出 archify architecture v1 spec，缓存于 <项目>/.timber/arch/<sha>.json。
// 另含 arch refs 端点（分支/标签列表，供架构视图 ref 下拉）。

import (
	"encoding/json"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// ---- spec schema（archify architecture v1） ----

type archSpec struct {
	SchemaVersion int               `json:"schema_version"`
	DiagramType   string            `json:"diagram_type"`
	Meta          archMeta          `json:"meta"`
	Components    []*archComponent  `json:"components"`
	Boundaries    []*archBoundary   `json:"boundaries,omitempty"`
	Connections   []*archConnection `json:"connections"`
}

type archMeta struct {
	Title          string    `json:"title"`
	QualityProfile string    `json:"quality_profile"`
	Output         string    `json:"output"` // archify 渲染器 schema 必填（占位，实际路径由主进程 argv 决定）
	Repository     *archRepo `json:"repository,omitempty"`
}

type archRepo struct {
	URL      string `json:"url,omitempty"`
	Revision string `json:"revision"`
	Provider string `json:"provider,omitempty"`
}

type archComponent struct {
	ID       string       `json:"id"`
	Type     string       `json:"type"` // frontend/backend/database/cloud/external...
	Label    string       `json:"label"`
	Sublabel string       `json:"sublabel,omitempty"`
	Pos      [2]int       `json:"pos"`
	Size     [2]int       `json:"size"`
	Sources  []archSource `json:"sources,omitempty"`
}

type archSource struct {
	Path string `json:"path"`
}

type archBoundary struct {
	Kind  string   `json:"kind"` // region
	Label string   `json:"label"`
	Wraps []string `json:"wraps"`
}

type archConnection struct {
	ID    string `json:"id"`
	From  string `json:"from"`
	To    string `json:"to"`
	Label string `json:"label,omitempty"`
}

// ---- arch refs ----

func (s *server) handleArchRefs(w http.ResponseWriter, r *http.Request) {
	p := s.project(w, r)
	if p == nil {
		return
	}
	if !isGitRepo(p.Path) {
		writeNotRepo(w)
		return
	}
	type refInfo struct {
		Name string `json:"name"`
		Sha  string `json:"sha"`
	}
	listRefs := func(namespace string) []refInfo {
		out, err := gitRun(p.Path, 15*time.Second, "for-each-ref",
			"--sort=-committerdate", "--count=20",
			"--format=%(refname:short)%00%(objectname)", namespace)
		if err != nil {
			return []refInfo{}
		}
		refs := []refInfo{}
		for _, ln := range strings.Split(out, "\n") {
			name, sha, ok := strings.Cut(strings.TrimRight(ln, "\r"), "\x00")
			if ok && name != "" {
				refs = append(refs, refInfo{Name: name, Sha: sha})
			}
		}
		return refs
	}
	head := ""
	if out, err := gitRun(p.Path, 10*time.Second, "rev-parse", "HEAD"); err == nil {
		head = strings.TrimSpace(out)
	}
	writeJSON(w, 200, map[string]any{
		"ok": true, "head": head,
		"branches": listRefs("refs/heads"), "tags": listRefs("refs/tags"),
	})
}

// ---- arch spec ----

// 源码扩展名集（契约）
var sourceExts = map[string]bool{
	".ts": true, ".tsx": true, ".js": true, ".jsx": true, ".mjs": true,
	".cjs": true, ".go": true, ".py": true, ".rs": true, ".java": true,
	".kt": true, ".vue": true, ".svelte": true, ".c": true, ".cc": true,
	".cpp": true, ".h": true, ".hpp": true, ".cs": true, ".rb": true,
	".php": true, ".swift": true, ".scala": true, ".sh": true, ".ps1": true,
	".css": true, ".scss": true, ".html": true,
}

// 磁盘扫描排除目录
var archSkipDirs = map[string]bool{
	".git": true, "node_modules": true, "dist": true, "build": true,
	"out": true, "release": true, "tmp": true, "vendor": true,
	".toolchain": true, ".timber": true,
}

const maxArchFileBytes = 1 << 20 // 1MB

// srcFile 一个待分析的源码文件（路径为项目相对、/ 分隔）。
type srcFile struct {
	path    string
	content []byte
}

func (s *server) handleArchSpec(w http.ResponseWriter, r *http.Request) {
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
	cacheFile := filepath.Join(cacheDir, sha+".json")
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
	spec := buildSpec(p, files, sha)
	data, err := json.Marshal(spec)
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

// collectSourceFiles 枚举源码文件：HEAD 用磁盘扫描，其余 ref 用 git ls-tree + git show。
func collectSourceFiles(p *Project, ref, sha string) ([]srcFile, error) {
	if ref == "HEAD" {
		return scanSourceFiles(p.Path)
	}
	prefix := repoPrefix(p.Path)
	out, err := gitRun(p.Path, 30*time.Second, "ls-tree", "-r", "--name-only", sha)
	if err != nil {
		return nil, err
	}
	files := []srcFile{}
	for _, ln := range strings.Split(out, "\n") {
		repoRel := strings.TrimRight(ln, "\r")
		rel := strings.TrimPrefix(repoRel, prefix)
		if prefix != "" && rel == repoRel {
			continue // 不在项目子树内
		}
		if !sourceExts[strings.ToLower(path.Ext(rel))] {
			continue
		}
		content, err := gitRun(p.Path, 15*time.Second, "show", sha+":"+repoRel)
		if err != nil || len(content) > maxArchFileBytes {
			continue
		}
		files = append(files, srcFile{path: rel, content: []byte(content)})
	}
	return files, nil
}

// scanSourceFiles 磁盘扫描（ref=HEAD）。
func scanSourceFiles(root string) ([]srcFile, error) {
	files := []srcFile{}
	err := filepath.Walk(root, func(abs string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			if abs != root && archSkipDirs[info.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		if !sourceExts[strings.ToLower(filepath.Ext(info.Name()))] || info.Size() > maxArchFileBytes {
			return nil
		}
		content, err := os.ReadFile(abs)
		if err != nil {
			return nil
		}
		rel, err := filepath.Rel(root, abs)
		if err != nil {
			return nil
		}
		files = append(files, srcFile{path: toSlash(rel), content: content})
		return nil
	})
	return files, err
}

// ---- 组件划分 ----

const maxComponents = 24

// groupDirs 以文件父目录为组件键；超过上限时逐级向上聚合。
func groupDirs(files []srcFile) map[string][]srcFile {
	dirOf := func(f string) string {
		d := path.Dir(f)
		if d == "." || d == "/" {
			return "."
		}
		return d
	}
	groups := map[string][]srcFile{}
	for _, f := range files {
		d := dirOf(f.path)
		groups[d] = append(groups[d], f)
	}
	for len(groups) > maxComponents {
		next := map[string][]srcFile{}
		for d, fs := range groups {
			pd := dirOf(d)
			if d == "." { // 根组件无法再上聚合，但文件数已超限也只能保留
				pd = "."
			}
			next[pd] = append(next[pd], fs...)
		}
		if len(next) == len(groups) { // 无法收敛（极端情况），防死循环
			break
		}
		groups = next
	}
	return groups
}

var langByExt = map[string]string{
	".go": "Go", ".ts": "TS", ".tsx": "TS", ".js": "JS", ".jsx": "JS",
	".mjs": "JS", ".cjs": "JS", ".py": "Py", ".rs": "Rust", ".java": "Java",
	".kt": "Kotlin", ".vue": "Vue", ".svelte": "Svelte", ".c": "C",
	".cc": "C++", ".cpp": "C++", ".h": "C/C++", ".hpp": "C++", ".cs": "C#",
	".rb": "Ruby", ".php": "PHP", ".swift": "Swift", ".scala": "Scala",
	".sh": "Shell", ".ps1": "PS", ".css": "CSS", ".scss": "SCSS", ".html": "HTML",
}

// primaryLang 组件内出现最多的语言。
func primaryLang(files []srcFile) string {
	counts := map[string]int{}
	best, bestN := "", 0
	for _, f := range files {
		lang := langByExt[strings.ToLower(path.Ext(f.path))]
		if lang == "" {
			continue
		}
		counts[lang]++
		if counts[lang] > bestN {
			best, bestN = lang, counts[lang]
		}
	}
	return best
}

// componentType 按目录名启发推断组件类型。
func componentType(dir string) string {
	l := strings.ToLower(dir)
	has := func(keys ...string) bool {
		for _, seg := range strings.Split(l, "/") {
			for _, k := range keys {
				if seg == k || strings.Contains(seg, k) {
					return true
				}
			}
		}
		return false
	}
	switch {
	case has("renderer", "frontend", "web", "ui", "client", "pages"):
		return "frontend"
	case has("docs", "doc", "documentation"):
		return "external"
	case has("scripts", "script", "tools", "tool", "ci", "deploy", "infra"):
		return "cloud"
	case has("db", "database", "sql", "migration"):
		return "database"
	default:
		return "backend"
	}
}

// kebabID 目录路径转 kebab id（"." → "root"）。
func kebabID(dir string) string {
	if dir == "." {
		return "root"
	}
	id := strings.ToLower(strings.ReplaceAll(dir, "/", "-"))
	var b strings.Builder
	for _, r := range id {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-' {
			b.WriteRune(r)
		} else {
			b.WriteByte('-')
		}
	}
	return strings.Trim(b.String(), "-")
}

// ---- import 提取与解析 ----

var (
	reJSImport  = regexp.MustCompile(`(?:import\s+[^'"]*?\sfrom\s+|import\s+|from\s+|require\(\s*|import\(\s*)['"]([^'"]+)['"]`)
	reGoBlock   = regexp.MustCompile(`(?s)import\s*\((.*?)\)`)
	reGoSingle  = regexp.MustCompile(`import\s+(?:[\w.]+\s+)?"([^"]+)"`)
	reQuoted    = regexp.MustCompile(`"([^"]+)"`)
	rePyImport  = regexp.MustCompile(`(?m)^\s*(?:from|import)\s+([A-Za-z0-9_.]+)`)
	reRustUse   = regexp.MustCompile(`(?m)^\s*use\s+([\w:]+)`)
	reCInclude  = regexp.MustCompile(`(?m)#include\s*[<"]([^>"]+)[>"]`)
	reJavaImprt = regexp.MustCompile(`(?m)^\s*import\s+(?:static\s+)?([\w.]+)`)
)

// extractImports 按扩展名提取 import 目标模块串。
func extractImports(f srcFile) []string {
	text := string(f.content)
	var out []string
	switch strings.ToLower(path.Ext(f.path)) {
	case ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte":
		for _, m := range reJSImport.FindAllStringSubmatch(text, -1) {
			out = append(out, m[1])
		}
	case ".go":
		for _, m := range reGoBlock.FindAllStringSubmatch(text, -1) {
			for _, q := range reQuoted.FindAllStringSubmatch(m[1], -1) {
				out = append(out, q[1])
			}
		}
		for _, m := range reGoSingle.FindAllStringSubmatch(text, -1) {
			out = append(out, m[1])
		}
	case ".py":
		for _, m := range rePyImport.FindAllStringSubmatch(text, -1) {
			out = append(out, m[1])
		}
	case ".rs":
		for _, m := range reRustUse.FindAllStringSubmatch(text, -1) {
			out = append(out, m[1])
		}
	case ".c", ".cc", ".cpp", ".h", ".hpp":
		for _, m := range reCInclude.FindAllStringSubmatch(text, -1) {
			out = append(out, m[1])
		}
	case ".java", ".kt", ".scala":
		for _, m := range reJavaImprt.FindAllStringSubmatch(text, -1) {
			out = append(out, m[1])
		}
	}
	return out
}

// resolver 把 import 目标映射到仓内目录（外部包返回空串）。
type resolver struct {
	dirs       []string // 组件目录（长前缀优先）
	dirSet     map[string]bool
	fileSet    map[string]bool
	goModPath  string
	existCache map[string]bool
}

func newResolver(compDirs []string, files []srcFile) *resolver {
	r := &resolver{dirSet: map[string]bool{}, fileSet: map[string]bool{}, existCache: map[string]bool{}}
	r.dirs = append(r.dirs, compDirs...)
	for _, f := range files {
		r.fileSet[f.path] = true
		for d := path.Dir(f.path); d != "." && d != "/"; d = path.Dir(d) {
			r.dirSet[d] = true
		}
	}
	return r
}

// targetExists 目标路径是否真实落在仓内（目录、文件，或可补扩展名/下级的模块路径）。
func (r *resolver) targetExists(p string) bool {
	if v, ok := r.existCache[p]; ok {
		return v
	}
	ex := r.dirSet[p] || r.fileSet[p]
	if !ex {
		for f := range r.fileSet {
			if strings.HasPrefix(f, p+"/") || strings.HasPrefix(f, p+".") {
				ex = true
				break
			}
		}
	}
	r.existCache[p] = ex
	return ex
}

// resolve 返回目标所属组件目录；无法映射到仓内返回 false。
func (r *resolver) resolve(target, fileDir string) (string, bool) {
	var p string
	relative := false
	switch {
	case strings.HasPrefix(target, "./") || strings.HasPrefix(target, "../"):
		relative = true
		p = path.Clean(path.Join(fileDir, target))
		if p == ".." || strings.HasPrefix(p, "../") {
			return "", false
		}
	case r.goModPath != "" && (target == r.goModPath || strings.HasPrefix(target, r.goModPath+"/")):
		p = strings.TrimPrefix(target, r.goModPath+"/")
		p = strings.TrimPrefix(p, r.goModPath)
		p = strings.TrimPrefix(p, "/")
	case strings.HasPrefix(target, "crate::"): // rust 仓内模块
		p = strings.ReplaceAll(strings.TrimPrefix(target, "crate::"), "::", "/")
	case !strings.Contains(target, "/"):
		// python/java 点分包名，仅在确为仓内目录时映射（避免 npm 裸包名误配）
		if dot := strings.ReplaceAll(target, ".", "/"); r.dirSet[dot] {
			p = dot
		} else {
			return "", false
		}
	default:
		// 含 / 的非相对路径：可能是仓内路径（go module 之外的 mono-repo）或外部包
		if r.targetExists(target) {
			p = target
		} else if dot := strings.ReplaceAll(target, ".", "/"); r.targetExists(dot) {
			p = dot
		} else {
			return "", false
		}
	}
	// 非相对 import 须确认目标真实存在，否则视为外部包丢弃
	//（相对 import 本身即仓内引用，免验）
	if !relative && !r.targetExists(p) {
		return "", false
	}
	// 目标是文件则取其目录，再向组件目录做最长前缀匹配
	tdir := p
	if !r.dirSet[tdir] && tdir != "." {
		tdir = path.Dir(tdir)
	}
	if tdir == "/" {
		tdir = "."
	}
	best, bestLen := "", -1
	for _, d := range r.dirs {
		if d == "." {
			if tdir == "." && bestLen < 0 {
				best, bestLen = ".", 0
			}
			continue
		}
		if tdir == d || strings.HasPrefix(tdir, d+"/") {
			if len(d) > bestLen {
				best, bestLen = d, len(d)
			}
		}
	}
	if best == "" {
		return "", false
	}
	return best, true
}

// ---- spec 构建 ----

// topDir 组件目录的第一层（boundary 键）；根组件返回 "\x00" 使其排最前。
func topDir(d string) string {
	if d == "." {
		return "\x00"
	}
	if i := strings.IndexByte(d, '/'); i >= 0 {
		return d[:i]
	}
	return d
}

// sortCompDirs 组件目录排序：按 boundary（第一层目录）分组，组内按目录名。
// spec 与 insights 共用，保证两端点组件集合、id 与顺序完全一致。
func sortCompDirs(dirs []string) {
	sort.Slice(dirs, func(i, j int) bool {
		ti, tj := topDir(dirs[i]), topDir(dirs[j])
		if ti != tj {
			return ti < tj
		}
		return dirs[i] < dirs[j]
	})
}

// fileCompDir 文件所属组件目录（聚合后可能不等于父目录）。
func fileCompDir(groups map[string][]srcFile, fileDir string) string {
	for d := fileDir; ; d = path.Dir(d) {
		if _, ok := groups[d]; ok {
			return d
		}
		if d == "." || d == "/" {
			return "."
		}
	}
}

// dirEdge 目录级有向边。
type dirEdge struct{ from, to string }

// importEdges 把 import 解析聚合为目录级边计数（spec 与 insights 共用）。
// extract 为 import 提取器：spec 传正则版 extractImports；insights 对 Go 文件切到 AST 结果。
func importEdges(p *Project, groups map[string][]srcFile, dirs []string, files []srcFile, idOf map[string]string, extract func(srcFile) []string) map[dirEdge]int {
	rsv := newResolver(dirs, files)
	rsv.goModPath = detectGoModule(p.Path, files)
	counts := map[dirEdge]int{}
	for _, f := range files {
		fileDir := path.Dir(f.path)
		if fileDir == "/" {
			fileDir = "."
		}
		from := fileCompDir(groups, fileDir)
		if _, ok := idOf[from]; !ok {
			continue // 文件所属组件目录不在最终组件集中（理论上不发生）
		}
		for _, target := range extract(f) {
			to, ok := rsv.resolve(target, fileDir)
			if !ok || to == from {
				continue // 外部包与自环丢弃
			}
			if _, ok := idOf[to]; !ok {
				continue
			}
			counts[dirEdge{from, to}]++
		}
	}
	return counts
}

func buildSpec(p *Project, files []srcFile, sha string) *archSpec {
	groups := groupDirs(files)

	dirs := make([]string, 0, len(groups))
	for d := range groups {
		dirs = append(dirs, d)
	}
	sortCompDirs(dirs)

	spec := &archSpec{
		SchemaVersion: 1,
		DiagramType:   "architecture",
		Components:    []*archComponent{},
		Connections:   []*archConnection{},
	}
	idOf := map[string]string{}
	for i, d := range dirs {
		fs := groups[d]
		id := kebabID(d)
		idOf[d] = id
		label := path.Base(d)
		if d == "." {
			label = p.Name
		}
		sublabel := itoa(len(fs)) + " files"
		if lang := primaryLang(fs); lang != "" {
			sublabel += " · " + lang
		}
		sources := []archSource{}
		for j, f := range fs {
			if j >= 3 { // 代表文件最多列 3 个
				break
			}
			sources = append(sources, archSource{Path: f.path})
		}
		spec.Components = append(spec.Components, &archComponent{
			ID:       id,
			Type:     componentType(d),
			Label:    label,
			Sublabel: sublabel,
			Pos:      [2]int{40 + (i%4)*210, 40 + (i/4)*140},
			Size:     [2]int{120, 60},
			Sources:  sources,
		})
	}

	// boundary：第一层目录分组（根组件不 wrap）
	topGroups := map[string][]string{}
	topOrder := []string{}
	for _, d := range dirs {
		top := topDir(d)
		if top == "\x00" {
			continue
		}
		if _, ok := topGroups[top]; !ok {
			topOrder = append(topOrder, top)
		}
		topGroups[top] = append(topGroups[top], idOf[d])
	}
	sort.Strings(topOrder)
	for _, top := range topOrder {
		spec.Boundaries = append(spec.Boundaries, &archBoundary{
			Kind: "region", Label: top, Wraps: topGroups[top],
		})
	}

	// 连接：import 解析聚合为目录级边
	counts := importEdges(p, groups, dirs, files, idOf, extractImports)
	edges := make([]dirEdge, 0, len(counts))
	for e := range counts {
		edges = append(edges, e)
	}
	sort.Slice(edges, func(i, j int) bool {
		if edges[i].from != edges[j].from {
			return edges[i].from < edges[j].from
		}
		return edges[i].to < edges[j].to
	})
	for _, e := range edges {
		c := &archConnection{
			ID:   idOf[e.from] + "-to-" + idOf[e.to],
			From: idOf[e.from],
			To:   idOf[e.to],
		}
		if n := counts[e]; n > 1 {
			c.Label = "×" + itoa(n)
		}
		spec.Connections = append(spec.Connections, c)
	}

	// meta
	short := sha
	if len(short) > 7 {
		short = short[:7]
	}
	spec.Meta = archMeta{
		Title:          p.Name + " @ " + short,
		QualityProfile: "showcase",
		Output:         "architecture.html",
	}
	repo := &archRepo{Revision: sha}
	if out, err := gitRun(p.Path, 10*time.Second, "config", "--get", "remote.origin.url"); err == nil {
		if url := strings.TrimSpace(out); url != "" {
			repo.URL = url
			switch {
			case strings.Contains(url, "github.com"):
				repo.Provider = "github"
			case strings.Contains(url, "gitlab.com"):
				repo.Provider = "gitlab"
			}
		}
	}
	spec.Meta.Repository = repo
	return spec
}

// detectGoModule 读取 go.mod 的 module 路径（用于把 module 内 import 映射回目录）。
func detectGoModule(root string, files []srcFile) string {
	var data []byte
	for _, f := range files {
		if f.path == "go.mod" {
			data = f.content
			break
		}
	}
	if data == nil {
		if d, err := os.ReadFile(filepath.Join(root, "go.mod")); err == nil {
			data = d
		}
	}
	for _, ln := range strings.Split(string(data), "\n") {
		if rest, ok := strings.CutPrefix(strings.TrimSpace(ln), "module "); ok {
			return strings.TrimSpace(rest)
		}
	}
	return ""
}
