FROM node:20-alpine

RUN apk add --no-cache python3

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 5001

CMD ["npm", "run", "start"]
