FROM rust:1.100.0-alpine AS builder
RUN apk add --no-cache build-base
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY tests ./tests
RUN cargo test --locked && cargo build --release --locked

FROM alpine:3.24
COPY --from=builder /build/target/release/exposure /usr/local/bin/exposure
USER 1000:1000
ENTRYPOINT ["/usr/local/bin/exposure"]
CMD ["--help"]
