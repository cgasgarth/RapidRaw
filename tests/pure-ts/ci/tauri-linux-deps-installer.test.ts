import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

const installer = resolve(import.meta.dir, '../../../.github/actions/install-tauri-linux-deps/install.sh');

function runPolicy(body: string) {
  return Bun.spawnSync(['bash', '-c', `source "$1"\n${body}`, 'installer-policy-test', installer], {
    env: { ...process.env, RAPIDRAW_RETRY_DELAY_SECONDS: '0' },
    stderr: 'pipe',
    stdout: 'pipe',
  });
}

describe('Tauri Linux dependency installer retry policy', () => {
  test('resumes once after a timeout and returns the successful attempt', () => {
    const result = runPolicy(`
invocations=0
flaky_install() {
  invocations=$((invocations + 1))
  [[ $invocations -eq 2 ]]
}
run_bounded_retry 2 flaky_install
printf '%s' "$invocations"
`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe('2');
  });

  test('stops after the bounded attempt count and preserves the failure status', () => {
    const result = runPolicy(`
invocations=0
failed_install() {
  invocations=$((invocations + 1))
  return 124
}
set +e
run_bounded_retry 2 failed_install
status=$?
set -e
printf '%s:%s' "$invocations" "$status"
`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe('2:124');
  });
});
