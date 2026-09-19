import { useState, useEffect, useMemo, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'
import {
  fetchOnChainVault,
  buildDepositInstruction,
  buildWithdrawInstruction,
  buildBorrowInstruction,
  buildMintOptionInstruction,
  buildSettleOptionInstruction,
  buildSetupStreamInstruction,
  buildRevokeStreamInstruction,
  buildLiquidateInstruction,
  fetchOnChainPythPrice,
  findMarketPda,
  findAssociatedTokenAddress,
} from '@/lib/solana'

type MarketState = 'OPEN' | 'CLOSED' | 'STALE'
type StrategyTab = 'borrow' | 'call' | 'stream'
type AppView = 'portfolio' | 'liquidations' | 'markets'

type AssetFeed = {
  symbol: string
  name: string
  ticker: string
  mintAddress: string
  priceFeedPubkey: string
  marketId: string
  price: number
  conf: number
  delta24h: number
}

type TxRecord = {
  id: string
  time: string
  action: string
  detail: string
  signature: string
}

type ActiveStream = {
  recipient: string
  amount: number
  startTime: number
  endTime: number
  cliffPct: number
  revocable: boolean
  released: number
}

type ActiveCall = {
  notional: number
  strike: number
  expiryDays: number
  premiumEarned: number
}

const ASSET_FEEDS: Record<string, AssetFeed> = {
  AAPLx: {
    symbol: 'AAPL',
    name: 'Apple Inc',
    ticker: 'AAPLx',
    mintAddress: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp',
    priceFeedPubkey: 'DJ2FyTgUAkEtXW3U5P9PF19meFTRtW4ZWKKFgACfVbUy',
    marketId: 'AAPLx',
    price: 224.23,
    conf: 0.08,
    delta24h: 0.74,
  },
  TSLAx: {
    symbol: 'TSLA',
    name: 'Tesla Inc',
    ticker: 'TSLAx',
    mintAddress: 'E8WFH8brgP58arcuW2wwsPHiomYrSvrgWTsRLZLAEZUQ',
    priceFeedPubkey: 'E8WFH8brgP58arcuW2wwsPHiomYrSvrgWTsRLZLAEZUQ',
    marketId: 'TSLAx',
    price: 248.50,
    conf: 0.12,
    delta24h: -1.15,
  },
  NVDAx: {
    symbol: 'NVDA',
    name: 'NVIDIA Corp',
    ticker: 'NVDAx',
    mintAddress: 'DJ2FyTgUAkEtXW3U5P9PF19meFTRtW4ZWKKFgACfVbUy',
    priceFeedPubkey: 'DJ2FyTgUAkEtXW3U5P9PF19meFTRtW4ZWKKFgACfVbUy',
    marketId: 'NVDAx',
    price: 116.00,
    conf: 0.06,
    delta24h: 1.82,
  },
}

export default function AppDashboard() {
  const { connection } = useConnection()
  const { publicKey, connected, disconnect, connecting, sendTransaction } = useWallet()
  const { setVisible } = useWalletModal()

  const [selectedAsset, setSelectedAsset] = useState<string>('AAPLx')
  const [marketState, setMarketState] = useState<MarketState>('OPEN')
  const [activeStrategy, setActiveStrategy] = useState<StrategyTab>('borrow')
  const [activeView, setActiveView] = useState<AppView>('portfolio')

  const [solBalance, setSolBalance] = useState<number | null>(null)
  const [airdropLoading, setAirdropLoading] = useState<boolean>(false)
  const [isTxPending, setIsTxPending] = useState<boolean>(false)

  const displayAddress = useMemo(() => {
    if (!publicKey) return ''
    const base58 = publicKey.toBase58()
    return `${base58.slice(0, 4)}…${base58.slice(-4)}`
  }, [publicKey])

  const handleWalletClick = () => {
    if (connected) {
      disconnect()
      showToast('Wallet Disconnected', 'Disconnected Solana wallet session.')
    } else {
      setVisible(true)
    }
  }

  const [prices, setPrices] = useState<Record<string, number>>({
    AAPLx: 224.23,
    TSLAx: 248.50,
    NVDAx: 116.00,
  })

  const [depositedShares, setDepositedShares] = useState<number>(0)
  const [walletShares, setWalletShares] = useState<number>(0)
  const [debtUsdc, setDebtUsdc] = useState<number>(0)

  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null)
  const [activeStream, setActiveStream] = useState<ActiveStream | null>(null)

  const [borrowInput, setBorrowInput] = useState<string>('')
  const [repayInput, setRepayInput] = useState<string>('')
  const [borrowMode, setBorrowMode] = useState<'borrow' | 'repay'>('borrow')

  const [callNotional, setCallNotional] = useState<string>('')
  const [callStrikePct, setCallStrikePct] = useState<number>(5)
  const [callExpiryDays, setCallExpiryDays] = useState<number>(30)

  const [streamRecipient, setStreamRecipient] = useState<string>('')
  const [streamShares, setStreamShares] = useState<string>('')
  const [streamDurationDays, setStreamDurationDays] = useState<number>(90)
  const [streamCliffPct, setStreamCliffPct] = useState<number>(25)
  const [streamRevocable, setStreamRevocable] = useState<boolean>(true)

  const [depositModalOpen, setDepositModalOpen] = useState<boolean>(false)
  const [withdrawModalOpen, setWithdrawModalOpen] = useState<boolean>(false)
  const [modalSharesInput, setModalSharesInput] = useState<string>('')

  const [clockTime, setClockTime] = useState<string>('14:32:00 UTC')
  const [feedAge, setFeedAge] = useState<number>(2)

  const [txHistory, setTxHistory] = useState<TxRecord[]>([])
  const [toastMessage, setToastMessage] = useState<{
    title: string
    desc: string
    type?: 'success' | 'error' | 'info'
  } | null>(null)

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date()
      const hh = String(now.getUTCHours()).padStart(2, '0')
      const mm = String(now.getUTCMinutes()).padStart(2, '0')
      const ss = String(now.getUTCSeconds()).padStart(2, '0')
      setClockTime(`${hh}:${mm}:${ss} UTC`)

      if (marketState === 'OPEN') {
        setFeedAge((prev) => (prev >= 5 ? 1 : prev + 1))
        setPrices((prev) => {
          const delta = (Math.random() - 0.49) * 0.12
          return {
            ...prev,
            [selectedAsset]: Math.max(10, Number((prev[selectedAsset] + delta).toFixed(2))),
          }
        })
      } else {
        setFeedAge((prev) => prev + 1)
      }
    }, 1000)

    return () => clearInterval(timer)
  }, [marketState, selectedAsset])

  useEffect(() => {
    if (!publicKey || !connected) {
      setSolBalance(null)
      return
    }

    let isMounted = true

    async function loadOnChainData() {
      const walletKey = publicKey
      if (!walletKey) return

      try {
        const bal = await connection.getBalance(walletKey)
        if (isMounted) setSolBalance(bal / 1e9)

        const currentAsset = ASSET_FEEDS[selectedAsset]
        if (!currentAsset) return
        const stockMint = new PublicKey(currentAsset.mintAddress)
        const onChainVault = await fetchOnChainVault(connection, walletKey, stockMint)

        if (onChainVault && isMounted) {
          const shares = onChainVault.collateralAmount.toNumber() / 1e8
          const debt = onChainVault.borrowedAmount.toNumber() / 1e6
          setDepositedShares(shares)
          setDebtUsdc(debt)

          if (onChainVault.activeStrategy === 2) {
            const notional = onChainVault.notionalAmount.toNumber() / 1e8
            const strike = onChainVault.strikePrice.toNumber() / 1e8
            const expiryDays = Math.max(
              0,
              Math.round((onChainVault.expiryTimestamp.toNumber() * 1000 - Date.now()) / (86400 * 1000)),
            )
            const premiumEarned = Number((notional * (prices[selectedAsset] || 224.23) * 0.045).toFixed(2))
            setActiveCall({ notional, strike, expiryDays, premiumEarned })
          } else if (onChainVault.activeStrategy === 3) {
            const amount = onChainVault.streamTotalAmount.toNumber() / 1e8
            const cliff = onChainVault.streamCliff.toNumber()
            const total = onChainVault.streamTotalAmount.toNumber()
            setActiveStream({
              recipient: onChainVault.streamRecipient.toBase58(),
              amount,
              startTime: onChainVault.streamStart.toNumber() * 1000,
              endTime: onChainVault.streamEnd.toNumber() * 1000,
              cliffPct: total > 0 ? Math.round((cliff / total) * 100) : 0,
              revocable: onChainVault.streamRevocable,
              released: onChainVault.streamReleasedAmount.toNumber() / 1e8,
            })
          }
        }

        const userAta = findAssociatedTokenAddress(stockMint, walletKey)
        try {
          const ataBal = await connection.getTokenAccountBalance(userAta)
          if (isMounted && ataBal.value.uiAmount !== null) {
            setWalletShares(ataBal.value.uiAmount)
          }
        } catch {}

        try {
          const pythData = await fetchOnChainPythPrice(connection, new PublicKey(currentAsset.priceFeedPubkey))
          if (pythData && isMounted && pythData.price > 0) {
            setPrices((prev) => ({
              ...prev,
              [selectedAsset]: Number(pythData.price.toFixed(2)),
            }))
            setFeedAge(Math.max(1, Math.floor(Date.now() / 1000) - pythData.publishTime))
          }
        } catch {}
      } catch {}
    }

    loadOnChainData()
    const syncInterval = setInterval(loadOnChainData, 10000)

    return () => {
      isMounted = false
      clearInterval(syncInterval)
    }
  }, [publicKey, connected, connection, selectedAsset, prices])

  const handleAirdropSol = async () => {
    if (!publicKey || !connected) {
      setVisible(true)
      return
    }
    setAirdropLoading(true)
    try {
      const sig = await connection.requestAirdrop(publicKey, 1e9)
      await connection.confirmTransaction(sig, 'confirmed')
      const bal = await connection.getBalance(publicKey)
      setSolBalance(bal / 1e9)
      showToast('Airdrop Confirmed', 'Received 1.0 SOL devnet gas.', 'success')
      logTransaction('AIRDROP', '1.0 SOL airdrop confirmed')
    } catch {
      showToast('Airdrop Limit', 'Devnet faucet rate limit reached. Please try again later or use an external faucet.', 'error')
    } finally {
      setAirdropLoading(false)
    }
  }

  const handleFaucetTokens = (amount = 100) => {
    setWalletShares((prev) => prev + amount)
    logTransaction('FAUCET', `Credited ${amount.toFixed(2)} ${assetInfo.ticker} test collateral`)
    showToast('Test Tokens Credited', `Added ${amount.toFixed(2)} ${assetInfo.ticker} to your wallet balance.`, 'success')
  }

  function parseFriendlyErrorMessage(err: unknown, fallbackMessage: string): string {
    const raw = err instanceof Error ? err.message : String(err || '')
    const message = raw.toLowerCase()

    if (message.includes('user rejected') || message.includes('cancelled') || message.includes('rejected')) {
      return 'Transaction was cancelled in your wallet.'
    }
    if (message.includes('insufficient funds') || message.includes('lamports')) {
      return 'Insufficient SOL to pay network transaction fee. Please request Devnet SOL.'
    }
    if (message.includes('insufficient collateral') || message.includes('insufficientcollateral')) {
      return 'Requested amount exceeds your available vault collateral.'
    }
    if (message.includes('ltv') || message.includes('liquidation') || message.includes('mathoverflow')) {
      return 'Operation exceeds allowable loan-to-value safety parameters.'
    }
    if (message.includes('invalidmarketstate') || message.includes('market')) {
      return 'Market state verification failed. Please refresh and retry.'
    }
    if (message.includes('invalidpricefeed') || message.includes('stale') || message.includes('pyth')) {
      return 'Market price feed is updating. Please try again in a few seconds.'
    }
    if (message.includes('incompatiblestrategy')) {
      return 'Another strategy is currently active on this vault.'
    }
    if (message.includes('streamnotrevocable')) {
      return 'This stream was designated as irrevocable at initialization.'
    }
    if (message.includes('optionnotexpired')) {
      return 'This option has not reached its maturity date yet.'
    }
    if (message.includes('unauthorized')) {
      return 'Wallet account is not authorized to manage this vault.'
    }
    return fallbackMessage
  }

  const showToast = (title: string, desc: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToastMessage({ title, desc, type })
    setTimeout(() => {
      setToastMessage(null)
    }, 4500)
  }

  const logTransaction = (action: string, detail: string) => {
    const now = new Date()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const ss = String(now.getSeconds()).padStart(2, '0')
    const signature = Math.random().toString(16).slice(2, 6) + '…' + Math.random().toString(16).slice(2, 6)

    setTxHistory((prev) => [
      {
        id: `tx-${Date.now()}`,
        time: `${hh}:${mm}:${ss}`,
        action,
        detail,
        signature,
      },
      ...prev.slice(0, 9),
    ])
  }

  const currentPrice = prices[selectedAsset] || 224.23
  const assetInfo = ASSET_FEEDS[selectedAsset]

  const ltvCap = marketState === 'OPEN' ? 0.65 : 0.40
  const liqThreshold = marketState === 'OPEN' ? 0.80 : 0.55
  const riskMultiplier = marketState === 'OPEN' ? 1.0000 : marketState === 'CLOSED' ? 0.8500 : 0.7000

  const collateralValueUsd = useMemo(() => {
    return depositedShares * currentPrice * riskMultiplier
  }, [depositedShares, currentPrice, riskMultiplier])

  const maxBorrowUsd = useMemo(() => {
    return Math.max(0, collateralValueUsd * ltvCap - debtUsdc)
  }, [collateralValueUsd, ltvCap, debtUsdc])

  const currentLtv = useMemo(() => {
    if (collateralValueUsd <= 0) return 0
    return (debtUsdc / collateralValueUsd) * 100
  }, [debtUsdc, collateralValueUsd])

  const healthFactor = useMemo(() => {
    if (debtUsdc <= 0) return null
    if (collateralValueUsd <= 0) return 0
    return (collateralValueUsd * liqThreshold) / debtUsdc
  }, [collateralValueUsd, liqThreshold, debtUsdc])

  const liquidationPrice = useMemo(() => {
    if (depositedShares <= 0 || debtUsdc <= 0) return 0
    return debtUsdc / (depositedShares * liqThreshold * riskMultiplier)
  }, [depositedShares, debtUsdc, liqThreshold, riskMultiplier])

  const liquidationBuffer = useMemo(() => {
    if (liquidationPrice <= 0 || currentPrice <= 0) return null
    return Math.max(0, ((currentPrice - liquidationPrice) / currentPrice) * 100)
  }, [currentPrice, liquidationPrice])

  const [chartTimeframe, setChartTimeframe] = useState<'24H' | '7D' | '30D'>('24H')

  const chartData = useMemo(() => {
    const base = currentPrice
    const ptsCount = 24
    const pts: { time: string; price: number }[] = []
    const volatility = chartTimeframe === '24H' ? 0.015 : chartTimeframe === '7D' ? 0.04 : 0.08
    const seed = selectedAsset === 'AAPLx' ? 42 : selectedAsset === 'TSLAx' ? 88 : 101

    for (let i = 0; i < ptsCount; i++) {
      const progress = i / (ptsCount - 1)
      const noise = Math.sin(i * 1.7 + seed) * Math.cos(i * 0.9) * volatility
      const trend = (progress - 1) * (assetInfo.delta24h / 100)
      const price = base * (1 + trend + noise)
      pts.push({
        time: `${i}h`,
        price: Number(price.toFixed(2)),
      })
    }
    pts[pts.length - 1].price = base

    const minP = Math.min(...pts.map((p) => p.price), liquidationPrice > 0 ? liquidationPrice * 0.95 : Infinity)
    const maxP = Math.max(...pts.map((p) => p.price))
    const range = maxP - minP || 1

    const width = 400
    const height = 110
    const padding = 10

    const coordinates = pts.map((pt, idx) => {
      const x = (idx / (ptsCount - 1)) * (width - padding * 2) + padding
      const y = height - padding - ((pt.price - minP) / range) * (height - padding * 2)
      return { x, y, price: pt.price }
    })

    const pathD = coordinates.reduce((acc, pt, idx) => {
      return idx === 0 ? `M ${pt.x},${pt.y}` : `${acc} L ${pt.x},${pt.y}`
    }, '')

    const areaD = `${pathD} L ${width - padding},${height} L ${padding},${height} Z`

    const liqY = liquidationPrice > 0 && liquidationPrice >= minP && liquidationPrice <= maxP
      ? height - padding - ((liquidationPrice - minP) / range) * (height - padding * 2)
      : null

    return { coordinates, pathD, areaD, minP, maxP, liqY, width, height }
  }, [currentPrice, selectedAsset, chartTimeframe, assetInfo.delta24h, liquidationPrice])

  const projectedBorrowLtv = useMemo(() => {
    const additional = parseFloat(borrowInput) || 0
    if (collateralValueUsd <= 0) return 0
    return ((debtUsdc + additional) / collateralValueUsd) * 100
  }, [borrowInput, debtUsdc, collateralValueUsd])

  const projectedBorrowHealth = useMemo(() => {
    const additional = parseFloat(borrowInput) || 0
    const newDebt = debtUsdc + additional
    if (newDebt <= 0) return null
    if (collateralValueUsd <= 0) return 0
    return (collateralValueUsd * liqThreshold) / newDebt
  }, [borrowInput, debtUsdc, collateralValueUsd, liqThreshold])

  const handleDeposit = async (e: FormEvent) => {
    e.preventDefault()
    if (!publicKey || !connected) {
      setVisible(true)
      return
    }
    const amount = parseFloat(modalSharesInput)
    if (!amount || amount <= 0) return

    setIsTxPending(true)
    try {
      const stockMint = new PublicKey(assetInfo.mintAddress)
      const marketStatePubkey = findMarketPda(assetInfo.marketId)[0]
      const amountBaseUnits = new BN(Math.round(amount * 1e8))
      const { transaction } = buildDepositInstruction(
        publicKey,
        stockMint,
        marketStatePubkey,
        amountBaseUnits,
      )

      const signature = await sendTransaction(transaction, connection)
      showToast('Transaction Broadcast', `Submitted: ${signature.slice(0, 8)}…`, 'info')

      await connection.confirmTransaction(signature, 'confirmed')

      setDepositedShares((prev) => prev + amount)
      setWalletShares((prev) => Math.max(0, prev - amount))
      setModalSharesInput('')
      setDepositModalOpen(false)
      logTransaction('DEPOSIT', `${amount.toFixed(2)} ${assetInfo.ticker} deposited on-chain`)
      showToast('Deposit Confirmed', `Successfully deposited ${amount.toFixed(2)} ${assetInfo.ticker} into your vault position.`, 'success')
    } catch (err: unknown) {
      showToast('Deposit Notice', parseFriendlyErrorMessage(err, 'Unable to deposit collateral right now. Please check your wallet and try again.'), 'error')
    } finally {
      setIsTxPending(false)
    }
  }

  const handleWithdraw = async (e: FormEvent) => {
    e.preventDefault()
    if (!publicKey || !connected) {
      setVisible(true)
      return
    }
    const amount = parseFloat(modalSharesInput)
    if (!amount || amount <= 0 || amount > depositedShares) return

    const remainingShares = depositedShares - amount
    const remainingValue = remainingShares * currentPrice * riskMultiplier
    if (debtUsdc > 0 && remainingValue * ltvCap < debtUsdc) {
      showToast('Withdrawal Blocked', 'Remaining collateral would exceed maximum allowable loan-to-value.', 'error')
      return
    }

    setIsTxPending(true)
    try {
      const stockMint = new PublicKey(assetInfo.mintAddress)
      const marketStatePubkey = findMarketPda(assetInfo.marketId)[0]
      const priceFeedPubkey = new PublicKey(assetInfo.priceFeedPubkey)
      const amountBaseUnits = new BN(Math.round(amount * 1e8))
      const { transaction } = buildWithdrawInstruction(
        publicKey,
        stockMint,
        marketStatePubkey,
        priceFeedPubkey,
        amountBaseUnits,
      )

      const signature = await sendTransaction(transaction, connection)
      showToast('Transaction Broadcast', `Submitted: ${signature.slice(0, 8)}…`, 'info')

      await connection.confirmTransaction(signature, 'confirmed')

      setDepositedShares((prev) => Math.max(0, prev - amount))
      setWalletShares((prev) => prev + amount)
      setModalSharesInput('')
      setWithdrawModalOpen(false)
      logTransaction('WITHDRAW', `${amount.toFixed(2)} ${assetInfo.ticker} withdrawn to wallet`)
      showToast('Withdrawal Confirmed', `Successfully returned ${amount.toFixed(2)} ${assetInfo.ticker} to your wallet.`, 'success')
    } catch (err: unknown) {
      showToast('Withdrawal Notice', parseFriendlyErrorMessage(err, 'Unable to withdraw collateral right now. Please check your position and try again.'), 'error')
    } finally {
      setIsTxPending(false)
    }
  }

  const handleBorrow = async (e: FormEvent) => {
    e.preventDefault()
    if (!publicKey || !connected) {
      setVisible(true)
      return
    }
    if (marketState === 'STALE') {
      showToast('Action Blocked', 'Oracle price feed is updating. New borrows are temporarily paused.', 'error')
      return
    }
    const amount = parseFloat(borrowInput)
    if (!amount || amount <= 0 || amount > maxBorrowUsd) return

    setIsTxPending(true)
    try {
      const stockMint = new PublicKey(assetInfo.mintAddress)
      const marketStatePubkey = findMarketPda(assetInfo.marketId)[0]
      const priceFeedPubkey = new PublicKey(assetInfo.priceFeedPubkey)
      const amountBaseUnits = new BN(Math.round(amount * 1e6))
      const { transaction } = buildBorrowInstruction(
        publicKey,
        stockMint,
        marketStatePubkey,
        priceFeedPubkey,
        amountBaseUnits,
      )

      const signature = await sendTransaction(transaction, connection)
      showToast('Transaction Broadcast', `Submitted: ${signature.slice(0, 8)}…`, 'info')

      await connection.confirmTransaction(signature, 'confirmed')

      setDebtUsdc((prev) => prev + amount)
      setBorrowInput('')
      logTransaction('BORROW', `${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} USDC borrowed`)
      showToast('Borrow Confirmed', `Successfully minted ${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} USDC to your wallet.`, 'success')
    } catch (err: unknown) {
      showToast('Borrow Notice', parseFriendlyErrorMessage(err, 'Unable to borrow USDC right now. Please verify your available borrowing power and try again.'), 'error')
    } finally {
      setIsTxPending(false)
    }
  }

  const handleRepay = (e: FormEvent) => {
    e.preventDefault()
    const amount = parseFloat(repayInput)
    if (!amount || amount <= 0) return
    const actualRepay = Math.min(amount, debtUsdc)

    setDebtUsdc((prev) => prev - actualRepay)
    setRepayInput('')
    logTransaction('REPAY', `${actualRepay.toLocaleString('en-US', { minimumFractionDigits: 2 })} USDC debt repaid`)
    showToast('Debt Repaid', `Successfully repaid ${actualRepay.toLocaleString('en-US', { minimumFractionDigits: 2 })} USDC.`, 'success')
  }

  const handleWriteCall = async (e: FormEvent) => {
    e.preventDefault()
    if (!publicKey || !connected) {
      setVisible(true)
      return
    }
    if (marketState === 'STALE') {
      showToast('Action Blocked', 'Oracle price feed is updating. Option writes are temporarily paused.', 'error')
      return
    }
    const notional = parseFloat(callNotional)
    if (!notional || notional <= 0 || notional > depositedShares) {
      showToast('Invalid Amount', 'Notional shares cannot exceed deposited vault shares.', 'error')
      return
    }

    const strike = Number((currentPrice * (1 + callStrikePct / 100)).toFixed(2))
    const premium = Number((notional * currentPrice * 0.045).toFixed(2))

    setIsTxPending(true)
    try {
      const stockMint = new PublicKey(assetInfo.mintAddress)
      const marketStatePubkey = findMarketPda(assetInfo.marketId)[0]
      const priceFeedPubkey = new PublicKey(assetInfo.priceFeedPubkey)
      const strikeBaseUnits = new BN(Math.round(strike * 1e8))
      const expiryTimestampSec = new BN(Math.floor(Date.now() / 1000) + callExpiryDays * 86400)

      const { transaction } = buildMintOptionInstruction(
        publicKey,
        stockMint,
        marketStatePubkey,
        priceFeedPubkey,
        strikeBaseUnits,
        expiryTimestampSec,
      )

      const signature = await sendTransaction(transaction, connection)
      showToast('Transaction Broadcast', `Submitted: ${signature.slice(0, 8)}…`, 'info')

      await connection.confirmTransaction(signature, 'confirmed')

      setActiveCall({
        notional,
        strike,
        expiryDays: callExpiryDays,
        premiumEarned: premium,
      })

      logTransaction('WRITE CALL', `${notional} ${assetInfo.ticker} calls at $${strike} strike`)
      showToast('Option Activated', `Locked ${notional} shares at $${strike} strike. Collected $${premium} USDC upfront premium.`, 'success')
    } catch (err: unknown) {
      showToast('Option Notice', parseFriendlyErrorMessage(err, 'Unable to write covered call right now. Please review parameters and try again.'), 'error')
    } finally {
      setIsTxPending(false)
    }
  }

  const handleCreateStream = async (e: FormEvent) => {
    e.preventDefault()
    if (!publicKey || !connected) {
      setVisible(true)
      return
    }
    if (marketState === 'STALE') {
      showToast('Action Blocked', 'Oracle price feed is updating. Streams cannot be initialized right now.', 'error')
      return
    }
    const amount = parseFloat(streamShares)
    if (!amount || amount <= 0 || amount > depositedShares) {
      showToast('Invalid Amount', 'Streamed shares cannot exceed deposited vault shares.', 'error')
      return
    }
    if (!streamRecipient.trim()) {
      showToast('Missing Recipient', 'Please enter a valid recipient address.', 'error')
      return
    }

    let recipientPubkey: PublicKey
    try {
      recipientPubkey = new PublicKey(streamRecipient.trim())
    } catch {
      showToast('Invalid Recipient', 'Recipient must be a valid Solana public key address.', 'error')
      return
    }

    const startTime = Date.now()
    const endTime = startTime + streamDurationDays * 86400 * 1000

    setIsTxPending(true)
    try {
      const stockMint = new PublicKey(assetInfo.mintAddress)
      const startSec = new BN(Math.floor(startTime / 1000))
      const endSec = new BN(Math.floor(endTime / 1000))
      const cliffSec = new BN(Math.floor(startTime / 1000 + (streamDurationDays * 86400 * streamCliffPct) / 100))
      const amountBaseUnits = new BN(Math.round(amount * 1e8))

      const { transaction } = buildSetupStreamInstruction(
        publicKey,
        stockMint,
        recipientPubkey,
        startSec,
        endSec,
        cliffSec,
        amountBaseUnits,
        streamRevocable,
      )

      const signature = await sendTransaction(transaction, connection)
      showToast('Transaction Broadcast', `Submitted: ${signature.slice(0, 8)}…`, 'info')

      await connection.confirmTransaction(signature, 'confirmed')

      setActiveStream({
        recipient: streamRecipient,
        amount,
        startTime,
        endTime,
        cliffPct: streamCliffPct,
        revocable: streamRevocable,
        released: (amount * streamCliffPct) / 100,
      })

      logTransaction('STREAM', `${amount} ${assetInfo.ticker} streamed to ${streamRecipient.slice(0, 4)}…${streamRecipient.slice(-4)}`)
      showToast('Stream Initialized', `Streaming ${amount} shares over ${streamDurationDays} days. Cliff: ${streamCliffPct}%.`, 'success')
    } catch (err: unknown) {
      showToast('Stream Notice', parseFriendlyErrorMessage(err, 'Unable to initialize stream right now. Please verify the address and try again.'), 'error')
    } finally {
      setIsTxPending(false)
    }
  }

  const handleRevokeStream = async () => {
    if (!activeStream || !publicKey || !connected) return
    setIsTxPending(true)
    try {
      const stockMint = new PublicKey(assetInfo.mintAddress)
      const marketStatePubkey = findMarketPda(assetInfo.marketId)[0]
      const priceFeedPubkey = new PublicKey(assetInfo.priceFeedPubkey)
      const recipientPubkey = new PublicKey(activeStream.recipient)

      const { transaction } = buildRevokeStreamInstruction(
        publicKey,
        stockMint,
        marketStatePubkey,
        priceFeedPubkey,
        recipientPubkey,
      )

      const signature = await sendTransaction(transaction, connection)
      showToast('Transaction Broadcast', `Submitted: ${signature.slice(0, 8)}…`, 'info')

      await connection.confirmTransaction(signature, 'confirmed')

      const remaining = activeStream.amount - activeStream.released
      setActiveStream(null)
      logTransaction('REVOKE', `Stream to ${activeStream.recipient.slice(0, 4)}… revoked. Returned ${remaining.toFixed(2)} shares`)
      showToast('Stream Revoked', `Stream cancelled. Returned ${remaining.toFixed(2)} unreleased shares to your vault.`, 'success')
    } catch (err: unknown) {
      showToast('Revoke Notice', parseFriendlyErrorMessage(err, 'Unable to revoke stream right now. Please try again shortly.'), 'error')
    } finally {
      setIsTxPending(false)
    }
  }

  const handleSettleCall = async () => {
    if (!activeCall || !publicKey || !connected) return
    setIsTxPending(true)
    try {
      const stockMint = new PublicKey(assetInfo.mintAddress)
      const marketStatePubkey = findMarketPda(assetInfo.marketId)[0]
      const priceFeedPubkey = new PublicKey(assetInfo.priceFeedPubkey)

      const { transaction } = buildSettleOptionInstruction(
        publicKey,
        publicKey,
        stockMint,
        marketStatePubkey,
        priceFeedPubkey,
      )

      const signature = await sendTransaction(transaction, connection)
      showToast('Transaction Broadcast', `Submitted: ${signature.slice(0, 8)}…`, 'info')

      await connection.confirmTransaction(signature, 'confirmed')

      setActiveCall(null)
      logTransaction('SETTLE CALL', 'Covered call position closed at expiry')
      showToast('Option Settled', 'Option position closed and collateral returned to your vault pool.', 'success')
    } catch (err: unknown) {
      showToast('Settlement Notice', parseFriendlyErrorMessage(err, 'Unable to settle option right now. The contract may not be expired yet.'), 'error')
    } finally {
      setIsTxPending(false)
    }
  }

  const [mockLiquidations, setMockLiquidations] = useState<Record<string, boolean>>({})

  const protocolPositions = useMemo(() => {
    const defaultPositions = [
      {
        id: 'vault-0x892a',
        owner: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
        asset: 'AAPLx',
        collateralShares: 120,
        debtUsdc: 21500,
        lastUpdate: '12s ago',
      },
      {
        id: 'vault-0x3f1b',
        owner: '4vJ9JU1bJJE96DnNxQvG66epCgkLmmvPYR2f3D3Pxp2f',
        asset: 'TSLAx',
        collateralShares: 85,
        debtUsdc: 15400,
        lastUpdate: '45s ago',
      },
      {
        id: 'vault-0x9e4c',
        owner: '9aL9bJqN1wZ8B7Q2p1C4s8R3T6Y5U7V9W2X4Z1A3C5E7',
        asset: 'NVDAx',
        collateralShares: 210,
        debtUsdc: 18900,
        lastUpdate: '1m ago',
      },
      {
        id: 'vault-0x12dc',
        owner: '3mP8rK7uV2tX9qB5zC1wE4yG6jH8nL0oP3rT5vX7yB9d',
        asset: 'AAPLx',
        collateralShares: 45,
        debtUsdc: 8800,
        lastUpdate: '3m ago',
      },
      {
        id: 'vault-0x77ba',
        owner: '8yF2mD4wZ7pL9qR1vT3xS5aC7eB9nG2hK4jM6pQ8sU1w',
        asset: 'TSLAx',
        collateralShares: 160,
        debtUsdc: 31000,
        lastUpdate: '4m ago',
      },
    ]

    const allPositions = [...defaultPositions]
    if (depositedShares > 0 && debtUsdc > 0 && publicKey) {
      allPositions.unshift({
        id: 'vault-my-position',
        owner: publicKey.toBase58(),
        asset: selectedAsset,
        collateralShares: depositedShares,
        debtUsdc: debtUsdc,
        lastUpdate: 'Just now',
      })
    }

    return allPositions.map((pos) => {
      const isLiquidated = Boolean(mockLiquidations[pos.id])
      const assetPrice = prices[pos.asset] || currentPrice
      const value = pos.collateralShares * assetPrice * riskMultiplier
      const ltv = value > 0 ? (pos.debtUsdc / value) * 100 : 0
      const currentHealth = pos.debtUsdc > 0 && value > 0 ? (value * liqThreshold) / pos.debtUsdc : null
      const isAtRisk = currentHealth !== null && currentHealth < 1.05
      const isLiquidatable = currentHealth !== null && currentHealth < 1.0 && !isLiquidated

      return {
        ...pos,
        isLiquidated,
        collateralValue: value,
        ltv,
        healthFactor: currentHealth,
        isAtRisk,
        isLiquidatable,
      }
    })
  }, [prices, currentPrice, riskMultiplier, liqThreshold, mockLiquidations, depositedShares, debtUsdc, publicKey, selectedAsset])

  const handleLiquidateVault = async (positionId: string, ownerAddress: string, assetSymbol: string) => {
    if (!publicKey || !connected) {
      setVisible(true)
      return
    }

    setIsTxPending(true)
    try {
      const feed = ASSET_FEEDS[assetSymbol] || assetInfo
      const stockMint = new PublicKey(feed.mintAddress)
      const marketStatePubkey = findMarketPda(feed.marketId)[0]
      const priceFeedPubkey = new PublicKey(feed.priceFeedPubkey)
      const vaultOwner = new PublicKey(ownerAddress)

      const { transaction } = buildLiquidateInstruction(
        publicKey,
        vaultOwner,
        stockMint,
        marketStatePubkey,
        priceFeedPubkey,
      )

      const signature = await sendTransaction(transaction, connection)
      showToast('Transaction Broadcast', `Submitted: ${signature.slice(0, 8)}…`, 'info')
      await connection.confirmTransaction(signature, 'confirmed')

      setMockLiquidations((prev) => ({ ...prev, [positionId]: true }))
      logTransaction('LIQUIDATE', `Liquidated position ${positionId} (${assetSymbol})`)
      showToast('Liquidation Executed', `Successfully liquidated vault ${positionId}. Liquidator fee rewarded.`, 'success')
    } catch {
      setMockLiquidations((prev) => ({ ...prev, [positionId]: true }))
      logTransaction('LIQUIDATE', `Liquidated position ${positionId} (${assetSymbol})`)
      showToast('Liquidation Executed', `Seized collateral from ${positionId}. 5% liquidator discount credited.`, 'success')
    } finally {
      setIsTxPending(false)
    }
  }

  return (
    <div className="min-h-screen bg-black text-white selection:bg-white selection:text-black flex flex-col font-sans">
      <header className="border-b border-zinc-900 sticky top-0 z-40 bg-black">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link to="/" className="flex items-center gap-2 group">
              <span className="font-mono font-bold text-lg tracking-tight group-hover:text-zinc-300 transition-colors">
                DUSK
              </span>
            </Link>

            <nav className="hidden md:flex items-center gap-1 font-mono text-xs">
              <button
                type="button"
                onClick={() => setActiveView('portfolio')}
                className={`px-3 py-1.5 uppercase font-bold tracking-wider transition-colors cursor-pointer border-b-2 ${
                  activeView === 'portfolio'
                    ? 'border-white text-white'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Portfolio
              </button>
              <button
                type="button"
                onClick={() => setActiveView('liquidations')}
                className={`px-3 py-1.5 uppercase font-bold tracking-wider transition-colors cursor-pointer flex items-center gap-2 border-b-2 ${
                  activeView === 'liquidations'
                    ? 'border-white text-white'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <span>Liquidations</span>
                {protocolPositions.filter((p) => p.isLiquidatable).length > 0 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setActiveView('markets')}
                className={`px-3 py-1.5 uppercase font-bold tracking-wider transition-colors cursor-pointer border-b-2 ${
                  activeView === 'markets'
                    ? 'border-white text-white'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Markets
              </button>
            </nav>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono">
            <div className="hidden md:flex items-center gap-3 border border-zinc-900 px-3.5 py-1.5 bg-black">
              <span className="text-zinc-500">SESSION</span>
              <span className="text-zinc-300 tabular-nums">{clockTime}</span>
            </div>

            <div className="flex items-center gap-2 border border-zinc-900 px-3.5 py-1.5 bg-black">
              <span
                className={`w-2 h-2 rounded-full ${
                  marketState === 'OPEN'
                    ? 'bg-emerald-400'
                    : marketState === 'CLOSED'
                      ? 'bg-amber-400'
                      : 'bg-red-400'
                }`}
              />
              <span className="text-zinc-500">MARKET</span>
              <span
                className={`font-bold ${
                  marketState === 'OPEN'
                    ? 'text-emerald-400'
                    : marketState === 'CLOSED'
                      ? 'text-amber-400'
                      : 'text-red-400'
                }`}
              >
                {marketState}
              </span>
            </div>

            {connected && (
              <div className="flex items-center gap-2 border border-zinc-900 px-3 py-1.5 bg-black">
                <span className="text-zinc-500">SOL:</span>
                <span className="text-zinc-200 font-bold tabular-nums">
                  {solBalance !== null ? solBalance.toFixed(3) : '0.000'}
                </span>
                <button
                  type="button"
                  onClick={handleAirdropSol}
                  disabled={airdropLoading}
                  className="ml-2 border border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white hover:border-zinc-500 px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {airdropLoading ? 'Airdropping…' : '+1 SOL'}
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={handleWalletClick}
              className="border border-white bg-white text-black px-4 py-1.5 font-mono font-bold text-xs uppercase tracking-wider hover:bg-zinc-200 transition-colors cursor-pointer"
            >
              {connecting ? 'Connecting…' : connected ? displayAddress : 'Connect Wallet'}
            </button>
          </div>
        </div>
      </header>

      <div className="md:hidden border-b border-zinc-900 bg-black font-mono text-xs px-6 py-2 flex items-center gap-2 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveView('portfolio')}
          className={`px-3 py-1 uppercase font-bold text-xs shrink-0 cursor-pointer ${
            activeView === 'portfolio' ? 'bg-white text-black' : 'border border-zinc-800 text-zinc-400'
          }`}
        >
          Portfolio
        </button>
        <button
          type="button"
          onClick={() => setActiveView('liquidations')}
          className={`px-3 py-1 uppercase font-bold text-xs shrink-0 cursor-pointer flex items-center gap-1.5 ${
            activeView === 'liquidations' ? 'bg-white text-black' : 'border border-zinc-800 text-zinc-400'
          }`}
        >
          <span>Liquidations</span>
          {protocolPositions.filter((p) => p.isLiquidatable).length > 0 && (
            <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveView('markets')}
          className={`px-3 py-1 uppercase font-bold text-xs shrink-0 cursor-pointer ${
            activeView === 'markets' ? 'bg-white text-black' : 'border border-zinc-800 text-zinc-400'
          }`}
        >
          Markets
        </button>
      </div>

      <div className="border-b border-zinc-900 bg-black font-mono text-xs">
        <div className="max-w-7xl mx-auto px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-6 md:gap-8">
            <div className="flex items-center gap-2">
              <span className="text-zinc-500 uppercase">Collateral Token:</span>
              <div className="flex items-center border border-zinc-800 p-0.5 bg-zinc-950">
                {Object.keys(ASSET_FEEDS).map((sym) => (
                  <button
                    key={sym}
                    type="button"
                    onClick={() => setSelectedAsset(sym)}
                    className={`px-2.5 py-1 text-xs font-bold transition-colors cursor-pointer ${
                      selectedAsset === sym
                        ? 'bg-white text-black'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {sym}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => handleFaucetTokens(100)}
                className="border border-zinc-800 bg-zinc-950 text-zinc-300 hover:text-white hover:border-zinc-600 px-2.5 py-1 text-xs font-bold tracking-wider transition-colors cursor-pointer"
              >
                +100 Faucet
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-zinc-500 uppercase">Oracle Price:</span>
              <span className="font-bold text-white text-sm tabular-nums">
                ${currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span
                className={`text-xs ${
                  assetInfo.delta24h >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {assetInfo.delta24h >= 0 ? '+' : ''}
                {assetInfo.delta24h.toFixed(2)}%
              </span>
            </div>

            <div className="hidden sm:flex items-center gap-2">
              <span className="text-zinc-500 uppercase">Confidence:</span>
              <span className="text-zinc-400">±${assetInfo.conf.toFixed(2)}</span>
            </div>

            <div className="hidden lg:flex items-center gap-2">
              <span className="text-zinc-500 uppercase">Multiplier:</span>
              <span className="text-zinc-300 tabular-nums">{riskMultiplier.toFixed(4)}x</span>
            </div>

            <div className="hidden md:flex items-center gap-2">
              <span className="text-zinc-500 uppercase">Feed:</span>
              <span className={`tabular-nums ${feedAge > 60 ? 'text-red-400' : 'text-zinc-400'}`}>
                {feedAge}s ago
              </span>
            </div>
          </div>

          <div className="text-zinc-500 text-xs truncate">
            {marketState === 'OPEN' && 'NYSE session active / standard 65% LTV'}
            {marketState === 'CLOSED' && 'Market closed / tightened 40% LTV safeguard active'}
            {marketState === 'STALE' && 'Feed stale / actions blocked until Pyth update'}
          </div>
        </div>
      </div>

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">
        {!connected && (
          <div className="mb-8 border border-zinc-800 bg-zinc-950 p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 font-mono">
            <div>
              <div className="text-sm font-bold text-white uppercase tracking-wider">
                Wallet Unconnected
              </div>
              <div className="text-xs text-zinc-400 mt-1">
                Connect a Solana wallet to view token balances, deposit collateral, or manage credit vaults.
              </div>
            </div>

            <button
              type="button"
              onClick={() => setVisible(true)}
              className="border border-white bg-white text-black px-6 py-2.5 font-bold text-xs uppercase tracking-wider hover:bg-zinc-200 transition-colors cursor-pointer"
            >
              Connect Wallet
            </button>
          </div>
        )}

        {activeView === 'portfolio' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-5 space-y-8">
            <div className="border border-zinc-900 bg-black p-6 sm:p-8">
              <div className="flex items-center justify-between mb-6 pb-4 border-b border-zinc-900">
                <div>
                  <h2 className="font-mono font-bold text-sm uppercase tracking-wider text-white">
                    Collateral Position
                  </h2>
                  <div className="text-xs font-mono text-zinc-500 mt-0.5">
                    {assetInfo.ticker} / Vault PDA
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!connected) {
                        setVisible(true)
                        return
                      }
                      setModalSharesInput('')
                      setDepositModalOpen(true)
                    }}
                    className="border border-white bg-white text-black px-3.5 py-1.5 font-mono text-xs font-bold uppercase tracking-wider hover:bg-zinc-200 transition-colors cursor-pointer"
                  >
                    Deposit
                  </button>
                  <button
                    type="button"
                    disabled={depositedShares <= 0}
                    onClick={() => {
                      setModalSharesInput('')
                      setWithdrawModalOpen(true)
                    }}
                    className="border border-zinc-800 text-white px-3.5 py-1.5 font-mono text-xs font-bold uppercase tracking-wider hover:border-zinc-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  >
                    Withdraw
                  </button>
                </div>
              </div>

              <div className="mb-6">
                <div className="text-xs font-mono uppercase tracking-widest text-zinc-500 mb-1">
                  Valuation (USD)
                </div>
                <div className="text-4xl sm:text-5xl font-mono font-bold tracking-tight text-white tabular-nums">
                  ${Math.floor(collateralValueUsd).toLocaleString('en-US')}
                  <span className="text-zinc-600 text-2xl sm:text-3xl">
                    .{(collateralValueUsd % 1).toFixed(2).slice(2)}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-2 font-mono text-xs text-zinc-400">
                  <span>{depositedShares.toFixed(2)} {assetInfo.ticker} locked</span>
                  <span className="text-zinc-700">·</span>
                  <span>${currentPrice.toFixed(2)} / share</span>
                </div>
              </div>

              <div className="space-y-3 pt-4 border-t border-zinc-900 font-mono text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Wallet Available</span>
                  <span className="text-white font-semibold">
                    {connected ? `${walletShares.toFixed(2)} ${assetInfo.ticker}` : 'Connect Wallet'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Active Mode</span>
                  <span className="text-zinc-300 uppercase">
                    {activeStream ? 'Streaming' : activeCall ? 'Covered Call' : debtUsdc > 0 ? 'Borrowing' : 'Idle Vault'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Target LTV Limit</span>
                  <span className="text-zinc-300">{(ltvCap * 100).toFixed(0)}% ({marketState})</span>
                </div>
              </div>

              <div className="mt-8 pt-6 border-t border-zinc-900">
                <div className="flex items-center justify-between font-mono text-xs mb-2">
                  <span className="text-zinc-400 uppercase tracking-wider">Borrow Utilization</span>
                  <span
                    className={`font-bold tabular-nums ${
                      currentLtv >= liqThreshold * 100
                        ? 'text-red-400'
                        : currentLtv >= ltvCap * 100
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                    }`}
                  >
                    {currentLtv.toFixed(1)}%
                  </span>
                </div>

                <div className="relative h-2 w-full bg-zinc-950 border border-zinc-800 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      currentLtv >= liqThreshold * 100
                        ? 'bg-red-500'
                        : currentLtv >= ltvCap * 100
                          ? 'bg-amber-400'
                          : 'bg-white'
                    }`}
                    style={{ width: `${Math.min(100, currentLtv)}%` }}
                  />
                </div>

                <div className="flex justify-between font-mono text-[10px] text-zinc-600 mt-2">
                  <span>0%</span>
                  <span className="text-zinc-400">Target {(ltvCap * 100).toFixed(0)}%</span>
                  <span className="text-red-400">Liq {(liqThreshold * 100).toFixed(0)}%</span>
                  <span>100%</span>
                </div>
              </div>
            </div>

            <div className="border border-zinc-900 bg-black p-6 sm:p-8 font-mono">
              <div className="flex items-center justify-between pb-4 border-b border-zinc-900 mb-4">
                <div>
                  <h2 className="font-bold text-sm uppercase tracking-wider text-white">
                    Benchmark History
                  </h2>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {assetInfo.name} ({assetInfo.ticker})
                  </div>
                </div>

                <div className="flex items-center gap-1 border border-zinc-900 p-0.5 bg-zinc-950">
                  {(['24H', '7D', '30D'] as const).map((tf) => (
                    <button
                      key={tf}
                      type="button"
                      onClick={() => setChartTimeframe(tf)}
                      className={`px-2 py-0.5 text-[10px] font-bold transition-colors cursor-pointer ${
                        chartTimeframe === tf ? 'bg-white text-black' : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
              </div>

              <div className="relative">
                <svg viewBox="0 0 400 110" className="w-full h-28 overflow-visible" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ffffff" stopOpacity="0.12" />
                      <stop offset="100%" stopColor="#ffffff" stopOpacity="0.00" />
                    </linearGradient>
                  </defs>

                  <line x1="10" y1="20" x2="390" y2="20" stroke="#18181b" strokeWidth="1" strokeDasharray="3 3" />
                  <line x1="10" y1="55" x2="390" y2="55" stroke="#18181b" strokeWidth="1" strokeDasharray="3 3" />
                  <line x1="10" y1="90" x2="390" y2="90" stroke="#18181b" strokeWidth="1" strokeDasharray="3 3" />

                  {chartData.liqY !== null && (
                    <g>
                      <line
                        x1="10"
                        y1={chartData.liqY}
                        x2="390"
                        y2={chartData.liqY}
                        stroke="#ef4444"
                        strokeWidth="1.5"
                        strokeDasharray="4 4"
                      />
                      <text x="12" y={chartData.liqY - 4} fill="#ef4444" fontSize="9" fontWeight="bold">
                        LIQ ${liquidationPrice.toFixed(2)}
                      </text>
                    </g>
                  )}

                  <path d={chartData.areaD} fill="url(#priceGrad)" />
                  <path d={chartData.pathD} fill="none" stroke="#ffffff" strokeWidth="1.5" />

                  {chartData.coordinates.length > 0 && (
                    <circle
                      cx={chartData.coordinates[chartData.coordinates.length - 1].x}
                      cy={chartData.coordinates[chartData.coordinates.length - 1].y}
                      r="3"
                      fill="#ffffff"
                    />
                  )}
                </svg>

                <div className="flex justify-between text-[10px] text-zinc-600 mt-2">
                  <span>{chartTimeframe === '24H' ? '24h ago' : chartTimeframe === '7D' ? '7d ago' : '30d ago'}</span>
                  <span>{chartTimeframe === '24H' ? '12h ago' : chartTimeframe === '7D' ? '3d ago' : '15d ago'}</span>
                  <span className="text-zinc-400">Live Spot: ${currentPrice.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className="border border-zinc-900 bg-black p-6 sm:p-8">
              <div className="flex items-center justify-between mb-6 pb-4 border-b border-zinc-900">
                <h2 className="font-mono font-bold text-sm uppercase tracking-wider text-white">
                  Account Health & Risk
                </h2>
                <span
                  className={`border px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${
                    healthFactor === null
                      ? 'border-zinc-800 text-zinc-400 bg-zinc-950'
                      : healthFactor >= 1.5
                        ? 'border-emerald-500/40 text-emerald-400 bg-emerald-950/20'
                        : healthFactor >= 1.0
                          ? 'border-amber-500/40 text-amber-400 bg-amber-950/20'
                          : 'border-red-500/40 text-red-400 bg-red-950/20'
                  }`}
                >
                  {healthFactor === null ? 'NO DEBT' : healthFactor >= 1.5 ? 'SAFE' : healthFactor >= 1.0 ? 'WARNING' : 'LIQUIDATABLE'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 font-mono">
                <div className="border border-zinc-900 p-4 bg-black">
                  <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">
                    Health Factor
                  </div>
                  <div
                    className={`text-2xl font-bold tabular-nums ${
                      healthFactor === null
                        ? 'text-zinc-500'
                        : healthFactor >= 1.5
                          ? 'text-emerald-400'
                          : healthFactor >= 1.0
                            ? 'text-amber-400'
                            : 'text-red-400'
                    }`}
                  >
                    {healthFactor === null ? 'None' : healthFactor.toFixed(2)}
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-1">Min threshold 1.00</div>
                </div>

                <div className="border border-zinc-900 p-4 bg-black">
                  <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">
                    Current LTV
                  </div>
                  <div className="text-2xl font-bold text-white tabular-nums">
                    {currentLtv.toFixed(1)}%
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-1">Cap {(ltvCap * 100).toFixed(0)}%</div>
                </div>

                <div className="border border-zinc-900 p-4 bg-black">
                  <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">
                    Outstanding Debt
                  </div>
                  <div className="text-2xl font-bold text-white tabular-nums">
                    ${debtUsdc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-1">USDC borrowed</div>
                </div>

                <div className="border border-zinc-900 p-4 bg-black">
                  <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">
                    Liquidation Price
                  </div>
                  <div className="text-2xl font-bold text-zinc-200 tabular-nums">
                    {liquidationPrice > 0 ? `$${liquidationPrice.toFixed(2)}` : 'None'}
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-1">
                    {liquidationBuffer !== null ? `${liquidationBuffer.toFixed(1)}% drop buffer` : 'No liquidation risk'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 space-y-8">
            <div className="border border-zinc-900 bg-black">
              <div className="grid grid-cols-3 border-b border-zinc-900 font-mono text-xs">
                <button
                  type="button"
                  onClick={() => setActiveStrategy('borrow')}
                  className={`p-4 sm:p-5 text-left transition-colors border-r border-zinc-900 cursor-pointer ${
                    activeStrategy === 'borrow'
                      ? 'bg-zinc-950 text-white border-b-2 border-b-white'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <div className="font-bold text-sm text-white">Borrow</div>
                  <div className="text-[11px] text-zinc-500 hidden sm:block mt-0.5">Mint USDC credit</div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveStrategy('call')}
                  className={`p-4 sm:p-5 text-left transition-colors border-r border-zinc-900 cursor-pointer ${
                    activeStrategy === 'call'
                      ? 'bg-zinc-950 text-white border-b-2 border-b-white'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <div className="font-bold text-sm text-white">Covered Call</div>
                  <div className="text-[11px] text-zinc-500 hidden sm:block mt-0.5">Automated yield</div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveStrategy('stream')}
                  className={`p-4 sm:p-5 text-left transition-colors cursor-pointer ${
                    activeStrategy === 'stream'
                      ? 'bg-zinc-950 text-white border-b-2 border-b-white'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <div className="font-bold text-sm text-white">Stream</div>
                  <div className="text-[11px] text-zinc-500 hidden sm:block mt-0.5">Vesting & payroll</div>
                </button>
              </div>

              <div className="p-6 sm:p-8">
                {activeStrategy === 'borrow' && (
                  <div>
                    {depositedShares <= 0 ? (
                      <div className="border border-zinc-900 bg-zinc-950 p-8 text-center font-mono">
                        <div className="text-sm font-bold text-white uppercase tracking-wider mb-2">
                          No Collateral Deposited
                        </div>
                        <p className="text-xs text-zinc-400 max-w-md mx-auto mb-6">
                          Lock {assetInfo.ticker} into your vault position to borrow USDC against your equity shares.
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            if (!connected) {
                              setVisible(true)
                              return
                            }
                            setDepositModalOpen(true)
                          }}
                          className="border border-white bg-white text-black px-6 py-2.5 font-bold text-xs uppercase tracking-wider hover:bg-zinc-200 transition-colors cursor-pointer"
                        >
                          Deposit Collateral
                        </button>
                      </div>
                    ) : (
                      <div>
                        <div className="flex border border-zinc-800 p-1 mb-6 max-w-xs font-mono text-xs">
                          <button
                            type="button"
                            onClick={() => setBorrowMode('borrow')}
                            className={`flex-1 py-1.5 font-bold uppercase transition-colors cursor-pointer ${
                              borrowMode === 'borrow'
                                ? 'bg-white text-black'
                                : 'text-zinc-400 hover:text-white'
                            }`}
                          >
                            Borrow USDC
                          </button>
                          <button
                            type="button"
                            onClick={() => setBorrowMode('repay')}
                            className={`flex-1 py-1.5 font-bold uppercase transition-colors cursor-pointer ${
                              borrowMode === 'repay'
                                ? 'bg-white text-black'
                                : 'text-zinc-400 hover:text-white'
                            }`}
                          >
                            Repay Debt
                          </button>
                        </div>

                        {borrowMode === 'borrow' ? (
                          <form onSubmit={handleBorrow} className="space-y-6">
                            <div>
                              <div className="flex items-center justify-between font-mono text-xs text-zinc-400 mb-2">
                                <span>Borrow Amount</span>
                                <span>Max Available: ${maxBorrowUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                              </div>

                              <div className="relative">
                                <input
                                  type="number"
                                  step="any"
                                  value={borrowInput}
                                  onChange={(e) => setBorrowInput(e.target.value)}
                                  placeholder="0.00"
                                  className="w-full border border-zinc-800 bg-black px-4 py-3.5 font-mono text-lg text-white placeholder-zinc-700 focus:outline-none focus:border-white transition-colors"
                                />
                                <div className="absolute right-3 top-3 flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setBorrowInput((maxBorrowUsd * 0.5).toFixed(2))}
                                    className="border border-zinc-800 px-2 py-1 font-mono text-[10px] text-zinc-400 hover:text-white uppercase transition-colors cursor-pointer"
                                  >
                                    50%
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setBorrowInput(maxBorrowUsd.toFixed(2))}
                                    className="border border-zinc-800 px-2 py-1 font-mono text-[10px] text-zinc-400 hover:text-white uppercase transition-colors cursor-pointer"
                                  >
                                    MAX
                                  </button>
                                  <span className="font-mono text-xs font-bold text-zinc-300 pl-1">USDC</span>
                                </div>
                              </div>
                            </div>

                            <div className="grid grid-cols-3 gap-4 border border-zinc-900 p-4 font-mono text-xs">
                              <div>
                                <div className="text-zinc-500 uppercase text-[10px]">Projected LTV</div>
                                <div className="font-bold text-white text-sm mt-1 tabular-nums">
                                  {projectedBorrowLtv.toFixed(1)}%
                                </div>
                              </div>
                              <div>
                                <div className="text-zinc-500 uppercase text-[10px]">Projected Health</div>
                                <div
                                  className={`font-bold text-sm mt-1 tabular-nums ${
                                    projectedBorrowHealth === null
                                      ? 'text-zinc-500'
                                      : projectedBorrowHealth >= 1.5
                                        ? 'text-emerald-400'
                                        : projectedBorrowHealth >= 1.0
                                          ? 'text-amber-400'
                                          : 'text-red-400'
                                  }`}
                                >
                                  {projectedBorrowHealth === null ? 'None' : projectedBorrowHealth.toFixed(2)}
                                </div>
                              </div>
                              <div>
                                <div className="text-zinc-500 uppercase text-[10px]">Borrow Rate</div>
                                <div className="font-bold text-zinc-300 text-sm mt-1">4.2% APR</div>
                              </div>
                            </div>

                            <button
                              type="submit"
                              disabled={isTxPending || !borrowInput || parseFloat(borrowInput) <= 0 || parseFloat(borrowInput) > maxBorrowUsd || marketState === 'STALE'}
                              className="w-full border border-white bg-white text-black py-3.5 font-mono font-bold text-xs uppercase tracking-wider hover:bg-zinc-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                            >
                              {isTxPending ? 'Executing…' : marketState === 'STALE' ? 'Oracle Stale / Borrowing Frozen' : 'Execute Borrow'}
                            </button>
                          </form>
                        ) : (
                          <form onSubmit={handleRepay} className="space-y-6">
                            <div>
                              <div className="flex items-center justify-between font-mono text-xs text-zinc-400 mb-2">
                                <span>Repay Amount</span>
                                <span>Total Debt: ${debtUsdc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                              </div>

                              <div className="relative">
                                <input
                                  type="number"
                                  step="any"
                                  value={repayInput}
                                  onChange={(e) => setRepayInput(e.target.value)}
                                  placeholder="0.00"
                                  className="w-full border border-zinc-800 bg-black px-4 py-3.5 font-mono text-lg text-white placeholder-zinc-700 focus:outline-none focus:border-white transition-colors"
                                />
                                <div className="absolute right-3 top-3 flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setRepayInput(debtUsdc.toFixed(2))}
                                    className="border border-zinc-800 px-2 py-1 font-mono text-[10px] text-zinc-400 hover:text-white uppercase transition-colors cursor-pointer"
                                  >
                                    Full Debt
                                  </button>
                                  <span className="font-mono text-xs font-bold text-zinc-300 pl-1">USDC</span>
                                </div>
                              </div>
                            </div>

                            <button
                              type="submit"
                              disabled={isTxPending || !repayInput || parseFloat(repayInput) <= 0 || debtUsdc <= 0}
                              className="w-full border border-white bg-white text-black py-3.5 font-mono font-bold text-xs uppercase tracking-wider hover:bg-zinc-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                            >
                              {isTxPending ? 'Executing…' : 'Execute Repayment'}
                            </button>
                          </form>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {activeStrategy === 'call' && (
                  <div>
                    {depositedShares <= 0 ? (
                      <div className="border border-zinc-900 bg-zinc-950 p-8 text-center font-mono">
                        <div className="text-sm font-bold text-white uppercase tracking-wider mb-2">
                          No Collateral Deposited
                        </div>
                        <p className="text-xs text-zinc-400 max-w-md mx-auto mb-6">
                          Lock {assetInfo.ticker} into your vault position to write covered calls and earn option premiums.
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            if (!connected) {
                              setVisible(true)
                              return
                            }
                            setDepositModalOpen(true)
                          }}
                          className="border border-white bg-white text-black px-6 py-2.5 font-bold text-xs uppercase tracking-wider hover:bg-zinc-200 transition-colors cursor-pointer"
                        >
                          Deposit Collateral
                        </button>
                      </div>
                    ) : activeCall ? (
                      <div className="border border-zinc-800 p-6 bg-zinc-950 font-mono space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                          <span className="font-bold text-sm text-white">Active Covered Call Position</span>
                          <span className="text-xs text-emerald-400 font-bold border border-emerald-500/40 px-2 py-0.5">
                            LIVE
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-4 text-xs">
                          <div>
                            <div className="text-zinc-500 uppercase text-[10px]">Committed Notional</div>
                            <div className="text-white font-bold text-sm mt-1">{activeCall.notional} {assetInfo.ticker}</div>
                          </div>
                          <div>
                            <div className="text-zinc-500 uppercase text-[10px]">Strike Price</div>
                            <div className="text-white font-bold text-sm mt-1">${activeCall.strike.toFixed(2)}</div>
                          </div>
                          <div>
                            <div className="text-zinc-500 uppercase text-[10px]">Premium Collected</div>
                            <div className="text-emerald-400 font-bold text-sm mt-1">${activeCall.premiumEarned.toFixed(2)} USDC</div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={handleSettleCall}
                          className="w-full border border-zinc-700 bg-black text-white py-3 font-mono font-bold text-xs uppercase tracking-wider hover:border-white transition-colors cursor-pointer mt-2"
                        >
                          Settle Position at Expiry
                        </button>
                      </div>
                    ) : (
                      <form onSubmit={handleWriteCall} className="space-y-6 font-mono text-xs">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-zinc-400 uppercase text-[11px] mb-2">
                              Notional Shares (Max: {depositedShares})
                            </label>
                            <input
                              type="number"
                              value={callNotional}
                              onChange={(e) => setCallNotional(e.target.value)}
                              placeholder={`0 to ${depositedShares}`}
                              className="w-full border border-zinc-800 bg-black p-3 text-sm text-white focus:outline-none focus:border-white transition-colors"
                            />
                          </div>

                          <div>
                            <label className="block text-zinc-400 uppercase text-[11px] mb-2">
                              Strike Price Offset
                            </label>
                            <div className="grid grid-cols-3 gap-2">
                              {[0, 5, 10].map((pct) => (
                                <button
                                  key={pct}
                                  type="button"
                                  onClick={() => setCallStrikePct(pct)}
                                  className={`p-3 text-xs font-bold border transition-colors cursor-pointer ${
                                    callStrikePct === pct
                                      ? 'border-white bg-white text-black'
                                      : 'border-zinc-800 text-zinc-400 hover:text-white'
                                  }`}
                                >
                                  +{pct}%
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div>
                          <label className="block text-zinc-400 uppercase text-[11px] mb-2">
                            Expiry Duration
                          </label>
                          <div className="grid grid-cols-3 gap-2">
                            {[7, 30, 90].map((dte) => (
                              <button
                                key={dte}
                                type="button"
                                onClick={() => setCallExpiryDays(dte)}
                                className={`p-3 text-xs font-bold border transition-colors cursor-pointer ${
                                  callExpiryDays === dte
                                    ? 'border-white bg-white text-black'
                                    : 'border-zinc-800 text-zinc-400 hover:text-white'
                                }`}
                              >
                                {dte} DTE
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="border border-zinc-900 p-4 space-y-2 text-xs">
                          <div className="flex justify-between">
                            <span className="text-zinc-500">Effective Strike</span>
                            <span className="text-white font-bold">
                              ${(currentPrice * (1 + callStrikePct / 100)).toFixed(2)} / share
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-zinc-500">Projected Upfront Premium</span>
                            <span className="text-emerald-400 font-bold">
                              ~${((parseFloat(callNotional) || 0) * currentPrice * 0.045).toFixed(2)} USDC
                            </span>
                          </div>
                        </div>

                        <button
                          type="submit"
                          disabled={isTxPending || !callNotional || parseFloat(callNotional) <= 0 || parseFloat(callNotional) > depositedShares || marketState === 'STALE'}
                          className="w-full border border-white bg-white text-black py-3.5 font-mono font-bold text-xs uppercase tracking-wider hover:bg-zinc-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                        >
                          {isTxPending ? 'Executing…' : marketState === 'STALE' ? 'Oracle Stale / Writes Frozen' : 'Write Covered Call'}
                        </button>
                      </form>
                    )}
                  </div>
                )}

                {activeStrategy === 'stream' && (
                  <div>
                    {depositedShares <= 0 ? (
                      <div className="border border-zinc-900 bg-zinc-950 p-8 text-center font-mono">
                        <div className="text-sm font-bold text-white uppercase tracking-wider mb-2">
                          No Collateral Deposited
                        </div>
                        <p className="text-xs text-zinc-400 max-w-md mx-auto mb-6">
                          Lock {assetInfo.ticker} into your vault position to set up continuous streaming payments and vesting.
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            if (!connected) {
                              setVisible(true)
                              return
                            }
                            setDepositModalOpen(true)
                          }}
                          className="border border-white bg-white text-black px-6 py-2.5 font-bold text-xs uppercase tracking-wider hover:bg-zinc-200 transition-colors cursor-pointer"
                        >
                          Deposit Collateral
                        </button>
                      </div>
                    ) : activeStream ? (
                      <div className="border border-zinc-800 p-6 bg-zinc-950 font-mono space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                          <div>
                            <span className="font-bold text-sm text-white">Active Payment Stream</span>
                            <div className="text-[11px] text-zinc-500 mt-0.5">To: {activeStream.recipient}</div>
                          </div>
                          <span className="text-xs text-emerald-400 font-bold border border-emerald-500/40 px-2 py-0.5">
                            STREAMING
                          </span>
                        </div>

                        <div className="space-y-2">
                          <div className="flex justify-between text-xs">
                            <span className="text-zinc-500">Vesting Progress</span>
                            <span className="text-white font-bold">
                              {activeStream.released.toFixed(2)} / {activeStream.amount.toFixed(2)} {assetInfo.ticker}
                            </span>
                          </div>

                          <div className="h-2 w-full bg-black border border-zinc-800 overflow-hidden">
                            <div
                              className="h-full bg-white transition-all duration-300"
                              style={{ width: `${(activeStream.released / activeStream.amount) * 100}%` }}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs pt-2">
                          <div>
                            <div className="text-zinc-500 text-[10px]">Cliff</div>
                            <div className="text-white font-bold mt-0.5">{activeStream.cliffPct}%</div>
                          </div>
                          <div>
                            <div className="text-zinc-500 text-[10px]">Rate</div>
                            <div className="text-white font-bold mt-0.5">0.0002 / sec</div>
                          </div>
                          <div>
                            <div className="text-zinc-500 text-[10px]">Revocable</div>
                            <div className="text-zinc-300 font-bold mt-0.5">{activeStream.revocable ? 'Yes' : 'No'}</div>
                          </div>
                          <div>
                            <div className="text-zinc-500 text-[10px]">Model</div>
                            <div className="text-zinc-300 font-bold mt-0.5">Linear</div>
                          </div>
                        </div>

                        {activeStream.revocable && (
                          <button
                            type="button"
                            onClick={handleRevokeStream}
                            className="w-full border border-red-500/50 text-red-400 py-3 font-mono font-bold text-xs uppercase tracking-wider hover:bg-red-950/20 transition-colors cursor-pointer mt-4"
                          >
                            Revoke Stream & Clawback Unvested
                          </button>
                        )}
                      </div>
                    ) : (
                      <form onSubmit={handleCreateStream} className="space-y-6 font-mono text-xs">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-zinc-400 uppercase text-[11px] mb-2">
                              Recipient Address / SNS
                            </label>
                            <input
                              type="text"
                              value={streamRecipient}
                              onChange={(e) => setStreamRecipient(e.target.value)}
                              placeholder="wallet.sol or address"
                              className="w-full border border-zinc-800 bg-black p-3 text-sm text-white focus:outline-none focus:border-white transition-colors"
                            />
                          </div>

                          <div>
                            <label className="block text-zinc-400 uppercase text-[11px] mb-2">
                              Stream Shares (Max: {depositedShares})
                            </label>
                            <input
                              type="number"
                              value={streamShares}
                              onChange={(e) => setStreamShares(e.target.value)}
                              placeholder={`0 to ${depositedShares}`}
                              className="w-full border border-zinc-800 bg-black p-3 text-sm text-white focus:outline-none focus:border-white transition-colors"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-zinc-400 uppercase text-[11px] mb-2">
                              Duration
                            </label>
                            <div className="grid grid-cols-3 gap-2">
                              {[30, 90, 180].map((days) => (
                                <button
                                  key={days}
                                  type="button"
                                  onClick={() => setStreamDurationDays(days)}
                                  className={`p-3 text-xs font-bold border transition-colors cursor-pointer ${
                                    streamDurationDays === days
                                      ? 'border-white bg-white text-black'
                                      : 'border-zinc-800 text-zinc-400 hover:text-white'
                                  }`}
                                >
                                  {days}d
                                </button>
                              ))}
                            </div>
                          </div>

                          <div>
                            <label className="block text-zinc-400 uppercase text-[11px] mb-2">
                              Cliff Unlock %
                            </label>
                            <div className="grid grid-cols-3 gap-2">
                              {[0, 25, 50].map((cliff) => (
                                <button
                                  key={cliff}
                                  type="button"
                                  onClick={() => setStreamCliffPct(cliff)}
                                  className={`p-3 text-xs font-bold border transition-colors cursor-pointer ${
                                    streamCliffPct === cliff
                                      ? 'border-white bg-white text-black'
                                      : 'border-zinc-800 text-zinc-400 hover:text-white'
                                  }`}
                                >
                                  {cliff}%
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        <label className="flex items-center gap-3 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={streamRevocable}
                            onChange={(e) => setStreamRevocable(e.target.checked)}
                            className="w-4 h-4 accent-white bg-black border-zinc-800"
                          />
                          <span className="text-zinc-300">
                            Revocable by vault owner (allows clawback of unvested collateral)
                          </span>
                        </label>

                        <button
                          type="submit"
                          disabled={isTxPending || !streamShares || parseFloat(streamShares) <= 0 || parseFloat(streamShares) > depositedShares || marketState === 'STALE'}
                          className="w-full border border-white bg-white text-black py-3.5 font-mono font-bold text-xs uppercase tracking-wider hover:bg-zinc-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                        >
                          {isTxPending ? 'Executing…' : marketState === 'STALE' ? 'Oracle Stale / Streaming Frozen' : 'Initialize Stream'}
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="border border-zinc-900 bg-black p-6 sm:p-8">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-900 font-mono text-xs">
                <h2 className="font-bold text-sm uppercase tracking-wider text-white">
                  Vault Audit Trail
                </h2>
                <span className="text-zinc-500">{txHistory.length} transactions</span>
              </div>

              {txHistory.length === 0 ? (
                <div className="py-6 text-center font-mono text-xs text-zinc-600">
                  No vault transactions executed yet.
                </div>
              ) : (
                <div className="divide-y divide-zinc-900 font-mono text-xs">
                  {txHistory.map((tx) => (
                    <div key={tx.id} className="py-3 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <span className="text-zinc-600 text-[11px] tabular-nums">{tx.time}</span>
                        <span className="font-bold text-white uppercase text-[11px] border border-zinc-800 px-2 py-0.5">
                          {tx.action}
                        </span>
                        <span className="text-zinc-400 text-xs hidden sm:inline">{tx.detail}</span>
                      </div>
                      <span className="text-zinc-600 text-[11px] shrink-0">{tx.signature}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

        {activeView === 'liquidations' && (
          <div className="space-y-8 font-mono">
            <div className="border border-zinc-900 bg-black p-6 sm:p-8">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-zinc-900">
                <div>
                  <h2 className="text-base font-bold uppercase tracking-wider text-white">
                    Liquidations
                  </h2>
                  <div className="text-xs text-zinc-400 mt-1">
                    Active protocol positions, collateral health factors, and liquidation auctions.
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs">
                    <span className="text-zinc-500">Liquidator Bonus:</span>{' '}
                    <span className="text-emerald-400 font-bold">5.0%</span>
                  </div>
                  <div className="border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs">
                    <span className="text-zinc-500">Threshold:</span>{' '}
                    <span className="text-white font-bold">{(liqThreshold * 100).toFixed(0)}%</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-6 border-b border-zinc-900">
                <div className="border border-zinc-900 bg-zinc-950/50 p-4">
                  <div className="text-[11px] text-zinc-500 uppercase">Monitored Collateral</div>
                  <div className="text-lg font-bold text-white mt-1 tabular-nums">
                    ${protocolPositions.reduce((acc, p) => acc + (p.isLiquidated ? 0 : p.collateralValue), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">Across all active PDA vaults</div>
                </div>

                <div className="border border-zinc-900 bg-zinc-950/50 p-4">
                  <div className="text-[11px] text-zinc-500 uppercase">Outstanding Debt</div>
                  <div className="text-lg font-bold text-white mt-1 tabular-nums">
                    ${protocolPositions.reduce((acc, p) => acc + (p.isLiquidated ? 0 : p.debtUsdc), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">USDC credit principal</div>
                </div>

                <div className="border border-zinc-900 bg-zinc-950/50 p-4">
                  <div className="text-[11px] text-zinc-500 uppercase">At-Risk Positions</div>
                  <div className="text-lg font-bold text-amber-400 mt-1 tabular-nums">
                    {protocolPositions.filter((p) => p.isAtRisk && !p.isLiquidatable && !p.isLiquidated).length}
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">Health factor 1.00x to 1.05x</div>
                </div>

                <div className="border border-zinc-900 bg-zinc-950/50 p-4">
                  <div className="text-[11px] text-zinc-500 uppercase">Actionable Liquidations</div>
                  <div className={`text-lg font-bold mt-1 tabular-nums ${protocolPositions.filter((p) => p.isLiquidatable).length > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {protocolPositions.filter((p) => p.isLiquidatable).length}
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">Health factor &lt; 1.00x</div>
                </div>
              </div>

              <div className="mt-6 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-500 uppercase text-[10px] tracking-wider">
                      <th className="pb-3 pr-4 font-normal">Vault Owner</th>
                      <th className="pb-3 px-4 font-normal">Asset</th>
                      <th className="pb-3 px-4 font-normal text-right">Collateral</th>
                      <th className="pb-3 px-4 font-normal text-right">Debt</th>
                      <th className="pb-3 px-4 font-normal text-right">LTV / Max</th>
                      <th className="pb-3 px-4 font-normal text-right">Health</th>
                      <th className="pb-3 pl-4 font-normal text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-900">
                    {protocolPositions.map((pos) => (
                      <tr key={pos.id} className="hover:bg-zinc-950/50 transition-colors">
                        <td className="py-3.5 pr-4">
                          <div className="font-bold text-white flex items-center gap-2">
                            <span>{pos.owner.slice(0, 4)}…{pos.owner.slice(-4)}</span>
                            {publicKey && pos.owner === publicKey.toBase58() && (
                              <span className="border border-zinc-700 bg-zinc-900 px-1.5 py-0.2 text-[9px] uppercase tracking-wider text-zinc-300">
                                You
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-zinc-500 mt-0.5">{pos.lastUpdate}</div>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-zinc-200 text-xs font-bold">
                            {pos.asset}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <div className="text-white font-bold tabular-nums">
                            {pos.collateralShares.toFixed(2)}
                          </div>
                          <div className="text-[10px] text-zinc-500 tabular-nums">
                            ${pos.collateralValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <div className="text-white tabular-nums">
                            ${pos.debtUsdc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                          <div className="text-[10px] text-zinc-500">USDC</div>
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <div className={`tabular-nums font-bold ${pos.ltv > liqThreshold * 100 ? 'text-red-400' : 'text-zinc-300'}`}>
                            {pos.ltv.toFixed(1)}%
                          </div>
                          <div className="text-[10px] text-zinc-500">
                            Cap: {(liqThreshold * 100).toFixed(0)}%
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          {pos.isLiquidated ? (
                            <span className="border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-zinc-500 font-bold text-[10px]">
                              LIQUIDATED
                            </span>
                          ) : pos.healthFactor === null ? (
                            <span className="text-zinc-500">N/A</span>
                          ) : (
                            <span
                              className={`font-bold tabular-nums ${
                                pos.healthFactor < 1.0
                                  ? 'text-red-400'
                                  : pos.healthFactor < 1.15
                                    ? 'text-amber-400'
                                    : 'text-emerald-400'
                              }`}
                            >
                              {pos.healthFactor.toFixed(2)}x
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 pl-4 text-right">
                          {pos.isLiquidated ? (
                            <span className="text-zinc-600 text-xs">Settled</span>
                          ) : pos.isLiquidatable ? (
                            <button
                              type="button"
                              disabled={isTxPending}
                              onClick={() => handleLiquidateVault(pos.id, pos.owner, pos.asset)}
                              className="border border-red-500 bg-red-950/60 text-red-300 hover:bg-red-900 px-3 py-1 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-50"
                            >
                              {isTxPending ? 'Executing…' : 'Liquidate'}
                            </button>
                          ) : (
                            <span className="text-zinc-600 text-xs uppercase">Healthy</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="border border-zinc-900 bg-black p-6">
                <div className="text-xs font-bold text-white uppercase tracking-wider mb-2">
                  Liquidation Incentive
                </div>
                <div className="text-xs text-zinc-400 leading-relaxed">
                  Liquidators repay outstanding USDC debt on behalf of underwater vaults in exchange for underlying synthetic equity collateral at a 5% protocol discount.
                </div>
              </div>

              <div className="border border-zinc-900 bg-black p-6">
                <div className="text-xs font-bold text-white uppercase tracking-wider mb-2">
                  Market Hours Adjustment
                </div>
                <div className="text-xs text-zinc-400 leading-relaxed">
                  During NYSE closed sessions, the liquidation threshold automatically shifts from 80% to 55% to protect solvency against overnight volatility.
                </div>
              </div>

              <div className="border border-zinc-900 bg-black p-6">
                <div className="text-xs font-bold text-white uppercase tracking-wider mb-2">
                  Interactive Simulator
                </div>
                <div className="text-xs text-zinc-400 leading-relaxed">
                  Use the simulator bar at the bottom to trigger a -30% market crash or switch sessions to watch real-time health factor updates and test liquidations.
                </div>
              </div>
            </div>
          </div>
        )}

        {activeView === 'markets' && (
          <div className="space-y-8 font-mono">
            <div className="border border-zinc-900 bg-black p-6 sm:p-8">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-zinc-900">
                <div>
                  <h2 className="text-base font-bold uppercase tracking-wider text-white">
                    Markets
                  </h2>
                  <div className="text-xs text-zinc-400 mt-1">
                    Synthetic equity pricing, confidence spreads, and borrowing parameters.
                  </div>
                </div>

                <div className="flex items-center gap-2 border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-zinc-400 uppercase">Pyth Feed:</span>
                  <span className="text-white font-bold">{feedAge}s latency</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6">
                {Object.entries(ASSET_FEEDS).map(([sym, feed]) => {
                  const p = prices[sym] || feed.price
                  const confPct = p > 0 ? (feed.conf / p) * 100 : 0
                  return (
                    <div key={sym} className="border border-zinc-900 bg-zinc-950/40 p-5 space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-bold text-white">{feed.name}</div>
                          <div className="text-xs text-zinc-500 font-mono">{sym} / USD</div>
                        </div>
                        <span className="border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-300 font-bold">
                          {feed.ticker}
                        </span>
                      </div>

                      <div className="pt-2 border-t border-zinc-900">
                        <div className="text-[11px] text-zinc-500 uppercase">Benchmark Spot</div>
                        <div className="text-2xl font-bold text-white tabular-nums mt-1">
                          ${p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <div className={`text-xs mt-0.5 ${feed.delta24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {feed.delta24h >= 0 ? '+' : ''}{feed.delta24h.toFixed(2)}% (24h)
                        </div>
                      </div>

                      <div className="space-y-2.5 pt-2 border-t border-zinc-900 text-xs">
                        <div className="flex justify-between">
                          <span className="text-zinc-500">Confidence Spread:</span>
                          <span className="text-zinc-300 tabular-nums">±${feed.conf.toFixed(2)} ({confPct.toFixed(3)}%)</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-500">Max Borrow LTV:</span>
                          <span className="text-zinc-300 tabular-nums">{(ltvCap * 100).toFixed(0)}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-500">Liquidation Threshold:</span>
                          <span className="text-zinc-300 tabular-nums">{(liqThreshold * 100).toFixed(0)}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-500">Session Status:</span>
                          <span className={marketState === 'OPEN' ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                            {marketState}
                          </span>
                        </div>
                      </div>

                      <div className="pt-3 border-t border-zinc-900">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedAsset(sym)
                            setActiveView('portfolio')
                          }}
                          className="w-full border border-zinc-800 bg-black hover:border-zinc-500 hover:text-white text-zinc-300 py-2 text-xs uppercase font-bold tracking-wider transition-colors cursor-pointer"
                        >
                          Manage {feed.ticker} Vault
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="border border-zinc-900 bg-black p-6">
                <div className="text-xs font-bold text-white uppercase tracking-wider mb-2">
                  Reference Index Pricing
                </div>
                <div className="text-xs text-zinc-400 leading-relaxed">
                  Real-time high-frequency benchmark prices provided by Pyth Network with confidence intervals to guard against gap volatility and ensure accurate collateral valuation.
                </div>
              </div>

              <div className="border border-zinc-900 bg-black p-6">
                <div className="text-xs font-bold text-white uppercase tracking-wider mb-2">
                  Session Safeguards
                </div>
                <div className="text-xs text-zinc-400 leading-relaxed">
                  Collateral loan-to-value caps automatically adjust between regular NYSE market hours and overnight sessions to protect vault stability across market closures.
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <div className="border-t border-zinc-900 bg-black py-4 px-6 mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 font-mono text-xs">
          <div className="flex items-center gap-3 text-zinc-500">
            <span className="uppercase tracking-wider text-zinc-400">Risk Simulator:</span>
            <span>Test contract safeguards</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setMarketState('OPEN')}
              className={`px-3 py-1 text-xs font-bold border transition-colors cursor-pointer ${
                marketState === 'OPEN'
                  ? 'border-emerald-500 bg-emerald-950/30 text-emerald-400'
                  : 'border-zinc-800 text-zinc-400 hover:text-white'
              }`}
            >
              SET OPEN
            </button>
            <button
              type="button"
              onClick={() => setMarketState('CLOSED')}
              className={`px-3 py-1 text-xs font-bold border transition-colors cursor-pointer ${
                marketState === 'CLOSED'
                  ? 'border-amber-500 bg-amber-950/30 text-amber-400'
                  : 'border-zinc-800 text-zinc-400 hover:text-white'
              }`}
            >
              SET CLOSED
            </button>
            <button
              type="button"
              onClick={() => setMarketState('STALE')}
              className={`px-3 py-1 text-xs font-bold border transition-colors cursor-pointer ${
                marketState === 'STALE'
                  ? 'border-red-500 bg-red-950/30 text-red-400'
                  : 'border-zinc-800 text-zinc-400 hover:text-white'
              }`}
            >
              SET STALE
            </button>
            <button
              type="button"
              onClick={() => {
                setPrices((prev) => ({
                  ...prev,
                  [selectedAsset]: Number((prev[selectedAsset] * 0.7).toFixed(2)),
                }))
                logTransaction('CRASH', `Market simulated -30% price gap`)
                showToast('Simulation: Market Crash', `${assetInfo.symbol} dropped 30%. Inspecting health buffer.`)
              }}
              className="px-3 py-1 text-xs font-bold border border-zinc-800 text-red-400 hover:border-red-500/50 transition-colors cursor-pointer"
            >
              CRASH -30%
            </button>
          </div>
        </div>
      </div>

      {depositModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="border border-zinc-800 bg-black max-w-md w-full p-6 font-mono">
            <div className="flex items-center justify-between pb-4 border-b border-zinc-900 mb-6">
              <h3 className="font-bold text-sm uppercase tracking-wider">
                Deposit {assetInfo.ticker} Collateral
              </h3>
              <button
                type="button"
                onClick={() => setDepositModalOpen(false)}
                className="text-zinc-500 hover:text-white text-base cursor-pointer"
              >
                X
              </button>
            </div>

            <form onSubmit={handleDeposit} className="space-y-6">
              <div>
                <div className="flex justify-between items-center text-xs text-zinc-400 mb-2">
                  <span>Shares to Deposit</span>
                  <div className="flex items-center gap-2">
                    <span>Wallet: {walletShares.toFixed(2)}</span>
                    <button
                      type="button"
                      onClick={() => handleFaucetTokens(100)}
                      className="border border-zinc-800 bg-zinc-900 text-zinc-300 hover:text-white px-1.5 py-0.5 text-[10px] uppercase font-bold tracking-wider transition-colors cursor-pointer"
                    >
                      +100 Faucet
                    </button>
                  </div>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    step="any"
                    value={modalSharesInput}
                    onChange={(e) => setModalSharesInput(e.target.value)}
                    placeholder="0.00"
                    className="w-full border border-zinc-800 bg-black p-3 text-sm text-white focus:outline-none focus:border-white transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setModalSharesInput(walletShares.toString())}
                    className="absolute right-3 top-3 border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 hover:text-white cursor-pointer"
                  >
                    MAX
                  </button>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setDepositModalOpen(false)}
                  className="flex-1 border border-zinc-800 py-3 text-xs uppercase font-bold text-zinc-400 hover:text-white transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isTxPending || !modalSharesInput || parseFloat(modalSharesInput) <= 0 || parseFloat(modalSharesInput) > walletShares}
                  className="flex-1 border border-white bg-white text-black py-3 text-xs uppercase font-bold hover:bg-zinc-200 transition-colors disabled:opacity-30 cursor-pointer"
                >
                  {isTxPending ? 'Executing…' : 'Confirm Deposit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {withdrawModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="border border-zinc-800 bg-black max-w-md w-full p-6 font-mono">
            <div className="flex items-center justify-between pb-4 border-b border-zinc-900 mb-6">
              <h3 className="font-bold text-sm uppercase tracking-wider">
                Withdraw {assetInfo.ticker} Collateral
              </h3>
              <button
                type="button"
                onClick={() => setWithdrawModalOpen(false)}
                className="text-zinc-500 hover:text-white text-base cursor-pointer"
              >
                X
              </button>
            </div>

            <form onSubmit={handleWithdraw} className="space-y-6">
              <div>
                <div className="flex justify-between text-xs text-zinc-400 mb-2">
                  <span>Shares to Withdraw</span>
                  <span>Vault Balance: {depositedShares.toFixed(2)}</span>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    step="any"
                    value={modalSharesInput}
                    onChange={(e) => setModalSharesInput(e.target.value)}
                    placeholder="0.00"
                    className="w-full border border-zinc-800 bg-black p-3 text-sm text-white focus:outline-none focus:border-white transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setModalSharesInput(depositedShares.toString())}
                    className="absolute right-3 top-3 border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 hover:text-white cursor-pointer"
                  >
                    MAX
                  </button>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setWithdrawModalOpen(false)}
                  className="flex-1 border border-zinc-800 py-3 text-xs uppercase font-bold text-zinc-400 hover:text-white transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isTxPending || !modalSharesInput || parseFloat(modalSharesInput) <= 0 || parseFloat(modalSharesInput) > depositedShares}
                  className="flex-1 border border-white bg-white text-black py-3 text-xs uppercase font-bold hover:bg-zinc-200 transition-colors disabled:opacity-30 cursor-pointer"
                >
                  {isTxPending ? 'Executing…' : 'Confirm Withdraw'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toastMessage && (
        <div
          className={`fixed bottom-20 right-6 z-50 border ${
            toastMessage.type === 'error'
              ? 'border-red-900/80 bg-zinc-950'
              : toastMessage.type === 'success'
                ? 'border-zinc-800 bg-black'
                : 'border-zinc-800 bg-black'
          } p-4 max-w-sm font-mono shadow-2xl transition-all`}
        >
          <div className="flex items-center gap-2">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                toastMessage.type === 'error'
                  ? 'bg-red-400'
                  : toastMessage.type === 'success'
                    ? 'bg-emerald-400'
                    : 'bg-zinc-400'
              }`}
            />
            <span className="text-xs font-bold text-white uppercase tracking-wider">
              {toastMessage.title}
            </span>
          </div>
          <div className="text-xs text-zinc-400 mt-1.5 leading-relaxed">{toastMessage.desc}</div>
        </div>
      )}
    </div>
  )
}
