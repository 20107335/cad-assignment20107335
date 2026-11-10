import type { APIGatewayProxyEvent } from 'aws-lambda';

// Logs "<cognito username>  <request path>[?query]" to CloudWatch, e.g.
//   Eoneill   /actors/4321?movie=1234
export const logRequest = (event: APIGatewayProxyEvent): void => {
  // The authorizer passes the Cognito username in its context. Requests made with
  // the admin API key bypass the authorizer, so they are logged as 'admin'.
  const username = event.requestContext.authorizer?.username ?? 'admin';
  const params = Object.entries(event.queryStringParameters ?? {}).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  const query = params.length ? `?${new URLSearchParams(params)}` : '';
  console.log(`${username}   ${event.path}${query}`);
};