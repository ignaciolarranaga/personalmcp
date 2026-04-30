FROM mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    g++ \
    make \
    ninja-build \
    pkg-config \
    python3 \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*
