#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { CityWalletBackendStack } from "../lib/backend-stack";
import { CityWalletDatabaseStack } from "../lib/database-stack";
import { CityWalletFrontendStack } from "../lib/frontend-stack";

const app = new cdk.App();

const database = new CityWalletDatabaseStack(app, "CityWalletDatabaseStack");
const backend = new CityWalletBackendStack(app, "CityWalletBackendStack", {
  dbSecret: database.dbSecret,
  dbEndpointAddress: database.dbEndpointAddress,
  lambdaSecurityGroup: database.lambdaSecurityGroup,
  vpc: database.vpc,
});
new CityWalletFrontendStack(app, "CityWalletFrontendStack", {
  apiUrl: backend.apiUrl,
});
