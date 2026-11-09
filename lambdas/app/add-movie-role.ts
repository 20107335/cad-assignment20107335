import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import type { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { actorKey, ddb, movieKey, parseId, type Role, tableName } from "../shared/db";
import { isResponse, parseJsonObject, response } from "../shared/http";
import { logRequest } from "../shared/request-logger";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  logRequest(event);

  const body = parseJsonObject(event);
  if (isResponse(body)) return body;

  // Issue 9: the body was cast to a Role without any checks, so bad input was saved.
  const role = parseRole(body);
  if (isResponse(role)) return role;

  try {
    // Issue 8: the role was never saved - the handler returned 201 without writing to DynamoDB.
    // Issue 10: the movie and actor weren't checked and duplicates overwrote existing roles.
    // One transaction: the movie and actor must exist and the role must not, or nothing is written.
    // The order of these items matters, failedCheckResponse maps failures by index.
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            ConditionCheck: {
              TableName: tableName,
              Key: { PK: movieKey(role.movieId), SK: movieKey(role.movieId) },
              ConditionExpression: "attribute_exists(PK)",
            },
          },
          {
            ConditionCheck: {
              TableName: tableName,
              Key: { PK: actorKey(role.actorId), SK: actorKey(role.actorId) },
              ConditionExpression: "attribute_exists(PK)",
            },
          },
          {
            Put: {
              TableName: tableName,
              Item: { PK: movieKey(role.movieId), SK: actorKey(role.actorId), ...role },
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
        ],
      })
    );
    return response(201, { message: "Role added", data: role });
  } catch (err) {
    const failedCheck = failedCheckResponse(err, role);
    if (failedCheck) return failedCheck;

    console.error("DynamoDB error:", err);
    return response(500, {
      message: "Internal server error",
      error: err,
    });
  }
};

// Maps a cancelled transaction to 404 (movie/actor missing) or 409 (role already exists).
// CancellationReasons are in the same order as TransactItems: movie, actor, role.
const failedCheckResponse = (
  err: unknown,
  role: Role
): APIGatewayProxyResult | undefined => {
  if ((err as Error).name !== "TransactionCanceledException") return undefined;
  const reasons = (err as TransactionCanceledException).CancellationReasons ?? [];
  const failed = (index: number) => reasons[index]?.Code === "ConditionalCheckFailed";

  if (failed(0)) return response(404, { message: `Movie ${role.movieId} not found` });
  if (failed(1)) return response(404, { message: `Actor ${role.actorId} not found` });
  if (failed(2)) {
    return response(409, {
      message: `Actor ${role.actorId} already has a role in movie ${role.movieId}`,
    });
  }
  return undefined;
};

// Validates the request body. Returns the Role, or a 400 response listing the invalid fields.
const parseRole = (body: Record<string, unknown>): Role | APIGatewayProxyResult => {
  const movieId = parseBodyId(body.movieId);
  const actorId = parseBodyId(body.actorId);
  const roleName = parseText(body.roleName);
  const roleDescription = parseText(body.roleDescription);

  if (
    movieId === undefined ||
    actorId === undefined ||
    roleName === undefined ||
    roleDescription === undefined
  ) {
    const invalid = Object.entries({ movieId, actorId, roleName, roleDescription })
      .filter(([, value]) => value === undefined)
      .map(([field]) => field);
    return response(400, { message: `Missing or invalid fields: ${invalid.join(", ")}` });
  }
  return { movieId, actorId, roleName, roleDescription };
};

// IDs may arrive as JSON numbers or numeric strings; either must be a positive integer.
const parseBodyId = (value: unknown): number | undefined =>
  typeof value === "number" || typeof value === "string" ? parseId(String(value)) : undefined;

// A non-empty string, trimmed.
const parseText = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;