# syntax=docker/dockerfile:1.7
# CyberStrikeAI v1.6.31 — Kali 底座 + 官方 install-tools.sh 全量工具

# ---- Stage 1: 编译 Go 主程序（干净的 golang 镜像）----
FROM golang:1.24-bookworm AS app-builder

WORKDIR /src

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential ca-certificates pkg-config \
    && rm -rf /var/lib/apt/lists/*

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN go build -o /out/cyberstrike-ai ./cmd/server/main.go

# ---- Stage 2: Kali 运行时 + 全量安全工具 ----
FROM kalilinux/kali-rolling AS runtime

ENV APP_HOME=/app \
    DEBIAN_FRONTEND=noninteractive \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONUNBUFFERED=1 \
    GOPROXY=https://proxy.golang.org,direct \
    GOBIN=/opt/cyberstrike/bin \
    PATH=/opt/cyberstrike/bin:/root/go/bin:/usr/local/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

WORKDIR ${APP_HOME}

# 已知可用的 Go 工具链（install-tools.sh 的 `go install @latest` 需要较新 Go）
COPY --from=golang:1.24-bookworm /usr/local/go /usr/local/go

# install-tools.sh 的前置依赖：curl/git/python/ruby/node/java/build + tini
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash curl wget git ca-certificates tini unzip xz-utils file \
        python3 python3-pip python3-venv pipx \
        ruby ruby-dev \
        nodejs npm \
        default-jdk-headless \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

# 应用运行所需文件
COPY --from=app-builder /out/cyberstrike-ai ./cyberstrike-ai
COPY web ./web
COPY tools ./tools
COPY roles ./roles
COPY skills ./skills
COPY agents ./agents
COPY knowledge_base ./knowledge_base
COPY requirements.txt ./requirements.txt
COPY config.docker.yaml ./config.example.yaml
COPY install-tools.sh ./install-tools.sh
COPY scripts/docker/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# 官方全量工具安装（root 环境 → --no-sudo；best-effort，个别工具失败不阻断构建）
# install-tools.sh 扫描 tools/*.yaml，按 apt→pip→gem→go→GitHub release 逐级安装。
RUN chmod +x ./install-tools.sh /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /opt/cyberstrike/bin \
    && apt-get update \
    && apt-get install -y kali-linux-headless \
    && (./install-tools.sh --no-sudo || true) \
    && pip3 install --break-system-packages --no-cache-dir -r requirements.txt 2>/dev/null || true \
    && rm -rf /var/lib/apt/lists/* /root/.cache /tmp/* 2>/dev/null || true

# 补齐 install-tools.sh 工具表覆盖不到 / 装错的工具：
#  - 真·projectdiscovery 工具（katana 被 pip 同名库顶替、nuclei 表项缺 go 路径 → 用 go install 锁版本覆盖）
#  - gdb（headless 元包未含）、dirsearch/paramspider（pip）、feroxbuster/rustscan（Rust，用 apt）
RUN apt-get update \
    && apt-get install -y --no-install-recommends gdb feroxbuster 2>/dev/null; \
    rm -f /usr/local/bin/katana; \
    GOBIN=/opt/cyberstrike/bin /usr/local/go/bin/go install github.com/projectdiscovery/katana/cmd/katana@v1.6.1 || true; \
    GOBIN=/opt/cyberstrike/bin /usr/local/go/bin/go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@v3.9.0 || true; \
    pip3 install --break-system-packages --no-cache-dir dirsearch 'git+https://github.com/devanshbatham/paramspider.git' 2>/dev/null || true; \
    rm -rf /var/lib/apt/lists/* /root/.cache /tmp/* 2>/dev/null || true

RUN mkdir -p runtime-config data tmp \
    && ln -s /app/runtime-config/config.yaml /app/config.yaml

EXPOSE 8080 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
    CMD curl -fsS http://127.0.0.1:8080/ >/dev/null || exit 1

ENTRYPOINT ["tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["./cyberstrike-ai"]
