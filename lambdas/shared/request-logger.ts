import type { APIGatewayProxyEvent } from 'aws-lambda';

// Logs "<cognito username>   <request path>[?query]" to CloudWatch, e.g.
//   doconnor   /actors/4321?movie=1234
export const logRequest = (event: APIGatewayProxyEvent): void => {
  // Issue 5: the username was hard-coded as 'TODO'.
  // The authorizer passes the Cognito username, requests made with
  // the admin API key don't go through the authorizer, so they are logged as 'admin'.
  const username = event.requestContext.authorizer?.username ?? 'admin';
  const params = Object.entries(event.queryStringParameters ?? {}).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  const query = params.length ? `?${new URLSearchParams(params)}` : '';
  console.log(`${username}   ${event.path}${query}`);
};