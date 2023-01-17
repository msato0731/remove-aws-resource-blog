#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { RemoveAwResourcePipelineStack } from '../lib/remove-aws-resource-pipeline-stack';

const app = new cdk.App();
new RemoveAwResourcePipelineStack(app, 'RemoveAwResourcePipeline', {
  codecommitRepoName: app.node.tryGetContext('codecommitRepoName'),
  dockerhubSecretsManagerArn: app.node.tryGetContext('dockerhubSecretsManagerArn'),
});

cdk.Tags.of(app).add('System', 'remove-aws-resource-pipeline');
cdk.Tags.of(app).add('remove', 'false');
