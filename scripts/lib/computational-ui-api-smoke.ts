type CommandBuilder<TCommand> = (...args: Array<unknown>) => TCommand;

interface InvalidSmokeCase {
  message: string;
  run: () => unknown;
}

interface ComputationalUiApiSmokeConfig<TDryRunCommand, TApplyCommand> {
  assertApplyCommand: (command: TApplyCommand, failures: Array<string>) => void;
  assertDryRunCommand: (command: TDryRunCommand, failures: Array<string>) => void;
  buildApplyCommand: CommandBuilder<TApplyCommand>;
  buildDryRunCommand: CommandBuilder<TDryRunCommand>;
  invalidCases: ReadonlyArray<InvalidSmokeCase>;
  label: string;
  validApplyArgs: Array<unknown>;
  validDryRunArgs: Array<unknown>;
}

const runBuilder = <TCommand>(builder: CommandBuilder<TCommand>, args: Array<unknown>): TCommand => builder(...args);

export const runComputationalUiApiSmoke = <TDryRunCommand, TApplyCommand>({
  assertApplyCommand,
  assertDryRunCommand,
  buildApplyCommand,
  buildDryRunCommand,
  invalidCases,
  label,
  validApplyArgs,
  validDryRunArgs,
}: ComputationalUiApiSmokeConfig<TDryRunCommand, TApplyCommand>): void => {
  const failures: Array<string> = [];
  assertDryRunCommand(runBuilder(buildDryRunCommand, validDryRunArgs), failures);
  assertApplyCommand(runBuilder(buildApplyCommand, validApplyArgs), failures);

  for (const invalidCase of invalidCases) {
    let blocked = false;
    try {
      invalidCase.run();
    } catch {
      blocked = true;
    }
    if (!blocked) failures.push(invalidCase.message);
  }

  if (failures.length > 0) {
    console.error(failures.join('\n'));
    throw new Error(`${label} UI/API validation failed.`);
  }

  console.log(`${label} UI/API ok`);
};
