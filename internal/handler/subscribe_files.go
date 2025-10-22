package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
	"traffic-info/internal/storage"
)

type subscribeFilesHandler struct {
	repo *storage.TrafficRepository
}

// NewSubscribeFilesHandler returns an admin-only handler for managing subscribe files.
func NewSubscribeFilesHandler(repo *storage.TrafficRepository) http.Handler {
	if repo == nil {
		panic("subscribe files handler requires repository")
	}

	return &subscribeFilesHandler{
		repo: repo,
	}
}

func (h *subscribeFilesHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/subscribe-files")
	path = strings.Trim(path, "/")

	switch {
	case path == "" && r.Method == http.MethodGet:
		h.handleList(w, r)
	case path == "" && r.Method == http.MethodPost:
		h.handleCreate(w, r)
	case path == "import" && r.Method == http.MethodPost:
		h.handleImport(w, r)
	case path == "upload" && r.Method == http.MethodPost:
		h.handleUpload(w, r)
	case path == "create-from-config" && r.Method == http.MethodPost:
		h.handleCreateFromConfig(w, r)
	case path != "" && path != "import" && path != "upload" && path != "create-from-config" && (r.Method == http.MethodPut || r.Method == http.MethodPatch):
		h.handleUpdate(w, r, path)
	case path != "" && path != "import" && path != "upload" && path != "create-from-config" && r.Method == http.MethodDelete:
		h.handleDelete(w, r, path)
	default:
		allowed := []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete}
		methodNotAllowed(w, allowed...)
	}
}

func (h *subscribeFilesHandler) handleList(w http.ResponseWriter, r *http.Request) {
	files, err := h.repo.ListSubscribeFiles(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"files": h.convertSubscribeFilesWithVersions(r.Context(), files),
	})
}

func (h *subscribeFilesHandler) handleCreate(w http.ResponseWriter, r *http.Request) {
	var req subscribeFileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeBadRequest(w, "请求格式不正确")
		return
	}

	if req.Name == "" {
		writeBadRequest(w, "订阅名称是必填项")
		return
	}
	if req.URL == "" {
		writeBadRequest(w, "链接地址是必填项")
		return
	}
	if req.Type == "" {
		writeBadRequest(w, "类型是必填项")
		return
	}
	if req.Filename == "" {
		writeBadRequest(w, "文件名是必填项")
		return
	}

	file := storage.SubscribeFile{
		Name:        req.Name,
		Description: req.Description,
		URL:         req.URL,
		Type:        req.Type,
		Filename:    req.Filename,
	}

	created, err := h.repo.CreateSubscribeFile(r.Context(), file)
	if err != nil {
		if errors.Is(err, storage.ErrSubscribeFileExists) {
			writeError(w, http.StatusConflict, errors.New("订阅名称已存在"))
			return
		}
		writeError(w, http.StatusBadRequest, err)
		return
	}

	respondJSON(w, http.StatusCreated, map[string]any{
		"file": convertSubscribeFile(created),
	})
}

func (h *subscribeFilesHandler) handleImport(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		URL         string `json:"url"`
		Filename    string `json:"filename"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeBadRequest(w, "请求格式不正确")
		return
	}

	if req.URL == "" {
		writeBadRequest(w, "订阅URL是必填项")
		return
	}
	if req.Name == "" {
		writeBadRequest(w, "订阅名称是必填项")
		return
	}

	// 创建HTTP客户端并获取订阅内容
	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	httpReq, err := http.NewRequest("GET", req.URL, nil)
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("无效的订阅URL"))
		return
	}

	// 添加User-Agent头
	httpReq.Header.Set("User-Agent", "clash-meta/2.4.0")

	resp, err := client.Do(httpReq)
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("无法获取订阅内容: "+err.Error()))
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		writeError(w, http.StatusBadRequest, errors.New("订阅服务器返回错误状态"))
		return
	}

	// 读取响应内容
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("读取订阅内容失败"))
		return
	}

	// 验证YAML格式
	var yamlCheck map[string]any
	if err := yaml.Unmarshal(body, &yamlCheck); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("订阅内容不是有效的YAML格式"))
		return
	}

	// 从content-disposition获取文件名
	filename := req.Filename
	if filename == "" {
		contentDisposition := resp.Header.Get("Content-Disposition")
		if contentDisposition != "" {
			filename = parseFilenameFromContentDisposition(contentDisposition)
		}
		if filename == "" {
			filename = fmt.Sprintf("subscription_%d.yaml", time.Now().Unix())
		}
	}

	// 确保文件名有.yaml或.yml扩展名
	ext := filepath.Ext(filename)
	if ext != ".yaml" && ext != ".yml" {
		filename = filename + ".yaml"
	}

	// 保存文件到subscribes目录
	subscribesDir := "subscribes"
	if err := os.MkdirAll(subscribesDir, 0755); err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("创建订阅目录失败"))
		return
	}

	filePath := filepath.Join(subscribesDir, filename)
	if err := os.WriteFile(filePath, body, 0644); err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("保存订阅文件失败"))
		return
	}

	// 保存到数据库
	file := storage.SubscribeFile{
		Name:        req.Name,
		Description: req.Description,
		URL:         req.URL,
		Type:        storage.SubscribeTypeImport,
		Filename:    filename,
	}

	created, err := h.repo.CreateSubscribeFile(r.Context(), file)
	if err != nil {
		// 如果数据库保存失败，删除已保存的文件
		_ = os.Remove(filePath)
		if errors.Is(err, storage.ErrSubscribeFileExists) {
			writeError(w, http.StatusConflict, errors.New("订阅名称已存在"))
			return
		}
		writeError(w, http.StatusBadRequest, err)
		return
	}

	respondJSON(w, http.StatusCreated, map[string]any{
		"file": convertSubscribeFile(created),
	})
}

func (h *subscribeFilesHandler) handleUpload(w http.ResponseWriter, r *http.Request) {
	// 解析multipart form
	if err := r.ParseMultipartForm(10 << 20); err != nil { // 10MB
		writeBadRequest(w, "解析表单失败")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeBadRequest(w, "文件上传失败")
		return
	}
	defer file.Close()

	name := r.FormValue("name")
	if name == "" {
		name = strings.TrimSuffix(header.Filename, filepath.Ext(header.Filename))
	}

	description := r.FormValue("description")
	filename := r.FormValue("filename")
	if filename == "" {
		filename = header.Filename
	}

	// 确保文件名有.yaml或.yml扩展名
	ext := filepath.Ext(filename)
	if ext != ".yaml" && ext != ".yml" {
		filename = filename + ".yaml"
	}

	// 读取并验证YAML格式
	content, err := io.ReadAll(file)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("读取文件失败"))
		return
	}

	var yamlCheck map[string]any
	if err := yaml.Unmarshal(content, &yamlCheck); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("文件不是有效的YAML格式"))
		return
	}

	// 保存文件到subscribes目录
	subscribesDir := "subscribes"
	if err := os.MkdirAll(subscribesDir, 0755); err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("创建订阅目录失败"))
		return
	}

	filePath := filepath.Join(subscribesDir, filename)
	if err := os.WriteFile(filePath, content, 0644); err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("保存订阅文件失败"))
		return
	}

	// 保存到数据库
	subscribeFile := storage.SubscribeFile{
		Name:        name,
		Description: description,
		URL:         "",  // 上传的文件没有URL
		Type:        storage.SubscribeTypeUpload,
		Filename:    filename,
	}

	created, err := h.repo.CreateSubscribeFile(r.Context(), subscribeFile)
	if err != nil {
		// 如果数据库保存失败，删除已保存的文件
		_ = os.Remove(filePath)
		if errors.Is(err, storage.ErrSubscribeFileExists) {
			writeError(w, http.StatusConflict, errors.New("订阅名称已存在"))
			return
		}
		writeError(w, http.StatusBadRequest, err)
		return
	}

	respondJSON(w, http.StatusCreated, map[string]any{
		"file": convertSubscribeFile(created),
	})
}

func (h *subscribeFilesHandler) handleUpdate(w http.ResponseWriter, r *http.Request, idSegment string) {
	id, err := strconv.ParseInt(idSegment, 10, 64)
	if err != nil || id <= 0 {
		writeBadRequest(w, "无效的订阅ID")
		return
	}

	existing, err := h.repo.GetSubscribeFileByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, storage.ErrSubscribeFileNotFound) {
			writeError(w, http.StatusNotFound, err)
			return
		}
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	var req subscribeFileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeBadRequest(w, "请求格式不正确")
		return
	}

	// 更新字段
	if req.Name != "" {
		existing.Name = req.Name
	}
	if req.Description != "" {
		existing.Description = req.Description
	}
	if req.URL != "" {
		existing.URL = req.URL
	}
	if req.Type != "" {
		existing.Type = req.Type
	}

	// 处理文件名更新
	oldFilename := existing.Filename
	needRenameFile := false
	if req.Filename != "" && req.Filename != existing.Filename {
		// 验证新文件名
		ext := filepath.Ext(req.Filename)
		if ext != ".yaml" && ext != ".yml" {
			writeError(w, http.StatusBadRequest, errors.New("文件名必须以 .yaml 或 .yml 结尾"))
			return
		}

		// 检查新文件名是否已被其他订阅使用
		if existingFile, err := h.repo.GetSubscribeFileByFilename(r.Context(), req.Filename); err == nil && existingFile.ID != id {
			writeError(w, http.StatusConflict, errors.New("文件名已被其他订阅使用"))
			return
		}

		existing.Filename = req.Filename
		needRenameFile = true
	}

	updated, err := h.repo.UpdateSubscribeFile(r.Context(), existing)
	if err != nil {
		if errors.Is(err, storage.ErrSubscribeFileExists) {
			writeError(w, http.StatusConflict, errors.New("订阅名称已存在"))
			return
		}
		if errors.Is(err, storage.ErrSubscribeFileNotFound) {
			writeError(w, http.StatusNotFound, err)
			return
		}
		writeError(w, http.StatusBadRequest, err)
		return
	}

	// 如果文件名发生变化，重命名物理文件
	if needRenameFile {
		oldPath := filepath.Join("subscribes", oldFilename)
		newPath := filepath.Join("subscribes", req.Filename)

		// 检查旧文件是否存在
		if _, err := os.Stat(oldPath); err == nil {
			// 重命名文件
			if err := os.Rename(oldPath, newPath); err != nil {
				// 重命名失败，回滚数据库更新
				existing.Filename = oldFilename
				_, _ = h.repo.UpdateSubscribeFile(r.Context(), existing)
				writeError(w, http.StatusInternalServerError, errors.New("重命名文件失败: "+err.Error()))
				return
			}
		}
		// 如果旧文件不存在，只更新数据库记录，不报错
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"file": convertSubscribeFile(updated),
	})
}

func (h *subscribeFilesHandler) handleDelete(w http.ResponseWriter, r *http.Request, idSegment string) {
	id, err := strconv.ParseInt(idSegment, 10, 64)
	if err != nil || id <= 0 {
		writeBadRequest(w, "无效的订阅ID")
		return
	}

	// 获取文件信息以便删除物理文件
	file, err := h.repo.GetSubscribeFileByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, storage.ErrSubscribeFileNotFound) {
			writeError(w, http.StatusNotFound, err)
			return
		}
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	// 删除数据库记录
	if err := h.repo.DeleteSubscribeFile(r.Context(), id); err != nil {
		if errors.Is(err, storage.ErrSubscribeFileNotFound) {
			writeError(w, http.StatusNotFound, err)
			return
		}
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	// 删除物理文件
	filePath := filepath.Join("subscribes", file.Filename)
	_ = os.Remove(filePath) // 忽略错误，即使文件不存在也继续

	respondJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// parseFilenameFromContentDisposition 从Content-Disposition头解析文件名
// 支持格式: attachment;filename*=UTF-8''%E6%B3%A1%E6%B3%A1Dog
func parseFilenameFromContentDisposition(header string) string {
	// 查找 filename*= 部分
	if idx := strings.Index(header, "filename*="); idx != -1 {
		// 提取等号后的内容
		value := header[idx+10:]
		// 查找两个单引号后的内容
		if idx2 := strings.LastIndex(value, "''"); idx2 != -1 {
			encoded := value[idx2+2:]
			// URL解码
			if decoded, err := url.QueryUnescape(encoded); err == nil {
				return decoded
			}
		}
	}

	// 如果没有filename*=，尝试filename=
	if idx := strings.Index(header, "filename="); idx != -1 {
		value := header[idx+9:]
		value = strings.Trim(value, `"`)
		if idx2 := strings.IndexAny(value, ";,"); idx2 != -1 {
			value = value[:idx2]
		}
		return strings.TrimSpace(value)
	}

	return ""
}

type subscribeFileRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	URL         string `json:"url"`
	Type        string `json:"type"`
	Filename    string `json:"filename"`
}

type subscribeFileDTO struct {
	ID            int64     `json:"id"`
	Name          string    `json:"name"`
	Description   string    `json:"description"`
	Type          string    `json:"type"`
	Filename      string    `json:"filename"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
	LatestVersion int64     `json:"latest_version,omitempty"`
}

func convertSubscribeFile(file storage.SubscribeFile) subscribeFileDTO {
	return subscribeFileDTO{
		ID:          file.ID,
		Name:        file.Name,
		Description: file.Description,
		Type:        file.Type,
		Filename:    file.Filename,
		CreatedAt:   file.CreatedAt,
		UpdatedAt:   file.UpdatedAt,
	}
}

func convertSubscribeFiles(files []storage.SubscribeFile) []subscribeFileDTO {
	result := make([]subscribeFileDTO, 0, len(files))
	for _, file := range files {
		result = append(result, convertSubscribeFile(file))
	}
	return result
}

func (h *subscribeFilesHandler) convertSubscribeFilesWithVersions(ctx context.Context, files []storage.SubscribeFile) []subscribeFileDTO {
	result := make([]subscribeFileDTO, 0, len(files))
	for _, file := range files {
		dto := convertSubscribeFile(file)

		// 获取最新版本号
		if versions, err := h.repo.ListRuleVersions(ctx, file.Filename, 1); err == nil && len(versions) > 0 {
			dto.LatestVersion = versions[0].Version
		}

		result = append(result, dto)
	}
	return result
}

// handleCreateFromConfig 保存生成的配置为订阅文件
func (h *subscribeFilesHandler) handleCreateFromConfig(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Filename    string `json:"filename"`
		Content     string `json:"content"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeBadRequest(w, "请求格式不正确")
		return
	}

	if req.Name == "" {
		writeBadRequest(w, "订阅名称是必填项")
		return
	}
	if req.Content == "" {
		writeBadRequest(w, "配置内容不能为空")
		return
	}

	// 设置默认文件名
	filename := req.Filename
	if filename == "" {
		filename = req.Name
	}

	// 确保文件名有.yaml或.yml扩展名
	ext := filepath.Ext(filename)
	if ext != ".yaml" && ext != ".yml" {
		filename = filename + ".yaml"
	}

	// 验证YAML格式
	var yamlCheck map[string]any
	if err := yaml.Unmarshal([]byte(req.Content), &yamlCheck); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("配置内容不是有效的YAML格式"))
		return
	}

	// 保存文件到subscribes目录
	subscribesDir := "subscribes"
	if err := os.MkdirAll(subscribesDir, 0755); err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("创建订阅目录失败"))
		return
	}

	filePath := filepath.Join(subscribesDir, filename)
	if err := os.WriteFile(filePath, []byte(req.Content), 0644); err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("保存订阅文件失败"))
		return
	}

	// 保存到数据库
	file := storage.SubscribeFile{
		Name:        req.Name,
		Description: req.Description,
		URL:         "",
		Type:        storage.SubscribeTypeCreate,
		Filename:    filename,
	}

	created, err := h.repo.CreateSubscribeFile(r.Context(), file)
	if err != nil {
		// 如果数据库保存失败，删除已保存的文件
		_ = os.Remove(filePath)
		if errors.Is(err, storage.ErrSubscribeFileExists) {
			writeError(w, http.StatusConflict, errors.New("订阅名称已存在"))
			return
		}
		writeError(w, http.StatusBadRequest, err)
		return
	}

	respondJSON(w, http.StatusCreated, map[string]any{
		"file": convertSubscribeFile(created),
	})
}
