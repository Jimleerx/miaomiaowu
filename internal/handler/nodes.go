package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
	"traffic-info/internal/auth"
	"traffic-info/internal/storage"
)

type nodesHandler struct {
	repo *storage.TrafficRepository
}

// NewNodesHandler returns an admin-only handler that manages proxy nodes.
func NewNodesHandler(repo *storage.TrafficRepository) http.Handler {
	if repo == nil {
		panic("nodes handler requires repository")
	}

	return &nodesHandler{
		repo: repo,
	}
}

func (h *nodesHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/nodes")
	path = strings.Trim(path, "/")

	switch {
	case path == "" && r.Method == http.MethodGet:
		h.handleList(w, r)
	case path == "" && r.Method == http.MethodPost:
		h.handleCreate(w, r)
	case path == "batch" && r.Method == http.MethodPost:
		h.handleBatchCreate(w, r)
	case path == "fetch-subscription" && r.Method == http.MethodPost:
		h.handleFetchSubscription(w, r)
	case path != "" && path != "batch" && path != "fetch-subscription" && (r.Method == http.MethodPut || r.Method == http.MethodPatch):
		h.handleUpdate(w, r, path)
	case path != "" && path != "batch" && path != "fetch-subscription" && r.Method == http.MethodDelete:
		h.handleDelete(w, r, path)
	case path == "clear" && r.Method == http.MethodPost:
		h.handleClearAll(w, r)
	default:
		allowed := []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete}
		methodNotAllowed(w, allowed...)
	}
}

func (h *nodesHandler) handleList(w http.ResponseWriter, r *http.Request) {
	username := auth.UsernameFromContext(r.Context())
	if username == "" {
		writeError(w, http.StatusUnauthorized, errors.New("用户未认证"))
		return
	}

	nodes, err := h.repo.ListNodes(r.Context(), username)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"nodes": convertNodes(nodes),
	})
}

func (h *nodesHandler) handleCreate(w http.ResponseWriter, r *http.Request) {
	username := auth.UsernameFromContext(r.Context())
	if username == "" {
		writeError(w, http.StatusUnauthorized, errors.New("用户未认证"))
		return
	}

	var req nodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeBadRequest(w, "请求格式不正确")
		return
	}

	if req.RawURL == "" {
		writeBadRequest(w, "节点URL是必填项")
		return
	}

	node := storage.Node{
		Username:     username,
		RawURL:       req.RawURL,
		NodeName:     req.NodeName,
		Protocol:     req.Protocol,
		ParsedConfig: req.ParsedConfig,
		ClashConfig:  req.ClashConfig,
		Enabled:      req.Enabled,
	}

	created, err := h.repo.CreateNode(r.Context(), node)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	respondJSON(w, http.StatusCreated, map[string]any{
		"node": convertNode(created),
	})
}

func (h *nodesHandler) handleBatchCreate(w http.ResponseWriter, r *http.Request) {
	username := auth.UsernameFromContext(r.Context())
	if username == "" {
		writeError(w, http.StatusUnauthorized, errors.New("用户未认证"))
		return
	}

	var req struct {
		Nodes []nodeRequest `json:"nodes"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeBadRequest(w, "请求格式不正确")
		return
	}

	if len(req.Nodes) == 0 {
		writeBadRequest(w, "节点列表不能为空")
		return
	}

	nodes := make([]storage.Node, 0, len(req.Nodes))
	for _, n := range req.Nodes {
		// 允许 Clash 订阅节点没有 RawURL，但必须有 NodeName 和 ClashConfig
		if n.NodeName == "" || n.ClashConfig == "" {
			continue
		}
		nodes = append(nodes, storage.Node{
			Username:     username,
			RawURL:       n.RawURL, // 可以为空（Clash 订阅节点）
			NodeName:     n.NodeName,
			Protocol:     n.Protocol,
			ParsedConfig: n.ParsedConfig,
			ClashConfig:  n.ClashConfig,
			Enabled:      n.Enabled,
		})
	}

	if len(nodes) == 0 {
		writeBadRequest(w, "没有有效的节点可以保存")
		return
	}

	created, err := h.repo.BatchCreateNodes(r.Context(), nodes)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	respondJSON(w, http.StatusCreated, map[string]any{
		"nodes": convertNodes(created),
	})
}

func (h *nodesHandler) handleUpdate(w http.ResponseWriter, r *http.Request, idSegment string) {
	username := auth.UsernameFromContext(r.Context())
	if username == "" {
		writeError(w, http.StatusUnauthorized, errors.New("用户未认证"))
		return
	}

	id, err := strconv.ParseInt(idSegment, 10, 64)
	if err != nil || id <= 0 {
		writeBadRequest(w, "无效的节点标识")
		return
	}

	existing, err := h.repo.GetNode(r.Context(), id, username)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, storage.ErrNodeNotFound) {
			status = http.StatusNotFound
		}
		writeError(w, status, err)
		return
	}

	var req nodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeBadRequest(w, "请求格式不正确")
		return
	}

	// Update fields
	if req.RawURL != "" {
		existing.RawURL = req.RawURL
	}
	if req.NodeName != "" {
		existing.NodeName = req.NodeName
	}
	if req.Protocol != "" {
		existing.Protocol = req.Protocol
	}
	if req.ParsedConfig != "" {
		existing.ParsedConfig = req.ParsedConfig
	}
	if req.ClashConfig != "" {
		existing.ClashConfig = req.ClashConfig
	}
	existing.Enabled = req.Enabled

	updated, err := h.repo.UpdateNode(r.Context(), existing)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, storage.ErrNodeNotFound) {
			status = http.StatusNotFound
		}
		writeError(w, status, err)
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"node": convertNode(updated),
	})
}

func (h *nodesHandler) handleDelete(w http.ResponseWriter, r *http.Request, idSegment string) {
	username := auth.UsernameFromContext(r.Context())
	if username == "" {
		writeError(w, http.StatusUnauthorized, errors.New("用户未认证"))
		return
	}

	id, err := strconv.ParseInt(idSegment, 10, 64)
	if err != nil || id <= 0 {
		writeBadRequest(w, "无效的节点标识")
		return
	}

	if err := h.repo.DeleteNode(r.Context(), id, username); err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, storage.ErrNodeNotFound) {
			status = http.StatusNotFound
		}
		writeError(w, status, err)
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *nodesHandler) handleClearAll(w http.ResponseWriter, r *http.Request) {
	username := auth.UsernameFromContext(r.Context())
	if username == "" {
		writeError(w, http.StatusUnauthorized, errors.New("用户未认证"))
		return
	}

	if err := h.repo.DeleteAllUserNodes(r.Context(), username); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "cleared"})
}

type nodeRequest struct {
	RawURL       string `json:"raw_url"`
	NodeName     string `json:"node_name"`
	Protocol     string `json:"protocol"`
	ParsedConfig string `json:"parsed_config"`
	ClashConfig  string `json:"clash_config"`
	Enabled      bool   `json:"enabled"`
}

type nodeDTO struct {
	ID           int64     `json:"id"`
	RawURL       string    `json:"raw_url"`
	NodeName     string    `json:"node_name"`
	Protocol     string    `json:"protocol"`
	ParsedConfig string    `json:"parsed_config"`
	ClashConfig  string    `json:"clash_config"`
	Enabled      bool      `json:"enabled"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func convertNode(node storage.Node) nodeDTO {
	return nodeDTO{
		ID:           node.ID,
		RawURL:       node.RawURL,
		NodeName:     node.NodeName,
		Protocol:     node.Protocol,
		ParsedConfig: node.ParsedConfig,
		ClashConfig:  node.ClashConfig,
		Enabled:      node.Enabled,
		CreatedAt:    node.CreatedAt,
		UpdatedAt:    node.UpdatedAt,
	}
}

func convertNodes(nodes []storage.Node) []nodeDTO {
	result := make([]nodeDTO, 0, len(nodes))
	for _, node := range nodes {
		result = append(result, convertNode(node))
	}
	return result
}

func (h *nodesHandler) handleFetchSubscription(w http.ResponseWriter, r *http.Request) {
	username := auth.UsernameFromContext(r.Context())
	if username == "" {
		writeError(w, http.StatusUnauthorized, errors.New("用户未认证"))
		return
	}

	var req struct {
		URL string `json:"url"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeBadRequest(w, "请求格式不正确")
		return
	}

	if req.URL == "" {
		writeBadRequest(w, "订阅URL是必填项")
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

	// 添加User-Agent头，模拟Clash客户端
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

	// 解析YAML
	var clashConfig struct {
		Proxies []map[string]any `yaml:"proxies"`
	}

	if err := yaml.Unmarshal(body, &clashConfig); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("解析订阅内容失败: "+err.Error()))
		return
	}

	if len(clashConfig.Proxies) == 0 {
		writeError(w, http.StatusBadRequest, errors.New("订阅中没有找到代理节点"))
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"proxies": clashConfig.Proxies,
		"count":   len(clashConfig.Proxies),
	})
}
