FROM --platform=$BUILDPLATFORM node:26-alpine AS builder

WORKDIR /src/docs-site
COPY docs-site/package.json docs-site/package-lock.json ./
RUN npm ci

COPY docs /src/docs
COPY docs-site /src/docs-site
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.31-alpine

COPY docs-site/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /src/docs-site/dist /usr/share/nginx/html/docs

EXPOSE 8080
