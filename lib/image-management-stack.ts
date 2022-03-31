import {
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_event_sources as events,
  aws_s3 as s3,
  aws_s3_notifications as s3n,
  aws_sqs as sqs,
  CfnOutput,
  RemovalPolicy,
  Stack,
  StackProps,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class ImageManagementStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const { SOURCE_IP } = process.env;

    /**
     * S3 data store bucket.
     */
    const ImageStoreBucket = new s3.Bucket(this, 'ImageStoreBucket', {
      removalPolicy: RemovalPolicy.DESTROY,
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    /**
     * TODO: add correct restrictions.
     */
    const ImageStoreBucketPolicy = new iam.PolicyStatement({
      actions: [
        's3:GetObject',
        's3:PutObject',
      ],
      resources: [
        ImageStoreBucket.arnForObjects('*'),
      ],
      principals: [
        new iam.AnyPrincipal()
      ],
    });

    /**
     * TEMP: Restrict to ip for testing.
     */
    ImageStoreBucketPolicy.addCondition('IpAddress', {
      'aws:SourceIp': [SOURCE_IP],
    });

    /**
     * Validate Data Source Bucket Resource Policy.
     */
    const ImageStoreBucketResourcePolicy = ImageStoreBucket.addToResourcePolicy(ImageStoreBucketPolicy);
    if (!ImageStoreBucketResourcePolicy.statementAdded) {
      console.log(`Failed to add ImageStoreBucketResourcePolicy to ${ImageStoreBucket.bucketName}`);
    }

    /**
     * Invalidator Function.
     */
    const Invalidator = new lambda.Function(this, 'Invalidator', {
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: 'index.invalidate',
      code: lambda.Code.fromAsset(path.join(__dirname, 'Invalidator')),
    });

    /**
     * Invalidator 'Removed/Deleted' Notification.
     */
    ImageStoreBucket.addEventNotification(
      s3.EventType.OBJECT_REMOVED,
      new s3n.LambdaDestination(Invalidator),
    );

    /**
     * Event Notification to SQS Queue (Sourced By Broadcaster)
     */
    /**
     * SQS
     * FIFO.
     */
    const BroadcasterQueue = new sqs.Queue(this, 'BroadcasterQueue.fifo');

    /**
     * Broadcaster 'Added' and 'Updated' Notifications
     */
    ImageStoreBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SqsDestination(BroadcasterQueue),
    );

    /**
     * Broadcaster 'Removed/Deleted' Notifications
     */
    ImageStoreBucket.addEventNotification(
      s3.EventType.OBJECT_REMOVED,
      new s3n.SqsDestination(BroadcasterQueue),
    );

    /**
     * TODO: Maybe Not Needed
     */
    new CfnOutput(this, 'ImageStoreBucketAddedBroadcasterQueue', {
      value: BroadcasterQueue.queueName,
    });

    /**
     * Lambda - Broadcaster.
     */
    const Broadcaster = new lambda.Function(this, 'Broadcaster', {
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: 'index.broadcast',
      code: lambda.Code.fromAsset(path.join(__dirname, 'Broadcaster')),
    });

    /**
     * Add SenderQueue as event source for Broadcaster.
     */
    Broadcaster.addEventSource(new events.SqsEventSource(BroadcasterQueue));
  }
}
