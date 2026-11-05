import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  actorKey,
  ddb,
  isMovieItem,
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

  // Issue P1: ?actor= was ignored. Read it and reject anything that isn't a positive integer (400).
  const actorParam = event.queryStringParameters?.actor;
  const actorId = parseId(actorParam);
  if (actorParam !== undefined && actorId === undefined) {
    return response(400, { message: "actor must be a positive integer" });
  }

  try {
    // If an actor is given, fetch that one role directly by its key (movieID | actorID);
    // 404 if the actor has no role in the movie. Otherwise fall through and return all roles.
    if (actorId !== undefined) {
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

    const resultItems = await queryMovieItems(movieId);

    // Issue 3: an unknown movie returned 200 with an empty list.
    // The movie item shares the partition with its roles, so if it's missing the movie doesn't exist.
    if (!resultItems.some(isMovieItem)) {
      return response(404, { message: `Movie ${movieId} not found` });
    }
    return response(200, { data: resultItems.filter(isRoleItem).map(toRole) });
  } catch (err) {
    console.error("DynamoDB error:", err);
    return response(500, {
      message: "Internal server error",
      error: err,
    });
  }
};

// Issue P2: only the first page of query results was read.
// Follow LastEvaluatedKey until DynamoDB has returned every item in the movie's partition.
const queryMovieItems = async (movieId: number) => {
  const items: Record<string, any>[] = [];
  let lastKey: Record<string, any> | undefined;
  do {
    const result = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": movieKey(movieId) },
        ExclusiveStartKey: lastKey,
      })
    );
    items.push(...(result.Items ?? []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return items;
};