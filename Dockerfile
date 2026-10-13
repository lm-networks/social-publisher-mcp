# social-publisher-mcp — LuMiGRAF Technology Lab — https://dev.lm-ads.com
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY dist ./dist
ENV MCP_HTTP_HOST=0.0.0.0 \
    MCP_HTTP_PORT=3100 \
    SOCIAL_MCP_MEDIA_DIR=/data/media \
    SOCIAL_MCP_QUEUE_FILE=/data/schedule.json \
    TZ=Europe/Warsaw
RUN mkdir -p /data/media && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 3100
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:3100/health || exit 1
CMD ["node", "dist/index.js", "--http"]
