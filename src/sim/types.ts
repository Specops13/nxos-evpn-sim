export type Role = 'super-spine' | 'spine' | 'leaf' | 'border-gateway' | 'host';

export type BgpFsm = 'Idle' | 'Connect' | 'Active' | 'OpenSent' | 'OpenConfirm' | 'Established';
export type OspfFsm = 'Down' | 'Init' | 'ExStart' | 'Exchange' | 'Loading' | 'Full';

export interface Ipv4Addr {
  ip: string;
  prefix: number;
  secondary?: boolean;
  tag?: number;
}

export interface OspfIfCfg {
  tag: string;
  area: string;
  network: 'point-to-point' | 'broadcast';
}

export interface NveMember {
  vni: number;
  associateVrf?: boolean;
  mcastGroup?: string;
  ingressReplicationBgp?: boolean;
  multisiteIngressReplication?: boolean;
}

export interface InterfaceCfg {
  name: string;
  description?: string;
  adminDown: boolean;
  switchport: boolean;
  mode: 'access' | 'trunk';
  accessVlan: number;
  /** 'all' or an explicit allowed list. */
  trunkVlans: number[] | 'all';
  vrf: string;
  ips: Ipv4Addr[];
  ospf?: OspfIfCfg;
  ipForward?: boolean;
  anycastGateway?: boolean;
  vpcPeerLink?: boolean;
  vpcId?: number;
  evpnMultisite?: 'dci-tracking' | 'fabric-tracking';
  esi?: string;
  nveSource?: string;
  nveHostReachBgp?: boolean;
  nveMultisiteIf?: string;
  nveMembers: NveMember[];
  suppressArp?: boolean;
}

export interface VlanCfg {
  id: number;
  name?: string;
  vnSegment?: number;
}

export interface RtCfg {
  dir: 'import' | 'export' | 'both';
  value: 'auto' | string;
  evpn: boolean;
}

export interface VrfAfCfg {
  routeTargets: RtCfg[];
  redistributeDirect?: { routeMap?: string };
}

export interface VrfCfg {
  name: string;
  vni?: number;
  rd?: 'auto' | string;
  afs: { ipv4?: VrfAfCfg };
}

export interface RouteMapEntry {
  seq: number;
  action: 'permit' | 'deny';
  matchInterface?: string;
  matchTag?: number;
  setNextHopUnchanged?: boolean;
}

export interface RouteMapCfg {
  name: string;
  entries: RouteMapEntry[];
}

export interface BgpAfCfg {
  retainRouteTargetAll?: boolean;
  /** eBGP multipath (NX-OS `maximum-paths`). */
  maximumPaths?: number;
  maximumPathsIbgp?: number;
  networks: string[];
  redistributeDirect?: { routeMap?: string };
  nextHopRouteMap?: string;
}

export interface BgpNbrAf {
  sendCommunity?: 'extended' | 'standard' | 'both';
  routeReflectorClient?: boolean;
  /** When set, allowas-in is configured. Number is the occurrence count (default 3). */
  allowAsIn?: number;
  disablePeerAsCheck?: boolean;
  rewriteEvpnRtAsn?: boolean;
  routeMapIn?: string;
  routeMapOut?: string;
}

export interface BgpNeighborCfg {
  address: string;
  remoteAs?: number;
  updateSource?: string;
  ebgpMultihop?: number;
  peerType?: 'fabric-external' | 'fabric-internal';
  afs: { ipv4?: BgpNbrAf; l2vpn?: BgpNbrAf };
}

export interface BgpVrfCfg {
  name: string;
  afs: { ipv4?: BgpAfCfg };
}

export interface BgpCfg {
  asn: number;
  routerId?: string;
  afs: { ipv4?: BgpAfCfg; l2vpn?: BgpAfCfg };
  neighbors: BgpNeighborCfg[];
  vrfs: BgpVrfCfg[];
}

export interface OspfProcCfg {
  tag: string;
  routerId?: string;
}

export interface EvpnVniCfg {
  vni: number;
  rd?: 'auto' | string;
  importRt: ('auto' | string)[];
  exportRt: ('auto' | string)[];
}

export interface VpcCfg {
  domain: number;
  keepaliveDest?: string;
  keepaliveSrc?: string;
  keepaliveVrf?: string;
  rolePriority: number;
  peerGateway?: boolean;
}

export interface DeviceCfg {
  hostname: string;
  features: string[];
  nvOverlayEvpn: boolean;
  anycastGatewayMac?: string;
  multisiteBgw?: number;
  vlans: VlanCfg[];
  vrfs: VrfCfg[];
  interfaces: InterfaceCfg[];
  ospf: OspfProcCfg[];
  bgp?: BgpCfg;
  evpnVnis: EvpnVniCfg[];
  vpc?: VpcCfg;
  routeMaps: RouteMapCfg[];
}

export interface HostCfg {
  mac: string;
  ip: string;
  prefix: number;
  vlan: number;
  gateway: string;
}

export interface RibPath {
  nextHop: string;
  intf: string;
  pref: number;
  metric: number;
  protocol: string;
  best: boolean;
  attached?: boolean;
  /** Present on overlay paths. Show as next-hop%vrf. */
  nhVrf?: string;
  vni?: number;
  routerMac?: string;
  internal?: boolean;
  tag?: number;
}

export interface RibRoute {
  vrf: string;
  prefix: string;
  paths: RibPath[];
}

export interface EvpnRoute {
  type: 1 | 2 | 3 | 4 | 5;
  rd: string;
  esi: string;
  ethTag: number;
  mac?: string;
  macIp?: string;
  prefix?: string;
  label: number;
  label2?: number;
  nextHop: string;
  routerMac?: string;
  rts: string[];
  asPath: number[];
  localPref?: number;
  origin: 'i' | 'e' | '?';
  source: 'local' | 'ibgp' | 'ebgp';
  peer: string;
  fromClient?: boolean;
  cluster: string[];
  weight: number;
  best: boolean;
  valid: boolean;
  multipath?: boolean;
  metric: number;
  reoriginatedBy: string[];
  learnedFrom: 'local' | 'fabric' | 'external';
  vni: number;
}

export interface BgpIpRoute {
  prefix: string;
  nextHop: string;
  asPath: number[];
  localPref?: number;
  origin: 'i' | 'e' | '?';
  source: 'local' | 'ibgp' | 'ebgp';
  peer: string;
  fromClient?: boolean;
  cluster: string[];
  weight: number;
  best: boolean;
  valid: boolean;
  multipath?: boolean;
  metric: number;
  tag?: number;
}

export interface BgpPeerOp {
  address: string;
  state: BgpFsm;
  since: number;
  msgIn: number;
  msgOut: number;
  ipv4Pfx: number;
  evpnPfx: number;
}

export interface OspfNbrOp {
  tag: string;
  routerId: string;
  priority: number;
  state: OspfFsm;
  address: string;
  intf: string;
  since: number;
  /** DR, BDR, or '-' for point-to-point. */
  role: 'DR' | 'BDR' | '-';
}

export interface LldpNbr {
  deviceId: string;
  localIntf: string;
  portId: string;
  hold: number;
  capability: string;
}

export interface L2Mac {
  vlan: number;
  mac: string;
  prod: 'Local' | 'BGP';
  nextHop: string;
}

export interface L2MacIp {
  vlan: number;
  mac: string;
  ip: string;
  prod: 'Local' | 'BGP';
  nextHop: string;
}

export interface MacRow {
  vlan: number;
  mac: string;
  type: 'dynamic' | 'static';
  flag: '*' | 'C' | 'G' | 'O';
  port: string;
  peerIp?: string;
}

export interface NvePeerOp {
  peerIp: string;
  state: 'Up' | 'Down';
  learn: 'CP';
  routerMac: string;
  since: number;
  vnis: number[];
}

export interface NveVniOp {
  vni: number;
  mcast: string;
  up: boolean;
  kind: 'L2' | 'L3';
  bd: string;
  flags: string;
}

export interface VpcOp {
  peerStatus: string;
  keepalive: string;
  consistency: string;
  role: 'primary' | 'secondary' | 'none established';
  peerLinkIf: string;
  peerLinkUp: boolean;
  activeVlans: string;
  members: { id: number; port: string; up: boolean; vlans: string }[];
}

export interface EsiOp {
  esi: string;
  intf: string;
  up: boolean;
  df: boolean;
  dfIp: string;
  vteps: { ip: string; df: boolean }[];
  algo: 'Modulus';
}

export interface OpState {
  ifOper: Record<string, boolean>;
  lldp: LldpNbr[];
  cdp: LldpNbr[];
  ospfNbrs: OspfNbrOp[];
  rib: RibRoute[];
  vrfRib: Record<string, RibRoute[]>;
  bgpPeers: BgpPeerOp[];
  bgpIpv4: BgpIpRoute[];
  evpn: EvpnRoute[];
  bgpTableVersion: number;
  l2mac: L2Mac[];
  l2macip: L2MacIp[];
  macTable: MacRow[];
  nvePeers: NvePeerOp[];
  nveVnis: NveVniOp[];
  vpc?: VpcOp;
  esi: EsiOp[];
}

export interface FsmMem {
  ospf: Record<string, { state: OspfFsm; since: number }>;
  bgp: Record<string, { state: BgpFsm; since: number; msgIn: number; msgOut: number }>;
  nveSince: Record<string, number>;
  ribInV4: Record<string, BgpIpRoute[]>;
  ribInEvpn: Record<string, EvpnRoute[]>;
}

export interface Device {
  id: string;
  role: Role;
  x: number;
  y: number;
  systemMac: string;
  config: DeviceCfg;
  startup: DeviceCfg | null;
  host?: HostCfg;
  op: OpState;
  mem: FsmMem;
}

export interface Link {
  id: string;
  a: { device: string; intf: string };
  b: { device: string; intf: string };
}

export interface TopologyFile {
  version: 1;
  name: string;
  devices: {
    id: string;
    role: Role;
    x: number;
    y: number;
    systemMac: string;
    config: DeviceCfg;
    host?: HostCfg;
  }[];
  links: { aDevice: string; aIntf: string; bDevice: string; bIntf: string }[];
}
