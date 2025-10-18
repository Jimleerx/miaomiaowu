#!/bin/bash
# 妙妙屋 - 一键安装命令（简化版）

set -e

VERSION="v0.0.5"
DOWNLOAD_URL="https://github.com/Jimleerx/miaomiaowu/releases/download/${VERSION}/traffic-info-linux-amd64"

echo "正在下载并安装妙妙屋..."

# 下载
wget -q --show-progress "$DOWNLOAD_URL" -O traffic-info

# 赋予执行权限
chmod +x traffic-info

# 创建数据目录
mkdir -p data

# 显示完成信息
echo ""
echo "✅ 安装完成！"
echo ""
echo "运行服务:"
echo "  ./traffic-info"
echo ""
echo "后台运行:"
echo "  nohup ./traffic-info > traffic-info.log 2>&1 &"
echo ""
echo "访问地址: http://localhost:8080"
echo ""
