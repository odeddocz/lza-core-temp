/**
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance
 *  with the License. A copy of the License is located at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  or in the 'license' file accompanying this file. This file is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific language
 *  governing permissions and limitations under the License.
 */

import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, test, vi } from 'vitest';
import { PipelineStack, PipelineStackProps } from '../lib/stacks/pipeline-stack';

function synthesize(overrides: Partial<PipelineStackProps> = {}) {
  const app = new cdk.App();
  const stack = new PipelineStack(app, 'lza-nip-PipelineStack-302524630066-il-central-1', {
    env: { account: '302524630066', region: 'il-central-1' },
    sourceRepository: 'github',
    sourceRepositoryOwner: 'odeddocz',
    sourceRepositoryName: 'lza-core-temp',
    sourceBranchName: 'ramdor-afi-handover-v1.14.5',
    sourceBucketName: 'lza-nip-installer-302524630066-il-central-1',
    sourceBucketObject: 'lza/v1.14.5.zip',
    enableApprovalStage: true,
    managementAccountId: '302524630066',
    managementAccountRoleName: 'AWSControlTowerExecution',
    managementAccountEmail: 'management@example.com',
    logArchiveAccountEmail: 'logs@example.com',
    auditAccountEmail: 'audit@example.com',
    controlTowerEnabled: 'Yes',
    installerStackName: 'Nip-Landing-Zone-Accelerator',
    partition: 'aws',
    configRepositoryLocation: 's3',
    codeconnectionArn: '',
    useExistingConfigRepo: false,
    configRepositoryName: '',
    configRepositoryBranchName: '',
    configRepositoryOwner: '',
    prefixes: {
      accelerator: 'lza-nip',
      repoName: 'lza-nip',
      bucketName: 'lza-nip',
      ssmParamName: '/lza-nip',
      kmsAlias: 'alias/lza-nip',
      snsTopicName: 'lza-nip',
      secretName: '/lza-nip',
      trailLogName: 'lza-nip',
      databaseName: 'lza-nip',
    },
    enableSingleAccountMode: false,
    pipelineAccountId: '302524630066',
    useExistingRoles: false,
    secureBucketName: 'lza-nip-installer-302524630066-il-central-1',
    ...overrides,
  });
  const template = Template.fromStack(stack);
  const resources = template.findResources('AWS::CodePipeline::Pipeline');
  const pipelines = Object.values(resources);
  expect(pipelines).toHaveLength(1);
  return { template, properties: pipelines[0]['Properties'], pipelineId: Object.keys(resources)[0] };
}

describe('AFI main-pipeline Prepare hold cleanup', () => {
  test('the complete target template differs from the guarded version only by removing the Prepare hold', () => {
    const original = cdk.aws_codepipeline.Pipeline.prototype.addStage;
    const guardedBaseline = vi.spyOn(cdk.aws_codepipeline.Pipeline.prototype, 'addStage').mockImplementation(function (
      this: cdk.aws_codepipeline.Pipeline,
      options,
    ) {
      return original.call(
        this,
        options.stageName === 'Prepare'
          ? {
              ...options,
              transitionToEnabled: false,
              transitionDisabledReason: 'Temporary AFI handover hold. Prepare blocked pending operator approval',
            }
          : options,
      );
    });
    let guarded;
    try {
      const current = synthesize();
      guarded = current.template.toJSON();
      expect(guarded['Resources'][current.pipelineId].Properties.DisableInboundStageTransitions).toEqual([
        {
          StageName: 'Prepare',
          Reason: 'Temporary AFI handover hold. Prepare blocked pending operator approval',
        },
      ]);
      delete guarded['Resources'][current.pipelineId].Properties.DisableInboundStageTransitions;
    } finally {
      guardedBaseline.mockRestore();
    }
    expect(synthesize().template.toJSON()).toEqual(guarded);
  });

  test('Prepare is enabled and ordinary Review approval is preserved in the target pipeline', () => {
    const { properties } = synthesize();
    expect(properties.Name).toBe('lza-nip-Pipeline');
    expect(properties.DisableInboundStageTransitions).toBeUndefined();
    expect(properties.Stages.slice(0, 5).map((stage: { Name: string }) => stage.Name)).toEqual([
      'Source',
      'Prepare',
      'Accounts',
      'Bootstrap',
      'Review',
    ]);
    const review = properties.Stages.find((stage: { Name: string }) => stage.Name === 'Review');
    expect(
      review.Actions.some(
        (action: { ActionTypeId: { Category: string } }) => action.ActionTypeId.Category === 'Approval',
      ),
    ).toBe(true);
    expect(properties.Stages[0].Actions[0].Configuration.S3ObjectKey).toBe('lza/v1.14.5.zip');
  });

  test.each([
    { env: { account: '111111111111', region: 'il-central-1' } },
    { env: { account: '302524630066', region: 'us-east-1' } },
    { qualifier: 'other' },
  ])('does not add a hold outside the target account/region/pipeline: %j', overrides => {
    const { properties } = synthesize(overrides);
    expect(properties.DisableInboundStageTransitions).toBeUndefined();
  });

  test('does not reintroduce the Prepare hold if ordinary Review approval is disabled', () => {
    const { properties } = synthesize({ enableApprovalStage: false });
    expect(properties.DisableInboundStageTransitions).toBeUndefined();
    expect(properties.Stages.some((stage: { Name: string }) => stage.Name === 'Review')).toBe(false);
  });
});
