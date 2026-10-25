import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DescribeTransitGatewayAttachmentsCommand, DescribeVpnConnectionsCommand } from '@aws-sdk/client-ec2';
import { CloudFormationCustomResourceEvent } from '@aws-accelerator/utils/lib/common-types';
import { handler } from '../../lib/aws-ec2/get-transit-gateway-attachment/index';
import { retiredAfiLookupResults } from '../../lib/aws-ec2/get-transit-gateway-attachment/afi-vpn-handover';

const calls = vi.hoisted(() => ({ ec2: vi.fn(), sts: vi.fn() }));
vi.mock('@aws-sdk/client-ec2', async importOriginal => ({
  ...(await importOriginal<typeof import('@aws-sdk/client-ec2')>()),
  EC2Client: class {
    send = calls.ec2;
  },
}));
vi.mock('@aws-sdk/client-sts', async importOriginal => ({
  ...(await importOriginal<typeof import('@aws-sdk/client-sts')>()),
  STSClient: class {
    send = calls.sts;
  },
}));

const stackName = 'lza-nip-NetworkAssociationsStack-182790204395-il-central-1';
const tgwId = 'tgw-0718ca7fa7c9621ff';
const names = [
  ['lza-nip-shared-services-attachment', '863819359187', 'vpc'],
  ['lza-nip-egress-attachment', '012504444721', 'vpc'],
  ['lza-nip-prod-attachment', '682120332009', 'vpc'],
  ['lza-ramdor-prod-attachment', '769181184689', 'vpc'],
  ['lza-ramdor-afi-nat-attachment', '929570730750', 'vpc'],
  ['lza-ramdor-ftp-attachment', '115963247600', 'vpc'],
  ['AFI1-Properties', '182790204395', 'vpn'],
  ['AFI2-Residences', '182790204395', 'vpn'],
  ['lza-nip-s2s-vpn', '182790204395', 'vpn'],
  ['lza-nip-s2s-vpn-jer', '182790204395', 'vpn'],
];
function event(): CloudFormationCustomResourceEvent {
  const serviceToken = 'arn:aws:lambda:il-central-1:182790204395:function:lookup';
  return {
    RequestType: 'Create',
    ServiceToken: serviceToken,
    ResponseURL: 'https://example.invalid/offline-only',
    StackId: `arn:aws:cloudformation:il-central-1:182790204395:stack/${stackName}/local-test`,
    RequestId: 'local-test',
    LogicalResourceId: 'BatchTgwAttachmentLookup4DD094C3',
    ResourceType: 'Custom::GetTransitGatewayAttachment',
    ResourceProperties: {
      ServiceToken: serviceToken,
      uuid: '459c50a4-3196-46e2-abbf-b9ba54b16e6d',
      attachments: names.map(([name, account, type]) => ({
        name,
        owningAccountId: account,
        type,
        transitGatewayId: tgwId,
        ...(type === 'vpc'
          ? { roleArn: `arn:aws:iam::${account}:role/lza-nip-GetTgwAttachmentRole-il-central-1` }
          : {}),
      })),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.sts.mockResolvedValue({
    Credentials: { AccessKeyId: 'offline', SecretAccessKey: 'offline', SessionToken: 'offline' },
  });
  calls.ec2.mockImplementation(async command => {
    if (command instanceof DescribeVpnConnectionsCommand) {
      const name = command.input.Filters?.find(filter => filter.Name === 'tag:Name')?.Values?.[0];
      if (!name || name.startsWith('AFI')) throw new Error('AFI must never be looked up');
      return { VpnConnections: [{ VpnConnectionId: `vpn-${name}` }] };
    }
    if (command instanceof DescribeTransitGatewayAttachmentsCommand) {
      return {
        TransitGatewayAttachments: names
          .filter((_, i) => i !== 6 && i !== 7)
          .map(([name, , type]) => ({
            TransitGatewayAttachmentId: `attachment-${name}`,
            ResourceId: `vpn-${name}`,
            TransitGatewayId: tgwId,
            State: 'available',
            ResourceType: type,
            Tags: [{ Key: 'Name', Value: name }],
          })),
      };
    }
    throw new Error('Unexpected AWS command in offline test');
  });
});

describe('AFI handover provider with the actual source handler', () => {
  it('succeeds when both AFI VPNs are absent, preserving all ten response positions', async () => {
    const result = await handler(event());
    expect(result?.Data?.attachmentIds.split(',')).toEqual(
      names.map(([name], i) =>
        i === 6 ? 'tgw-attach-03c0e823f59faed92' : i === 7 ? 'tgw-attach-0536baca56709278c' : `attachment-${name}`,
      ),
    );
    expect(calls.ec2).toHaveBeenCalled();
    const lookedUpNames = calls.ec2.mock.calls
      .filter(([command]) => command instanceof DescribeVpnConnectionsCommand)
      .map(
        ([command]) => command.input.Filters.find((filter: { Name: string }) => filter.Name === 'tag:Name').Values[0],
      );
    expect(new Set(lookedUpNames)).toEqual(new Set(['lza-nip-s2s-vpn', 'lza-nip-s2s-vpn-jer']));
  });

  it('does not hide a missing corporate VPN', async () => {
    calls.ec2.mockImplementation(async command => {
      if (command instanceof DescribeVpnConnectionsCommand) return { VpnConnections: [] };
      return {
        TransitGatewayAttachments: [
          {
            TransitGatewayAttachmentId: 'available-attachment',
            ResourceId: 'vpn-missing',
            TransitGatewayId: tgwId,
            State: 'available',
          },
        ],
      };
    });
    await expect(handler(event())).rejects.toThrow();
  });

  it.each(['account', 'region', 'stack', 'resource'])('does not retire lookups outside the exact scope: %s', kind => {
    const input = event();
    if (kind === 'account') input.StackId = input.StackId.replace(':182790204395:', ':111111111111:');
    if (kind === 'region') input.StackId = input.StackId.replace(':il-central-1:', ':us-east-1:');
    if (kind === 'stack') input.StackId = input.StackId.replace(stackName, 'another-stack');
    if (kind === 'resource') input.LogicalResourceId = 'AnotherResource';
    expect(retiredAfiLookupResults(input)).toEqual([]);
  });

  it.each(['uuid', 'name', 'tgw', 'role', 'length'])('refuses unexpected input before AWS reads: %s', kind => {
    const input = event();
    if (kind === 'uuid') input.ResourceProperties['uuid'] = 'changed';
    if (kind === 'name') input.ResourceProperties['attachments'][6].name = 'changed';
    if (kind === 'tgw') input.ResourceProperties['attachments'][0].transitGatewayId = 'changed';
    if (kind === 'role') input.ResourceProperties['attachments'][0].roleArn = 'changed';
    if (kind === 'length') input.ResourceProperties['attachments'].pop();
    expect(() => retiredAfiLookupResults(input)).toThrow(/baseline drift/);
    expect(calls.ec2).not.toHaveBeenCalled();
    expect(calls.sts).not.toHaveBeenCalled();
  });

  it('performs no AWS operations on Delete', async () => {
    const input = { ...event(), RequestType: 'Delete' as const, PhysicalResourceId: 'batch' };
    expect((await handler(input))?.Status).toBe('SUCCESS');
    expect(calls.ec2).not.toHaveBeenCalled();
    expect(calls.sts).not.toHaveBeenCalled();
  });
});
