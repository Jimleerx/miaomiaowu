package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"miaomiaowu/internal/substore"
)

// ConvertRequest 转换请求
type ConvertRequest struct {
	Proxies []map[string]interface{} `json:"proxies"` // 节点列表
	Target  string                   `json:"target"`  // 目标格式: clash, surge, uri, etc.
	Options *ConvertOptions          `json:"options"` // 转换选项
}

// ConvertOptions 转换选项
type ConvertOptions struct {
	IncludeUnsupported     bool `json:"include_unsupported"`      // 是否包含不支持的节点
	ClientCompatibility    bool `json:"client_compatibility"`     // 客户端兼容模式
	UseNewTemplateSystem   bool `json:"use_new_template_system"`  // 使用新模板系统
	EnableProxyProvider    bool `json:"enable_proxy_provider"`    // 启用 proxy-provider
}

// ConvertResponse 转换响应
type ConvertResponse struct {
	Content string `json:"content"` // 转换后的内容
	Count   int    `json:"count"`   // 节点数量
}

// NewConvertHandler 创建配置转换处理器
func NewConvertHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, errors.New("only POST method is allowed"))
			return
		}

		var req ConvertRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		// 验证参数
		if len(req.Proxies) == 0 {
			writeError(w, http.StatusBadRequest, errors.New("proxies is required"))
			return
		}

		target := strings.TrimSpace(strings.ToLower(req.Target))
		if target == "" {
			writeError(w, http.StatusBadRequest, errors.New("target format is required"))
			return
		}

		// 设置默认选项
		if req.Options == nil {
			req.Options = &ConvertOptions{}
		}

		// 转换为 substore.Proxy 格式
		proxies := make([]substore.Proxy, 0, len(req.Proxies))
		for _, p := range req.Proxies {
			proxies = append(proxies, substore.Proxy(p))
		}

		// 创建转换选项
		produceOpts := &substore.ProduceOptions{
			IncludeUnsupportedProxy:   req.Options.IncludeUnsupported,
			ClientCompatibilityMode: req.Options.ClientCompatibility,
		}

		// 获取 producer 工厂
		factory := substore.GetDefaultFactory()

		// 转换配置
		result, err := factory.ConvertProxies(proxies, target, produceOpts)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		// 提取内容
		var content string
		switch v := result.(type) {
		case string:
			content = v
		case []byte:
			content = string(v)
		default:
			// 尝试 JSON 序列化
			jsonBytes, err := json.Marshal(v)
			if err != nil {
				writeError(w, http.StatusInternalServerError, errors.New("failed to serialize result"))
				return
			}
			content = string(jsonBytes)
		}

		// 返回结果
		resp := ConvertResponse{
			Content: content,
			Count:   len(proxies),
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(resp)
	})
}
