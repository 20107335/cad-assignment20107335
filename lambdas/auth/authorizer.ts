import type {
  APIGatewayAuthorizerResult,
  APIGatewayRequestAuthorizerEvent,
} from 'aws-lambda';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

// Created outside the handler so the user pool's JWKS is cached across invocations.
const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.USER_POOL_ID!,
  clientId: process.env.CLIENT_ID!,
  tokenUse: 'id',
});

// Verifies the Cognito ID token in the `token` cookie (set by the Auth API's signin)
// and passes the Cognito username to the App API lambdas via the authorizer context.
export const handler = async (
  event: APIGatewayRequestAuthorizerEvent,
): Promise<APIGatewayAuthorizerResult> => {
  const token = parseCookies(event.headers?.cookie ?? event.headers?.Cookie)['token'];
    // Issue 13: a Deny policy made API Gateway return 403. Throwing 'Unauthorized' returns 401,
  // the correct status when no valid credentials are provided.
  if (!token) {
    throw new Error('Unauthorized');
  }

  try {
    const payload = await verifier.verify(token);
    const username = payload['cognito:username'];
    return policy(payload.sub, 'Allow', event.methodArn, { username });
  } catch (err) {
    console.log('Token verification failed:', (err as Error).message);
    throw new Error('Unauthorized');
  }
};

const parseCookies = (header?: string): Record<string, string> => {
  const cookies: Record<string, string> = {};
  for (const part of header?.split(';') ?? []) {
    const [name, ...value] = part.trim().split('=');
    if (name) cookies[name] = decodeURIComponent(value.join('='));
  }
  return cookies;
};

const policy = (
  principalId: string,
  effect: 'Allow' | 'Deny',
  resource: string,
  context?: Record<string, string>,
): APIGatewayAuthorizerResult => ({
  principalId,
  policyDocument: {
    Version: '2012-10-17',
    Statement: [{ Action: 'execute-api:Invoke', Effect: effect, Resource: resource }],
  },
  context,
});
