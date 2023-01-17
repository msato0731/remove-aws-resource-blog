import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';

export interface RemoveAwResourcePipelineStackProps extends cdk.StackProps {
  codecommitRepoName: string;
  dockerhubSecretsManagerArn: string;
}

export class RemoveAwResourcePipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: RemoveAwResourcePipelineStackProps) {
    super(scope, id, props);

    // IAM Role
    const codebuildRole = new iam.Role(this, 'CodeBuildRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
    });

    const nukeRole = new iam.Role(this, 'AwsNukeRole', {
      assumedBy: new iam.ArnPrincipal(codebuildRole.roleArn),
    });

    const dockerhubSecrets = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'DockerhubSecrets',
      props.dockerhubSecretsManagerArn,
    );
    codebuildRole.addToPolicy(
      new iam.PolicyStatement({
        resources: [dockerhubSecrets.secretArn],
        actions: ['secretsmanager:GetSecretValue'],
      }),
    );

    // CodeBuild RoleでAwsNuke Roleを引き受けれるようにする
    nukeRole.grantAssumeRole(codebuildRole);
    // aws-nukeはリソース削除を行うため強い権限を付与
    nukeRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess'));

    // Source
    const sourceOutput = new codepipeline.Artifact();
    const sourceAction = new codepipeline_actions.CodeCommitSourceAction({
      actionName: 'CodeCommit_Source',
      repository: codecommit.Repository.fromRepositoryName(this, 'Repo', props.codecommitRepoName),
      branch: 'main',
      output: sourceOutput,
      // 手動トリガーでPipelineを起動させたいため
      trigger: codepipeline_actions.CodeCommitTrigger.NONE,
    });

    // Log Group
    // aws-nukeで除外時に名前が固定されていた方が都合が良いため(タグをつけれないため、タグで除外ができない)
    const dryRunProjectLogGroup = new logs.LogGroup(this, 'DryRunProjectLogGroup', {
      logGroupName: '/aws/codebuild/remove-resource-pipeline/dry-run-project',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const runProjectLogGroup = new logs.LogGroup(this, 'RunProjectLogGroup', {
      logGroupName: '/aws/codebuild/remove-resource-pipeline/run-project',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // CodeBuild
    const dryRunProject = new codebuild.PipelineProject(this, 'DryRunProject', {
      role: codebuildRole,
      logging: {
        cloudWatch: {
          logGroup: dryRunProjectLogGroup,
        },
      },
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_6_0,
        privileged: true,
      },
      environmentVariables: {
        DOCKER_HUB_SECRET_ARN: {
          value: props.dockerhubSecretsManagerArn,
        },
        ASSUME_ROLE_ARN: {
          value: nukeRole.roleArn,
        },
        AWS_NUKE_DRY_RUN: {
          value: true,
        },
      },
    });
    const runProject = new codebuild.PipelineProject(this, 'RunProject', {
      role: codebuildRole,
      logging: {
        cloudWatch: {
          logGroup: runProjectLogGroup,
        },
      },
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_6_0,
        privileged: true,
      },
      environmentVariables: {
        DOCKER_HUB_SECRET_ARN: {
          value: props.dockerhubSecretsManagerArn,
        },
        ASSUME_ROLE_ARN: {
          value: nukeRole.roleArn,
        },
        AWS_NUKE_DRY_RUN: {
          value: false,
        },
      },
    });

    // CodePipeline
    const dryRunAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'DryRun',
      project: dryRunProject,
      input: sourceOutput,
    });

    const runAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'Run',
      project: runProject,
      input: sourceOutput,
    });

    const approvalActions = new codepipeline_actions.ManualApprovalAction({
      actionName: 'Approval',
    });

    new codepipeline.Pipeline(this, 'Pipeline', {
      stages: [
        {
          stageName: 'Source',
          actions: [sourceAction],
        },
        {
          stageName: 'DryRun',
          actions: [dryRunAction],
        },
        {
          stageName: 'Approval',
          actions: [approvalActions],
        },
        {
          stageName: 'Run',
          actions: [runAction],
        },
      ],
    });
  }
}
