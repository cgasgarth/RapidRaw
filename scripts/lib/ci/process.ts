const textDecoder = new TextDecoder();

const decodePipe = (value) => textDecoder.decode(value ?? new Uint8Array()).trim();

export const runText = (command, args = [], options = {}) => {
  const result = Bun.spawnSync({
    cmd: [command, ...args],
    cwd: options.cwd,
    stderr: 'pipe',
    stdout: 'pipe',
  });

  if (result.exitCode !== 0) {
    const stderr = decodePipe(result.stderr);
    const stdout = decodePipe(result.stdout);
    throw new Error(`${command} ${args.join(' ')} failed: ${stderr || stdout || `exit ${result.exitCode}`}`);
  }

  return decodePipe(result.stdout);
};

export const runQuiet = (command, args = [], options = {}) => {
  runText(command, args, options);
};
