# Build stage for frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app

# Copy frontend package files
COPY miaomiaowu/package*.json ./miaomiaowu/

# Install dependencies
WORKDIR /app/miaomiaowu
RUN npm ci

# Copy frontend source
COPY miaomiaowu/ ./

# Build frontend (will output to ../internal/web/dist)
RUN npm run build

# Build stage for backend
FROM golang:1.24-alpine AS backend-builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git

# Copy go mod files
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY . .

# Copy built frontend from previous stage (vite outputs to /app/internal/web/dist)
COPY --from=frontend-builder /app/internal/web/dist ./internal/web/dist

# Build backend with optimizations
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -trimpath \
    -ldflags="-s -w" \
    -o /app/server \
    ./cmd/server

# Final stage
FROM alpine:latest

WORKDIR /app

# Install ca-certificates for HTTPS requests
RUN apk --no-cache add ca-certificates tzdata

# Create non-root user
RUN addgroup -g 1000 appuser && \
    adduser -D -u 1000 -G appuser appuser

# Copy binary from builder
COPY --from=backend-builder /app/server /app/server

# Create necessary directories
RUN mkdir -p /app/subscribes && \
    chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/ || exit 1

# Run the application
CMD ["/app/server"]
