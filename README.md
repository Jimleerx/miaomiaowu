# 妙妙屋 - 流量监控管理系统

一个轻量级、易部署的服务器流量监控与订阅管理系统，支持 Nezha、DStatus 和 Komari 探针。

## 功能特性

### 核心功能
- 📊 **实时流量监控** - 支持多服务器流量聚合统计
- 📈 **历史数据展示** - 30 天流量使用趋势图表
- 🔗 **订阅链接管理** - 一键生成 Clash 订阅链接
- 🎯 **智能规则配置** - 可视化订阅规则编辑器
- 👥 **用户权限管理** - 管理员/普通用户角色区分
- 🌓 **主题切换** - 支持亮色/暗色模式

### 探针支持
- [Nezha](https://github.com/naiba/nezha) 面板
- [DStatus](https://github.com/DokiDoki1103/dstatus) 监控
- [Komari](https://github.com/missuo/komari) 面板

### 体验demo
[Demo](https://demo.miaomiaowu.com)  
账户/密码: test / test123


### 安装部署

#### 方式 1：一键安装（推荐 - Linux）

**自动安装为 systemd 服务（Debian/Ubuntu）：**
```bash
# 下载并运行安装脚本
curl -sL https://raw.githubusercontent.com/Jimleerx/miaomiaowu/main/install.sh | bash
```

安装完成后，服务将自动启动，访问 `http://服务器IP:8080` 即可。

**简易安装（手动运行）：**
```bash
# 一键下载安装
curl -sL https://raw.githubusercontent.com/Jimleerx/miaomiaowu/main/quick-install.sh | bash

# 运行服务
./traffic-info
```

#### 方式 2：手动安装

**Linux：**
```bash
# 下载二进制文件（修改版本号为所需版本）
wget https://github.com/Jimleerx/miaomiaowu/releases/download/v0.0.2/traffic-info-linux-amd64

# 添加执行权限
chmod +x traffic-info-linux-amd64

# 运行
./traffic-info-linux-amd64
```

**Windows：**
```powershell
# 从 Releases 页面下载 traffic-info-windows-amd64.exe
# https://github.com/Jimleerx/miaomiaowu/releases

# 双击运行或在命令行中执行
.\traffic-info-windows-amd64.exe
```

#### 方式 3：Docker 部署

使用官方镜像 `ghcr.io/jimleerx/miaomiaowu:latest` 一键运行：
```bash
docker run -d \
  --name traffic-info \
  -p 8080:8080 \
  -v ./traffic-info-data:/app/data \
  -v ./subscribes:/app/subscribes \
  ghcr.io/jimleerx/miaomiaowu:latest
```

说明：
- `-p 8080:8080` 将容器端口映射到宿主机，按需调整。
- `-v ./traffic-info-data:/app/data` 持久化数据库文件，防止容器重建时数据丢失。
- `-v ./subscribes:/app/data` 持久化数据库文件，防止容器重建时数据丢失。
- `-e JWT_SECRET=your-secret` 可选参数，配置token密钥，建议改成随机字符串
- 其他环境变量（如 `LOG_LEVEL`）同下文“环境变量”章节，可通过 `-e` 继续添加。

更新镜像后可执行：
```bash
docker pull ghcr.io/jimleerx/miaomiaowu:latest
docker stop traffic-info && docker rm traffic-info
```
然后按照上方命令重新启动服务。

### 页面截图
![image](https://github.com/Jimleerx/miaomiaowu/blob/main/screenshots/traffic_info.png)  
![image](https://github.com/Jimleerx/miaomiaowu/blob/main/screenshots/subscribe_url.png)  
![image](https://github.com/Jimleerx/miaomiaowu/blob/main/screenshots/probe_datasource.png)  
![image](https://github.com/Jimleerx/miaomiaowu/blob/main/screenshots/subscribe_manage.png)  
![image](https://github.com/Jimleerx/miaomiaowu/blob/main/screenshots/rules_file_edit.png)  
![image](https://github.com/Jimleerx/miaomiaowu/blob/main/screenshots/user_manage.png)
### 技术特点
- 🚀 单二进制文件部署，无需外部依赖
- 💾 使用 SQLite 数据库，免维护
- 🔒 JWT 认证，安全可靠
- 📱 响应式设计，支持移动端

## 快速开始

### 系统要求
- Linux/Windows x86_64
- 无其他依赖

### 安装部署

#### Linux
```bash
# 下载二进制文件
wget https://github.com/Jimleerx/traffic-info/releases/latest/download/traffic-info-linux-amd64

# 添加执行权限
chmod +x traffic-info-linux-amd64

# 运行
./traffic-info-linux-amd64
```

#### Windows
```powershell
# 下载 traffic-info-windows-amd64.exe
# 双击运行或在命令行中执行
.\traffic-info-windows-amd64.exe
```

### 首次配置

1. 启动程序后，访问 `http://localhost:8080`
2. 首次访问会显示初始化页面
3. 填写管理员账号信息：
   - 用户名
   - 密码
   - 昵称
   - 邮箱（可选）
   - 头像地址（可选）
4. 完成初始化后，使用管理员账号登录

### 探针配置

1. 以管理员身份登录
2. 进入「探针管理」页面
3. 选择探针类型（Nezha/DStatus/Komari）
4. 填写探针地址（如：`https://probe.example.com`）
5. 添加服务器配置：
   - **服务器 ID**：探针中的服务器标识
   - **服务器名称**：显示名称
   - **流量计算方式**：
     - `up` - 仅上行流量
     - `down` - 仅下行流量
     - `both` - 双向流量
   - **月流量限额（GB）**：服务器月流量上限
6. 保存配置

## 配置说明

### 环境变量

```bash
# 服务器端口（默认 8080）
PORT=8080

# 数据库路径（默认 ./data/traffic.db）
DATABASE_PATH=./data/traffic.db

# JWT 密钥（建议自定义）
JWT_SECRET=your-secret-key

# 日志级别（debug/info/warn/error）
LOG_LEVEL=info
```

### 数据库

程序启动时会自动创建 SQLite 数据库，默认路径为 `./data/traffic.db`。数据库包含：
- 用户表
- 探针配置表
- 流量记录表
- 订阅配置表

### 订阅规则配置

系统支持自定义订阅规则（YAML 格式），支持以下客户端：
- Clash/ClashX
- Clash Meta
- Shadowrocket

规则配置示例参见「规则配置」页面。

## API 文档

### 认证接口

#### 登录
```http
POST /api/login
Content-Type: application/json

{
  "username": "admin",
  "password": "password"
}
```

#### 刷新令牌
```http
POST /api/refresh
Authorization: Bearer <refresh_token>
```

### 流量统计

#### 获取流量摘要
```http
GET /api/traffic/summary
Authorization: Bearer <access_token>
```

响应：
```json
{
  "metrics": {
    "total_limit_gb": 1000.00,
    "total_used_gb": 256.50,
    "total_remaining_gb": 743.50,
    "usage_percentage": 25.65
  },
  "history": [
    {
      "date": "2025-10-01",
      "used_gb": 8.52
    }
  ]
}
```

### 探针配置

#### 获取探针配置
```http
GET /api/admin/probe/config
Authorization: Bearer <access_token>
```

#### 更新探针配置
```http
PUT /api/admin/probe/config
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "probe_type": "nezha",
  "address": "https://probe.example.com",
  "servers": [
    {
      "server_id": "1",
      "name": "Server 1",
      "traffic_method": "both",
      "monthly_traffic_gb": 100
    }
  ]
}
```

## 开发指南

### 技术栈

#### 后端
- Go 1.24+
- SQLite (modernc.org/sqlite)
- Gorilla WebSocket
- JWT 认证

#### 前端
- React 19
- TypeScript
- TanStack Router
- TanStack Query
- Tailwind CSS
- Recharts

### 本地开发

#### 后端开发
```bash
# 安装依赖
go mod download

# 运行开发服务器
go run cmd/server/main.go
```

#### 前端开发
```bash
# 进入前端目录
cd miaomiaowu

# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

### 构建

#### 构建所有平台
```bash
# 构建前端
cd miaomiaowu && npm run build && cd ..

# 构建 Linux 版本
GOOS=linux GOARCH=amd64 go build -o build/traffic-info-linux-amd64 ./cmd/server

# 构建 Windows 版本
GOOS=windows GOARCH=amd64 go build -o build/traffic-info-windows-amd64.exe ./cmd/server
```

### 项目结构

```
traffic-info/
├── cmd/
│   └── server/          # 服务器入口
│       ├── main.go      # 主程序
│       └── cors.go      # CORS 配置
├── internal/
│   ├── auth/            # 认证模块
│   ├── handler/         # HTTP 处理器
│   ├── storage/         # 数据库操作
│   └── web/             # 嵌入的前端资源
├── miaomiaowu/          # 前端项目
│   ├── src/
│   │   ├── components/  # React 组件
│   │   ├── routes/      # 路由页面
│   │   ├── stores/      # Zustand 状态管理
│   │   └── lib/         # 工具函数
│   └── package.json
├── data/                # 数据目录
│   └── traffic.db       # SQLite 数据库
└── build/               # 构建输出
```

## 安全建议

1. **修改默认密钥**：部署前务必修改 JWT_SECRET
2. **使用 HTTPS**：生产环境建议配置 SSL 证书
3. **定期备份**：定期备份 `data/traffic.db` 数据库文件
4. **防火墙配置**：仅开放必要端口
5. **密码强度**：设置强密码并定期更换

## 常见问题

### 1. 探针连接失败
- 检查探针地址是否正确
- 确认探针服务正常运行
- 检查网络连通性和防火墙设置
- 检查浏览器是否跨域

### 2. 流量数据不更新
- 确认探针配置中的服务器 ID 正确
- 检查探针 WebSocket 连接状态
- 查看服务器日志排查错误

### 3. 订阅链接无法访问
- 确认已配置订阅规则
- 检查规则 YAML 格式是否正确
- 验证客户端类型匹配

### 4. 忘记管理员密码
如果忘记密码，可以删除数据库重新初始化：
```bash
# 备份数据库（可选）
cp data/traffic.db data/traffic.db.bak

# 删除数据库
rm data/traffic.db

# 重启程序，将显示初始化页面
```

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

## 联系方式

- 问题反馈：[GitHub Issues](https://github.com/Jimleerx/traffic-info/issues)
- 功能建议：[GitHub Discussions](https://github.com/Jimleerx/traffic-info/discussions)

## 更新日志

### v0.0.1 (2025-10-15)
- 初始版本发布
- 支持 Nezha/DStatus/Komari 探针
- 流量监控与订阅管理
- 用户权限管理
- 首次启动初始化向导
