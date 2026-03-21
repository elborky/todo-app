FROM node:20-alpine

# Build deps for native sqlite3 module
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install dependencies (cached layer if package files unchanged)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy app source
COPY server.js ./
COPY public ./public

# Directory for persistent SQLite database
RUN mkdir /data && chown node:node /data

ENV DB_PATH=/data/todos.db
ENV NODE_ENV=production

USER node

EXPOSE 3000

VOLUME ["/data"]

CMD ["node", "server.js"]
