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

// GET /movies/{movieID}/roles?[actor=actorID]
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  logRequest(event);

  const movieId = parseId(event.pathParameters?.movieID);
  if (movieId === undefined) {
    return response(400, { message: "movieID must be a positive integer" });
  }

  // Optional ?actor= filter, only that actor's role in the movie is returned.
  const actorParam = event.queryStringParameters?.actor;
  const actorId = parseId(actorParam);
  if (actorParam !== undefined && actorId === undefined) {
    return response(400, { message: "actor must be a positive integer" });
  }

  try {
    // The movie item shares its partition with the movie's roles, so one query
    // confirms the movie exists and returns its cast.
    const resultItems = await queryMovieItems(movieId);
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
    console.error("DynamoDB error:", err);
    return response(500, { message: "Internal server error" });
  }
};

// Reads every item in the movie's partition, following DynamoDB's pagination.
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