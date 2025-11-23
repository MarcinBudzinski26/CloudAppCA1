import * as cdk from "aws-cdk-lib"
import { Construct } from "constructs"

import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as dynamodb from "aws-cdk-lib/aws-dynamodb"
import * as custom from "aws-cdk-lib/custom-resources"
import * as apig from "aws-cdk-lib/aws-apigateway"
import { UserPool } from "aws-cdk-lib/aws-cognito"

import { generateBatch } from "../shared/util"
import { movies, movieCasts } from "../seed/movies"

export class RestAPIStack extends cdk.Stack {
  private auth: apig.IResource
  private userPoolId: string
  private userPoolClientId: string

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // Cognito
    const userPool = new UserPool(this, "UserPool", {
      signInAliases: { username: true, email: true },
      selfSignUpEnabled: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    const appClient = userPool.addClient("AppClient", {
      authFlows: { userPassword: true },
    })

    this.userPoolId = userPool.userPoolId
    this.userPoolClientId = appClient.userPoolClientId


    // Authorizer for api methods
    const authorizer = new apig.CognitoUserPoolsAuthorizer(this, "MoviesAuthorizer", {
      cognitoUserPools: [userPool],
    })

    // Auth API (same as labs)
    const authApi = new apig.RestApi(this, "AuthServiceApi", {
      description: "Authentication Service RestApi",
      endpointTypes: [apig.EndpointType.REGIONAL],
      defaultCorsPreflightOptions: {
        allowOrigins: apig.Cors.ALL_ORIGINS,
      },
    })

    // /auth resource root
    const authResource = authApi.root.addResource("auth")


    // Tables
    const moviesTable = new dynamodb.Table(this, "MoviesTable", {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: "id", type: dynamodb.AttributeType.NUMBER },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      tableName: "Movies",
    })

    const movieCastsTable = new dynamodb.Table(this, "MovieCastTable", {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: "movieId", type: dynamodb.AttributeType.NUMBER },
      sortKey: { name: "actorName", type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      tableName: "MovieCast",
    })

    movieCastsTable.addLocalSecondaryIndex({
      indexName: "roleIx",
      sortKey: { name: "roleName", type: dynamodb.AttributeType.STRING },
    })

    // Lambdas
    const getMovieByIdFn = new lambdanode.NodejsFunction(this, "GetMovieByIdFn", {
      architecture: lambda.Architecture.ARM_64,
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/getMovieById.ts`,
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      environment: {
        TABLE_NAME: moviesTable.tableName,
        REGION: cdk.Aws.REGION,
        CAST_TABLE_NAME: movieCastsTable.tableName,
      },
    })

    const getAllMoviesFn = new lambdanode.NodejsFunction(this, "GetAllMoviesFn", {
      architecture: lambda.Architecture.ARM_64,
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/getAllMovies.ts`,
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      environment: {
        TABLE_NAME: moviesTable.tableName,
        REGION: cdk.Aws.REGION,
      },
    })

    const newMovieFn = new lambdanode.NodejsFunction(this, "AddMovieFn", {
      architecture: lambda.Architecture.ARM_64,
      runtime: lambda.Runtime.NODEJS_16_X,
      entry: `${__dirname}/../lambdas/addMovie.ts`,
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      environment: {
        TABLE_NAME: moviesTable.tableName,
        REGION: cdk.Aws.REGION,
      },
    })

    const deleteMovieFn = new lambdanode.NodejsFunction(this, "DeleteMovieFn", {
      architecture: lambda.Architecture.ARM_64,
      runtime: lambda.Runtime.NODEJS_16_X,
      entry: `${__dirname}/../lambdas/deleteMovie.ts`,
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      environment: {
        TABLE_NAME: moviesTable.tableName,
        REGION: cdk.Aws.REGION,
      },
    })

    const getMovieCastMembersFn = new lambdanode.NodejsFunction(this, "GetCastMemberFn", {
      architecture: lambda.Architecture.ARM_64,
      runtime: lambda.Runtime.NODEJS_16_X,
      entry: `${__dirname}/../lambdas/getMovieCastMember.ts`,
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      environment: {
        TABLE_NAME: movieCastsTable.tableName,
        REGION: cdk.Aws.REGION,
      },
    })

    // Seed data
    new custom.AwsCustomResource(this, "moviesddbInitData", {
      onCreate: {
        service: "DynamoDB",
        action: "batchWriteItem",
        parameters: {
          RequestItems: {
            [moviesTable.tableName]: generateBatch(movies),
            [movieCastsTable.tableName]: generateBatch(movieCasts),
          },
        },
        physicalResourceId: custom.PhysicalResourceId.of("moviesddbInitData"),
      },
      policy: custom.AwsCustomResourcePolicy.fromSdkCalls({
        resources: [moviesTable.tableArn, movieCastsTable.tableArn],
      }),
    })

    // Api
    const api = new apig.RestApi(this, "RestAPI", {
      description: "demo api",
      deployOptions: { stageName: "dev" },
      defaultCorsPreflightOptions: {
        allowHeaders: ["Content-Type", "X-Amz-Date", "Authorization"],
        allowMethods: ["OPTIONS", "GET", "POST", "PUT", "PATCH", "DELETE"],
        allowCredentials: true,
        allowOrigins: ["*"],
      },
    })

    this.auth = api.root.addResource("auth")

    this.addAuthRoute("signup", "POST", "SignUpFn", "signup.ts")
  // this.addAuthRoute("confirm", "POST", "ConfirmFn", "confirm.ts")
  // this.addAuthRoute("signin", "POST", "SignInFn", "signin.ts")
  //  this.addAuthRoute("signout", "POST", "SignOutFn", "signout.ts")
  // this.addAuthRoute("setup", "POST", "SetupFn", "setup.ts")

    const moviesEndpoint = api.root.addResource("movies")
    const movieEndpoint = moviesEndpoint.addResource("{movieId}")
    const movieCastEndpoint = moviesEndpoint.addResource("cast")

    // Public methods
    moviesEndpoint.addMethod(
      "GET",
      new apig.LambdaIntegration(getAllMoviesFn, { proxy: true })
    )

    movieEndpoint.addMethod(
      "GET",
      new apig.LambdaIntegration(getMovieByIdFn, { proxy: true })
    )

    movieCastEndpoint.addMethod(
      "GET",
      new apig.LambdaIntegration(getMovieCastMembersFn, { proxy: true })
    )

    // Protected methods
    moviesEndpoint.addMethod(
      "POST",
      new apig.LambdaIntegration(newMovieFn, { proxy: true }),
      {
        authorizer,
        authorizationType: apig.AuthorizationType.COGNITO,
      }
    )

    movieEndpoint.addMethod(
      "DELETE",
      new apig.LambdaIntegration(deleteMovieFn, { proxy: true }),
      {
        authorizer,
        authorizationType: apig.AuthorizationType.COGNITO,
      }
    )

    // Permissions
    moviesTable.grantReadData(getMovieByIdFn)
    moviesTable.grantReadData(getAllMoviesFn)
    moviesTable.grantReadWriteData(newMovieFn)
    moviesTable.grantReadWriteData(deleteMovieFn)

    movieCastsTable.grantReadData(getMovieCastMembersFn)
    movieCastsTable.grantReadData(getMovieByIdFn)

    // Outputs so you can test in postman
    new cdk.CfnOutput(this, "UserPoolId", { value: userPool.userPoolId })
    new cdk.CfnOutput(this, "UserPoolClientId", { value: appClient.userPoolClientId })
    new cdk.CfnOutput(this, "ApiUrl", { value: api.url })
  }

  private addAuthRoute(
    resourceName: string,
    method: string,
    fnName: string,
    fnEntry: string
  ): void {
    const commonFnProps = {
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "handler",
      environment: {
        USER_POOL_ID: this.userPoolId,
        CLIENT_ID: this.userPoolClientId,
        REGION: cdk.Aws.REGION,
      },
    }

    const resource = this.auth.addResource(resourceName)
    const fn = new lambdanode.NodejsFunction(this, fnName, {
      ...commonFnProps,
      entry: `${__dirname}/../lambdas/auth/${fnEntry}`,
    })

    resource.addMethod(method, new apig.LambdaIntegration(fn))
  }


}
