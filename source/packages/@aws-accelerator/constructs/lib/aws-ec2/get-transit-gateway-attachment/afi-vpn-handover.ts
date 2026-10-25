/**
 * Ramdor AFI ownership handover. Local customization for LZA v1.14.5 only.
 * Retired slot values are inert response padding, not live resource references.
 * They are never looked up or consumed by a managed route/association.
 */
const STACK_NAME = 'lza-nip-NetworkAssociationsStack-182790204395-il-central-1';
const UUID = '459c50a4-3196-46e2-abbf-b9ba54b16e6d';
const TGW_ID = 'tgw-0718ca7fa7c9621ff';
const layout = [
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

interface LookupEvent {
  StackId: string;
  LogicalResourceId: string;
  ResourceProperties: { [key: string]: unknown };
}

export function retiredAfiLookupResults(event: LookupEvent): Array<{ id: string; index: number }> {
  const arn = event.StackId.split(':');
  const stackName = arn.slice(5).join(':').split('/')[1];
  if (
    arn[1] !== 'aws' ||
    arn[2] !== 'cloudformation' ||
    arn[3] !== 'il-central-1' ||
    arn[4] !== '182790204395' ||
    stackName !== STACK_NAME ||
    event.LogicalResourceId !== 'BatchTgwAttachmentLookup4DD094C3'
  )
    return [];

  const inputs = event.ResourceProperties['attachments'];
  if (event.ResourceProperties['uuid'] !== UUID || !Array.isArray(inputs) || inputs.length !== layout.length)
    throw new Error('AFI handover provider baseline drift; refuse to resolve the shared batch.');

  layout.forEach(([name, account, type], index) => {
    const item = inputs[index];
    const roleArn =
      type === 'vpc' ? `arn:aws:iam::${account}:role/lza-nip-GetTgwAttachmentRole-il-central-1` : undefined;
    if (
      !item ||
      item.name !== name ||
      item.type !== type ||
      item.owningAccountId !== account ||
      item.transitGatewayId !== TGW_ID ||
      item.roleArn !== roleArn ||
      item.isSameAccountRegionAccepter !== undefined ||
      item.crossAccountVpnOptions !== undefined
    )
      throw new Error(`AFI handover provider baseline drift at slot ${index}.`);
  });
  return [
    { index: 6, id: 'tgw-attach-03c0e823f59faed92' },
    { index: 7, id: 'tgw-attach-0536baca56709278c' },
  ];
}
