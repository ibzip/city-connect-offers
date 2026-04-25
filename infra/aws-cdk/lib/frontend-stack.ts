import * as cdk from "aws-cdk-lib";
import { CfnOutput, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface CityWalletFrontendStackProps extends StackProps {
  apiUrl: string;
}

export class CityWalletFrontendStack extends Stack {
  constructor(scope: Construct, id: string, props: CityWalletFrontendStackProps) {
    super(scope, id, props);

    const consumerBucket = new s3.Bucket(this, "ConsumerWalletBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    const merchantBucket = new s3.Bucket(this, "MerchantPortalBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const consumerDistribution = new cloudfront.Distribution(this, "ConsumerWalletDistribution", {
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: new origins.S3Origin(consumerBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      errorResponses: spaFallbacks(),
    });
    const merchantDistribution = new cloudfront.Distribution(this, "MerchantPortalDistribution", {
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: new origins.S3Origin(merchantBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      errorResponses: spaFallbacks(),
    });

    new CfnOutput(this, "ConsumerWalletBucketName", { value: consumerBucket.bucketName });
    new CfnOutput(this, "MerchantPortalBucketName", { value: merchantBucket.bucketName });
    new CfnOutput(this, "ConsumerWalletUrl", { value: `https://${consumerDistribution.distributionDomainName}` });
    new CfnOutput(this, "MerchantPortalUrl", { value: `https://${merchantDistribution.distributionDomainName}` });
    new CfnOutput(this, "FrontendApiBaseUrl", { value: props.apiUrl });
  }
}

function spaFallbacks(): cloudfront.ErrorResponse[] {
  return [
    { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html" },
    { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html" },
  ];
}
