# health:1.0, the pinned runner for the execution layer and, in full runs, every static tool. Build: npm run image:build
# Every tool is pinned by an exact version below. The base image is pinned by digest.
ARG NODE_IMAGE=node:22.20.0-bookworm@sha256:915acd9e9b885ead0c620e27e37c81b74c226e0e1c8177f37a60217b6eabb0d7
FROM ${NODE_IMAGE}

ARG NPM_VERSION=11.21.0
ARG PNPM_VERSION=12.9.1
ARG YARN_VERSION=4.18.1
ARG BUN_VERSION=1.4.2
ARG TYPESCRIPT_VERSION=5.9.3
ARG ESLINT_VERSION=9.39.5
ARG TYPESCRIPT_ESLINT_VERSION=8.71.0
ARG ESLINT_PLUGIN_REACT_HOOKS_VERSION=7.1.1
ARG PYRIGHT_VERSION=1.1.414
ARG UV_VERSION=0.12.23
ARG PYTHON_VERSION=3.12.15
ARG POETRY_VERSION=2.5.1
ARG PDM_VERSION=2.29.2
ARG PIPENV_VERSION=2026.8.0
ARG RUFF_VERSION=0.16.10
ARG MYPY_VERSION=2.4.0
ARG C8_VERSION=12.0.0
# Same version as the host's knip in package.json, so preview and full runs report the same issues.
ARG KNIP_VERSION=6.39.0
ARG JSCPD_VERSION=5.4.0
ARG COMPLEXIPY_VERSION=8.0.1
ARG VULTURE_VERSION=2.16
ARG DEPTRY_VERSION=0.25.1
ARG IMPORT_LINTER_VERSION=2.15
ARG GRIMP_VERSION=3.17
ARG GITLEAKS_VERSION=8.30.1
ARG GITLEAKS_SHA256_AMD64=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
ARG GITLEAKS_SHA256_ARM64=e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080
ARG OSV_SCANNER_VERSION=2.7.0
ARG OSV_SCANNER_SHA256_AMD64=160c6253e2922e9e0a6a9771c5c4c40a4b3c6090b34a3cdd5e80c96cc2e4218b
ARG OSV_SCANNER_SHA256_ARM64=4061ef4c021ed3c47f203b818f337e351336cc5cd67c0274fc36bd1dfc728dd7
ARG PYTEST_VERSION=9.1.1
ARG PYTEST_COV_VERSION=7.1.0
ARG COVERAGE_VERSION=7.16.2
ARG GO_VERSION=1.27.1
ARG GO_SHA256_AMD64=63d339f0da5ab53635a56f2490a7984dfe12dfcff22ad749f63edaf590168445
ARG GO_SHA256_ARM64=3450b45a3f9ee8568792736a5c5e70a1f2e9b36c35a8f74958c03e51d7d92bec
# Set by BuildKit. Redeclared here so the stage can see it; empty on a legacy builder.
ARG TARGETARCH

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl build-essential \
 && rm -rf /var/lib/apt/lists/*

# Node tools. Yarn is Berry because the methodology installs with `yarn install --immutable`.
# The base image ships Yarn 1 at /usr/local/bin/yarn, which blocks the Berry install, so it is removed first.
# npm is pinned past the base image's 10.9: its peer resolution crashes on vitest 4 (`reading 'edgesOut'`).
RUN rm -rf /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-v* \
 && npm install -g npm@${NPM_VERSION} \
 && npm install -g \
    pnpm@${PNPM_VERSION} \
    @yarnpkg/cli-dist@${YARN_VERSION} \
    bun@${BUN_VERSION} \
    typescript@${TYPESCRIPT_VERSION} \
    eslint@${ESLINT_VERSION} \
    pyright@${PYRIGHT_VERSION} \
    c8@${C8_VERSION} \
    knip@${KNIP_VERSION} \
    jscpd@${JSCPD_VERSION}

# The pinned lint ruleset and its plugins live in /opt/health, never in a scanned repository.
# type=module because bin/health-eslint is extensionless ESM; npm 11's `npm init -y` writes "type": "commonjs",
# under which node exits 0 on it without running it.
WORKDIR /opt/health
RUN npm init -y >/dev/null \
 && npm pkg set type=module \
 && npm install --save-exact \
    eslint@${ESLINT_VERSION} \
    typescript@${TYPESCRIPT_VERSION} \
    typescript-eslint@${TYPESCRIPT_ESLINT_VERSION} \
    eslint-plugin-react-hooks@${ESLINT_PLUGIN_REACT_HOOKS_VERSION}
COPY config/ /opt/health/
COPY bin/ /opt/health/bin/
RUN chmod +x /opt/health/bin/*

# Python 3.12 from uv's pinned builds, then the Python tools. Steps run as the host user, so the tool environments
# live in /opt/uv-tools: uv's default is under /root, which no other user can enter.
ENV UV_PYTHON_INSTALL_DIR=/opt/python UV_TOOL_DIR=/opt/uv-tools UV_TOOL_BIN_DIR=/usr/local/bin UV_LINK_MODE=copy POETRY_VIRTUALENVS_IN_PROJECT=1 PIPENV_VENV_IN_PROJECT=1
RUN curl -LsSf https://astral.sh/uv/${UV_VERSION}/install.sh | sh \
 && mv /root/.local/bin/uv /root/.local/bin/uvx /usr/local/bin/ \
 && uv python install ${PYTHON_VERSION} \
 && ln -s "$(uv python find ${PYTHON_VERSION})" /usr/local/bin/python \
 && ln -s /usr/local/bin/python /usr/local/bin/python3 \
 && uv tool install --python ${PYTHON_VERSION} poetry==${POETRY_VERSION} \
 && uv tool install --python ${PYTHON_VERSION} pdm==${PDM_VERSION} \
 && uv tool install --python ${PYTHON_VERSION} pipenv==${PIPENV_VERSION} \
 && uv tool install --python ${PYTHON_VERSION} ruff==${RUFF_VERSION} \
 && uv tool install --python ${PYTHON_VERSION} mypy==${MYPY_VERSION}

# The static tools of a full run (4.1, 4.4, 5.5 and D3 for Python). import-linter's environment also holds grimp,
# which python/graph_helper.py imports; the helper runs with /opt/uv-tools/import-linter/bin/python.
RUN uv tool install --python ${PYTHON_VERSION} complexipy==${COMPLEXIPY_VERSION} \
 && uv tool install --python ${PYTHON_VERSION} vulture==${VULTURE_VERSION} \
 && uv tool install --python ${PYTHON_VERSION} deptry==${DEPTRY_VERSION} \
 && uv tool install --python ${PYTHON_VERSION} import-linter==${IMPORT_LINTER_VERSION} --with grimp==${GRIMP_VERSION}

# pytest, pytest-cov and coverage as wheels, for repositories whose environment has none (the test step has no network). `health-pytest` installs them offline.
RUN uv venv /tmp/wheel-venv --python ${PYTHON_VERSION} \
 && uv pip install --python /tmp/wheel-venv/bin/python pip \
 && /tmp/wheel-venv/bin/python -m pip download -d /opt/health/wheels pytest==${PYTEST_VERSION} pytest-cov==${PYTEST_COV_VERSION} coverage==${COVERAGE_VERSION} \
 && rm -rf /tmp/wheel-venv

# Go, pinned by checksum for amd64 and arm64. No parameter uses it yet.
# TARGETARCH is empty without BuildKit, so it falls back to the Debian architecture name.
RUN arch="${TARGETARCH:-$(dpkg --print-architecture)}" \
 && case "${arch}" in \
      amd64) go_sha256="${GO_SHA256_AMD64}" ;; \
      arm64) go_sha256="${GO_SHA256_ARM64}" ;; \
      *) echo "unsupported architecture for Go: ${arch}" >&2; exit 1 ;; \
    esac \
 && curl -fsSL -o /tmp/go.tgz "https://go.dev/dl/go${GO_VERSION}.linux-${arch}.tar.gz" \
 && echo "${go_sha256}  /tmp/go.tgz" | sha256sum -c - \
 && tar -C /usr/local -xzf /tmp/go.tgz \
 && rm /tmp/go.tgz

# gitleaks (5.4) and osv-scanner (5.1), release binaries pinned by checksum for amd64 and arm64.
RUN arch="${TARGETARCH:-$(dpkg --print-architecture)}" \
 && case "${arch}" in \
      amd64) gitleaks_arch=x64; gitleaks_sha256="${GITLEAKS_SHA256_AMD64}"; osv_sha256="${OSV_SCANNER_SHA256_AMD64}" ;; \
      arm64) gitleaks_arch=arm64; gitleaks_sha256="${GITLEAKS_SHA256_ARM64}"; osv_sha256="${OSV_SCANNER_SHA256_ARM64}" ;; \
      *) echo "unsupported architecture for gitleaks and osv-scanner: ${arch}" >&2; exit 1 ;; \
    esac \
 && curl -fsSL -o /tmp/gitleaks.tgz "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_${gitleaks_arch}.tar.gz" \
 && echo "${gitleaks_sha256}  /tmp/gitleaks.tgz" | sha256sum -c - \
 && tar -C /usr/local/bin -xzf /tmp/gitleaks.tgz gitleaks \
 && rm /tmp/gitleaks.tgz \
 && curl -fsSL -o /usr/local/bin/osv-scanner "https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}/osv-scanner_linux_${arch}" \
 && echo "${osv_sha256}  /usr/local/bin/osv-scanner" | sha256sum -c - \
 && chmod +x /usr/local/bin/osv-scanner

ENV PATH=/opt/health/bin:/usr/local/go/bin:$PATH
WORKDIR /work

# Bumped whenever the set of tools a full run needs from the image changes. A full scan refuses an image whose
# label differs from IMAGE_REVISION in src/exec/docker.ts, so an image built before the change is rebuilt.
LABEL dev.vibecodedshit.health.revision="2"
