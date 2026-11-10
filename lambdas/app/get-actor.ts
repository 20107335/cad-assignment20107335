import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  actorKey,
  ddb,
  movieKey,
  parseId,
  tableName,
  toActor,
  toRole,
} from "../shared/db";
import { response } from "../shared/http";
import { logRequest } from "../shared/request-logger";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  logRequest(event);

  const actorId = parseId(event.pathParameters?.actorID);
  if (actorId === undefined) {
    return response(400, { message: "actorID must be a positive integer" });
  }

  const movieParam = event.queryStringParameters?.movie;
  const movieId = parseId(movieParam);
  if (movieParam !== undefined && movieId === undefined) {
    return response(400, { message: "movie must be a positive integer" });
  }
  try {
    const actorResult = await ddb.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: actorKey(actorId), SK: actorKey(actorId) },
      })
    );

    if (!actorResult.Item) {
      return response(404, { message: `Actor ${actorId} not found` });
    }
    const actor = toActor(actorResult.Item);

    // Issue 4: ?movie= was validated but never used, so the role was never included.
    // Issue 14: an unknown movie was silently ignored; it now returns 404.
    // Fetch the movie and the role (m#movieID | a#actorID) together; add the role if the actor is in it.
    if (movieId !== undefined) {
      const [movieResult, roleResult] = await Promise.all([
        ddb.send(
          new GetCommand({
            TableName: tableName,
            Key: { PK: movieKey(movieId), SK: movieKey(movieId) },
          })
        ),
        ddb.send(
          new GetCommand({
            TableName: tableName,
            Key: { PK: movieKey(movieId), SK: actorKey(actorId) },
          })
        ),
      ]);
      if (!movieResult.Item) {
        return response(404, { message: `Movie ${movieId} not found` });
      }
      if (roleResult.Item) {
        return response(200, { data: { ...actor, role: toRole(roleResult.Item) } });
      }
    }

    return response(200, { data: actor });
  } catch (err) {
    // Issue 12: the raw error was returned to the caller. It is logged to CloudWatch instead.
    console.error("DynamoDB error:", err);
    return response(500, { message: "Internal server error" });
  }
};