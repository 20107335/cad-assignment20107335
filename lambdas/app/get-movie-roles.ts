import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  actorKey,
  ddb,
  isRoleItem,
  movieKey,
  parseId,
  tableName,
  toRole,
} from "../shared/db";
import { response } from "../shared/http";
import { logRequest } from "../shared/request-logger";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  logRequest(event);

  const movieId = parseId(event.pathParameters?.movieID);
  if (movieId === undefined) {
    return response(400, { message: "movieID must be a positive integer" });
  }

  // Issue: ?actor= was ignored. Read it and reject anything that isn't a positive integer
  const actorParam = event.queryStringParameters?.actor;
  const actorId = parseId(actorParam);
  if (actorParam !== undefined && actorId === undefined) {
    return response(400, { message: "actor must be a positive integer" });
  }

  try {
     // If an actor is given, fetch that one role directly by its key.
    // 404 if the actor has no role in the movie. Otherwise fall through and return all roles.
    if (actorId !== undefined) {
      // A role's key is movieID/actorID, so it can be fetched directly.
      const roleResult = await ddb.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: movieKey(movieId), SK: actorKey(actorId) },
        })
      );
      if (!roleResult.Item) {
        return response(404, {
          message: `Actor ${actorId} has no role in movie ${movieId}`,
        });
      }
      return response(200, { data: toRole(roleResult.Item) });
    }

    const queryResult = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": movieKey(movieId) },
        // ExclusiveStartKey: lastKey,
      })
    );

    const resultItems = queryResult.Items ?? [];
    return response(200, { data: resultItems.filter(isRoleItem).map(toRole) });
  } catch (err) {
    console.error("DynamoDB error:", err);
    return response(500, {
      message: "Internal server error",
      error: err,
    });
  }
};