# ctx = repo root
FROM rust:1.91-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates crates
COPY games/brawler/sim games/brawler/sim
COPY games/brawler/server games/brawler/server
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked -p brawler-server && cp target/release/brawler-server /brawler-server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*
COPY --from=build /brawler-server /usr/local/bin/
ENV PORT=8787
EXPOSE 8787
USER nobody
CMD ["brawler-server"]
