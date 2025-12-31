/**
 * KAI Contract Hooks
 *
 * React hooks for interacting with KAI smart contracts
 */

import { useState, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'
import { getContractConfig, NETWORKS } from '../contracts/config'

// Get provider
const getProvider = () => {
  if (typeof window.ethereum !== 'undefined') {
    return new ethers.BrowserProvider(window.ethereum)
  }
  return null
}

// Get signer
const getSigner = async () => {
  const provider = getProvider()
  if (!provider) return null
  return provider.getSigner()
}

// Get contract instance
const getContract = async (contractName, withSigner = false) => {
  const config = getContractConfig()
  const address = config.addresses[contractName]
  const abi = config.abis[contractName]

  if (!address || !abi) {
    throw new Error(`Contract ${contractName} not configured`)
  }

  const provider = getProvider()
  if (!provider) {
    throw new Error('No wallet provider found')
  }

  if (withSigner) {
    const signer = await getSigner()
    return new ethers.Contract(address, abi, signer)
  }

  return new ethers.Contract(address, abi, provider)
}

/**
 * Hook to manage wallet connection
 */
export function useWallet() {
  const [account, setAccount] = useState(null)
  const [chainId, setChainId] = useState(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (typeof window.ethereum === 'undefined') return

    const handleAccountsChanged = (accounts) => {
      setAccount(accounts[0] || null)
    }

    const handleChainChanged = (newChainId) => {
      setChainId(parseInt(newChainId, 16))
    }

    window.ethereum.on('accountsChanged', handleAccountsChanged)
    window.ethereum.on('chainChanged', handleChainChanged)

    // Check if already connected
    window.ethereum.request({ method: 'eth_accounts' })
      .then(handleAccountsChanged)

    window.ethereum.request({ method: 'eth_chainId' })
      .then(handleChainChanged)

    return () => {
      window.ethereum.removeListener('accountsChanged', handleAccountsChanged)
      window.ethereum.removeListener('chainChanged', handleChainChanged)
    }
  }, [])

  const connect = useCallback(async () => {
    if (typeof window.ethereum === 'undefined') {
      setError('Please install MetaMask')
      return false
    }

    setIsConnecting(true)
    setError(null)

    try {
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts'
      })
      setAccount(accounts[0])
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setIsConnecting(false)
    }
  }, [])

  const switchNetwork = useCallback(async (networkId) => {
    const network = NETWORKS[networkId]
    if (!network) {
      setError('Unknown network')
      return false
    }

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${network.chainId.toString(16)}` }]
      })
      return true
    } catch (switchError) {
      // Network not added, try to add it
      if (switchError.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: `0x${network.chainId.toString(16)}`,
              chainName: network.name,
              rpcUrls: [network.rpcUrl],
              nativeCurrency: network.currency,
              blockExplorerUrls: network.explorer ? [network.explorer] : []
            }]
          })
          return true
        } catch (addError) {
          setError(addError.message)
          return false
        }
      }
      setError(switchError.message)
      return false
    }
  }, [])

  const disconnect = useCallback(() => {
    setAccount(null)
  }, [])

  return {
    account,
    chainId,
    isConnecting,
    error,
    isConnected: !!account,
    connect,
    disconnect,
    switchNetwork
  }
}

/**
 * Hook for KAI Token operations
 */
export function useKAIToken() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const getBalance = useCallback(async (address) => {
    setLoading(true)
    setError(null)
    try {
      const contract = await getContract('KAIToken')
      const balance = await contract.balanceOf(address)
      const decimals = await contract.decimals()
      return ethers.formatUnits(balance, decimals)
    } catch (err) {
      setError(err.message)
      return '0'
    } finally {
      setLoading(false)
    }
  }, [])

  const getTokenInfo = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const contract = await getContract('KAIToken')
      const [name, symbol, decimals, totalSupply, totalBurned] = await Promise.all([
        contract.name(),
        contract.symbol(),
        contract.decimals(),
        contract.totalSupply(),
        contract.totalBurned()
      ])
      return {
        name,
        symbol,
        decimals: Number(decimals),
        totalSupply: ethers.formatUnits(totalSupply, decimals),
        totalBurned: ethers.formatUnits(totalBurned, decimals)
      }
    } catch (err) {
      setError(err.message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const transfer = useCallback(async (to, amount) => {
    setLoading(true)
    setError(null)
    try {
      const contract = await getContract('KAIToken', true)
      const decimals = await contract.decimals()
      const amountWei = ethers.parseUnits(amount.toString(), decimals)
      const tx = await contract.transfer(to, amountWei)
      await tx.wait()
      return tx.hash
    } catch (err) {
      setError(err.message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const approve = useCallback(async (spender, amount) => {
    setLoading(true)
    setError(null)
    try {
      const contract = await getContract('KAIToken', true)
      const decimals = await contract.decimals()
      const amountWei = ethers.parseUnits(amount.toString(), decimals)
      const tx = await contract.approve(spender, amountWei)
      await tx.wait()
      return tx.hash
    } catch (err) {
      setError(err.message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const burn = useCallback(async (amount, pillarId, reason) => {
    setLoading(true)
    setError(null)
    try {
      const contract = await getContract('KAIToken', true)
      const decimals = await contract.decimals()
      const amountWei = ethers.parseUnits(amount.toString(), decimals)
      const tx = await contract.directBurn(amountWei, pillarId, reason)
      await tx.wait()
      return tx.hash
    } catch (err) {
      setError(err.message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  return {
    loading,
    error,
    getBalance,
    getTokenInfo,
    transfer,
    approve,
    burn
  }
}

/**
 * Hook for Revenue/Subscription operations
 */
export function useRevenue() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const getRevenueStats = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const contract = await getContract('KAIRevenue')
      const token = await getContract('KAIToken')
      const decimals = await token.decimals()

      const [totalRevenue, monthlyRevenue, alertBasic, alertUrgent, subBasic, subPremium] =
        await Promise.all([
          contract.totalRevenue(),
          contract.monthlyRevenue(),
          contract.ALERT_BASIC(),
          contract.ALERT_URGENT(),
          contract.SUBSCRIPTION_BASIC(),
          contract.SUBSCRIPTION_PREMIUM()
        ])

      return {
        totalRevenue: ethers.formatUnits(totalRevenue, decimals),
        monthlyRevenue: ethers.formatUnits(monthlyRevenue, decimals),
        pricing: {
          alertBasic: ethers.formatUnits(alertBasic, decimals),
          alertUrgent: ethers.formatUnits(alertUrgent, decimals),
          subscriptionBasic: ethers.formatUnits(subBasic, decimals),
          subscriptionPremium: ethers.formatUnits(subPremium, decimals)
        }
      }
    } catch (err) {
      setError(err.message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const buyAlert = useCallback(async (alertType) => {
    setLoading(true)
    setError(null)
    try {
      const contract = await getContract('KAIRevenue', true)
      const tx = await contract.buyAlert(alertType)
      const receipt = await tx.wait()
      return { txHash: tx.hash, receipt }
    } catch (err) {
      setError(err.message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const subscribe = useCallback(async (plan) => {
    setLoading(true)
    setError(null)
    try {
      const contract = await getContract('KAIRevenue', true)
      const tx = await contract.subscribe(plan)
      const receipt = await tx.wait()
      return { txHash: tx.hash, receipt }
    } catch (err) {
      setError(err.message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const getUserStats = useCallback(async (address) => {
    setLoading(true)
    setError(null)
    try {
      const contract = await getContract('KAIRevenue')
      const token = await getContract('KAIToken')
      const decimals = await token.decimals()

      const [alertCount, totalSpent, isSubscribed] = await contract.getUserStats(address)
      const hasActiveSub = await contract.hasActiveSubscription(address)

      return {
        alertCount: Number(alertCount),
        totalSpent: ethers.formatUnits(totalSpent, decimals),
        isSubscribed,
        hasActiveSubscription: hasActiveSub
      }
    } catch (err) {
      setError(err.message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  return {
    loading,
    error,
    getRevenueStats,
    buyAlert,
    subscribe,
    getUserStats
  }
}

/**
 * Hook for Staking operations
 */
export function useStaking() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const getStakingInfo = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const contract = await getContract('ClimateAlertStaking')
      const token = await getContract('KAIToken')
      const decimals = await token.decimals()

      const [minimumStake, stakingDuration, totalStaked] = await Promise.all([
        contract.minimumStake(),
        contract.stakingDuration(),
        contract.totalStaked()
      ])

      return {
        minimumStake: ethers.formatUnits(minimumStake, decimals),
        stakingDuration: Number(stakingDuration),
        totalStaked: ethers.formatUnits(totalStaked, decimals)
      }
    } catch (err) {
      setError(err.message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const getUserStake = useCallback(async (address) => {
    setLoading(true)
    setError(null)
    try {
      const contract = await getContract('ClimateAlertStaking')
      const token = await getContract('KAIToken')
      const decimals = await token.decimals()

      const [amount, timestamp, rewards] = await contract.getStakeInfo(address)
      const pendingRewards = await contract.calculateRewards(address)

      return {
        stakedAmount: ethers.formatUnits(amount, decimals),
        stakedAt: Number(timestamp),
        rewards: ethers.formatUnits(rewards, decimals),
        pendingRewards: ethers.formatUnits(pendingRewards, decimals)
      }
    } catch (err) {
      setError(err.message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const stake = useCallback(async (amount) => {
    setLoading(true)
    setError(null)
    try {
      const contract = await getContract('ClimateAlertStaking', true)
      const token = await getContract('KAIToken')
      const decimals = await token.decimals()
      const amountWei = ethers.parseUnits(amount.toString(), decimals)

      const tx = await contract.stake(amountWei)
      await tx.wait()
      return tx.hash
    } catch (err) {
      setError(err.message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const unstake = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const contract = await getContract('ClimateAlertStaking', true)
      const tx = await contract.unstake()
      await tx.wait()
      return tx.hash
    } catch (err) {
      setError(err.message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const claimRewards = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const contract = await getContract('ClimateAlertStaking', true)
      const tx = await contract.claimRewards()
      await tx.wait()
      return tx.hash
    } catch (err) {
      setError(err.message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  return {
    loading,
    error,
    getStakingInfo,
    getUserStake,
    stake,
    unstake,
    claimRewards
  }
}

/**
 * Hook for Governance operations
 */
export function useGovernance() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const getGovernanceInfo = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const contract = await getContract('KAIGovernance')
      const token = await getContract('KAIToken')
      const decimals = await token.decimals()

      const [proposalCount, quorumThreshold, votingPeriod] = await Promise.all([
        contract.proposalCount(),
        contract.quorumThreshold(),
        contract.votingPeriod()
      ])

      return {
        proposalCount: Number(proposalCount),
        quorumThreshold: ethers.formatUnits(quorumThreshold, decimals),
        votingPeriod: Number(votingPeriod)
      }
    } catch (err) {
      setError(err.message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const createProposal = useCallback(async (title, description, proposalType) => {
    setLoading(true)
    setError(null)
    try {
      const contract = await getContract('KAIGovernance', true)
      const tx = await contract.propose(title, description, proposalType)
      const receipt = await tx.wait()
      return { txHash: tx.hash, receipt }
    } catch (err) {
      setError(err.message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const vote = useCallback(async (proposalId, support) => {
    setLoading(true)
    setError(null)
    try {
      const contract = await getContract('KAIGovernance', true)
      const tx = await contract.vote(proposalId, support)
      await tx.wait()
      return tx.hash
    } catch (err) {
      setError(err.message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const executeProposal = useCallback(async (proposalId) => {
    setLoading(true)
    setError(null)
    try {
      const contract = await getContract('KAIGovernance', true)
      const tx = await contract.executeProposal(proposalId)
      await tx.wait()
      return tx.hash
    } catch (err) {
      setError(err.message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  return {
    loading,
    error,
    getGovernanceInfo,
    createProposal,
    vote,
    executeProposal
  }
}

export default {
  useWallet,
  useKAIToken,
  useRevenue,
  useStaking,
  useGovernance
}
