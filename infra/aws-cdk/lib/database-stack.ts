import { CfnOutput, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

export class CityWalletDatabaseStack extends Stack {
  public readonly dbSecret: secretsmanager.ISecret;
  public readonly dbEndpointAddress: string;
  public readonly dbSecurityGroup: ec2.ISecurityGroup;
  public readonly lambdaSecurityGroup: ec2.ISecurityGroup;
  public readonly vpc: ec2.IVpc;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "CityWalletVpc", {
      maxAzs: 2,
      natGateways: 1,
    });
    this.vpc = vpc;

    const dbSecurityGroup = new ec2.SecurityGroup(this, "DatabaseSecurityGroup", {
      vpc,
      allowAllOutbound: true,
      description: "City Wallet PostgreSQL security group",
    });
    this.dbSecurityGroup = dbSecurityGroup;
    const lambdaSecurityGroup = new ec2.SecurityGroup(this, "LambdaSecurityGroup", {
      vpc,
      allowAllOutbound: true,
      description: "City Wallet Lambda security group",
    });
    this.lambdaSecurityGroup = lambdaSecurityGroup;
    dbSecurityGroup.addIngressRule(lambdaSecurityGroup, ec2.Port.tcp(5432), "Allow City Wallet Lambdas to reach PostgreSQL");

    const credentials = rds.Credentials.fromGeneratedSecret("citywallet");
    const database = new rds.DatabaseInstance(this, "CityWalletPostgres", {
      vpc,
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16_3 }),
      credentials,
      databaseName: "citywallet",
      allocatedStorage: 20,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      securityGroups: [dbSecurityGroup],
      publiclyAccessible: false,
      removalPolicy: RemovalPolicy.DESTROY,
      deletionProtection: false,
    });

    // TODO: Add RDS Proxy when Lambda concurrency or connection churn becomes material.
    this.dbSecret = database.secret!;
    this.dbEndpointAddress = database.dbInstanceEndpointAddress;

    const optionalParameters = [
      new ssm.StringParameter(this, "OpenAiApiKeyParameter", {
        parameterName: "/city-wallet/openai-api-key",
        stringValue: "not-configured",
        description: "Optional OpenAI API key placeholder for replacing MockLLMClient.",
      }),
      new ssm.StringParameter(this, "PayoneApiKeyParameter", {
        parameterName: "/city-wallet/payone-api-key",
        stringValue: "not-configured",
        description: "Optional Payone API key placeholder for replacing SimulatedPayoneProvider.",
      }),
      new ssm.StringParameter(this, "WeatherApiKeyParameter", {
        parameterName: "/city-wallet/weather-api-key",
        stringValue: "not-configured",
        description: "Optional weather API key placeholder for replacing mock weather providers.",
      }),
    ];

    new CfnOutput(this, "VpcId", { value: vpc.vpcId });
    new CfnOutput(this, "DbEndpointAddress", { value: database.dbInstanceEndpointAddress });
    new CfnOutput(this, "DbSecretName", { value: database.secret?.secretName ?? "missing-secret" });
    new CfnOutput(this, "LambdaSecurityGroupId", { value: lambdaSecurityGroup.securityGroupId });
    for (const parameter of optionalParameters) {
      new CfnOutput(this, `${parameter.node.id}Name`, { value: parameter.parameterName });
    }
  }
}
