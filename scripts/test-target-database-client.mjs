import postgres from "postgres";

export function createTestTargetDatabaseClient(
  databaseUrl,
  max,
  { caCertificate, clientFactory = postgres, persistent = false } = {},
) {
  if (typeof caCertificate !== "string" || caCertificate.length === 0) {
    throw new Error("Greenfield TEST database CA is invalid");
  }
  return clientFactory(databaseUrl, {
    prepare: false,
    ssl: { ca: caCertificate, rejectUnauthorized: true },
    max,
    idle_timeout: persistent ? null : 5,
    connect_timeout: 10,
    max_lifetime: persistent ? null : 120,
    onnotice: () => {},
    connection: { application_name: "gioia_greenfield_test" },
  });
}

export async function endTestTargetDatabaseClient(client) {
  await client.end({ timeout: 5 });
}
