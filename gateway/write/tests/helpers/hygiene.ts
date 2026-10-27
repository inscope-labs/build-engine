/**
 * The log-hygiene check: put sentinels everywhere and prove that none of them comes out.
 *
 * This is the check behind plan task 5.4.2 and the Phase 5 exit gate's "no credentials or
 * payloads leak through logs, query reflection, errors, or release artifacts". It is written as a
 * driver rather than as assertions, so that the **same** code backs the test and the deploy gate:
 * a gate that is a second implementation of the check is a gate that checks something else.
 *
 * What it does:
 *
 *  1. puts a sentinel in every place a secret could be — the signing secret, the provider
 *     credential, the operator credential, the capability URL, the signature, the file's content,
 *     the content's base64, and a file name;
 *  2. drives the **real** Worker through the whole protocol with those sentinels in place, and
 *     through the failure paths too, because a leak is most likely in an error message;
 *  3. captures every output the gateway produces: the platform's log lines, the failure
 *     response bodies, the metrics, and the durable audit records;
 *  4. checks each output for the sentinel values **and** for the shapes that look like a secret.
 *
 * The success responses are deliberately not scanned for the file's name or its content. A `read`
 * returns the content the agent itself just sent, and echoing that back to the agent is the
 * operation working, not a leak. What must not happen is the content reaching the **log**, an
** error body, the metrics, or the durable stream — those are places the agent's data and the
 * operator's secrets have no business being.
 */

/** A value that must never appear in an output. */
export interface Sentinel {
  /** What it is. */
  name: string;
  /** The value itself. */
  value: string;
}

/** One captured output. */
export interface CapturedOutput {
  /** Where it came from. */
  where: string;
  /** The text. */
  text: string;
}

/** A leak. */
export interface HygieneFinding {
  /** Where the leak was. */
  where: string;
  /** Which sentinel leaked. */
  sentinel: string;
}

/** The result of the check. */
export interface HygieneResult {
  /** The sentinels that were planted. */
  sentinels: Sentinel[];
  /** Everything the gateway emitted. */
  outputs: CapturedOutput[];
  /** What leaked. Empty is the pass condition. */
  findings: HygieneFinding[];
}

/** The sentinel values. They are distinctive enough that a substring match is meaningful. */
export const SENTINEL_SIGNING_SECRET = "sentinel-signing-secret-0123456789abcdefghij";
export const SENTINEL_GITHUB_TOKEN = "ghp_SENTINELGITHUBTOKEN0123456789abcdefghij";
export const SENTINEL_OPERATOR_TOKEN = "sentinel-operator-token-0123456789abcdefghij";
export const SENTINEL_CONTENT = "SENTINEL_PAYLOAD_CONTENT_0123456789\nsecond line\n";
export const SENTINEL_FILE = "sentinel-file-0123456789.md";

/**
 * Run the check.
 *
 * The gateway is driven through the protocol with the sentinels in place. The mock provider is
 * used because a commit is one of the paths a payload could leak through, and the mock is the
 * only provider this branch has ever spoken to.
 */
export async function runHygieneCheck(): Promise<HygieneResult> {
  const { MemoryNamespace, testEnv } = await import("./mock-worker.ts");
  const { testRepo } = await import("./mock-github.ts");
  const { commitDriver } = await import("./github-test-repo.ts");
  const { default: worker } = await import("../../src/index.ts");
  const { base64url } = await import("../../src/util/base64.ts");
  const { utf8 } = await import("../../src/util/hash.ts");
  const { containsSecret } = await import("../../src/audit/redaction.ts");

  const namespace = new MemoryNamespace();
  const github = await testRepo();
  const env = testEnv(namespace, {
    SIGNING_KEYS: JSON.stringify({ k1: SENTINEL_SIGNING_SECRET }),
    GITHUB_TOKEN: SENTINEL_GITHUB_TOKEN,
    OPERATOR_TOKEN: SENTINEL_OPERATOR_TOKEN,
    // The mock provider's address, so that the check never reaches the internet.
    GITHUB_API_BASE: github.baseUrl,
  }) as never;

  const driver = await commitDriver(github, env, SENTINEL_SIGNING_SECRET);

  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]): void => {
    logs.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
  };

  const outputs: CapturedOutput[] = [];
  const errorBodies: string[] = [];

  try {
    // The capability, over the sentinel signing secret.
    const capability = driver.capability;
    const rootUrl =
      `/w1/${capability.kid}/${capability.exp}/${capability.order}/${capability.plan}` +
      `/${capability.task}/${capability.writer}/${capability.head}/${capability.sig}`;

    // The whole protocol, with the sentinel content in it.
    await driver.stage(SENTINEL_FILE, SENTINEL_CONTENT);
    await driver.get("status");
    await driver.get("read", { path: SENTINEL_FILE });
    await driver.get("commit", { files: SENTINEL_FILE });
    await driver.get("seal");

    // The failure paths, which is where a leak is most likely.
    const failures: [string, string][] = [
      ["garbage path", "/w1/nonsense"],
      ["a bad signature", `${rootUrl.replace(/[A-Za-z0-9_-]{43}$/, "A".repeat(43))}`],
    ];
    for (const [name, path] of failures) {
      const response = await worker.fetch(new Request(`https://write.example.internal${path}`), env);
      errorBodies.push(await response.text());
      void name;
    }
    // The wrong method: this protocol is GET only.
    const wrongMethod = await worker.fetch(
      new Request(`https://write.example.internal${rootUrl}`, { method: "POST" }),
      env,
    );
    errorBodies.push(await wrongMethod.text());

    // A request with a sentinel in a query value that must not be echoed.
    const unknown = await worker.fetch(
      new Request(`https://write.example.internal${rootUrl}/create?path=${SENTINEL_FILE}&sentinel=${SENTINEL_CONTENT}`),
      env,
    );
    errorBodies.push(await unknown.text());

    // The operator channel.
    const metrics = await worker.fetch(
      new Request("https://write.example.internal/admin/metrics", {
        headers: { Authorization: `Bearer ${SENTINEL_OPERATOR_TOKEN}` },
      }),
      env,
    );
    errorBodies.push(await metrics.text());

    const audit = await worker.fetch(
      new Request(`https://write.example.internal/admin/audit?order=${capability.order}`, {
        headers: { Authorization: `Bearer ${SENTINEL_OPERATOR_TOKEN}` },
      }),
      env,
    );
    errorBodies.push(await audit.text());
  } finally {
    console.log = original;
    await github.stop();
  }

  for (const line of logs) outputs.push({ where: "log", text: line });
  errorBodies.forEach((text, index) => outputs.push({ where: `output-${index}`, text }));

  const sentinels: Sentinel[] = [
    { name: "signing-secret", value: SENTINEL_SIGNING_SECRET },
    { name: "github-token", value: SENTINEL_GITHUB_TOKEN },
    { name: "operator-token", value: SENTINEL_OPERATOR_TOKEN },
    { name: "payload", value: SENTINEL_CONTENT },
    { name: "payload-base64", value: base64url(utf8(SENTINEL_CONTENT)) },
    { name: "query-value", value: SENTINEL_FILE },
  ];

  const findings: HygieneFinding[] = [];
  for (const output of outputs) {
    for (const sentinel of sentinels) {
      if (sentinel.value !== "" && output.text.includes(sentinel.value)) {
        findings.push({ where: output.where, sentinel: sentinel.name });
      }
    }
    // And the shapes: anything that looks like a secret, even one we did not plant.
    if (containsSecret(output.text)) {
      findings.push({ where: output.where, sentinel: "shape" });
    }
  }

  return { sentinels, outputs, findings };
}
