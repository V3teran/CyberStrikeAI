# syntax=docker/dockerfile:1.7
# CyberStrikeAI App Image
# 主程序层：依赖 cyberstrike-tools 基础镜像，只添加 CSAI 二进制 + 前端 + 配置
# 每次上游更新只需重建这一层（分钟级）

ARG TOOLS_IMAGE=ghcr.io/v3teran/offsec-tools:latest

# ---- Stage 1: 编译 Go 主程序 ----
FROM golang:1.24-bookworm AS app-builder

ARG GOPROXY=https://proxy.golang.org,direct
ENV GOPROXY=${GOPROXY}

WORKDIR /src

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential ca-certificates pkg-config \
    && rm -rf /var/lib/apt/lists/*

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN go build -o /out/cyberstrike-ai ./cmd/server/main.go

# ---- Stage 2: 工具层 + CSAI 主程序 ----
FROM ${TOOLS_IMAGE}

ENV APP_HOME=/app \
    DEBIAN_FRONTEND=noninteractive \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONUNBUFFERED=1 \
    GOPROXY=https://proxy.golang.org,direct \
    GOBIN=/opt/cyberstrike/bin \
    PATH=/root/.local/bin:/opt/cyberstrike/bin:/root/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

WORKDIR ${APP_HOME}

# tini (ENTRYPOINT 需要) + curl (HEALTHCHECK 需要)
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini curl \
    && rm -rf /var/lib/apt/lists/*

# 从编译阶段复制主程序
COPY --from=app-builder /out/cyberstrike-ai ./cyberstrike-ai

# 应用运行时文件（tools/*.yaml 由 tools 镜像安装时使用，这里覆盖一份用于运行时读取）
COPY web ./web
COPY tools ./tools
COPY roles ./roles
COPY skills ./skills
COPY agents ./agents
COPY knowledge_base ./knowledge_base
COPY requirements.txt ./requirements.txt
COPY config.docker.yaml ./config.example.yaml
COPY scripts/docker/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# 安装 Python 运行时依赖（tools 镜像不包含这些）
RUN pip3 install --break-system-packages --no-cache-dir -r requirements.txt 2>/dev/null || true \
    && rm -rf /root/.cache /tmp/* 2>/dev/null || true

RUN mkdir -p runtime-config data tmp \
    && chmod +x /usr/local/bin/docker-entrypoint.sh \
    && ln -s /app/runtime-config/config.yaml /app/config.yaml

EXPOSE 8080 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
    CMD curl -fsS http://127.0.0.1:8080/ >/dev/null || exit 1

ENTRYPOINT ["tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["./cyberstrike-ai"]
