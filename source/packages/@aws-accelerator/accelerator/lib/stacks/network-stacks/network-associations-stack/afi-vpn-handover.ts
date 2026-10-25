/**
 * Ramdor AFI ownership handover. Local customization for LZA v1.14.5 only.
 * Keep retired slots so existing Fn::Select references do not move.
 * No AFI VPN, CGW, route or association is created by this helper.
 */
export const AFI_HANDOVER_STACK = 'lza-nip-NetworkAssociationsStack-182790204395-il-central-1';
export const AFI_HANDOVER_UUID = '459c50a4-3196-46e2-abbf-b9ba54b16e6d';

interface Lookup {
  name: string;
  owningAccountId: string;
  transitGatewayId: string;
  type: string;
  roleName?: string;
  isSameAccountRegionAccepter?: boolean;
  crossAccountVpnOptions?: unknown;
}

const liveLayout = [
  ['lza-nip-shared-services-attachment', '863819359187', 'vpc'],
  ['lza-nip-egress-attachment', '012504444721', 'vpc'],
  ['lza-nip-prod-attachment', '682120332009', 'vpc'],
  ['lza-ramdor-prod-attachment', '769181184689', 'vpc'],
  ['lza-ramdor-afi-nat-attachment', '929570730750', 'vpc'],
  ['lza-ramdor-ftp-attachment', '115963247600', 'vpc'],
  ['lza-nip-s2s-vpn', '182790204395', 'vpn'],
  ['lza-nip-s2s-vpn-jer', '182790204395', 'vpn'],
];

/**
 * Strict baseline lock, not a general network extension mechanism.
 * Additions, removals or changes to the eight live lookups require a reviewed
 * rebase of this customization. Other stacks retain upstream behavior.
 */
export function preserveAfiLookupLayout<T extends Lookup>(
  stackName: string,
  lookups: Record<string, T>,
): Record<string, T> {
  if (stackName !== AFI_HANDOVER_STACK) return lookups;
  const entries = Object.entries(lookups);
  const tgwId = entries[0]?.[1].transitGatewayId;
  if (!tgwId || entries.length !== liveLayout.length) {
    throw new Error('AFI handover baseline drift: expected exactly eight live TGW lookups; review the customization.');
  }
  liveLayout.forEach(([name, account, type], index) => {
    const [key, item] = entries[index];
    const roleName = type === 'vpc' ? 'lza-nip-GetTgwAttachmentRole-il-central-1' : undefined;
    if (
      (type === 'vpn' && key !== `${name}_lza-nip-tgw`) ||
      (type === 'vpc' && !key.startsWith('lza-nip-tgw_')) ||
      item.name !== name ||
      item.owningAccountId !== account ||
      item.type !== type ||
      item.transitGatewayId !== tgwId ||
      item.roleName !== roleName ||
      item.isSameAccountRegionAccepter !== undefined ||
      item.crossAccountVpnOptions !== undefined
    ) {
      throw new Error(`AFI handover baseline drift at lookup ${index}: ${key}; review the customization.`);
    }
  });
  const vpnTemplate = entries[6][1];
  const retired: [string, T][] = ['AFI1-Properties', 'AFI2-Residences'].map(name => [
    `${name}_lza-nip-tgw`,
    { ...vpnTemplate, name },
  ]);
  return Object.fromEntries([...entries.slice(0, 6), ...retired, ...entries.slice(6)]);
}
