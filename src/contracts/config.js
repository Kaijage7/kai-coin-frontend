/**
 * KAI Contract Configuration
 *
 * Deployed contract addresses and ABIs for frontend integration
 */

// Network configurations
export const NETWORKS = {
  polygon: {
    chainId: 137,
    name: 'Polygon Mainnet',
    rpcUrl: 'https://polygon-rpc.com',
    explorer: 'https://polygonscan.com',
    currency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 }
  },
  amoy: {
    chainId: 80002,
    name: 'Polygon Amoy Testnet',
    rpcUrl: 'https://rpc-amoy.polygon.technology',
    explorer: 'https://www.oklink.com/amoy',
    currency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 }
  },
  hardhat: {
    chainId: 31337,
    name: 'Hardhat Local',
    rpcUrl: 'http://127.0.0.1:8545',
    explorer: '',
    currency: { name: 'ETH', symbol: 'ETH', decimals: 18 }
  }
}

// Default network (change this when deploying)
export const DEFAULT_NETWORK = 'amoy'

// Contract addresses (update after deployment)
export const CONTRACT_ADDRESSES = {
  hardhat: {
    KAIToken: '',
    KAIRevenue: '',
    KAIGovernance: '',
    ClimateAlertStaking: '',
    KAI_Oracle: '',
    KaiHealth: '',
    KAI_Agriculture: '',
    KAI_LawEvidence: '',
    KaiDisasterResponse: '',
    KAIVesting: ''
  },
  amoy: {
    KAIToken: '',
    KAIRevenue: '',
    KAIGovernance: '',
    ClimateAlertStaking: '',
    KAI_Oracle: '',
    KaiHealth: '',
    KAI_Agriculture: '',
    KAI_LawEvidence: '',
    KaiDisasterResponse: '',
    KAIVesting: ''
  },
  polygon: {
    KAIToken: '',
    KAIRevenue: '',
    KAIGovernance: '',
    ClimateAlertStaking: '',
    KAI_Oracle: '',
    KaiHealth: '',
    KAI_Agriculture: '',
    KAI_LawEvidence: '',
    KaiDisasterResponse: '',
    KAIVesting: ''
  }
}

// Minimal ABIs for frontend interaction
export const ABIS = {
  // KAI Token - ERC20 + custom functions
  KAIToken: [
    // ERC20 Standard
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
    'function totalSupply() view returns (uint256)',
    'function balanceOf(address account) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function transferFrom(address from, address to, uint256 amount) returns (bool)',
    // Custom
    'function totalBurned() view returns (uint256)',
    'function burnedByAddress(address account) view returns (uint256)',
    'function getPillarBurnRate(uint8 pillarId) view returns (uint256)',
    'function directBurn(uint256 amount, uint8 pillarId, string reason)',
    // Events
    'event Transfer(address indexed from, address indexed to, uint256 value)',
    'event Approval(address indexed owner, address indexed spender, uint256 value)',
    'event PillarBurn(address indexed burner, uint8 indexed pillarId, uint256 amount, string reason)'
  ],

  // Revenue Contract
  KAIRevenue: [
    'function kaiToken() view returns (address)',
    'function treasury() view returns (address)',
    'function totalRevenue() view returns (uint256)',
    'function monthlyRevenue() view returns (uint256)',
    'function ALERT_BASIC() view returns (uint256)',
    'function ALERT_URGENT() view returns (uint256)',
    'function SUBSCRIPTION_BASIC() view returns (uint256)',
    'function SUBSCRIPTION_PREMIUM() view returns (uint256)',
    'function buyAlert(uint8 alertType) returns (uint256)',
    'function subscribe(uint8 plan)',
    'function hasActiveSubscription(address user) view returns (bool)',
    'function getUserStats(address user) view returns (uint256 alertCount, uint256 totalSpent, bool isSubscribed)',
    'event RevenueCollected(uint256 amount, uint256 totalRevenue)',
    'event SubscriptionCreated(address indexed user, uint8 plan, uint256 expiresAt)'
  ],

  // Governance / DAO
  KAIGovernance: [
    'function kaiToken() view returns (address)',
    'function proposalCount() view returns (uint256)',
    'function quorumThreshold() view returns (uint256)',
    'function votingPeriod() view returns (uint256)',
    'function propose(string title, string description, uint8 proposalType) returns (uint256)',
    'function vote(uint256 proposalId, bool support)',
    'function executeProposal(uint256 proposalId)',
    'function getProposal(uint256 proposalId) view returns (tuple)',
    'function hasVoted(uint256 proposalId, address voter) view returns (bool)',
    'event ProposalCreated(uint256 indexed proposalId, address proposer, string title)',
    'event VoteCast(uint256 indexed proposalId, address indexed voter, bool support, uint256 weight)',
    'event ProposalExecuted(uint256 indexed proposalId)'
  ],

  // Climate Alert Staking
  ClimateAlertStaking: [
    'function kaiToken() view returns (address)',
    'function minimumStake() view returns (uint256)',
    'function stakingDuration() view returns (uint256)',
    'function totalStaked() view returns (uint256)',
    'function stake(uint256 amount)',
    'function unstake()',
    'function claimRewards()',
    'function getStakeInfo(address staker) view returns (uint256 amount, uint256 timestamp, uint256 rewards)',
    'function calculateRewards(address staker) view returns (uint256)',
    'event Staked(address indexed user, uint256 amount)',
    'event Unstaked(address indexed user, uint256 amount)',
    'event RewardsClaimed(address indexed user, uint256 amount)'
  ],

  // Oracle
  KAI_Oracle: [
    'function getRiskLevel(string region, uint8 riskType) view returns (uint8)',
    'function getLatestData(string region) view returns (tuple)',
    'function isHighRisk(string region) view returns (bool)',
    'event DataUpdated(string indexed region, uint8 riskType, uint8 level)',
    'event AlertTriggered(string indexed region, uint8 severity)'
  ],

  // Health
  KaiHealth: [
    'function inspectionFee() view returns (uint256)',
    'function getInspection(uint256 inspectionId) view returns (tuple)',
    'function requestInspection(string facilityName, string location) payable returns (uint256)',
    'function certifyFacility(uint256 inspectionId, string certificateHash)',
    'event InspectionRequested(uint256 indexed id, address requester, string facilityName)',
    'event InspectionCompleted(uint256 indexed id, bool passed)',
    'event FacilityCertified(uint256 indexed id, string certificateHash)'
  ],

  // Agriculture
  KAI_Agriculture: [
    'function getPolicyDetails(uint256 policyId) view returns (tuple)',
    'function createPolicy(string cropType, uint256 coverage, string region) payable returns (uint256)',
    'function claimPolicy(uint256 policyId, string evidenceHash)',
    'event PolicyCreated(uint256 indexed policyId, address farmer, string cropType, uint256 coverage)',
    'event ClaimFiled(uint256 indexed policyId, string evidenceHash)',
    'event ClaimPaid(uint256 indexed policyId, uint256 amount)'
  ],

  // Law / Evidence
  KAI_LawEvidence: [
    'function getEvidence(bytes32 evidenceHash) view returns (tuple)',
    'function submitEvidence(bytes32 evidenceHash, string description) returns (uint256)',
    'function verifyEvidence(bytes32 evidenceHash) view returns (bool exists, uint256 timestamp, address submitter)',
    'event EvidenceSubmitted(bytes32 indexed hash, address indexed submitter, uint256 timestamp)',
    'event EvidenceVerified(bytes32 indexed hash)'
  ],

  // Disaster Response
  KaiDisasterResponse: [
    'function emergencyFund() view returns (uint256)',
    'function getIncident(uint256 incidentId) view returns (tuple)',
    'function reportIncident(uint8 disasterType, string location, uint8 severity, string description) returns (uint256)',
    'function requestAid(uint256 incidentId, uint256 amount, string reason)',
    'event IncidentReported(uint256 indexed id, uint8 disasterType, string location, uint8 severity)',
    'event AidRequested(uint256 indexed incidentId, address requester, uint256 amount)',
    'event AidDisbursed(uint256 indexed incidentId, address recipient, uint256 amount)'
  ],

  // Vesting
  KAIVesting: [
    'function token() view returns (address)',
    'function getVestingSchedule(address beneficiary) view returns (tuple)',
    'function releasable(address beneficiary) view returns (uint256)',
    'function release(address beneficiary)',
    'event VestingScheduleCreated(address indexed beneficiary, uint256 amount, uint256 cliff, uint256 duration)',
    'event TokensReleased(address indexed beneficiary, uint256 amount)'
  ]
}

// Get contract config for current network
export function getContractConfig(networkId = DEFAULT_NETWORK) {
  return {
    network: NETWORKS[networkId],
    addresses: CONTRACT_ADDRESSES[networkId],
    abis: ABIS
  }
}

// Helper to get explorer URL for address
export function getExplorerUrl(address, networkId = DEFAULT_NETWORK) {
  const explorer = NETWORKS[networkId]?.explorer
  if (!explorer) return ''
  return `${explorer}/address/${address}`
}

// Helper to get explorer URL for transaction
export function getTxExplorerUrl(txHash, networkId = DEFAULT_NETWORK) {
  const explorer = NETWORKS[networkId]?.explorer
  if (!explorer) return ''
  return `${explorer}/tx/${txHash}`
}

export default {
  NETWORKS,
  DEFAULT_NETWORK,
  CONTRACT_ADDRESSES,
  ABIS,
  getContractConfig,
  getExplorerUrl,
  getTxExplorerUrl
}
