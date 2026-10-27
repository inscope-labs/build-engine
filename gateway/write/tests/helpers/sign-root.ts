/**
 * Signing capabilities for the tests.
 *
 * The tests mint real capabilities with the **shipped** signing code, so that a test can never
 * pass against a signer that differs from the one the gateway verifies with. The secret is a
 * test-only secret and is never a real one.
 */
import { sign } from "../../src/auth/signature.ts";
import type { Capability } from "../../src/types/requests.ts";

/** The test signing secret. A test-only secret, never a real one. */
export const TEST_SECRET = "test-only-signing-secret-do-not-use-anywhere-else";

/** The key id used by the tests. */
export const TEST_KID = "k1";

/**
 * The pinned test clock, in unix seconds.
 *
 * The contract's expiry boundary is inclusive and the maximum lifetime is enforced against the
 * gateway's own clock, so a test that used the wall clock would be flaky. The test environment
 * pins the clock, and the default capability is minted relative to it.
 */
export const TEST_NOW = 1_800_000_000;

/** A 40-hex commit sha, for the expected head. */
export const TEST_HEAD = "a".repeat(40);

/** The fields of a test capability. */
export interface TestCapabilityFields {
  kid?: string;
  exp?: number;
  order?: string;
  plan?: string;
  task?: string;
  writer?: string;
  head?: string;
  secret?: string;
}

/** The fields a test capability has, with the defaults filled in. */
export function capabilityFields(fields: TestCapabilityFields = {}): Required<Omit<TestCapabilityFields, "secret">> {
  return {
    kid: fields.kid ?? TEST_KID,
    exp: fields.exp ?? TEST_NOW + 3600,
    order: fields.order ?? "10008-S001",
    plan: fields.plan ?? "castiel-dev",
    task: fields.task ?? "10008-1-001-01",
    writer: fields.writer ?? "agent-7",
    head: fields.head ?? TEST_HEAD,
  };
}

/** Sign a capability and return its parts. */
export async function signedCapability(fields: TestCapabilityFields = {}): Promise<{
  capability: Capability;
  secret: string;
}> {
  const secret = fields.secret ?? TEST_SECRET;
  const parts = capabilityFields(fields);
  const sig = await sign(secret, parts);
  return { capability: { ...parts, sig }, secret };
}

/** The path of a capability, with the operation appended when there is one. */
export function capabilityPath(capability: Capability, operation?: string): string {
  const base =
    `/w1/${capability.kid}/${capability.exp}/${capability.order}/${capability.plan}` +
    `/${capability.task}/${capability.writer}/${capability.head}/${capability.sig}`;
  return operation === undefined ? base : `${base}/${operation}`;
}
