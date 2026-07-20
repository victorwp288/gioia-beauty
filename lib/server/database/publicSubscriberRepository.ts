import "server-only";

import { z } from "zod";

import {
  IdempotencyKeySchema,
  IsoInstantSchema,
  NewsletterActionPurposeSchema,
  PositiveVersionSchema,
  PublicSubscribeCommandSchema,
  UuidSchema,
  isNewsletterActionTokenKeyId,
} from "@/lib/domain/schemas/index.ts";

import { createRuntimeDatabase, type RuntimeDatabase } from "./runtime.ts";

const HashSchema = z
  .custom<Buffer>(
    (value) => Buffer.isBuffer(value) && value.byteLength === 32,
    "Expected a 32-byte hash",
  )
  .transform((value) => Buffer.from(value));

const commandContextFields = {
  principalScopeHash: HashSchema,
  requestFingerprint: HashSchema,
};

const SubscribeInputSchema = z
  .object({
    ...commandContextFields,
    command: PublicSubscribeCommandSchema,
  })
  .strict();

const SubscriberActionClaimsSchema = z
  .object({
    version: z.literal(1),
    purpose: NewsletterActionPurposeSchema,
    tokenId: UuidSchema,
    subscriberId: UuidSchema,
    subscriberVersion: PositiveVersionSchema,
    issuedAt: IsoInstantSchema,
    expiresAt: IsoInstantSchema,
  })
  .strict();

const SubscriberActionInputSchema = z
  .object({
    ...commandContextFields,
    idempotencyKey: IdempotencyKeySchema,
    claims: SubscriberActionClaimsSchema,
    signingKeyId: z.string().refine(isNewsletterActionTokenKeyId),
  })
  .strict();

const RawCommandRowSchema = z
  .object({
    http_status: z.number().int(),
    result: z.object({ code: z.string() }).strict(),
    replayed: z.boolean(),
  })
  .strict();

const SUBSCRIBE_QUERY = `
  select command.http_status, command.result, command.replayed
  from gioia_private.subscribe_public_newsletter(
    $1::bytea, $2::text, $3::bytea, $4::text
  ) as command
  limit 2
`;

const CONFIRM_QUERY = `
  select command.http_status, command.result, command.replayed
  from gioia_private.confirm_public_newsletter(
    $1::uuid, $2::integer, $3::uuid, $4::integer, $5::timestamptz,
    $6::timestamptz, $7::text, $8::bytea, $9::text, $10::bytea
  ) as command
  limit 2
`;

const UNSUBSCRIBE_QUERY = `
  select command.http_status, command.result, command.replayed
  from gioia_private.unsubscribe_public_newsletter(
    $1::uuid, $2::integer, $3::uuid, $4::integer, $5::timestamptz,
    $6::timestamptz, $7::text, $8::bytea, $9::text, $10::bytea
  ) as command
  limit 2
`;

export type PublicSubscriberAcceptedResult = Readonly<{
  httpStatus: 202;
  code: "REQUEST_ACCEPTED";
  replayed: boolean;
}>;

export type PublicSubscriberCommandResult =
  | PublicSubscriberAcceptedResult
  | Readonly<{
      httpStatus: 400;
      code: "PUBLIC_EMAIL_INVALID";
      replayed: boolean;
    }>;

export interface PublicSubscriberRepository {
  subscribe(input: unknown): Promise<PublicSubscriberCommandResult>;
  confirm(input: unknown): Promise<PublicSubscriberAcceptedResult>;
  unsubscribe(input: unknown): Promise<PublicSubscriberAcceptedResult>;
}

function unexpectedResult(): Error {
  return new Error("Unexpected public subscriber command result");
}

function parseCommandResult(
  rows: Array<Record<string, unknown>>,
  allowEmailFailure: boolean,
): PublicSubscriberCommandResult {
  if (rows.length !== 1 || !rows[0]) throw unexpectedResult();

  const parsed = RawCommandRowSchema.safeParse(rows[0]);
  if (!parsed.success) throw unexpectedResult();

  const { http_status: httpStatus, result, replayed } = parsed.data;
  if (httpStatus === 202 && result.code === "REQUEST_ACCEPTED") {
    return Object.freeze({ httpStatus, code: result.code, replayed });
  }
  if (
    allowEmailFailure &&
    httpStatus === 400 &&
    result.code === "PUBLIC_EMAIL_INVALID"
  ) {
    return Object.freeze({ httpStatus, code: result.code, replayed });
  }
  throw unexpectedResult();
}

async function execute(
  database: Pick<RuntimeDatabase, "transaction">,
  query: string,
  parameters: readonly unknown[],
  allowEmailFailure: boolean,
) {
  const rows = await database.transaction((transaction) =>
    transaction.unsafe(query, parameters),
  );
  return parseCommandResult(rows, allowEmailFailure);
}

export function createPublicSubscriberRepository(
  database: Pick<RuntimeDatabase, "transaction"> = createRuntimeDatabase(),
): PublicSubscriberRepository {
  return {
    async subscribe(input) {
      const parsed = SubscribeInputSchema.parse(input);
      return execute(
        database,
        SUBSCRIBE_QUERY,
        [
          parsed.principalScopeHash,
          parsed.command.idempotencyKey,
          parsed.requestFingerprint,
          parsed.command.email,
        ],
        true,
      );
    },

    async confirm(input) {
      const parsed = SubscriberActionInputSchema.parse(input);
      if (parsed.claims.purpose !== "newsletter_confirm") {
        throw unexpectedResult();
      }
      const result = await execute(
        database,
        CONFIRM_QUERY,
        [
          parsed.claims.subscriberId,
          parsed.claims.subscriberVersion,
          parsed.claims.tokenId,
          parsed.claims.version,
          parsed.claims.issuedAt,
          parsed.claims.expiresAt,
          parsed.signingKeyId,
          parsed.principalScopeHash,
          parsed.idempotencyKey,
          parsed.requestFingerprint,
        ],
        false,
      );
      if (result.httpStatus !== 202) throw unexpectedResult();
      return result;
    },

    async unsubscribe(input) {
      const parsed = SubscriberActionInputSchema.parse(input);
      if (parsed.claims.purpose !== "newsletter_unsubscribe") {
        throw unexpectedResult();
      }
      const result = await execute(
        database,
        UNSUBSCRIBE_QUERY,
        [
          parsed.claims.subscriberId,
          parsed.claims.subscriberVersion,
          parsed.claims.tokenId,
          parsed.claims.version,
          parsed.claims.issuedAt,
          parsed.claims.expiresAt,
          parsed.signingKeyId,
          parsed.principalScopeHash,
          parsed.idempotencyKey,
          parsed.requestFingerprint,
        ],
        false,
      );
      if (result.httpStatus !== 202) throw unexpectedResult();
      return result;
    },
  };
}

export const publicSubscriberRepository = createPublicSubscriberRepository();
