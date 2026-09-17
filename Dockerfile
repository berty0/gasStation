# BenzinaBergamo — container leggero per hosting cloud (Railway/Render/Fly.io)
# Server zero-dipendenze Node.js: basta copiare il progetto e avviarlo.
FROM node:22-slim

WORKDIR /app

# Copia tutto (escluso data/, node_modules/, artefatti — vedi .dockerignore)
COPY . .

# Avvio. Il server sceglie la porta da $PORT (come su Railway/Render/Fly).
EXPOSE 8080
CMD ["node", "server.js"]