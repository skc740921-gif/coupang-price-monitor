FROM node:20-slim
RUN apt-get update && apt-get install -y chromium ca-certificates fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV CHROME_BIN=/usr/bin/chromium
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm","start"]
