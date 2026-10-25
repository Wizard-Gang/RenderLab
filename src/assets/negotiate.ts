// Contract-version and required-feature negotiation (specification §8.1 step 6, §11.5). A bundle names the contracts
// it needs; the consuming adapter names the contracts and versions it renders. Every unmet requirement is reported
// together, with what is supported instead, so the fix (re-export, or a newer reader) is clear from one attempt.

export interface ContractRef {
  readonly key: string;
  readonly version: number;
}

/** Contract key → the versions a reader renders. */
export type ContractSupport = ReadonlyMap<string, readonly number[]>;

export interface UnsupportedContract extends ContractRef {
  /** The versions of this key the reader supports; empty when it knows none. */
  readonly supported: readonly number[];
  readonly reason: string;
}

export interface CompatibilityReport {
  readonly compatible: boolean;
  readonly required: readonly ContractRef[];
  readonly unsupported: readonly UnsupportedContract[];
}

/** Builds support from `key@version` strings, e.g. `["maplab.map@1", "maplab.camera@1"]`. */
export function contractSupport(entries: Iterable<string>): ContractSupport {
  const support = new Map<string, number[]>();
  for (const entry of entries) {
    const match = /^(.+)@([1-9][0-9]*)$/.exec(entry);
    if (!match) throw new TypeError(`${JSON.stringify(entry)} is not key@version`);
    const versions = support.get(match[1]!) ?? [];
    if (!versions.includes(Number(match[2]))) versions.push(Number(match[2]));
    support.set(match[1]!, versions.sort((left, right) => left - right));
  }
  return support;
}

function reason({ key, version }: ContractRef, supported: readonly number[]): string {
  if (supported.length === 0) {
    return `${key} v${version} is required, but this reader supports no version of ${key}; use a reader that supports it or export without it`;
  }
  const versions = supported.map((value) => `v${value}`).join(", ");
  return `${key} v${version} is required, but this reader supports ${key} ${versions}; re-export for a supported version or use a reader that supports v${version}`;
}

export function negotiate(required: readonly ContractRef[], support: ContractSupport): CompatibilityReport {
  const unsupported = required.flatMap((contract): UnsupportedContract[] => {
    const supported = support.get(contract.key) ?? [];
    return supported.includes(contract.version) ? [] : [{ ...contract, supported, reason: reason(contract, supported) }];
  });
  return { compatible: unsupported.length === 0, required, unsupported };
}
