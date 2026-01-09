FROM node:20-slim

# LibreOffice for DOCX/PPTX/XLSX → PDF
RUN apt-get update && apt-get install -y libreoffice \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
