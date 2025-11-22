import { APIGatewayProxyHandlerV2 } from "aws-lambda";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

const ddbDocClient = createDDbDocClient();

export const handler: APIGatewayProxyHandlerV2 = async (event, context) => {
  try {
    console.log("[EVENT]", JSON.stringify(event));

    const pathParams = event.pathParameters;
    const movieId = pathParams?.movieId ? parseInt(pathParams.movieId) : undefined;

    if (!movieId) {
      return {
        statusCode: 404,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ Message: "Missing movie Id" }),
      };
    }

    // should include cast?
    const includeCast =
      event.queryStringParameters?.cast?.toLowerCase() === "true";

    // 1) get the movie
    const movieOutput = await ddbDocClient.send(
      new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { id: movieId },
      })
    );

    if (!movieOutput.Item) {
      return {
        statusCode: 404,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ Message: "Invalid movie Id" }),
      };
    }

    let cast: any[] | undefined = undefined;

    // 2) optionally get cast
    if (includeCast && process.env.CAST_TABLE_NAME) {
      const castOutput = await ddbDocClient.send(
        new QueryCommand({
          TableName: process.env.CAST_TABLE_NAME,
          KeyConditionExpression: "movieId = :m",
          ExpressionAttributeValues: {
            ":m": movieId,
          },
        })
      );
      cast = castOutput.Items || [];
    }

    const body: any = {
      movie: movieOutput.Item,
    };

    if (includeCast) {
      body.cast = cast;
    }

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    };
  } catch (error: any) {
    console.log(JSON.stringify(error));
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error }),
    };
  }
};


function createDDbDocClient() {
  const ddbClient = new DynamoDBClient({ region: process.env.REGION });
  const marshallOptions = {
    convertEmptyValues: true,
    removeUndefinedValues: true,
    convertClassInstanceToMap: true,
  };
  const unmarshallOptions = {
    wrapNumbers: false,
  };
  const translateConfig = { marshallOptions, unmarshallOptions };
  return DynamoDBDocumentClient.from(ddbClient, translateConfig);
}
