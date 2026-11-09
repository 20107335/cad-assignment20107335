import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
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
    // Store it under the spec's role key: PK = m#movieID, SK = a#actorID.
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: tableName,
              Item: { PK: movieKey(role.movieId), SK: actorKey(role.actorId), ...role },
            },
          },
        ],
      })
    );
    return response(201, { message: "Role added", data: role });
  } catch (err) {
    console.error("DynamoDB error:", err);
    return response(500, {
      message: "Internal server error",
      error: err,
    });
  }
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