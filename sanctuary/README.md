# Sanctuary - Umbrel App Package

This directory contains the files needed to submit Sanctuary to the Umbrel App Store. See [ARCHITECTURE.md](ARCHITECTURE.md) for the frontend architecture reference.

## Files

| File | Description |
|------|-------------|
| `umbrel-app.yml` | App manifest with metadata, description, dependencies |
| `docker-compose.yml` | Umbrel-compatible Docker Compose configuration |
| `exports.sh` | Environment variable exports for other apps |
| `icon.svg` | 256x256 app icon (no rounded corners) |

## Before Submission

### 1. Build and Push Docker Images

The Docker images must be published to a container registry (GitHub Container Registry recommended):

```bash
# Build multi-arch images
docker buildx create --use --name sanctuary-builder

# Build and push frontend
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t ghcr.io/nekoguntai/sanctuary-frontend:v0.8.7 \
  -f Dockerfile \
  --push \
  .

# Build and push backend
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t ghcr.io/nekoguntai/sanctuary-backend:v0.8.7 \
  -f server/Dockerfile \
  --push \
  ./server
```

### 2. Get SHA256 Digests

After pushing, get the image digests:

```bash
# Get frontend digest
docker buildx imagetools inspect ghcr.io/nekoguntai/sanctuary-frontend:v0.8.7 --format '{{json .Manifest.Digest}}'

# Get backend digest
docker buildx imagetools inspect ghcr.io/nekoguntai/sanctuary-backend:v0.8.7 --format '{{json .Manifest.Digest}}'
```

Update `docker-compose.yml` with the actual SHA256 digests:
- Replace `PLACEHOLDER_FRONTEND_SHA256` with the frontend digest
- Replace `PLACEHOLDER_BACKEND_SHA256` with the backend digest

### 3. Create Gallery Images

Create 3-5 screenshots (1440x900 PNG):
- `1.jpg` - Dashboard/wallet overview
- `2.jpg` - Transaction list
- `3.jpg` - Send transaction / PSBT creation
- `4.jpg` - Hardware wallet connection
- `5.jpg` - Settings/admin panel

### 4. Test on Umbrel

Test the app on actual Umbrel hardware:
- Raspberry Pi 4 with umbrelOS
- Umbrel Home
- x86 Linux system with umbrelOS

## Submission Process

1. **Fork** https://github.com/getumbrel/umbrel-apps

2. **Create directory** `sanctuary/` in your fork

3. **Copy files** from this directory:
   ```bash
   cp umbrel-app.yml docker-compose.yml exports.sh icon.svg /path/to/umbrel-apps/sanctuary/
   ```

4. **Add gallery images** to `sanctuary/` directory

5. **Open Pull Request** with this template:

   ```markdown
   ## App Submission: Sanctuary

   ### App Details
   - **Name:** Sanctuary
   - **Category:** Bitcoin
   - **Version:** 0.8.7
   - **Port:** 3010

   ### Description
   Self-hosted Bitcoin wallet coordinator for hardware wallets. Watch-only wallet
   management with multi-user support, PSBT signing, and real-time blockchain sync.

   ### Testing
   - [ ] Tested on Raspberry Pi 4
   - [ ] Tested on Umbrel Home
   - [ ] Tested on x86 Linux

   ### Checklist
   - [x] App has a `umbrel-app.yml` manifest
   - [x] App has a `docker-compose.yml`
   - [x] App has a 256x256 SVG icon
   - [x] App has 3-5 gallery images (1440x900)
   - [x] Docker images are multi-arch (amd64 + arm64)
   - [x] Docker images are pinned to SHA256 digests
   - [x] App works with electrs dependency
   ```

## IP Address Assignment

Umbrel will likely adjust these IP addresses during review:

| Service | IP Address |
|---------|------------|
| web | 10.21.22.50 |
| server | 10.21.22.51 |
| db | 10.21.22.52 |
| migrate | 10.21.22.53 |
| redis | 10.21.22.54 |
| worker | 10.21.22.55 |

## Dependencies

Sanctuary requires **electrs** (Electrum server) to be installed on Umbrel. This provides:
- `APP_ELECTRS_NODE_IP` - Electrum server IP
- `APP_ELECTRS_NODE_PORT` - Electrum server port (50001)

## Alternative: Community App Store

If you want to distribute Sanctuary without going through official review:

1. Create a GitHub repository for your app store
2. Follow the Umbrel community app store format
3. Users can add your store via Umbrel Settings → App Stores → Add

See: https://github.com/getumbrel/umbrel-apps#community-app-stores
