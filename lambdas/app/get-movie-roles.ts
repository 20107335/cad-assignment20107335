import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
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

  // Issue 2: ?actor= was ignored. Read it and reject anything that isn't a positive integer (400).
  const actorParam = event.queryStringParameters?.actor;
  const actorId = parseId(actorParam);
  if (actorParam !== undefined && actorId === undefined) {
    return response(400, { message: "actor must be a positive integer" });
  }

  try {
    const resultItems = await queryMovieItems(movieId);

    // Issue 3: an unknown movie returned 200 with an empty list.
    // Issue 14: this check now also covers ?actor=, which previously blamed the actor instead.
    // The movie item shares the partition with its roles, so if it's missing the movie doesn't exist.
    if (!resultItems.some(isMovieItem)) {
      return response(404, { message: `Movie ${movieId} not found` });
    }

    const roles = resultItems.filter(isRoleItem).map(toRole);
    if (actorId === undefined) {
      return response(200, { data: roles });
    }

    const role = roles.find((r) => r.actorId === actorId);
    if (!role) {
      return response(404, {
        message: `Actor ${actorId} has no role in movie ${movieId}`,
      });
    }
    return response(200, { data: role });
  } catch (err) {
    // Issue 12: the raw error was returned to the caller. It is logged to CloudWatch instead.
    console.error("DynamoDB error:", err);
    return response(500, { message: "Internal server error" });
  }
};

// Issue 3: only the first page of query results was read.
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