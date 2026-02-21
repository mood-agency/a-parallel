/**
 * Pre-startup script: kills any process holding the server port.
 * Prevents ghost processes from causing dual-listener issues.
 * Runs before `bun --watch` starts the server.
 */
const port = Number(process.argv[2]) || Number(process.env.PORT) || 3001;

function findListeningPids(targetPort: number): number[] {
  const isWindows = process.platform === 'win32';
  try {
    if (isWindows) {
      // Use exact port match to avoid false positives (e.g. :3001 matching :30010)
      const result = Bun.spawnSync(['cmd', '/c', `netstat -ano | findstr :${targetPort} | findstr LISTENING`]);
      const output = result.stdout.toString().trim();
      if (!output) return [];
      const pids = new Set<number>();
      for (const line of output.split('\n')) {
        const parts = line.trim().split(/\s+/);
        // Verify the port matches exactly (local address is parts[1], e.g. "127.0.0.1:3007")
        const localAddr = parts[1] ?? '';
        const addrPort = localAddr.split(':').pop();
        if (addrPort !== String(targetPort)) continue;
        const pid = parseInt(parts[parts.length - 1], 10);
        if (pid && pid !== process.pid) pids.add(pid);
      }
      return [...pids];
    } else {
      const result = Bun.spawnSync(['lsof', '-ti', `:${targetPort}`]);
      const output = result.stdout.toString().trim();
      if (!output) return [];
      return output.split('\n').map(s => parseInt(s, 10)).filter(p => p && p !== process.pid);
    }
  } catch {
    return [];
  }
}

async function killPort(targetPort: number): Promise<void> {
  const isWindows = process.platform === 'win32';
  const pids = findListeningPids(targetPort);
  if (pids.length === 0) {
    console.log(`[kill-port] Port ${targetPort} is free`);
    return;
  }

  for (const pid of pids) {
    console.log(`[kill-port] Killing PID ${pid} on port ${targetPort}`);
    if (isWindows) {
      // /T = kill process tree (children too), /F = force
      const r = Bun.spawnSync(['cmd', '/c', `taskkill /F /T /PID ${pid}`]);
      const out = r.stdout.toString().trim();
      const err = r.stderr.toString().trim();
      if (out) console.log(`[kill-port]   ${out}`);
      if (err) console.log(`[kill-port]   ${err}`);
    } else {
      try { process.kill(pid, 'SIGKILL'); } catch {}
    }
  }

  // Wait until port is actually free (up to 10s)
  for (let i = 0; i < 20; i++) {
    await Bun.sleep(500);
    const remaining = findListeningPids(targetPort);
    if (remaining.length === 0) {
      console.log(`[kill-port] Port ${targetPort} is free`);
      return;
    }
    // On Windows, retry kill for any new/surviving PIDs every 2s
    if (isWindows && i > 0 && i % 4 === 0) {
      for (const pid of remaining) {
        console.log(`[kill-port] Retrying kill for PID ${pid}`);
        Bun.spawnSync(['cmd', '/c', `taskkill /F /T /PID ${pid}`]);
      }
    }
  }

  // Last resort on Windows: kill by port using PowerShell
  if (isWindows) {
    console.log(`[kill-port] Trying PowerShell to free port ${targetPort}...`);
    Bun.spawnSync(['powershell', '-NoProfile', '-Command',
      `Get-NetTCPConnection -LocalPort ${targetPort} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`
    ]);
    await Bun.sleep(1000);
    if (findListeningPids(targetPort).length === 0) {
      console.log(`[kill-port] Port ${targetPort} is free (via PowerShell)`);
      return;
    }
  }

  console.warn(`[kill-port] Port ${targetPort} may still be in use — server will attempt reusePort`);
}

await killPort(port);

export {};
