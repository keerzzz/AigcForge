FROM alpine AS base

ARG BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=${BUN_RUNTIME_TRANSPILER_CACHE_PATH}
RUN apk add --no-cache libgcc libstdc++ ripgrep

FROM base AS build-amd64
COPY dist/cli-linux-x64-baseline-musl/bin/aigcfroge /usr/local/bin/aigcfroge

FROM base AS build-arm64
COPY dist/cli-linux-arm64-musl/bin/aigcfroge /usr/local/bin/aigcfroge

ARG TARGETARCH
FROM build-${TARGETARCH}
RUN ln -s aigcfroge /usr/local/bin/aigcfroge2 && aigcfroge --version && aigcfroge2 --version
ENTRYPOINT ["aigcfroge"]
