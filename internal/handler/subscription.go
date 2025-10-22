package handler

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"traffic-info/internal/auth"
	"traffic-info/internal/storage"
	"traffic-info/internal/substore"

	"gopkg.in/yaml.v3"
)

const subscriptionDefaultType = "clash"

type SubscriptionHandler struct {
	summary  *TrafficSummaryHandler
	repo     *storage.TrafficRepository
	baseDir  string
	fallback string
}

type subscriptionEndpoint struct {
	tokens *auth.TokenStore
	repo   *storage.TrafficRepository
	inner  *SubscriptionHandler
}

func NewSubscriptionHandler(repo *storage.TrafficRepository, baseDir string) http.Handler {
	if repo == nil {
		panic("subscription handler requires repository")
	}

	summary := NewTrafficSummaryHandler(repo)
	return newSubscriptionHandler(summary, repo, baseDir, subscriptionDefaultType)
}

// NewSubscriptionEndpoint returns a handler that serves subscription files, allowing either session tokens or user tokens via query parameter.
func NewSubscriptionEndpoint(tokens *auth.TokenStore, repo *storage.TrafficRepository, baseDir string) http.Handler {
	if tokens == nil {
		panic("subscription endpoint requires token store")
	}
	if repo == nil {
		panic("subscription endpoint requires repository")
	}

	inner := newSubscriptionHandler(nil, repo, baseDir, subscriptionDefaultType)
	return &subscriptionEndpoint{tokens: tokens, repo: repo, inner: inner}
}

func newSubscriptionHandler(summary *TrafficSummaryHandler, repo *storage.TrafficRepository, baseDir, fallback string) *SubscriptionHandler {
	if summary == nil {
		if repo == nil {
			panic("subscription handler requires repository")
		}
		summary = NewTrafficSummaryHandler(repo)
	}

	if repo == nil {
		panic("subscription handler requires repository")
	}

	if baseDir == "" {
		baseDir = filepath.FromSlash("subscribes")
	}

	cleanedBase := filepath.Clean(baseDir)
	if fallback == "" {
		fallback = subscriptionDefaultType
	}

	return &SubscriptionHandler{summary: summary, repo: repo, baseDir: cleanedBase, fallback: fallback}
}

func (s *subscriptionEndpoint) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	request, ok := s.authorizeRequest(w, r)
	if !ok {
		return
	}

	s.inner.ServeHTTP(w, request)
}

func (s *subscriptionEndpoint) authorizeRequest(w http.ResponseWriter, r *http.Request) (*http.Request, bool) {
	if r.Method != http.MethodGet {
		// allow handler to respond with method restrictions
		return r, true
	}

	queryToken := strings.TrimSpace(r.URL.Query().Get("token"))
	if queryToken != "" && s.repo != nil {
		username, err := s.repo.ValidateUserToken(r.Context(), queryToken)
		if err == nil {
			ctx := auth.ContextWithUsername(r.Context(), username)
			return r.WithContext(ctx), true
		}
		if !errors.Is(err, storage.ErrTokenNotFound) {
			writeError(w, http.StatusInternalServerError, err)
			return nil, false
		}
	}

	headerToken := strings.TrimSpace(r.Header.Get(auth.AuthHeader))
	username, ok := s.tokens.Lookup(headerToken)
	if ok {
		ctx := auth.ContextWithUsername(r.Context(), username)
		return r.WithContext(ctx), true
	}

	auth.WriteUnauthorizedResponse(w)
	return nil, false
}

func (h *SubscriptionHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, errors.New("only GET is supported"))
		return
	}

	// 尝试获取流量信息，如果探针未配置则跳过流量统计
	totalLimit, _, totalUsed, err := h.summary.fetchTotals(r.Context())
	hasTrafficInfo := err == nil
	// 如果是探针未配置的错误，不返回错误，继续处理
	if err != nil && !errors.Is(err, storage.ErrProbeConfigNotFound) {
		// 其他错误才返回
		writeError(w, http.StatusBadGateway, err)
		return
	}

	filename := strings.TrimSpace(r.URL.Query().Get("filename"))
	var subscribeFile storage.SubscribeFile
	var displayName string

	if filename != "" {
		subscribeFile, err = h.repo.GetSubscribeFileByFilename(r.Context(), filename)
		if err != nil {
			if errors.Is(err, storage.ErrSubscribeFileNotFound) {
				writeError(w, http.StatusNotFound, errors.New("subscription file not found"))
				return
			}
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		displayName = subscribeFile.Name
	} else {
		// TODO: 订阅链接已经配置到客户端，管理员修改文件名后，原订阅链接无法使用
		// 1.0 版本时改为与表里的ID关联，暂时先不改
		legacyName := strings.TrimSpace(r.URL.Query().Get("t"))
		link, err := h.resolveSubscription(r.Context(), legacyName)
		if err != nil {
			if errors.Is(err, storage.ErrSubscriptionNotFound) {
				writeError(w, http.StatusNotFound, err)
				return
			}
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		filename = link.RuleFilename
		displayName = link.Name
	}

	cleanedName := filepath.Clean(filename)
	if strings.HasPrefix(cleanedName, "..") {
		writeError(w, http.StatusBadRequest, errors.New("invalid rule filename"))
		return
	}

	resolvedPath := filepath.Join(h.baseDir, cleanedName)

	data, err := os.ReadFile(resolvedPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			writeError(w, http.StatusNotFound, err)
		} else {
			writeError(w, http.StatusInternalServerError, err)
		}
		return
	}

	// 根据参数t的类型调用substore的转换代码
	clientType := strings.TrimSpace(r.URL.Query().Get("t"))
	// 默认浏览器打开时直接输入文本, 不再下载问卷
	contentType := "text/yaml; charset=utf-8; charset=UTF-8"
	ext := filepath.Ext(filename)
	if ext == "" {
		ext = ".yaml"
	}

	// clash 和 clashmeta 类型直接输出源文件, 不需要转换
	if clientType != "" && clientType != "clash" && clientType != "clashmeta" {
		// Convert subscription using substore producers
		convertedData, err := h.convertSubscription(data, clientType)
		if err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("failed to convert subscription for client %s: %w", clientType, err))
			return
		}
		data = convertedData

		// Set content type and extension based on client type
		switch clientType {
		case "surge", "surgemac", "loon", "qx", "surfboard", "shadowrocket":
			// Text-based formats
			contentType = "text/plain; charset=utf-8"
			ext = ".txt"
		case "sing-box":
			// JSON format
			contentType = "application/json; charset=utf-8"
			ext = ".json"
		case "v2ray":
			// Base64 format
			contentType = "text/plain; charset=utf-8"
			ext = ".txt"
		case "uri":
			// URI format
			contentType = "text/plain; charset=utf-8"
			ext = ".txt"
		default:
			// YAML-based formats (clash, clashmeta, stash, shadowrocket, egern)
			contentType = "text/yaml; charset=utf-8"
			ext = ".yaml"
		}
	}

	attachmentName := url.PathEscape("妙妙屋-" + displayName + ext)

	w.Header().Set("Content-Type", contentType)
	// 只有在有流量信息时才添加 subscription-userinfo 头
	if hasTrafficInfo {
		headerValue := buildSubscriptionHeader(totalLimit, totalUsed)
		w.Header().Set("subscription-userinfo", headerValue)
	}
	w.Header().Set("profile-update-interval", "24")
	if clientType == "" {
		w.Header().Set("content-disposition", "attachment;filename*=UTF-8''"+attachmentName)
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (h *SubscriptionHandler) resolveSubscription(ctx context.Context, name string) (storage.SubscriptionLink, error) {
	if h == nil {
		return storage.SubscriptionLink{}, errors.New("subscription handler not initialized")
	}

	if h.repo == nil {
		return storage.SubscriptionLink{}, errors.New("subscription repository not configured")
	}

	trimmed := strings.TrimSpace(name)
	if trimmed != "" {
		return h.repo.GetSubscriptionByName(ctx, trimmed)
	}

	if h.fallback != "" {
		link, err := h.repo.GetSubscriptionByName(ctx, h.fallback)
		if err == nil {
			return link, nil
		}
		if !errors.Is(err, storage.ErrSubscriptionNotFound) {
			return storage.SubscriptionLink{}, err
		}
	}

	return h.repo.GetFirstSubscriptionLink(ctx)
}

func buildSubscriptionHeader(totalLimit, totalUsed int64) string {
	download := strconv.FormatInt(totalUsed, 10)
	total := strconv.FormatInt(totalLimit, 10)
	return "upload=0; download=" + download + "; total=" + total + "; expire="
}

// convertSubscription converts a YAML subscription file to the specified client format
func (h *SubscriptionHandler) convertSubscription(yamlData []byte, clientType string) ([]byte, error) {
	// 读取yaml
	var config map[string]interface{}
	if err := yaml.Unmarshal(yamlData, &config); err != nil {
		return nil, fmt.Errorf("failed to parse YAML: %w", err)
	}

	// 读取yaml中proxies属性的节点列表
	proxiesRaw, ok := config["proxies"]
	if !ok {
		return nil, errors.New("no 'proxies' field found in YAML")
	}

	proxiesArray, ok := proxiesRaw.([]interface{})
	if !ok {
		return nil, errors.New("'proxies' field is not an array")
	}

	// 转换成substore的Proxy结构
	var proxies []substore.Proxy
	for _, p := range proxiesArray {
		proxyMap, ok := p.(map[string]interface{})
		if !ok {
			continue
		}
		proxies = append(proxies, substore.Proxy(proxyMap))
	}

	if len(proxies) == 0 {
		return nil, errors.New("no valid proxies found in YAML")
	}

	factory := substore.GetDefaultFactory()

	// 根据客户端类型获取Producer
	producer, err := factory.GetProducer(clientType)
	if err != nil {
		return nil, fmt.Errorf("unsupported client type '%s': %w", clientType, err)
	}

	// 调用Produce方法生成转换后的节点, 这里不处理原substore的internal模式与额外菜蔬
	result, err := producer.Produce(proxies, "", nil)
	if err != nil {
		return nil, fmt.Errorf("failed to produce subscription: %w", err)
	}
	switch v := result.(type) {
	case string:
		return []byte(v), nil
	case []byte:
		return v, nil
	default:
		return nil, fmt.Errorf("unexpected result type from producer: %T, expected string or []byte", result)
	}
}
