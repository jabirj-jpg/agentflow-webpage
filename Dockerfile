FROM node:20-alpine

# Create and use app directory
WORKDIR /app

# Install only production deps (fail if install breaks)
COPY package*.json ./

# Use npm ci ONLY if package-lock.json exists
# RUN npm ci --omit=dev

# Copy the rest of the source
COPY . .

# Drop privileges (security best practice)
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser



CMD ["node", "server.js"]