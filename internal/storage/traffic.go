package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

const (
	pragmaJournalMode = "PRAGMA journal_mode=WAL;"
)

const (
	RoleAdmin = "admin"
	RoleUser  = "user"
)

const (
	SubscriptionButtonQR     = "qr"
	SubscriptionButtonCopy   = "copy"
	SubscriptionButtonImport = "import"
)

// TrafficRecord represents an aggregated traffic snapshot for a specific date.
type TrafficRecord struct {
	Date           time.Time
	TotalLimit     int64
	TotalUsed      int64
	TotalRemaining int64
}

// TrafficRepository manages persistence of traffic usage snapshots.
type TrafficRepository struct {
	db *sql.DB
}

// SubscriptionLink represents a configurable subscription entry exposed to clients.
type SubscriptionLink struct {
	ID           int64
	Name         string
	Type         string
	Description  string
	RuleFilename string
	Buttons      []string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

func normalizeSubscriptionButtons(input []string) []string {
	if len(input) == 0 {
		return append([]string(nil), defaultSubscriptionButtons...)
	}

	seen := make(map[string]struct{}, len(input))
	for _, button := range input {
		key := strings.ToLower(strings.TrimSpace(button))
		if _, ok := allowedSubscriptionButtons[key]; ok {
			seen[key] = struct{}{}
		}
	}

	if len(seen) == 0 {
		return append([]string(nil), defaultSubscriptionButtons...)
	}

	order := []string{SubscriptionButtonQR, SubscriptionButtonCopy, SubscriptionButtonImport}
	normalized := make([]string, 0, len(seen))
	for _, button := range order {
		if _, ok := seen[button]; ok {
			normalized = append(normalized, button)
		}
	}

	return normalized
}

func encodeSubscriptionButtons(input []string) (string, error) {
	normalized := normalizeSubscriptionButtons(input)
	data, err := json.Marshal(normalized)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func decodeSubscriptionButtons(encoded string) []string {
	if strings.TrimSpace(encoded) == "" {
		return append([]string(nil), defaultSubscriptionButtons...)
	}

	var raw []string
	if err := json.Unmarshal([]byte(encoded), &raw); err != nil {
		return append([]string(nil), defaultSubscriptionButtons...)
	}

	return normalizeSubscriptionButtons(raw)
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanSubscriptionLink(scanner rowScanner) (SubscriptionLink, error) {
	var (
		link    SubscriptionLink
		buttons string
	)

	if err := scanner.Scan(&link.ID, &link.Name, &link.Type, &link.Description, &link.RuleFilename, &buttons, &link.CreatedAt, &link.UpdatedAt); err != nil {
		return SubscriptionLink{}, err
	}

	link.Buttons = decodeSubscriptionButtons(buttons)

	return link, nil
}

func scanProbeConfig(scanner rowScanner) (ProbeConfig, error) {
	var cfg ProbeConfig
	if err := scanner.Scan(&cfg.ID, &cfg.ProbeType, &cfg.Address, &cfg.CreatedAt, &cfg.UpdatedAt); err != nil {
		return ProbeConfig{}, err
	}
	return cfg, nil
}

func scanProbeServer(scanner rowScanner) (ProbeServer, error) {
	var srv ProbeServer
	if err := scanner.Scan(&srv.ID, &srv.ConfigID, &srv.ServerID, &srv.Name, &srv.TrafficMethod, &srv.MonthlyTrafficBytes, &srv.Position, &srv.CreatedAt, &srv.UpdatedAt); err != nil {
		return ProbeServer{}, err
	}
	return srv, nil
}

var (
	ErrTokenNotFound                = errors.New("token not found")
	ErrUserNotFound                 = errors.New("user not found")
	ErrUserExists                   = errors.New("user already exists")
	ErrRuleVersionNotFound          = errors.New("rule version not found")
	ErrSubscriptionNotFound         = errors.New("subscription link not found")
	ErrSubscriptionExists           = errors.New("subscription link already exists")
	ErrProbeConfigNotFound          = errors.New("probe configuration not found")
	ErrNodeNotFound                 = errors.New("node not found")
	ErrSubscribeFileNotFound        = errors.New("subscribe file not found")
	ErrSubscribeFileExists          = errors.New("subscribe file already exists")
	ErrUserSettingsNotFound         = errors.New("user settings not found")
	ErrExternalSubscriptionNotFound = errors.New("external subscription not found")
	ErrExternalSubscriptionExists   = errors.New("external subscription already exists")
)

var (
	allowedSubscriptionButtons = map[string]struct{}{
		SubscriptionButtonQR:     {},
		SubscriptionButtonCopy:   {},
		SubscriptionButtonImport: {},
	}
	defaultSubscriptionButtons = []string{
		SubscriptionButtonQR,
		SubscriptionButtonCopy,
		SubscriptionButtonImport,
	}
)

const (
	ProbeTypeNezha   = "nezha"
	ProbeTypeNezhaV0 = "nezhav0"
	ProbeTypeDstatus = "dstatus"
	ProbeTypeKomari  = "komari"

	TrafficMethodUp   = "up"
	TrafficMethodDown = "down"
	TrafficMethodBoth = "both"
)

type ProbeConfig struct {
	ID        int64
	ProbeType string
	Address   string
	Servers   []ProbeServer
	CreatedAt time.Time
	UpdatedAt time.Time
}

type ProbeServer struct {
	ID                  int64
	ConfigID            int64
	ServerID            string
	Name                string
	TrafficMethod       string
	MonthlyTrafficBytes int64
	Position            int
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

// Node represents a proxy node stored in the database.
type Node struct {
	ID             int64
	Username       string
	RawURL         string
	NodeName       string
	Protocol       string
	ParsedConfig   string
	ClashConfig    string
	Enabled        bool
	Tag            string
	OriginalServer string
	ProbeServer    string // Probe server name for binding
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// SubscribeFile represents a subscription file configuration.
type SubscribeFile struct {
	ID          int64
	Name        string
	Description string
	URL         string
	Type        string
	Filename    string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// UserSettings represents user-specific configuration.
type UserSettings struct {
	Username            string
	ForceSyncExternal   bool
	MatchRule           string // "node_name" or "server_port"
	CacheExpireMinutes  int    // Cache expiration time in minutes
	SyncTraffic         bool   // Sync traffic info from external subscriptions
	EnableProbeBinding  bool   // Enable probe server binding for nodes
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

// ExternalSubscription represents an external subscription URL imported by user.
type ExternalSubscription struct {
	ID          int64
	Username    string
	Name        string
	URL         string
	NodeCount   int
	LastSyncAt  *time.Time
	Upload      int64  // 已上传流量（字节）
	Download    int64  // 已下载流量（字节）
	Total       int64  // 总流量（字节）
	Expire      *time.Time // 过期时间
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

var (
	allowedProbeTypes = map[string]struct{}{
		ProbeTypeNezha:   {},
		ProbeTypeNezhaV0: {},
		ProbeTypeDstatus: {},
		ProbeTypeKomari:  {},
	}
	allowedTrafficMethods = map[string]struct{}{
		TrafficMethodUp:   {},
		TrafficMethodDown: {},
		TrafficMethodBoth: {},
	}
)

// NewTrafficRepository initializes a new SQLite-backed repository stored at the given path or DSN.
func NewTrafficRepository(path string) (*TrafficRepository, error) {
	if path == "" {
		return nil, errors.New("traffic repository path is empty")
	}

	if path != ":memory:" && !strings.HasPrefix(path, "file:") {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return nil, fmt.Errorf("create traffic data directory: %w", err)
		}
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite db: %w", err)
	}

	db.SetMaxOpenConns(1)

	if _, err := db.Exec(pragmaJournalMode); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("enable wal: %w", err)
	}

	repo := &TrafficRepository{db: db}
	if err := repo.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}

	return repo, nil
}

// Close releases the underlying database resources.
func (r *TrafficRepository) Close() error {
	if r == nil || r.db == nil {
		return nil
	}
	return r.db.Close()
}

func (r *TrafficRepository) migrate() error {
	const trafficSchema = `
CREATE TABLE IF NOT EXISTS traffic_records (
    date TEXT PRIMARY KEY,
    total_limit INTEGER NOT NULL,
    total_used INTEGER NOT NULL,
    total_remaining INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`

	if _, err := r.db.Exec(trafficSchema); err != nil {
		return fmt.Errorf("migrate traffic_records: %w", err)
	}

	const userTokenSchema = `
CREATE TABLE IF NOT EXISTS user_tokens (
    username TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`

	if _, err := r.db.Exec(userTokenSchema); err != nil {
		return fmt.Errorf("migrate user_tokens: %w", err)
	}

	const sessionSchema = `
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
`

	if _, err := r.db.Exec(sessionSchema); err != nil {
		return fmt.Errorf("migrate sessions: %w", err)
	}

	const userSchema = `
CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    email TEXT,
    nickname TEXT,
    avatar_url TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`

	if _, err := r.db.Exec(userSchema); err != nil {
		return fmt.Errorf("migrate users: %w", err)
	}

	if err := r.ensureUserColumn("email", "TEXT"); err != nil {
		return err
	}

	if err := r.ensureUserColumn("nickname", "TEXT"); err != nil {
		return err
	}

	if err := r.ensureUserColumn("avatar_url", "TEXT"); err != nil {
		return err
	}

	if err := r.syncNicknames(); err != nil {
		return err
	}

	if err := r.ensureUserColumn("role", "TEXT NOT NULL DEFAULT 'user'"); err != nil {
		return err
	}

	if err := r.ensureUserColumn("is_active", "INTEGER NOT NULL DEFAULT 1"); err != nil {
		return err
	}

	const historySchema = `
CREATE TABLE IF NOT EXISTS rule_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    version INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(filename, version)
);
`

	if _, err := r.db.Exec(historySchema); err != nil {
		return fmt.Errorf("migrate rule_versions: %w", err)
	}

	const subscriptionSchema = `
CREATE TABLE IF NOT EXISTS subscription_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT '',
    description TEXT,
    rule_filename TEXT NOT NULL,
    buttons TEXT NOT NULL DEFAULT '[]',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name)
);
`

	if _, err := r.db.Exec(subscriptionSchema); err != nil {
		return fmt.Errorf("migrate subscription_links: %w", err)
	}

	// Migrate existing probe_configs table to add nezhav0 support BEFORE creating with IF NOT EXISTS
	if err := r.migrateProbeConfigsForNezhaV0(); err != nil {
		return fmt.Errorf("migrate probe_configs for nezhav0: %w", err)
	}

	const probeConfigSchema = `
CREATE TABLE IF NOT EXISTS probe_configs (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    probe_type TEXT NOT NULL CHECK (probe_type IN ('nezha','nezhav0','dstatus','komari')),
    address TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`

	if _, err := r.db.Exec(probeConfigSchema); err != nil {
		return fmt.Errorf("migrate probe_configs: %w", err)
	}

	const probeServersSchema = `
CREATE TABLE IF NOT EXISTS probe_servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    config_id INTEGER NOT NULL,
    server_id TEXT NOT NULL,
    name TEXT NOT NULL,
    traffic_method TEXT NOT NULL CHECK (traffic_method IN ('up','down','both')),
    monthly_traffic_bytes INTEGER NOT NULL DEFAULT 0 CHECK (monthly_traffic_bytes >= 0),
    position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(config_id) REFERENCES probe_configs(id) ON DELETE CASCADE,
    UNIQUE(config_id, server_id)
);
`

	if _, err := r.db.Exec(probeServersSchema); err != nil {
		return fmt.Errorf("migrate probe_servers: %w", err)
	}

	if err := r.ensureDefaultProbeConfig(); err != nil {
		return err
	}

	const nodesSchema = `
CREATE TABLE IF NOT EXISTS nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    raw_url TEXT NOT NULL,
    node_name TEXT NOT NULL,
    protocol TEXT NOT NULL,
    parsed_config TEXT NOT NULL,
    clash_config TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    tag TEXT NOT NULL DEFAULT '手动输入',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_nodes_username ON nodes(username);
CREATE INDEX IF NOT EXISTS idx_nodes_protocol ON nodes(protocol);
CREATE INDEX IF NOT EXISTS idx_nodes_enabled ON nodes(enabled);
`

	if _, err := r.db.Exec(nodesSchema); err != nil {
		return fmt.Errorf("migrate nodes: %w", err)
	}

	// Add tag column to existing nodes table if it doesn't exist
	if err := r.ensureNodeColumn("tag", "TEXT NOT NULL DEFAULT '手动输入'"); err != nil {
		return err
	}

	// Add original_server column to existing nodes table if it doesn't exist
	if err := r.ensureNodeColumn("original_server", "TEXT"); err != nil {
		return err
	}

	// Add probe_server column to existing nodes table if it doesn't exist
	if err := r.ensureNodeColumn("probe_server", "TEXT"); err != nil {
		return err
	}

	// Create tag index after ensuring column exists
	if _, err := r.db.Exec(`CREATE INDEX IF NOT EXISTS idx_nodes_tag ON nodes(tag);`); err != nil {
		return fmt.Errorf("create tag index: %w", err)
	}

	const subscribeFilesSchema = `
CREATE TABLE IF NOT EXISTS subscribe_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    url TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('create','import','upload')),
    filename TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name)
);
CREATE INDEX IF NOT EXISTS idx_subscribe_files_type ON subscribe_files(type);
`

	if _, err := r.db.Exec(subscribeFilesSchema); err != nil {
		return fmt.Errorf("migrate subscribe_files: %w", err)
	}

	// 用户-订阅关联表（多对多关系）
	// 关联到 subscribe_files 表
	const userSubscriptionsSchema = `
CREATE TABLE IF NOT EXISTS user_subscriptions (
    username TEXT NOT NULL,
    subscription_id INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (username, subscription_id),
    FOREIGN KEY(username) REFERENCES users(username) ON DELETE CASCADE,
    FOREIGN KEY(subscription_id) REFERENCES subscribe_files(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_username ON user_subscriptions(username);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_subscription_id ON user_subscriptions(subscription_id);
`

	if _, err := r.db.Exec(userSubscriptionsSchema); err != nil {
		return fmt.Errorf("migrate user_subscriptions: %w", err)
	}

	const userSettingsSchema = `
CREATE TABLE IF NOT EXISTS user_settings (
    username TEXT PRIMARY KEY,
    force_sync_external INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(username) REFERENCES users(username) ON DELETE CASCADE
);
`

	if _, err := r.db.Exec(userSettingsSchema); err != nil {
		return fmt.Errorf("migrate user_settings: %w", err)
	}

	// Add match_rule column to user_settings table if it doesn't exist
	if err := r.ensureUserSettingsColumn("match_rule", "TEXT NOT NULL DEFAULT 'node_name'"); err != nil {
		return err
	}

	// Add cache_expire_minutes column to user_settings table if it doesn't exist
	if err := r.ensureUserSettingsColumn("cache_expire_minutes", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}

	// Add sync_traffic column to user_settings table if it doesn't exist
	if err := r.ensureUserSettingsColumn("sync_traffic", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}

	// Add enable_probe_binding column to user_settings table if it doesn't exist
	if err := r.ensureUserSettingsColumn("enable_probe_binding", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}

	const externalSubscriptionsSchema = `
CREATE TABLE IF NOT EXISTS external_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    node_count INTEGER NOT NULL DEFAULT 0,
    last_sync_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(username) REFERENCES users(username) ON DELETE CASCADE,
    UNIQUE(username, url)
);
CREATE INDEX IF NOT EXISTS idx_external_subscriptions_username ON external_subscriptions(username);
CREATE INDEX IF NOT EXISTS idx_external_subscriptions_url ON external_subscriptions(url);
`

	if _, err := r.db.Exec(externalSubscriptionsSchema); err != nil {
		return fmt.Errorf("migrate external_subscriptions: %w", err)
	}

	// Add traffic fields to external_subscriptions table
	if err := r.ensureExternalSubscriptionColumn("upload", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := r.ensureExternalSubscriptionColumn("download", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := r.ensureExternalSubscriptionColumn("total", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := r.ensureExternalSubscriptionColumn("expire", "TIMESTAMP"); err != nil {
		return err
	}

	return nil
}

// ListSubscriptionLinks returns all configured subscription links ordered by creation.
func (r *TrafficRepository) ListSubscriptionLinks(ctx context.Context) ([]SubscriptionLink, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	rows, err := r.db.QueryContext(ctx, `SELECT id, name, type, COALESCE(description, ''), rule_filename, buttons, created_at, updated_at FROM subscription_links ORDER BY id ASC`)
	if err != nil {
		return nil, fmt.Errorf("list subscription links: %w", err)
	}
	defer rows.Close()

	var links []SubscriptionLink
	for rows.Next() {
		link, err := scanSubscriptionLink(rows)
		if err != nil {
			return nil, fmt.Errorf("scan subscription link: %w", err)
		}
		links = append(links, link)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate subscription links: %w", err)
	}

	return links, nil
}

// GetSubscriptionByName retrieves a subscription link by its unique name.
func (r *TrafficRepository) GetSubscriptionByName(ctx context.Context, name string) (SubscriptionLink, error) {
	var link SubscriptionLink
	if r == nil || r.db == nil {
		return link, errors.New("traffic repository not initialized")
	}

	name = strings.TrimSpace(name)
	if name == "" {
		return link, errors.New("subscription name is required")
	}

	row := r.db.QueryRowContext(ctx, `SELECT id, name, type, COALESCE(description, ''), rule_filename, buttons, created_at, updated_at FROM subscription_links WHERE name = ? LIMIT 1`, name)
	result, err := scanSubscriptionLink(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return link, ErrSubscriptionNotFound
		}
		return link, fmt.Errorf("get subscription by name: %w", err)
	}

	return result, nil
}

// GetSubscriptionByID retrieves a subscription link by its identifier.
func (r *TrafficRepository) GetSubscriptionByID(ctx context.Context, id int64) (SubscriptionLink, error) {
	var link SubscriptionLink
	if r == nil || r.db == nil {
		return link, errors.New("traffic repository not initialized")
	}

	if id <= 0 {
		return link, errors.New("subscription id is required")
	}

	row := r.db.QueryRowContext(ctx, `SELECT id, name, type, COALESCE(description, ''), rule_filename, buttons, created_at, updated_at FROM subscription_links WHERE id = ? LIMIT 1`, id)
	result, err := scanSubscriptionLink(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return link, ErrSubscriptionNotFound
		}
		return link, fmt.Errorf("get subscription by id: %w", err)
	}

	return result, nil
}

// GetFirstSubscriptionLink returns the earliest created subscription link.
func (r *TrafficRepository) GetFirstSubscriptionLink(ctx context.Context) (SubscriptionLink, error) {
	var link SubscriptionLink
	if r == nil || r.db == nil {
		return link, errors.New("traffic repository not initialized")
	}

	row := r.db.QueryRowContext(ctx, `SELECT id, name, type, COALESCE(description, ''), rule_filename, buttons, created_at, updated_at FROM subscription_links ORDER BY id ASC LIMIT 1`)
	result, err := scanSubscriptionLink(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return link, ErrSubscriptionNotFound
		}
		return link, fmt.Errorf("get first subscription: %w", err)
	}

	return result, nil
}

// CreateSubscriptionLink inserts a new subscription link definition.
func (r *TrafficRepository) CreateSubscriptionLink(ctx context.Context, link SubscriptionLink) (SubscriptionLink, error) {
	if r == nil || r.db == nil {
		return SubscriptionLink{}, errors.New("traffic repository not initialized")
	}

	link.Name = strings.TrimSpace(link.Name)
	link.Type = strings.TrimSpace(link.Type)
	link.Description = strings.TrimSpace(link.Description)
	link.RuleFilename = strings.TrimSpace(link.RuleFilename)

	if link.Name == "" {
		return SubscriptionLink{}, errors.New("subscription name is required")
	}
	if link.Type == "" {
		link.Type = link.Name
	}
	if link.RuleFilename == "" {
		return SubscriptionLink{}, errors.New("rule filename is required")
	}

	encodedButtons, err := encodeSubscriptionButtons(link.Buttons)
	if err != nil {
		return SubscriptionLink{}, fmt.Errorf("encode subscription buttons: %w", err)
	}

	res, err := r.db.ExecContext(ctx, `INSERT INTO subscription_links (name, type, description, rule_filename, buttons) VALUES (?, ?, ?, ?, ?)`, link.Name, link.Type, link.Description, link.RuleFilename, encodedButtons)
	if err != nil {
		lowered := strings.ToLower(err.Error())
		if strings.Contains(lowered, "unique") {
			return SubscriptionLink{}, ErrSubscriptionExists
		}
		return SubscriptionLink{}, fmt.Errorf("create subscription link: %w", err)
	}

	id, err := res.LastInsertId()
	if err != nil {
		return SubscriptionLink{}, fmt.Errorf("fetch subscription id: %w", err)
	}

	return r.GetSubscriptionByID(ctx, id)
}

// UpdateSubscriptionLink updates an existing subscription link.
func (r *TrafficRepository) UpdateSubscriptionLink(ctx context.Context, link SubscriptionLink) (SubscriptionLink, error) {
	if r == nil || r.db == nil {
		return SubscriptionLink{}, errors.New("traffic repository not initialized")
	}

	if link.ID <= 0 {
		return SubscriptionLink{}, errors.New("subscription id is required")
	}

	link.Name = strings.TrimSpace(link.Name)
	link.Type = strings.TrimSpace(link.Type)
	link.Description = strings.TrimSpace(link.Description)
	link.RuleFilename = strings.TrimSpace(link.RuleFilename)

	if link.Name == "" {
		return SubscriptionLink{}, errors.New("subscription name is required")
	}
	if link.Type == "" {
		link.Type = link.Name
	}
	if link.RuleFilename == "" {
		return SubscriptionLink{}, errors.New("rule filename is required")
	}

	encodedButtons, err := encodeSubscriptionButtons(link.Buttons)
	if err != nil {
		return SubscriptionLink{}, fmt.Errorf("encode subscription buttons: %w", err)
	}

	res, err := r.db.ExecContext(ctx, `UPDATE subscription_links SET name = ?, type = ?, description = ?, rule_filename = ?, buttons = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, link.Name, link.Type, link.Description, link.RuleFilename, encodedButtons, link.ID)
	if err != nil {
		lowered := strings.ToLower(err.Error())
		if strings.Contains(lowered, "unique") {
			return SubscriptionLink{}, ErrSubscriptionExists
		}
		return SubscriptionLink{}, fmt.Errorf("update subscription link: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return SubscriptionLink{}, fmt.Errorf("subscription update rows affected: %w", err)
	}
	if affected == 0 {
		return SubscriptionLink{}, ErrSubscriptionNotFound
	}

	return r.GetSubscriptionByID(ctx, link.ID)
}

// DeleteSubscriptionLink removes a subscription link definition.
func (r *TrafficRepository) DeleteSubscriptionLink(ctx context.Context, id int64) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}
	if id <= 0 {
		return errors.New("subscription id is required")
	}

	res, err := r.db.ExecContext(ctx, `DELETE FROM subscription_links WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete subscription link: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("subscription delete rows affected: %w", err)
	}
	if affected == 0 {
		return ErrSubscriptionNotFound
	}

	return nil
}

// CountSubscriptionsByFilename returns how many subscriptions reference the given rule filename.
func (r *TrafficRepository) CountSubscriptionsByFilename(ctx context.Context, filename string) (int64, error) {
	if r == nil || r.db == nil {
		return 0, errors.New("traffic repository not initialized")
	}

	filename = strings.TrimSpace(filename)
	if filename == "" {
		return 0, errors.New("rule filename is required")
	}

	var count int64
	if err := r.db.QueryRowContext(ctx, `SELECT COUNT(1) FROM subscription_links WHERE rule_filename = ?`, filename).Scan(&count); err != nil {
		return 0, fmt.Errorf("count subscription by filename: %w", err)
	}

	return count, nil
}

// GetProbeConfig returns the current probe configuration with associated servers.
func (r *TrafficRepository) GetProbeConfig(ctx context.Context) (ProbeConfig, error) {
	var cfg ProbeConfig
	if r == nil || r.db == nil {
		return cfg, errors.New("traffic repository not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	row := r.db.QueryRowContext(ctx, `SELECT id, probe_type, address, created_at, updated_at FROM probe_configs WHERE id = 1 LIMIT 1`)
	result, err := scanProbeConfig(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return cfg, ErrProbeConfigNotFound
		}
		return cfg, fmt.Errorf("get probe config: %w", err)
	}

	rows, err := r.db.QueryContext(ctx, `SELECT id, config_id, server_id, name, traffic_method, monthly_traffic_bytes, position, created_at, updated_at FROM probe_servers WHERE config_id = ? ORDER BY position ASC, id ASC`, result.ID)
	if err != nil {
		return cfg, fmt.Errorf("list probe servers: %w", err)
	}
	defer rows.Close()

	var servers []ProbeServer
	for rows.Next() {
		server, err := scanProbeServer(rows)
		if err != nil {
			return cfg, fmt.Errorf("scan probe server: %w", err)
		}
		servers = append(servers, server)
	}

	if err := rows.Err(); err != nil {
		return cfg, fmt.Errorf("iterate probe servers: %w", err)
	}

	result.Servers = servers

	return result, nil
}

// UpsertProbeConfig updates the singleton probe configuration and replaces its server list.
func (r *TrafficRepository) UpsertProbeConfig(ctx context.Context, cfg ProbeConfig) (ProbeConfig, error) {
	if r == nil || r.db == nil {
		return ProbeConfig{}, errors.New("traffic repository not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	type sanitizedServer struct {
		ServerID            string
		Name                string
		TrafficMethod       string
		MonthlyTrafficBytes int64
	}

	cfg.ProbeType = strings.ToLower(strings.TrimSpace(cfg.ProbeType))
	if _, ok := allowedProbeTypes[cfg.ProbeType]; !ok {
		return ProbeConfig{}, errors.New("unsupported probe type")
	}

	cfg.Address = strings.TrimSpace(cfg.Address)
	if cfg.Address == "" {
		return ProbeConfig{}, errors.New("probe address is required")
	}

	if len(cfg.Servers) == 0 {
		return ProbeConfig{}, errors.New("at least one server is required")
	}

	sanitized := make([]sanitizedServer, 0, len(cfg.Servers))
	for idx, srv := range cfg.Servers {
		serverID := strings.TrimSpace(srv.ServerID)
		if serverID == "" {
			return ProbeConfig{}, fmt.Errorf("server %d: server id is required", idx+1)
		}

		name := strings.TrimSpace(srv.Name)
		if name == "" {
			return ProbeConfig{}, fmt.Errorf("server %d: server name is required", idx+1)
		}

		method := strings.ToLower(strings.TrimSpace(srv.TrafficMethod))
		if _, ok := allowedTrafficMethods[method]; !ok {
			return ProbeConfig{}, fmt.Errorf("server %d: unsupported traffic method", idx+1)
		}

		if srv.MonthlyTrafficBytes < 0 {
			return ProbeConfig{}, fmt.Errorf("server %d: monthly traffic cannot be negative", idx+1)
		}

		sanitized = append(sanitized, sanitizedServer{
			ServerID:            serverID,
			Name:                name,
			TrafficMethod:       method,
			MonthlyTrafficBytes: srv.MonthlyTrafficBytes,
		})
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return ProbeConfig{}, fmt.Errorf("begin probe config tx: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `INSERT INTO probe_configs (id, probe_type, address) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET probe_type = excluded.probe_type, address = excluded.address, updated_at = CURRENT_TIMESTAMP`, cfg.ProbeType, cfg.Address); err != nil {
		return ProbeConfig{}, fmt.Errorf("upsert probe config: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM probe_servers WHERE config_id = 1`); err != nil {
		return ProbeConfig{}, fmt.Errorf("clear probe servers: %w", err)
	}

	stmt, err := tx.PrepareContext(ctx, `INSERT INTO probe_servers (config_id, server_id, name, traffic_method, monthly_traffic_bytes, position) VALUES (1, ?, ?, ?, ?, ?)`)
	if err != nil {
		return ProbeConfig{}, fmt.Errorf("prepare insert probe server: %w", err)
	}
	defer stmt.Close()

	for idx, srv := range sanitized {
		if _, err := stmt.ExecContext(ctx, srv.ServerID, srv.Name, srv.TrafficMethod, srv.MonthlyTrafficBytes, idx); err != nil {
			return ProbeConfig{}, fmt.Errorf("insert probe server %d: %w", idx+1, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return ProbeConfig{}, fmt.Errorf("commit probe config: %w", err)
	}

	return r.GetProbeConfig(ctx)
}

func (r *TrafficRepository) ensureDefaultProbeConfig() error {
	// No longer creating default probe configuration
	// Users must configure probe settings via the web interface
	return nil
}

func (r *TrafficRepository) migrateProbeConfigsForNezhaV0() error {
	// Check if table exists first
	rows, err := r.db.Query(`SELECT sql FROM sqlite_master WHERE type='table' AND name='probe_configs'`)
	if err != nil {
		return fmt.Errorf("query schema: %w", err)
	}
	defer rows.Close()

	var schemaSql string
	if rows.Next() {
		if err := rows.Scan(&schemaSql); err != nil {
			return fmt.Errorf("scan schema: %w", err)
		}
	} else {
		// Table doesn't exist yet, no migration needed
		return nil
	}
	rows.Close()

	// If schema already contains nezhav0, no migration needed
	if strings.Contains(schemaSql, "nezhav0") {
		return nil
	}

	// If old schema doesn't contain probe_type check, also skip (brand new table will be created correctly)
	if !strings.Contains(schemaSql, "probe_type") {
		return nil
	}

	// Need to migrate: recreate table with new CHECK constraint
	tx, err := r.db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Create new table with updated schema
	_, err = tx.Exec(`
CREATE TABLE probe_configs_new (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    probe_type TEXT NOT NULL CHECK (probe_type IN ('nezha','nezhav0','dstatus','komari')),
    address TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
)`)
	if err != nil {
		return fmt.Errorf("create new table: %w", err)
	}

	// Copy data from old table
	_, err = tx.Exec(`INSERT INTO probe_configs_new SELECT * FROM probe_configs`)
	if err != nil {
		return fmt.Errorf("copy data: %w", err)
	}

	// Drop old table
	_, err = tx.Exec(`DROP TABLE probe_configs`)
	if err != nil {
		return fmt.Errorf("drop old table: %w", err)
	}

	// Rename new table
	_, err = tx.Exec(`ALTER TABLE probe_configs_new RENAME TO probe_configs`)
	if err != nil {
		return fmt.Errorf("rename table: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}

	return nil
}

func (r *TrafficRepository) ensureUserColumn(name, definition string) error {
	rows, err := r.db.Query(`PRAGMA table_info(users)`)
	if err != nil {
		return fmt.Errorf("users table info: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			cid        int
			colName    string
			colType    string
			notNull    int
			defaultVal sql.NullString
			pk         int
		)
		if err := rows.Scan(&cid, &colName, &colType, &notNull, &defaultVal, &pk); err != nil {
			return fmt.Errorf("scan table info: %w", err)
		}
		if strings.EqualFold(colName, name) {
			return nil
		}
	}

	alter := fmt.Sprintf("ALTER TABLE users ADD COLUMN %s %s", name, definition)
	if _, err := r.db.Exec(alter); err != nil {
		return fmt.Errorf("add column %s: %w", name, err)
	}

	return nil
}

func (r *TrafficRepository) ensureNodeColumn(name, definition string) error {
	rows, err := r.db.Query(`PRAGMA table_info(nodes)`)
	if err != nil {
		return fmt.Errorf("nodes table info: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			cid        int
			colName    string
			colType    string
			notNull    int
			defaultVal sql.NullString
			pk         int
		)
		if err := rows.Scan(&cid, &colName, &colType, &notNull, &defaultVal, &pk); err != nil {
			return fmt.Errorf("scan table info: %w", err)
		}
		if strings.EqualFold(colName, name) {
			return nil
		}
	}

	alter := fmt.Sprintf("ALTER TABLE nodes ADD COLUMN %s %s", name, definition)
	if _, err := r.db.Exec(alter); err != nil {
		return fmt.Errorf("add column %s: %w", name, err)
	}

	return nil
}

func (r *TrafficRepository) ensureUserSettingsColumn(name, definition string) error {
	rows, err := r.db.Query(`PRAGMA table_info(user_settings)`)
	if err != nil {
		return fmt.Errorf("user_settings table info: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			cid        int
			colName    string
			colType    string
			notNull    int
			defaultVal sql.NullString
			pk         int
		)
		if err := rows.Scan(&cid, &colName, &colType, &notNull, &defaultVal, &pk); err != nil {
			return fmt.Errorf("scan table info: %w", err)
		}
		if strings.EqualFold(colName, name) {
			return nil
		}
	}

	alter := fmt.Sprintf("ALTER TABLE user_settings ADD COLUMN %s %s", name, definition)
	if _, err := r.db.Exec(alter); err != nil {
		return fmt.Errorf("add column %s: %w", name, err)
	}

	return nil
}

func (r *TrafficRepository) ensureExternalSubscriptionColumn(name, definition string) error {
	rows, err := r.db.Query(`PRAGMA table_info(external_subscriptions)`)
	if err != nil {
		return fmt.Errorf("external_subscriptions table info: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			cid        int
			colName    string
			colType    string
			notNull    int
			defaultVal sql.NullString
			pk         int
		)
		if err := rows.Scan(&cid, &colName, &colType, &notNull, &defaultVal, &pk); err != nil {
			return fmt.Errorf("scan table info: %w", err)
		}
		if strings.EqualFold(colName, name) {
			return nil
		}
	}

	alter := fmt.Sprintf("ALTER TABLE external_subscriptions ADD COLUMN %s %s", name, definition)
	if _, err := r.db.Exec(alter); err != nil {
		return fmt.Errorf("add column %s: %w", name, err)
	}

	return nil
}

func (r *TrafficRepository) syncNicknames() error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if _, err := r.db.Exec(`UPDATE users SET nickname = username WHERE nickname IS NULL OR nickname = ''`); err != nil {
		return fmt.Errorf("sync nicknames: %w", err)
	}

	return nil
}

// RecordDaily upserts the aggregated traffic usage for the provided date.
func (r *TrafficRepository) RecordDaily(ctx context.Context, date time.Time, totalLimit, totalUsed, totalRemaining int64) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	normalized := date.UTC().Format("2006-01-02")

	const stmt = `
INSERT INTO traffic_records (date, total_limit, total_used, total_remaining)
VALUES (?, ?, ?, ?)
ON CONFLICT(date) DO UPDATE SET
    total_limit = excluded.total_limit,
    total_used = excluded.total_used,
    total_remaining = excluded.total_remaining,
    created_at = CURRENT_TIMESTAMP;
`

	if _, err := r.db.ExecContext(ctx, stmt, normalized, totalLimit, totalUsed, totalRemaining); err != nil {
		return fmt.Errorf("upsert traffic record: %w", err)
	}

	return nil
}

// ListRecent returns up to the requested number of most recent traffic records, ordered from newest to oldest.
func (r *TrafficRepository) ListRecent(ctx context.Context, limit int) ([]TrafficRecord, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	if limit <= 0 {
		limit = 30
	}

	rows, err := r.db.QueryContext(ctx, `
SELECT date, total_limit, total_used, total_remaining
FROM traffic_records
ORDER BY date DESC
LIMIT ?;
`, limit)
	if err != nil {
		return nil, fmt.Errorf("list recent traffic records: %w", err)
	}
	defer rows.Close()

	var records []TrafficRecord
	for rows.Next() {
		var (
			dateStr        string
			totalLimit     int64
			totalUsed      int64
			totalRemaining int64
		)

		if err := rows.Scan(&dateStr, &totalLimit, &totalUsed, &totalRemaining); err != nil {
			return nil, fmt.Errorf("scan traffic record: %w", err)
		}

		parsed, err := time.Parse("2006-01-02", dateStr)
		if err != nil {
			return nil, fmt.Errorf("parse traffic record date: %w", err)
		}

		records = append(records, TrafficRecord{
			Date:           parsed,
			TotalLimit:     totalLimit,
			TotalUsed:      totalUsed,
			TotalRemaining: totalRemaining,
		})
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate traffic records: %w", err)
	}

	return records, nil
}

// GetOrCreateUserToken returns the existing token for the given username or creates a new one.
func (r *TrafficRepository) GetOrCreateUserToken(ctx context.Context, username string) (string, error) {
	if r == nil || r.db == nil {
		return "", errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return "", errors.New("username is required")
	}

	const selectStmt = `SELECT token FROM user_tokens WHERE username = ? LIMIT 1;`
	var token string
	if err := r.db.QueryRowContext(ctx, selectStmt, username).Scan(&token); err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return "", fmt.Errorf("query user token: %w", err)
		}

		newToken := uuid.NewString()
		const insertStmt = `INSERT INTO user_tokens (username, token, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP);`
		if _, err := r.db.ExecContext(ctx, insertStmt, username, newToken); err != nil {
			return "", fmt.Errorf("insert user token: %w", err)
		}
		token = newToken
	}

	return token, nil
}

// ResetUserToken generates and stores a new token for the provided username.
func (r *TrafficRepository) ResetUserToken(ctx context.Context, username string) (string, error) {
	if r == nil || r.db == nil {
		return "", errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return "", errors.New("username is required")
	}

	newToken := uuid.NewString()
	const stmt = `
INSERT INTO user_tokens (username, token, updated_at)
VALUES (?, ?, CURRENT_TIMESTAMP)
ON CONFLICT(username) DO UPDATE SET
    token = excluded.token,
    updated_at = CURRENT_TIMESTAMP;
`

	if _, err := r.db.ExecContext(ctx, stmt, username, newToken); err != nil {
		return "", fmt.Errorf("reset user token: %w", err)
	}

	return newToken, nil
}

// ValidateUserToken returns the username associated with the provided token if it exists.
func (r *TrafficRepository) ValidateUserToken(ctx context.Context, token string) (string, error) {
	if r == nil || r.db == nil {
		return "", errors.New("traffic repository not initialized")
	}

	token = strings.TrimSpace(token)
	if token == "" {
		return "", errors.New("token is required")
	}

	const stmt = `SELECT username FROM user_tokens WHERE token = ? LIMIT 1;`
	var username string
	if err := r.db.QueryRowContext(ctx, stmt, token).Scan(&username); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrTokenNotFound
		}
		return "", fmt.Errorf("query user token by value: %w", err)
	}

	return username, nil
}

// SaveRuleVersion persists a new rule version for the provided filename and returns the new version number.
func (r *TrafficRepository) SaveRuleVersion(ctx context.Context, filename, content, createdBy string) (int64, error) {
	if r == nil || r.db == nil {
		return 0, errors.New("traffic repository not initialized")
	}

	filename = strings.TrimSpace(filename)
	createdBy = strings.TrimSpace(createdBy)
	if filename == "" {
		return 0, errors.New("filename is required")
	}
	if createdBy == "" {
		return 0, errors.New("createdBy is required")
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		} else {
			_ = tx.Commit()
		}
	}()

	var currentVersion sql.NullInt64
	if err = tx.QueryRowContext(ctx, `SELECT MAX(version) FROM rule_versions WHERE filename = ?`, filename).Scan(&currentVersion); err != nil {
		return 0, fmt.Errorf("query max version: %w", err)
	}

	newVersion := int64(1)
	if currentVersion.Valid {
		newVersion = currentVersion.Int64 + 1
	}

	if _, err = tx.ExecContext(ctx, `INSERT INTO rule_versions (filename, version, content, created_by) VALUES (?, ?, ?, ?)`, filename, newVersion, content, createdBy); err != nil {
		return 0, fmt.Errorf("insert rule version: %w", err)
	}

	return newVersion, nil
}

// ListRuleVersions returns the most recent rule versions for a file.
func (r *TrafficRepository) ListRuleVersions(ctx context.Context, filename string, limit int) ([]RuleVersion, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	filename = strings.TrimSpace(filename)
	if filename == "" {
		return nil, errors.New("filename is required")
	}

	if limit <= 0 {
		limit = 10
	}

	rows, err := r.db.QueryContext(ctx, `SELECT version, content, created_by, created_at FROM rule_versions WHERE filename = ? ORDER BY version DESC LIMIT ?`, filename, limit)
	if err != nil {
		return nil, fmt.Errorf("query rule versions: %w", err)
	}
	defer rows.Close()

	var versions []RuleVersion
	for rows.Next() {
		var rv RuleVersion
		rv.Filename = filename
		if err := rows.Scan(&rv.Version, &rv.Content, &rv.CreatedBy, &rv.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan rule version: %w", err)
		}
		versions = append(versions, rv)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate rule versions: %w", err)
	}

	return versions, nil
}

// LatestRuleVersion returns the most recent stored version for the provided rule file.
func (r *TrafficRepository) LatestRuleVersion(ctx context.Context, filename string) (RuleVersion, error) {
	versions, err := r.ListRuleVersions(ctx, filename, 1)
	if err != nil {
		return RuleVersion{}, err
	}
	if len(versions) == 0 {
		return RuleVersion{}, ErrRuleVersionNotFound
	}
	return versions[0], nil
}

// RuleVersion represents an archived version of a YAML rule file.
type RuleVersion struct {
	Filename  string
	Version   int64
	Content   string
	CreatedBy string
	CreatedAt time.Time
}

// User represents an authenticated account stored in the repository.
type User struct {
	Username     string
	PasswordHash string
	Email        string
	Nickname     string
	AvatarURL    string
	Role         string
	IsActive     bool
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// UserProfileUpdate captures editable profile fields for a user.
type UserProfileUpdate struct {
	Email     string
	Nickname  string
	AvatarURL string
}

// EnsureUser inserts or updates the provided user.
func (r *TrafficRepository) EnsureUser(ctx context.Context, username, passwordHash string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return errors.New("username is required")
	}
	if passwordHash == "" {
		return errors.New("password hash is required")
	}

	_, err := r.db.ExecContext(ctx, `INSERT INTO users (username, password_hash, nickname, role) VALUES (?, ?, ?, ?) ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash`, username, passwordHash, username, RoleUser)
	if err != nil {
		return fmt.Errorf("ensure user: %w", err)
	}

	return nil
}

// CreateUser inserts a brand new user with the provided credentials. Returns ErrUserExists if username already present.
func (r *TrafficRepository) CreateUser(ctx context.Context, username, email, nickname, passwordHash, role string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	email = strings.TrimSpace(email)
	nickname = strings.TrimSpace(nickname)
	role = strings.TrimSpace(role)

	if username == "" {
		return errors.New("username is required")
	}
	if passwordHash == "" {
		return errors.New("password hash is required")
	}
	if nickname == "" {
		nickname = username
	}
	if role == "" {
		role = RoleUser
	}
	role = strings.ToLower(role)
	if role != RoleAdmin {
		role = RoleUser
	}

	_, err := r.db.ExecContext(ctx, `INSERT INTO users (username, password_hash, email, nickname, role, is_active) VALUES (?, ?, ?, ?, ?, 1)`, username, passwordHash, email, nickname, role)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return ErrUserExists
		}
		return fmt.Errorf("create user: %w", err)
	}

	return nil
}

// GetUser retrieves a user by username.
func (r *TrafficRepository) GetUser(ctx context.Context, username string) (User, error) {
	var user User
	if r == nil || r.db == nil {
		return user, errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return user, errors.New("username is required")
	}

	row := r.db.QueryRowContext(ctx, `SELECT username, password_hash, COALESCE(email, ''), COALESCE(nickname, ''), COALESCE(avatar_url, ''), COALESCE(role, ''), is_active, created_at, updated_at FROM users WHERE username = ? LIMIT 1`, username)
	var active int
	if err := row.Scan(&user.Username, &user.PasswordHash, &user.Email, &user.Nickname, &user.AvatarURL, &user.Role, &active, &user.CreatedAt, &user.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return user, ErrUserNotFound
		}
		return user, fmt.Errorf("get user: %w", err)
	}
	if user.Nickname == "" {
		user.Nickname = user.Username
	}
	if user.Role == "" {
		user.Role = RoleUser
	}
	user.IsActive = active != 0

	return user, nil
}

// ListUsers returns up to limit users ordered by creation time.
func (r *TrafficRepository) ListUsers(ctx context.Context, limit int) ([]User, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	if limit <= 0 {
		limit = 10
	}

	rows, err := r.db.QueryContext(ctx, `SELECT username, password_hash, COALESCE(email, ''), COALESCE(nickname, ''), COALESCE(avatar_url, ''), COALESCE(role, ''), is_active, created_at, updated_at FROM users ORDER BY created_at ASC LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	defer rows.Close()

	var users []User
	for rows.Next() {
		var user User
		var active int
		if err := rows.Scan(&user.Username, &user.PasswordHash, &user.Email, &user.Nickname, &user.AvatarURL, &user.Role, &active, &user.CreatedAt, &user.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan user: %w", err)
		}
		if user.Nickname == "" {
			user.Nickname = user.Username
		}
		if user.Role == "" {
			user.Role = RoleUser
		}
		user.IsActive = active != 0
		users = append(users, user)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate users: %w", err)
	}

	return users, nil
}

// UpdateUserPassword updates the stored password hash for the specified user.
func (r *TrafficRepository) UpdateUserPassword(ctx context.Context, username, passwordHash string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return errors.New("username is required")
	}
	if passwordHash == "" {
		return errors.New("password hash is required")
	}

	res, err := r.db.ExecContext(ctx, `UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?`, passwordHash, username)
	if err != nil {
		return fmt.Errorf("update user password: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("password rows affected: %w", err)
	}
	if affected == 0 {
		return ErrUserNotFound
	}

	return nil
}

// UpdateUserRole sets the role for the specified user.
func (r *TrafficRepository) UpdateUserRole(ctx context.Context, username, role string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	role = strings.TrimSpace(role)
	if username == "" {
		return errors.New("username is required")
	}
	if role == "" {
		role = RoleUser
	}
	role = strings.ToLower(role)
	if role != RoleAdmin {
		role = RoleUser
	}

	res, err := r.db.ExecContext(ctx, `UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?`, role, username)
	if err != nil {
		return fmt.Errorf("update user role: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("role rows affected: %w", err)
	}
	if affected == 0 {
		return ErrUserNotFound
	}

	return nil
}

// UpdateUserStatus toggles the active state for a user.
func (r *TrafficRepository) UpdateUserStatus(ctx context.Context, username string, active bool) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return errors.New("username is required")
	}

	value := 0
	if active {
		value = 1
	}

	res, err := r.db.ExecContext(ctx, `UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?`, value, username)
	if err != nil {
		return fmt.Errorf("update user status: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("status rows affected: %w", err)
	}
	if affected == 0 {
		return ErrUserNotFound
	}

	return nil
}

// UpdateUserNickname updates the nickname associated with a user account.
func (r *TrafficRepository) UpdateUserNickname(ctx context.Context, username, nickname string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	nickname = strings.TrimSpace(nickname)

	if username == "" {
		return errors.New("username is required")
	}
	if nickname == "" {
		nickname = username
	}

	res, err := r.db.ExecContext(ctx, `UPDATE users SET nickname = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?`, nickname, username)
	if err != nil {
		return fmt.Errorf("update user nickname: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("nickname rows affected: %w", err)
	}
	if affected == 0 {
		return ErrUserNotFound
	}

	return nil
}

// UpdateUserProfile updates editable profile fields for the specified user.
func (r *TrafficRepository) UpdateUserProfile(ctx context.Context, username string, profile UserProfileUpdate) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return errors.New("username is required")
	}

	email := strings.TrimSpace(profile.Email)
	nickname := strings.TrimSpace(profile.Nickname)
	avatar := strings.TrimSpace(profile.AvatarURL)

	if nickname == "" {
		nickname = username
	}

	res, err := r.db.ExecContext(ctx, `UPDATE users SET email = ?, nickname = ?, avatar_url = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?`, email, nickname, avatar, username)
	if err != nil {
		return fmt.Errorf("update user profile: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("profile rows affected: %w", err)
	}
	if affected == 0 {
		return ErrUserNotFound
	}

	return nil
}

// RenameUser changes a username and updates dependent tables.
func (r *TrafficRepository) RenameUser(ctx context.Context, oldUsername, newUsername string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	oldUsername = strings.TrimSpace(oldUsername)
	newUsername = strings.TrimSpace(newUsername)
	if oldUsername == "" || newUsername == "" {
		return errors.New("usernames are required")
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("rename user begin tx: %w", err)
	}

	defer func() {
		if err != nil {
			_ = tx.Rollback()
		} else {
			_ = tx.Commit()
		}
	}()

	res, err := tx.ExecContext(ctx, `UPDATE users SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?`, newUsername, oldUsername)
	if err != nil {
		return fmt.Errorf("rename user: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("rename user rows affected: %w", err)
	}
	if affected == 0 {
		return ErrUserNotFound
	}

	if _, err = tx.ExecContext(ctx, `UPDATE user_tokens SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?`, newUsername, oldUsername); err != nil {
		return fmt.Errorf("rename user tokens: %w", err)
	}

	return nil
}

// Session represents an authenticated session stored in the database.
type Session struct {
	Token     string
	Username  string
	ExpiresAt time.Time
	CreatedAt time.Time
}

// CreateSession persists a new session to the database.
func (r *TrafficRepository) CreateSession(ctx context.Context, token, username string, expiresAt time.Time) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	token = strings.TrimSpace(token)
	username = strings.TrimSpace(username)
	if token == "" {
		return errors.New("token is required")
	}
	if username == "" {
		return errors.New("username is required")
	}

	const stmt = `INSERT INTO sessions (token, username, expires_at) VALUES (?, ?, ?)`
	if _, err := r.db.ExecContext(ctx, stmt, token, username, expiresAt); err != nil {
		return fmt.Errorf("create session: %w", err)
	}

	return nil
}

// DeleteSession removes a session from the database.
func (r *TrafficRepository) DeleteSession(ctx context.Context, token string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	token = strings.TrimSpace(token)
	if token == "" {
		return errors.New("token is required")
	}

	const stmt = `DELETE FROM sessions WHERE token = ?`
	if _, err := r.db.ExecContext(ctx, stmt, token); err != nil {
		return fmt.Errorf("delete session: %w", err)
	}

	return nil
}

// DeleteUserSessions removes all sessions for a specific user.
func (r *TrafficRepository) DeleteUserSessions(ctx context.Context, username string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return errors.New("username is required")
	}

	const stmt = `DELETE FROM sessions WHERE username = ?`
	if _, err := r.db.ExecContext(ctx, stmt, username); err != nil {
		return fmt.Errorf("delete user sessions: %w", err)
	}

	return nil
}

// LoadSessions retrieves all non-expired sessions from the database.
func (r *TrafficRepository) LoadSessions(ctx context.Context) ([]Session, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	const stmt = `SELECT token, username, expires_at, created_at FROM sessions WHERE expires_at > datetime('now') ORDER BY created_at ASC`
	rows, err := r.db.QueryContext(ctx, stmt)
	if err != nil {
		return nil, fmt.Errorf("load sessions: %w", err)
	}
	defer rows.Close()

	var sessions []Session
	for rows.Next() {
		var session Session
		if err := rows.Scan(&session.Token, &session.Username, &session.ExpiresAt, &session.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan session: %w", err)
		}
		sessions = append(sessions, session)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate sessions: %w", err)
	}

	return sessions, nil
}

// CleanupExpiredSessions removes expired sessions from the database.
func (r *TrafficRepository) CleanupExpiredSessions(ctx context.Context) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	const stmt = `DELETE FROM sessions WHERE expires_at <= datetime('now')`
	if _, err := r.db.ExecContext(ctx, stmt); err != nil {
		return fmt.Errorf("cleanup expired sessions: %w", err)
	}

	return nil
}

// AssignSubscriptionToUser assigns a subscription to a user.
func (r *TrafficRepository) AssignSubscriptionToUser(ctx context.Context, username string, subscriptionID int64) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return errors.New("username is required")
	}
	if subscriptionID <= 0 {
		return errors.New("invalid subscription ID")
	}

	_, err := r.db.ExecContext(ctx, `INSERT INTO user_subscriptions (username, subscription_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, username, subscriptionID)
	if err != nil {
		return fmt.Errorf("assign subscription to user: %w", err)
	}

	return nil
}

// RemoveSubscriptionFromUser removes a subscription assignment from a user.
func (r *TrafficRepository) RemoveSubscriptionFromUser(ctx context.Context, username string, subscriptionID int64) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return errors.New("username is required")
	}
	if subscriptionID <= 0 {
		return errors.New("invalid subscription ID")
	}

	_, err := r.db.ExecContext(ctx, `DELETE FROM user_subscriptions WHERE username = ? AND subscription_id = ?`, username, subscriptionID)
	if err != nil {
		return fmt.Errorf("remove subscription from user: %w", err)
	}

	return nil
}

// GetUserSubscriptionIDs returns all subscription IDs assigned to a user.
func (r *TrafficRepository) GetUserSubscriptionIDs(ctx context.Context, username string) ([]int64, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return nil, errors.New("username is required")
	}

	const stmt = `SELECT subscription_id FROM user_subscriptions WHERE username = ? ORDER BY created_at ASC`
	rows, err := r.db.QueryContext(ctx, stmt, username)
	if err != nil {
		return nil, fmt.Errorf("get user subscription IDs: %w", err)
	}
	defer rows.Close()

	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan subscription ID: %w", err)
		}
		ids = append(ids, id)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate subscription IDs: %w", err)
	}

	return ids, nil
}

// SetUserSubscriptions replaces all subscriptions for a user with the provided list.
func (r *TrafficRepository) SetUserSubscriptions(ctx context.Context, username string, subscriptionIDs []int64) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return errors.New("username is required")
	}

	// 使用事务确保原子性
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	// 删除用户的所有现有订阅
	_, err = tx.ExecContext(ctx, `DELETE FROM user_subscriptions WHERE username = ?`, username)
	if err != nil {
		return fmt.Errorf("delete existing subscriptions: %w", err)
	}

	// 插入新的订阅
	if len(subscriptionIDs) > 0 {
		stmt, err := tx.PrepareContext(ctx, `INSERT INTO user_subscriptions (username, subscription_id) VALUES (?, ?)`)
		if err != nil {
			return fmt.Errorf("prepare insert statement: %w", err)
		}
		defer stmt.Close()

		for _, id := range subscriptionIDs {
			if id <= 0 {
				continue
			}
			_, err = stmt.ExecContext(ctx, username, id)
			if err != nil {
				return fmt.Errorf("insert subscription %d: %w", id, err)
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}

	return nil
}

// GetUserSubscriptions returns all subscriptions assigned to a user.
func (r *TrafficRepository) GetUserSubscriptions(ctx context.Context, username string) ([]SubscribeFile, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return nil, errors.New("username is required")
	}

	const stmt = `
		SELECT s.id, s.name, COALESCE(s.description, ''), COALESCE(s.url, ''), s.type, s.filename, s.created_at, s.updated_at
		FROM subscribe_files s
		INNER JOIN user_subscriptions us ON s.id = us.subscription_id
		WHERE us.username = ?
		ORDER BY s.created_at DESC
	`
	rows, err := r.db.QueryContext(ctx, stmt, username)
	if err != nil {
		return nil, fmt.Errorf("get user subscriptions: %w", err)
	}
	defer rows.Close()

	var subscriptions []SubscribeFile
	for rows.Next() {
		var sub SubscribeFile
		if err := rows.Scan(&sub.ID, &sub.Name, &sub.Description, &sub.URL, &sub.Type, &sub.Filename, &sub.CreatedAt, &sub.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan subscription: %w", err)
		}
		subscriptions = append(subscriptions, sub)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate subscriptions: %w", err)
	}

	return subscriptions, nil
}

// GetUserSettings retrieves user settings for a given username.
func (r *TrafficRepository) GetUserSettings(ctx context.Context, username string) (UserSettings, error) {
	var settings UserSettings
	if r == nil || r.db == nil {
		return settings, errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return settings, errors.New("username is required")
	}

	const stmt = `SELECT username, force_sync_external, COALESCE(match_rule, 'node_name'), COALESCE(cache_expire_minutes, 0), COALESCE(sync_traffic, 0), COALESCE(enable_probe_binding, 0), created_at, updated_at FROM user_settings WHERE username = ? LIMIT 1`
	var forceSyncInt, syncTrafficInt, enableProbeBindingInt int
	err := r.db.QueryRowContext(ctx, stmt, username).Scan(&settings.Username, &forceSyncInt, &settings.MatchRule, &settings.CacheExpireMinutes, &syncTrafficInt, &enableProbeBindingInt, &settings.CreatedAt, &settings.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return settings, ErrUserSettingsNotFound
		}
		return settings, fmt.Errorf("get user settings: %w", err)
	}

	settings.ForceSyncExternal = forceSyncInt == 1
	settings.SyncTraffic = syncTrafficInt == 1
	settings.EnableProbeBinding = enableProbeBindingInt == 1

	return settings, nil
}

// UpsertUserSettings creates or updates user settings.
func (r *TrafficRepository) UpsertUserSettings(ctx context.Context, settings UserSettings) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	username := strings.TrimSpace(settings.Username)
	if username == "" {
		return errors.New("username is required")
	}

	forceSyncInt := 0
	if settings.ForceSyncExternal {
		forceSyncInt = 1
	}

	syncTrafficInt := 0
	if settings.SyncTraffic {
		syncTrafficInt = 1
	}

	enableProbeBindingInt := 0
	if settings.EnableProbeBinding {
		enableProbeBindingInt = 1
	}

	matchRule := strings.TrimSpace(settings.MatchRule)
	if matchRule == "" {
		matchRule = "node_name"
	}

	cacheExpireMinutes := settings.CacheExpireMinutes
	if cacheExpireMinutes < 0 {
		cacheExpireMinutes = 0
	}

	const stmt = `
		INSERT INTO user_settings (username, force_sync_external, match_rule, cache_expire_minutes, sync_traffic, enable_probe_binding, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(username) DO UPDATE SET
			force_sync_external = excluded.force_sync_external,
			match_rule = excluded.match_rule,
			cache_expire_minutes = excluded.cache_expire_minutes,
			sync_traffic = excluded.sync_traffic,
			enable_probe_binding = excluded.enable_probe_binding,
			updated_at = CURRENT_TIMESTAMP
	`

	if _, err := r.db.ExecContext(ctx, stmt, username, forceSyncInt, matchRule, cacheExpireMinutes, syncTrafficInt, enableProbeBindingInt); err != nil {
		return fmt.Errorf("upsert user settings: %w", err)
	}

	return nil
}

// ListExternalSubscriptions returns all external subscriptions for a user.
func (r *TrafficRepository) ListExternalSubscriptions(ctx context.Context, username string) ([]ExternalSubscription, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return nil, errors.New("username is required")
	}

	const stmt = `SELECT id, username, name, url, node_count, last_sync_at, COALESCE(upload, 0), COALESCE(download, 0), COALESCE(total, 0), expire, created_at, updated_at FROM external_subscriptions WHERE username = ? ORDER BY created_at DESC`
	rows, err := r.db.QueryContext(ctx, stmt, username)
	if err != nil {
		return nil, fmt.Errorf("list external subscriptions: %w", err)
	}
	defer rows.Close()

	var subs []ExternalSubscription
	for rows.Next() {
		var sub ExternalSubscription
		var lastSyncAt, expire sql.NullTime
		if err := rows.Scan(&sub.ID, &sub.Username, &sub.Name, &sub.URL, &sub.NodeCount, &lastSyncAt, &sub.Upload, &sub.Download, &sub.Total, &expire, &sub.CreatedAt, &sub.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan external subscription: %w", err)
		}
		if lastSyncAt.Valid {
			sub.LastSyncAt = &lastSyncAt.Time
		}
		if expire.Valid {
			sub.Expire = &expire.Time
		}
		subs = append(subs, sub)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate external subscriptions: %w", err)
	}

	return subs, nil
}

// GetExternalSubscription retrieves an external subscription by ID.
func (r *TrafficRepository) GetExternalSubscription(ctx context.Context, id int64, username string) (ExternalSubscription, error) {
	var sub ExternalSubscription
	if r == nil || r.db == nil {
		return sub, errors.New("traffic repository not initialized")
	}

	if id <= 0 {
		return sub, errors.New("subscription id is required")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return sub, errors.New("username is required")
	}

	const stmt = `SELECT id, username, name, url, node_count, last_sync_at, created_at, updated_at FROM external_subscriptions WHERE id = ? AND username = ? LIMIT 1`
	var lastSyncAt sql.NullTime
	err := r.db.QueryRowContext(ctx, stmt, id, username).Scan(&sub.ID, &sub.Username, &sub.Name, &sub.URL, &sub.NodeCount, &lastSyncAt, &sub.CreatedAt, &sub.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return sub, ErrExternalSubscriptionNotFound
		}
		return sub, fmt.Errorf("get external subscription: %w", err)
	}

	if lastSyncAt.Valid {
		sub.LastSyncAt = &lastSyncAt.Time
	}

	return sub, nil
}

// CreateExternalSubscription creates a new external subscription.
func (r *TrafficRepository) CreateExternalSubscription(ctx context.Context, sub ExternalSubscription) (int64, error) {
	if r == nil || r.db == nil {
		return 0, errors.New("traffic repository not initialized")
	}

	username := strings.TrimSpace(sub.Username)
	if username == "" {
		return 0, errors.New("username is required")
	}

	name := strings.TrimSpace(sub.Name)
	if name == "" {
		return 0, errors.New("subscription name is required")
	}

	url := strings.TrimSpace(sub.URL)
	if url == "" {
		return 0, errors.New("subscription url is required")
	}

	const stmt = `INSERT INTO external_subscriptions (username, name, url, node_count, last_sync_at) VALUES (?, ?, ?, ?, ?)`
	result, err := r.db.ExecContext(ctx, stmt, username, name, url, sub.NodeCount, sub.LastSyncAt)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return 0, ErrExternalSubscriptionExists
		}
		return 0, fmt.Errorf("create external subscription: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("get last insert id: %w", err)
	}

	return id, nil
}

// UpdateExternalSubscription updates an existing external subscription.
func (r *TrafficRepository) UpdateExternalSubscription(ctx context.Context, sub ExternalSubscription) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if sub.ID <= 0 {
		return errors.New("subscription id is required")
	}

	username := strings.TrimSpace(sub.Username)
	if username == "" {
		return errors.New("username is required")
	}

	name := strings.TrimSpace(sub.Name)
	if name == "" {
		return errors.New("subscription name is required")
	}

	url := strings.TrimSpace(sub.URL)
	if url == "" {
		return errors.New("subscription url is required")
	}

	const stmt = `UPDATE external_subscriptions SET name = ?, url = ?, node_count = ?, last_sync_at = ?, upload = ?, download = ?, total = ?, expire = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND username = ?`
	result, err := r.db.ExecContext(ctx, stmt, name, url, sub.NodeCount, sub.LastSyncAt, sub.Upload, sub.Download, sub.Total, sub.Expire, sub.ID, username)
	if err != nil {
		return fmt.Errorf("update external subscription: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected: %w", err)
	}

	if rows == 0 {
		return ErrExternalSubscriptionNotFound
	}

	return nil
}

// DeleteExternalSubscription deletes an external subscription.
func (r *TrafficRepository) DeleteExternalSubscription(ctx context.Context, id int64, username string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if id <= 0 {
		return errors.New("subscription id is required")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return errors.New("username is required")
	}

	const stmt = `DELETE FROM external_subscriptions WHERE id = ? AND username = ?`
	result, err := r.db.ExecContext(ctx, stmt, id, username)
	if err != nil {
		return fmt.Errorf("delete external subscription: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected: %w", err)
	}

	if rows == 0 {
		return ErrExternalSubscriptionNotFound
	}

	return nil
}
