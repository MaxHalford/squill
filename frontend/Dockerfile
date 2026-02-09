# Use bun base image
FROM oven/bun:latest AS base

# Build arguments for Vite environment variables
ARG VITE_BACKEND_URL
ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_GITHUB_CLIENT_ID

# Set environment variables from build arguments
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
ENV VITE_GITHUB_CLIENT_ID=$VITE_GITHUB_CLIENT_ID

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN bun run build

# Production stage
FROM nginx:alpine AS production

# Copy built assets from build stage
COPY --from=base /app/dist /usr/share/nginx/html

# Copy nginx configuration for SPA routing
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
