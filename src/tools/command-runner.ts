import { execSync } from 'child_process';

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}

export function runCommand(command: string, cwd: string, timeoutMs = 120_000): CommandResult {
  try {
    const stdout = execSync(command, {
      cwd,
      timeout: timeoutMs,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout: stdout.toString(), stderr: '', exitCode: 0, success: true };
  } catch (error) {
    const err = error as { stdout?: Buffer; stderr?: Buffer; status?: number };
    return {
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? String(error),
      exitCode: err.status ?? 1,
      success: false,
    };
  }
}
