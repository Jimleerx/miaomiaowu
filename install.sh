#!/bin/bash

# 妙妙屋 - 流量监控管理系统 安装脚本
# 适用于 Debian/Ubuntu Linux 系统

set -e

# 配置
VERSION="v0.0.4"
GITHUB_REPO="Jimleerx/miaomiaowu"
BINARY_NAME="traffic-info-linux-amd64"
INSTALL_DIR="/usr/local/bin"
SERVICE_NAME="traffic-info"
DATA_DIR="/var/lib/traffic-info"
CONFIG_DIR="/etc/traffic-info"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

echo_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

echo_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查是否为 root 用户
check_root() {
    if [ "$EUID" -ne 0 ]; then
        echo_error "请使用 root 权限运行此脚本"
        echo_info "使用命令: sudo bash install.sh"
        exit 1
    fi
}

# 检查系统架构
check_architecture() {
    ARCH=$(uname -m)
    if [ "$ARCH" != "x86_64" ]; then
        echo_error "此脚本仅支持 x86_64 架构，当前架构: $ARCH"
        exit 1
    fi
}

# 安装依赖
install_dependencies() {
    echo_info "检查并安装依赖..."
    apt-get update -qq
    apt-get install -y wget curl systemd >/dev/null 2>&1
}

# 下载二进制文件
download_binary() {
    echo_info "下载 $SERVICE_NAME $VERSION..."
    DOWNLOAD_URL="https://github.com/${GITHUB_REPO}/releases/download/${VERSION}/${BINARY_NAME}"

    cd /tmp
    if wget -q --show-progress "$DOWNLOAD_URL" -O "$BINARY_NAME"; then
        echo_info "下载完成"
    else
        echo_error "下载失败，请检查网络连接或版本号"
        exit 1
    fi
}

# 安装二进制文件
install_binary() {
    echo_info "安装二进制文件..."
    chmod +x "/tmp/$BINARY_NAME"
    mv "/tmp/$BINARY_NAME" "$INSTALL_DIR/$SERVICE_NAME"
    echo_info "已安装到 $INSTALL_DIR/$SERVICE_NAME"
}

# 创建数据目录
create_directories() {
    echo_info "创建数据目录..."
    mkdir -p "$DATA_DIR"
    mkdir -p "$CONFIG_DIR"
    chmod 755 "$DATA_DIR"
    chmod 755 "$CONFIG_DIR"
}

# 创建 systemd 服务
create_systemd_service() {
    echo_info "创建 systemd 服务..."
    cat > /etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=Traffic Info - 妙妙屋流量监控系统
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$DATA_DIR
ExecStart=$INSTALL_DIR/$SERVICE_NAME
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

# 环境变量
Environment="PORT=8080"
Environment="DATABASE_PATH=$DATA_DIR/traffic.db"
Environment="LOG_LEVEL=info"

# 安全选项
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    echo_info "systemd 服务已创建"
}

# 启动服务
start_service() {
    echo_info "启动服务..."
    systemctl enable ${SERVICE_NAME}.service
    systemctl start ${SERVICE_NAME}.service
    sleep 2

    if systemctl is-active --quiet ${SERVICE_NAME}.service; then
        echo_info "服务启动成功！"
        return 0
    else
        echo_error "服务启动失败"
        return 1
    fi
}

# 显示状态
show_status() {
    echo ""
    echo "======================================"
    echo_info "妙妙屋安装完成！"
    echo "======================================"
    echo ""
    echo "📦 安装位置: $INSTALL_DIR/$SERVICE_NAME"
    echo "💾 数据目录: $DATA_DIR"
    echo "🌐 访问地址: http://$(hostname -I | awk '{print $1}'):8080"
    echo ""
    echo "常用命令:"
    echo "  启动服务: systemctl start $SERVICE_NAME"
    echo "  停止服务: systemctl stop $SERVICE_NAME"
    echo "  重启服务: systemctl restart $SERVICE_NAME"
    echo "  查看状态: systemctl status $SERVICE_NAME"
    echo "  查看日志: journalctl -u $SERVICE_NAME -f"
    echo ""
    echo "⚠️  首次访问需要完成初始化配置"
    echo ""
}

# 主函数
main() {
    echo_info "开始安装妙妙屋流量监控系统..."
    echo ""

    check_root
    check_architecture
    install_dependencies
    download_binary
    install_binary
    create_directories
    create_systemd_service

    if start_service; then
        show_status
    else
        echo_error "安装过程中出现错误，请查看日志: journalctl -u $SERVICE_NAME -n 50"
        exit 1
    fi
}

# 运行主函数
main
