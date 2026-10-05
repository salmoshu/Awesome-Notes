package main

// fs.go：远端/本地目录浏览 —— 远程连接建立后，客户端逐级浏览文件系统并挑选要导入的项目目录。
// 仅列目录（文档项目以目录为单位导入），hasDocs 提示该目录直接包含文档文件。

import (
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const fsListMaxEntries = 2000

type fsEntry struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	HasDocs bool   `json:"hasDocs"`
}

func (s *server) handleFsList(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	showAll := q.Get("all") == "1"

	home, _ := os.UserHomeDir()
	dir := strings.TrimSpace(q.Get("path"))
	if dir == "" || dir == "~" {
		dir = home
	}
	if !filepath.IsAbs(dir) && !strings.HasPrefix(dir, `\\`) {
		writeError(w, 400, "需传入绝对路径（留空则为家目录）")
		return
	}
	dir = filepath.Clean(dir)

	entries, err := os.ReadDir(dir)
	if err != nil {
		writeError(w, 400, "目录不可读："+err.Error())
		return
	}

	out := []fsEntry{}
	truncated := false
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		if !showAll && strings.HasPrefix(name, ".") {
			continue
		}
		if len(out) >= fsListMaxEntries {
			truncated = true
			break
		}
		full := filepath.Join(dir, name)
		out = append(out, fsEntry{Name: name, Path: full, HasDocs: dirHasDocs(full)})
	}
	sort.Slice(out, func(i, j int) bool {
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})

	parent := filepath.Dir(dir)
	if parent == dir {
		parent = ""
	}
	writeJSON(w, 200, map[string]any{
		"path":      dir,
		"home":      home,
		"parent":    parent,
		"sep":       string(filepath.Separator),
		"entries":   out,
		"truncated": truncated,
	})
}

// dirHasDocs 目录直接包含文档文件则提示（仅看一层，避免深扫拖慢浏览）。
func dirHasDocs(dir string) bool {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if docExts[strings.ToLower(filepath.Ext(e.Name()))] {
			return true
		}
	}
	return false
}
