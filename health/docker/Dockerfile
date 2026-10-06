# health:1.0, the pinned runner for the execution layer. Build: npm run image:build
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
    c8@${C8_VERSION}

# The pinned lint ruleset and its plugins live in /opt/health, never in a scanned repository.
WORKDIR /opt/health
RUN npm init -y >/dev/null \
 && npm install --save-exact \
    eslint@${ESLINT_VERSION} \
    typescript@${TYPESCRIPT_VERSION} \
    typescript-eslint@${TYPESCRIPT_ESLINT_VERSION} \
    eslint-plugin-react-hooks@${ESLINT_PLUGIN_REACT_HOOKS_VERSION}
COPY config/ /opt/health/
COPY bin/ /opt/health/bin/
RUN chmod +x /opt/health/bin/*

# Python 3.12 from uv's pinned builds, then the Python tools.
ENV UV_PYTHON_INSTALL_DIR=/opt/python UV_TOOL_BIN_DIR=/usr/local/bin UV_LINK_MODE=copy POETRY_VIRTUALENVS_IN_PROJECT=1 PIPENV_VENV_IN_PROJECT=1
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

ENV PATH=/opt/health/bin:/usr/local/go/bin:$PATH
WORKDIR /work
