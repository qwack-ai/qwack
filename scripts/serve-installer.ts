#!/usr/bin/env bun
import { networkInterfaces } from "os"
import { existsSync } from "fs"
import { resolve, join } from "path"

const PORT = parseInt(process.env.INSTALLER_PORT ?? "80", 10)
const QWACK_PORT = parseInt(process.env.QWACK_PORT ?? "4000", 10)
const DIST_DIR = resolve(import.meta.dir, "../packages/opencode/dist")

function getLanIP(): string {
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address
    }
  }
  return "localhost"
}

const HOST_IP = getLanIP()
const SERVER_URL = `http://${HOST_IP}:${QWACK_PORT}`
const INSTALLER_URL = `http://${HOST_IP}${PORT === 80 ? "" : `:${PORT}`}`

const PLATFORMS: Record<string, { dir: string; binary: string }> = {
  "linux-x64": { dir: "opencode-linux-x64", binary: "qwack" },
  "linux-arm64": { dir: "opencode-linux-arm64", binary: "qwack" },
  "darwin-arm64": { dir: "opencode-darwin-arm64", binary: "qwack" },
  "darwin-x64": { dir: "opencode-darwin-x64", binary: "qwack" },
  "win-x64": { dir: "opencode-windows-x64", binary: "qwack.exe" },
}

function availablePlatforms(): string[] {
  return Object.entries(PLATFORMS)
    .filter(([_, v]) => existsSync(join(DIST_DIR, v.dir, "bin", v.binary)))
    .map(([k]) => k)
}

const INSTALL_SH = `#!/usr/bin/env bash
set -euo pipefail

echo "🦆 Qwack Installer"
echo ""

OS=\$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=\$(uname -m)
case "\$ARCH" in
  x86_64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
esac

PLATFORM="\${OS}-\${ARCH}"
case "\$OS" in
  darwin) PLATFORM="darwin-\${ARCH}" ;;
  linux)  PLATFORM="linux-\${ARCH}" ;;
  *)      echo "Unsupported OS: \$OS"; exit 1 ;;
esac

echo "Detected: \$PLATFORM"

INSTALL_DIR="\$HOME/.local/bin"
mkdir -p "\$INSTALL_DIR"

echo "Downloading qwack binary..."
curl -fsSL "${INSTALLER_URL}/download/\$PLATFORM" -o "\$INSTALL_DIR/qwack"
chmod +x "\$INSTALL_DIR/qwack"

mkdir -p "\$HOME/.config/qwack"
echo '{"server":"${SERVER_URL}"}' > "\$HOME/.config/qwack/auth.json"

echo ""
echo "✅ Qwack installed!"
echo "   Binary: \$INSTALL_DIR/qwack"
echo "   Server: ${SERVER_URL}"
echo ""
echo "Run:  qwack"
echo "Then: /qwack login"
echo ""
if [[ ":\$PATH:" != *":\$INSTALL_DIR:"* ]]; then
  echo "⚠  Add to your PATH first:"
  echo "   export PATH=\\"\\\$HOME/.local/bin:\\\$PATH\\""
  echo ""
fi
`

const INSTALL_PS1 = [
  'Write-Host "🦆 Qwack Installer" -ForegroundColor Yellow',
  'Write-Host ""',
  '',
  '$Arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }',
  '$Platform = "win-$Arch"',
  'Write-Host "Detected: $Platform"',
  '',
  '$InstallDir = "$env:LOCALAPPDATA\\qwack"',
  'New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null',
  '',
  'Stop-Process -Name qwack -Force -ErrorAction SilentlyContinue',
  'Start-Sleep -Milliseconds 500',
  '',
  'Write-Host "Downloading qwack binary..."',
  `Invoke-WebRequest -Uri "${INSTALLER_URL}/download/$Platform" -OutFile "$InstallDir\\qwack.exe"`,
  '',
  '$AuthDir = "$env:USERPROFILE\\.config\\qwack"',
  'New-Item -ItemType Directory -Force -Path $AuthDir | Out-Null',
  `'{"server":"${SERVER_URL}"}' | Set-Content "$AuthDir\\auth.json"`,
  '',
  '$CurrentPath = [Environment]::GetEnvironmentVariable("Path", "User")',
  'if ($CurrentPath -notlike "*$InstallDir*") {',
  '    [Environment]::SetEnvironmentVariable("Path", "$CurrentPath;$InstallDir", "User")',
  '    $env:Path = "$env:Path;$InstallDir"',
  '    Write-Host "Added $InstallDir to PATH" -ForegroundColor Cyan',
  '}',
  '',
  'Write-Host ""',
  'Write-Host "✅ Qwack installed!" -ForegroundColor Green',
  'Write-Host "   Binary: $InstallDir\\qwack.exe"',
  `Write-Host "   Server: ${SERVER_URL}"`,
  'Write-Host ""',
  'Write-Host "Run:  qwack"',
  'Write-Host "Then: /qwack login"',
].join("\n")

function isWindows(ua: string): boolean {
  return /powershell|windowspowershell/i.test(ua) || /Windows NT/i.test(ua)
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const ua = req.headers.get("user-agent") ?? ""

    if (url.pathname === "/install") {
      if (isWindows(ua)) {
        return new Response(INSTALL_PS1, { headers: { "Content-Type": "text/plain; charset=utf-8" } })
      }
      return new Response(INSTALL_SH, { headers: { "Content-Type": "text/plain; charset=utf-8" } })
    }

    if (url.pathname === "/install.sh") {
      return new Response(INSTALL_SH, { headers: { "Content-Type": "text/plain; charset=utf-8" } })
    }

    if (url.pathname === "/install.ps1") {
      return new Response(INSTALL_PS1, { headers: { "Content-Type": "text/plain; charset=utf-8" } })
    }

    if (url.pathname.startsWith("/download/")) {
      const platform = url.pathname.replace("/download/", "")
      const entry = PLATFORMS[platform]
      if (!entry) {
        return new Response(`Unknown platform: ${platform}\nAvailable: ${availablePlatforms().join(", ")}`, { status: 404 })
      }
      const binaryPath = join(DIST_DIR, entry.dir, "bin", entry.binary)
      const file = Bun.file(binaryPath)
      if (!await file.exists()) {
        return new Response(`Binary not built for ${platform}. Run: bun run build --single`, { status: 404 })
      }
      return new Response(file, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${entry.binary}"`,
        },
      })
    }

    if (url.pathname === "/health") {
      return Response.json({ status: "ok", server: SERVER_URL, platforms: availablePlatforms() })
    }

    const available = availablePlatforms()
    return new Response(
      `🦆 Qwack Installer\n\n` +
      `Mac/Linux:  curl -fsSL http://${HOST_IP}/install | sh\n` +
      `Windows:    irm http://${HOST_IP}/install | iex\n\n` +
      `Available binaries: ${available.length > 0 ? available.join(", ") : "none — run 'bun run build' first"}\n`,
      { headers: { "Content-Type": "text/plain" } },
    )
  },
})

const available = availablePlatforms()
console.log(`\n🦆 Qwack Installer Server`)
console.log(`   ${INSTALLER_URL}`)
console.log(`   Qwack server: ${SERVER_URL}`)
console.log(`   Binaries: ${available.length > 0 ? available.join(", ") : "none — run 'bun run build' first"}`)
console.log(`\nFriends run:`)
console.log(`   Mac/Linux:  curl -fsSL http://${HOST_IP}/install | sh`)
console.log(`   Windows:    irm http://${HOST_IP}/install | iex`)
console.log(``)
