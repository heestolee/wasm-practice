# Node.js 이미지 사용
FROM node:18-alpine

# 작업 디렉토리 설정
WORKDIR /usr/src/app

# 필요한 파일 복사 및 의존성 설치
COPY package*.json ./
RUN npm install

# 모든 소스 파일을 작업 디렉토리로 복사
COPY . .

# 서버 실행
CMD ["node", "src/server.js"]
