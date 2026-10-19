/** A rejected contract value: every failure is reported at once, each naming the path of the offending field. */
export class ContractError extends Error {
  readonly failures: readonly string[];

  constructor(subject: string, failures: readonly string[]) {
    super(`${subject} is invalid:\n- ${failures.join("\n- ")}`);
    this.name = "ContractError";
    this.failures = Object.freeze([...failures]);
  }
}

/** Collects failures while validating, then throws them together. */
export class Failures {
  readonly list: string[] = [];

  add(path: string, message: string): void {
    this.list.push(`${path}: ${message}`);
  }

  get empty(): boolean {
    return this.list.length === 0;
  }

  throwIfAny(subject: string): void {
    if (this.list.length > 0) throw new ContractError(subject, this.list);
  }
}
