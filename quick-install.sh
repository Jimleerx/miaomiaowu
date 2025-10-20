#!/bin/bash
# 妙妙屋 - 一键安装命令（简化版）

set -e

VERSION="v0.0.7"
GITHUB_REPO="Jimleerx/miaomiaowu"
DOWNLOAD_URL="https://github.com/${GITHUB_REPO}/releases/download/${VERSION}/traffic-info-linux-amd64"
VERSION_FILE=".version"

# 安装函数
install() {
    echo "正在下载并安装妙妙屋 $VERSION ..."

    # 下载
    wget -q --show-progress "$DOWNLOAD_URL" -O traffic-info

    # 赋予执行权限
    chmod +x traffic-info

    # 创建数据目录
    mkdir -p data

    # 保存版本信息
    echo "$VERSION" > "$VERSION_FILE"

    # 显示完成信息
    echo ""
    echo "✅ 安装完成！"
    echo ""
    echo "赋予可执行权限:"
    echo "  chmod +x ./traffic-info"
    echo ""
    echo "运行服务:"
    echo "  ./traffic-info"
    echo ""
    echo "后台运行:"
    echo "  nohup ./traffic-info > traffic-info.log 2>&1 &"
    echo ""
    echo "访问地址: http://localhost:8080"
    echo ""
    echo "更新版本:"
    echo "  curl -sL https://raw.githubusercontent.com/${GITHUB_REPO}/main/quick-install.sh | bash -s update"
    echo ""
}

# 更新函数
update() {
    echo "正在更新妙妙屋..."
    echo ""

    # 检查是否已安装
    if [ ! -f "traffic-info" ]; then
        echo "❌ 未检测到已安装的 traffic-info，请先运行安装"
        exit 1
    fi

    # 显示当前版本
    if [ -f "$VERSION_FILE" ]; then
        CURRENT_VERSION=$(cat "$VERSION_FILE")
        echo "当前版本: $CURRENT_VERSION"
    fi
    echo "目标版本: $VERSION"
    echo ""

    # 查找并停止运行中的进程
    if pgrep -f "./traffic-info" > /dev/null; then
        echo "停止运行中的服务..."
        pkill -f "./traffic-info" || true
        sleep 2
    fi

    # 备份当前版本
    if [ -f "traffic-info" ]; then
        echo "备份当前版本..."
        cp traffic-info traffic-info.bak
    fi

    # 下载新版本
    echo "下载新版本..."
    wget -q --show-progress "$DOWNLOAD_URL" -O traffic-info

    # 赋予执行权限
    chmod +x traffic-info

    # 保存版本信息
    echo "$VERSION" > "$VERSION_FILE"

    echo ""
    echo "✅ 更新完成！"
    echo ""
    echo "📦 版本: $VERSION"
    echo ""
    echo "运行服务:"
    echo "  ./traffic-info"
    echo ""
    echo "后台运行:"
    echo "  nohup ./traffic-info > traffic-info.log 2>&1 &"
    echo ""
    echo "如遇问题可回滚到备份版本:"
    echo "  mv traffic-info.bak traffic-info"
    echo ""
}

# 主函数
main() {
    if [ "$1" = "update" ]; then
        update
    else
        install
    fi
}

# 运行主函数
main "$@"
