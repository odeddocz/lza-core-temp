import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { TransitGatewayAttachmentLookupOption, TransitGatewayAttachmentType } from '@aws-accelerator/constructs';
import {
  AFI_HANDOVER_STACK,
  AFI_HANDOVER_UUID,
  preserveAfiLookupLayout,
} from '../lib/stacks/network-stacks/network-associations-stack/afi-vpn-handover';
import { NetworkAssociationsStack } from '../lib/stacks/network-stacks/network-associations-stack/network-associations-stack';
import deployedBatch from './fixtures/afi-handover-batch.json';

const batchId = 'BatchTgwAttachmentLookup4DD094C3';
function liveLookups(): Record<string, TransitGatewayAttachmentLookupOption> {
  const transitGatewayId = cdk.Fn.ref(
    'SsmParameterValuelzanipnetworktransitGatewayslzaniptgwidC96584B6F00A464EAD1953AFF4B05118Parameter',
  );
  return Object.fromEntries(
    deployedBatch.attachments
      .filter((_, i) => i !== 6 && i !== 7)
      .map((item, i) => [
        item.type === 'vpn' ? `${item.name}_lza-nip-tgw` : `lza-nip-tgw_account_vpc${i}`,
        {
          name: item.name,
          owningAccountId: item.owningAccountId,
          transitGatewayId,
          type: item.type as TransitGatewayAttachmentType,
          ...(item.type === 'vpc' ? { roleName: 'lza-nip-GetTgwAttachmentRole-il-central-1' } : {}),
        },
      ]),
  );
}

describe('AFI handover pinned source integration', () => {
  it('preserves the original ten input slots and does not mutate live input', () => {
    const input = liveLookups();
    const keys = Object.keys(input);
    const restored = preserveAfiLookupLayout(AFI_HANDOVER_STACK, input);
    expect(Object.keys(input)).toEqual(keys);
    expect(Object.values(restored).map(item => item.name)).toEqual(deployedBatch.attachments.map(item => item.name));
    expect(AFI_HANDOVER_UUID).toBe(deployedBatch.uuid);
  });

  it('does not change other stacks', () => {
    const input = liveLookups();
    expect(preserveAfiLookupLayout('unrelated-stack', input)).toBe(input);
  });

  it.each(['addition', 'removal', 'rename', 'role', 'owner', 'tgw'])('rejects baseline drift: %s', kind => {
    const input = liveLookups();
    const keys = Object.keys(input);
    if (kind === 'addition') input['extra'] = input[keys[0]];
    if (kind === 'removal') delete input[keys[0]];
    if (kind === 'rename') input[keys[6]] = { ...input[keys[6]], name: 'renamed' };
    if (kind === 'role') input[keys[0]] = { ...input[keys[0]], roleName: 'wrong' };
    if (kind === 'owner') input[keys[0]] = { ...input[keys[0]], owningAccountId: '111111111111' };
    if (kind === 'tgw') input[keys[0]] = { ...input[keys[0]], transitGatewayId: 'tgw-wrong' };
    expect(() => preserveAfiLookupLayout(AFI_HANDOVER_STACK, input)).toThrow(/baseline drift/);
  });

  it('uses real CDK constructs and the actual patched method without changing deployed batch properties', () => {
    const stack = new cdk.Stack(new cdk.App(), 'LocalHandoverReview', {
      stackName: AFI_HANDOVER_STACK,
      env: { account: '182790204395', region: 'il-central-1' },
    });
    const attachments = new Map<string, string>();
    Object.assign(stack, {
      logRetention: 365,
      cloudwatchKey: new cdk.aws_kms.Key(stack, 'LocalOnlyKey'),
      transitGatewayAttachments: attachments,
    });
    NetworkAssociationsStack.prototype['setBatchLookupTgwAttachmentId'].call(
      stack as NetworkAssociationsStack,
      liveLookups(),
    );
    const template = Template.fromStack(stack).toJSON();
    const resource = template['Resources'][batchId];
    expect(resource).toBeDefined();
    expect(resource.Properties.uuid).toEqual(deployedBatch.uuid);
    expect(resource.Properties.attachments).toEqual(deployedBatch.attachments);
    expect(stack.resolve(attachments.get('lza-nip-s2s-vpn_lza-nip-tgw'))).toEqual({
      'Fn::Select': [8, { 'Fn::Split': [',', { 'Fn::GetAtt': [batchId, 'attachmentIds'] }] }],
    });
    expect(stack.resolve(attachments.get('lza-nip-s2s-vpn-jer_lza-nip-tgw'))).toEqual({
      'Fn::Select': [9, { 'Fn::Split': [',', { 'Fn::GetAtt': [batchId, 'attachmentIds'] }] }],
    });
    const types = Object.values(template['Resources']).map(resource => (resource as { Type: string }).Type);
    expect(types.some(type => type.startsWith('AWS::EC2::'))).toBe(false);
  });
});
