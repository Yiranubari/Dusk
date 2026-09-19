import { useState } from 'react'
import { Link } from 'react-router-dom'

export default function AppDashboard() {
  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>('deposit')
  const [amount, setAmount] = useState('')

  return (
    <div className="min-h-screen bg-black text-white selection:bg-white selection:text-black flex flex-col font-sans">
      <header className="border-b border-zinc-800 bg-black sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2">
              <span className="font-mono font-bold text-lg tracking-tight">DUSK</span>
            </Link>
            <span className="text-xs font-mono uppercase tracking-widest text-zinc-500 border-l border-zinc-800 pl-4 hidden sm:inline-block">
              Vault Terminal
            </span>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono">
            <div className="flex items-center gap-2 border border-zinc-800 px-3 py-1.5 bg-zinc-950">
              <span className="text-zinc-400">NETWORK:</span>
              <span className="text-zinc-200 font-semibold">LOCALNET</span>
            </div>

            <button
              type="button"
              className="border border-white bg-white text-black px-4 py-2 font-mono font-semibold text-xs tracking-wider uppercase hover:bg-zinc-200 transition-colors"
            >
              Connect Wallet
            </button>
          </div>
        </div>
      </header>

      <div className="border-b border-zinc-800 bg-black font-mono text-xs">
        <div className="max-w-7xl mx-auto px-6 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <div>
              <span className="text-zinc-500 uppercase mr-2">Feed:</span>
              <span className="font-bold text-white">NVDA / USD</span>
            </div>
            <div>
              <span className="text-zinc-500 uppercase mr-2">Pyth Px:</span>
              <span className="font-bold text-emerald-400">$128.45</span>
            </div>
            <div>
              <span className="text-zinc-500 uppercase mr-2">Confidence:</span>
              <span className="text-zinc-300">±$0.04</span>
            </div>
            <div>
              <span className="text-zinc-500 uppercase mr-2">Multiplier:</span>
              <span className="text-zinc-300">1.0000x</span>
            </div>
          </div>
          <div className="text-zinc-500">
            Market open : standard risk parameters active
          </div>
        </div>
      </div>

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="border border-zinc-800 bg-black p-6">
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-zinc-800">
              <h2 className="font-mono font-bold text-base uppercase tracking-wider">
                Vault Position Summary
              </h2>
              <span className="font-mono text-xs text-zinc-500">
                ACCOUNT: UNCONNECTED
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 font-mono">
              <div className="border border-zinc-900 bg-zinc-950 p-4">
                <div className="text-zinc-500 text-xs uppercase mb-1">Deposited Collateral</div>
                <div className="text-xl font-bold text-white">$0.00</div>
                <div className="text-xs text-zinc-500 mt-1">0 NVDA</div>
              </div>
              <div className="border border-zinc-900 bg-zinc-950 p-4">
                <div className="text-zinc-500 text-xs uppercase mb-1">Borrow Limit</div>
                <div className="text-xl font-bold text-white">$0.00</div>
                <div className="text-xs text-zinc-500 mt-1">LTV 70%</div>
              </div>
              <div className="border border-zinc-900 bg-zinc-950 p-4">
                <div className="text-zinc-500 text-xs uppercase mb-1">Outstanding Debt</div>
                <div className="text-xl font-bold text-white">$0.00</div>
                <div className="text-xs text-zinc-500 mt-1">USDC</div>
              </div>
              <div className="border border-zinc-900 bg-zinc-950 p-4">
                <div className="text-zinc-500 text-xs uppercase mb-1">Health Factor</div>
                <div className="text-xl font-bold text-emerald-400">100.0%</div>
                <div className="text-xs text-zinc-500 mt-1">SAFE</div>
              </div>
            </div>
          </div>

          <div className="border border-zinc-800 bg-black p-6">
            <h2 className="font-mono font-bold text-base uppercase tracking-wider mb-4 pb-3 border-b border-zinc-800">
              Active Protocol Feeds
            </h2>

            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-xs">
                <thead>
                  <tr className="border-b border-zinc-900 text-zinc-500 pb-2">
                    <th className="py-2 font-normal uppercase">Market</th>
                    <th className="py-2 font-normal uppercase">Price</th>
                    <th className="py-2 font-normal uppercase">Conf</th>
                    <th className="py-2 font-normal uppercase">Session</th>
                    <th className="py-2 font-normal uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900">
                  <tr>
                    <td className="py-3 font-bold text-white">NVDA / USD</td>
                    <td className="py-3 text-emerald-400 font-bold">$128.45</td>
                    <td className="py-3 text-zinc-400">±$0.04</td>
                    <td className="py-3 text-zinc-300">Regular</td>
                    <td className="py-3 text-emerald-400">ACTIVE</td>
                  </tr>
                  <tr>
                    <td className="py-3 font-bold text-white">AAPL / USD</td>
                    <td className="py-3 text-emerald-400 font-bold">$224.12</td>
                    <td className="py-3 text-zinc-400">±$0.06</td>
                    <td className="py-3 text-zinc-300">Regular</td>
                    <td className="py-3 text-emerald-400">ACTIVE</td>
                  </tr>
                  <tr>
                    <td className="py-3 font-bold text-white">TSLA / USD</td>
                    <td className="py-3 text-emerald-400 font-bold">$252.80</td>
                    <td className="py-3 text-zinc-400">±$0.11</td>
                    <td className="py-3 text-zinc-300">Regular</td>
                    <td className="py-3 text-emerald-400">ACTIVE</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div>
          <div className="border border-zinc-800 bg-black p-6">
            <div className="flex border-b border-zinc-800 mb-6">
              <button
                type="button"
                onClick={() => setActiveTab('deposit')}
                className={`flex-1 py-3 text-xs font-mono font-bold uppercase tracking-wider text-center transition-colors border-b-2 ${
                  activeTab === 'deposit'
                    ? 'border-white text-white'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Deposit Collateral
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('withdraw')}
                className={`flex-1 py-3 text-xs font-mono font-bold uppercase tracking-wider text-center transition-colors border-b-2 ${
                  activeTab === 'withdraw'
                    ? 'border-white text-white'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Withdraw
              </button>
            </div>

            <div className="space-y-4 font-mono">
              <div>
                <label className="block text-xs uppercase text-zinc-500 mb-2">
                  Asset
                </label>
                <div className="border border-zinc-800 bg-zinc-950 p-3 text-sm flex items-center justify-between">
                  <span className="font-bold text-white">NVDA</span>
                  <span className="text-xs text-zinc-500">SPL TOKEN</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs uppercase text-zinc-500 mb-2">
                  <span>Amount</span>
                  <span>Balance: 0.00</span>
                </div>
                <div className="border border-zinc-800 bg-zinc-950 p-3 flex items-center justify-between">
                  <input
                    type="text"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="bg-transparent text-white font-mono text-sm focus:outline-none w-full"
                  />
                  <button
                    type="button"
                    onClick={() => setAmount('10')}
                    className="text-xs text-zinc-400 hover:text-white uppercase pl-2 font-bold"
                  >
                    MAX
                  </button>
                </div>
              </div>

              <div className="pt-2 text-xs text-zinc-500 space-y-1">
                <div className="flex justify-between">
                  <span>Effective Multiplier</span>
                  <span className="text-zinc-300">1.0000x</span>
                </div>
                <div className="flex justify-between">
                  <span>Liquidation Buffer</span>
                  <span className="text-zinc-300">15%</span>
                </div>
              </div>

              <button
                type="button"
                className="w-full mt-4 border border-white bg-white text-black py-3 font-mono font-bold text-xs uppercase tracking-wider hover:bg-zinc-200 transition-colors"
              >
                Connect Wallet to Transact
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
