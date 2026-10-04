package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Annotation 一条批注。Quote + Prefix/Suffix 构成"锚点"：
// 文档被编辑后锚点可能漂移，agent 按引用文本与上下文重新定位。
type Annotation struct {
	ID        string    `json:"id"`
	Doc       string    `json:"doc"`    // 相对项目根（/ 分隔）
	Quote     string    `json:"quote"`  // 被批注的原文
	Prefix    string    `json:"prefix"` // 原文前 ~40 字符上下文
	Suffix    string    `json:"suffix"` // 原文后 ~40 字符上下文
	Text      string    `json:"text"`   // 批注内容（要求 agent 做的事）
	Status    string    `json:"status"` // open | done
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// annotationFile 一个项目的批注库，落在 <项目>/.awesome-notes/annotations.json。
type annotationFile struct {
	Version int                      `json:"version"`
	Docs    map[string][]*Annotation `json:"docs"`
}

type annotationStore struct {
	mu sync.Mutex
}

func newAnnotationStore() *annotationStore { return &annotationStore{} }

func annFilePath(projectPath string) string {
	return filepath.Join(projectPath, ".awesome-notes", "annotations.json")
}

func (s *annotationStore) load(projectPath string) (*annotationFile, error) {
	f := &annotationFile{Version: 1, Docs: map[string][]*Annotation{}}
	data, err := os.ReadFile(annFilePath(projectPath))
	if os.IsNotExist(err) {
		return f, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(data, f); err != nil {
		return nil, err
	}
	if f.Docs == nil {
		f.Docs = map[string][]*Annotation{}
	}
	return f, nil
}

func (s *annotationStore) save(projectPath string, f *annotationFile) error {
	if err := os.MkdirAll(filepath.Dir(annFilePath(projectPath)), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	tmp := annFilePath(projectPath) + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, annFilePath(projectPath))
}

func (s *annotationStore) list(projectPath, doc string) ([]*Annotation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	f, err := s.load(projectPath)
	if err != nil {
		return nil, err
	}
	if doc == "" {
		var all []*Annotation
		for _, anns := range f.Docs {
			all = append(all, anns...)
		}
		return all, nil
	}
	return f.Docs[doc], nil
}

func (s *annotationStore) create(projectPath string, a *Annotation) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	f, err := s.load(projectPath)
	if err != nil {
		return err
	}
	buf := make([]byte, 6)
	_, _ = rand.Read(buf)
	a.ID = "ann-" + hex.EncodeToString(buf)
	if a.Status == "" {
		a.Status = "open"
	}
	a.CreatedAt = time.Now()
	a.UpdatedAt = a.CreatedAt
	f.Docs[a.Doc] = append(f.Docs[a.Doc], a)
	return s.save(projectPath, f)
}

func (s *annotationStore) update(projectPath, doc, id, text, status string) (*Annotation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	f, err := s.load(projectPath)
	if err != nil {
		return nil, err
	}
	for _, a := range f.Docs[doc] {
		if a.ID == id {
			if text != "" {
				a.Text = text
			}
			if status != "" {
				a.Status = status
			}
			a.UpdatedAt = time.Now()
			return a, s.save(projectPath, f)
		}
	}
	return nil, os.ErrNotExist
}

func (s *annotationStore) delete(projectPath, doc, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	f, err := s.load(projectPath)
	if err != nil {
		return err
	}
	anns := f.Docs[doc]
	for i, a := range anns {
		if a.ID == id {
			f.Docs[doc] = append(anns[:i], anns[i+1:]...)
			if len(f.Docs[doc]) == 0 {
				delete(f.Docs, doc)
			}
			return s.save(projectPath, f)
		}
	}
	return os.ErrNotExist
}
