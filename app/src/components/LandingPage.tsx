import { useRef, type MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { DottedGlowBackground } from '@/components/ui/dotted-glow-background'
import { BackgroundRippleEffect } from '@/components/ui/background-ripple-effect'
import { DoorsCurtain, type DoorsCurtainHandle } from '@/components/ui/doors-curtain'

export default function LandingPage() {
  const navigate = useNavigate()
  const doorsRef = useRef<DoorsCurtainHandle | null>(null)

  const handleLaunchApp = (e: MouseEvent) => {
    e.preventDefault()
    if (doorsRef.current) {
      doorsRef.current.close(() => {
        navigate('/app')
      })
    } else {
      navigate('/app')
    }
  }

  return (
    <div className="min-h-screen bg-black text-white selection:bg-white selection:text-black flex flex-col font-sans">
      <DoorsCurtain ref={doorsRef} duration={3500} delay={600} />

      <header className="border-b border-zinc-900 sticky top-0 z-50 bg-black">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-mono font-bold text-lg tracking-tight">DUSK</span>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden bg-black min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <BackgroundRippleEffect />
        <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black via-black/80 to-transparent pointer-events-none z-10" />

        <div className="relative z-10 max-w-5xl mx-auto px-6 py-20 md:py-24 -translate-y-6 md:-translate-y-10 flex flex-col items-center justify-center text-center pointer-events-none">
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-white leading-tight sm:leading-[1.15] mb-6 max-w-4xl pointer-events-auto">
            <span className="block">The collateral layer for</span>
            <span className="block">tokenized equities on Solana.</span>
          </h1>

          <p className="text-base sm:text-lg text-zinc-400 leading-relaxed mb-10 max-w-2xl mx-auto pointer-events-auto">
            Lock your tokenized shares in a single vault to borrow stablecoins, earn yield with covered calls, or stream payments over time. Safe and non-custodial, with automatic safeguards when traditional stock markets close.
          </p>

          <div className="flex justify-center pointer-events-auto">
            <button
              type="button"
              onClick={handleLaunchApp}
              className="group inline-flex items-center gap-2.5 border border-white bg-white text-black px-8 py-3.5 font-mono font-bold text-sm tracking-wider uppercase hover:bg-zinc-200 transition-colors cursor-pointer"
            >
              <span>Launch App</span>
              <svg
                className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  d="M3 8H13M13 8L8.5 3.5M13 8L8.5 12.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
      </section>

      <section className="border-b border-zinc-900 py-20">
        <div className="max-w-6xl mx-auto px-6">
          <div className="max-w-xl mb-12">
            <div className="text-xs font-mono uppercase tracking-widest text-zinc-500 mb-2">
              Use Cases
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Three ways to use one position
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="border border-zinc-900 bg-black p-6">
              <div className="font-mono text-xs text-zinc-600 mb-4">01</div>
              <h3 className="font-bold text-lg mb-2">Borrow Stablecoins</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Borrow USDC directly against your tokenized stock collateral without selling your underlying shares.
              </p>
            </div>

            <div className="border border-zinc-900 bg-black p-6">
              <div className="font-mono text-xs text-zinc-600 mb-4">02</div>
              <h3 className="font-bold text-lg mb-2">Earn Yield</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Generate yield by selling covered calls directly against your deposited equity collateral.
              </p>
            </div>

            <div className="border border-zinc-900 bg-black p-6">
              <div className="font-mono text-xs text-zinc-600 mb-4">03</div>
              <h3 className="font-bold text-lg mb-2">Stream Payments</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Set up per-second streaming for gradual payouts, vesting schedules, or continuous collateral release.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-zinc-900 py-20">
        <div className="max-w-6xl mx-auto px-6">
          <div className="border border-zinc-900 p-8 md:p-12">
            <div className="text-xs font-mono uppercase tracking-widest text-zinc-500 mb-2">
              Market Protection
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-4">
              Built for real market hours
            </h2>
            <p className="text-zinc-400 leading-relaxed max-w-2xl text-sm md:text-base">
              Tokenized stocks trade 24/7 on Solana, but the underlying stock market closes overnight and on weekends. Dusk automatically checks whether the stock exchange is open and verifies price feed health before executing risk-sensitive actions, protecting your collateral from stale prices.
            </p>
          </div>
        </div>
      </section>

      <section className="border-b border-zinc-900 py-20">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-xs font-mono uppercase tracking-widest text-zinc-500 mb-2">
            How It Works
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-12">
            Simple three step setup
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="border-l border-zinc-800 pl-6">
              <div className="font-mono text-xs text-zinc-500 mb-2">STEP 01</div>
              <h3 className="font-bold text-base mb-2">Connect wallet</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Connect your Solana wallet such as Phantom or Solflare in one click.
              </p>
            </div>

            <div className="border-l border-zinc-800 pl-6">
              <div className="font-mono text-xs text-zinc-500 mb-2">STEP 02</div>
              <h3 className="font-bold text-base mb-2">Deposit collateral</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Lock your supported tokenized stock into your dedicated non-custodial vault.
              </p>
            </div>

            <div className="border-l border-zinc-800 pl-6">
              <div className="font-mono text-xs text-zinc-500 mb-2">STEP 03</div>
              <h3 className="font-bold text-base mb-2">Select strategy</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Choose to borrow stablecoins, write covered calls, or stream your position.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 bg-black border-b border-zinc-900">
        <div className="max-w-6xl mx-auto px-6">
          <div className="relative overflow-hidden border border-zinc-800 bg-black p-8 md:p-14">
            <DottedGlowBackground
              className="pointer-events-none mask-radial-to-90% mask-radial-at-center opacity-40 dark:opacity-100"
              opacity={1}
              gap={10}
              radius={1.6}
              colorLightVar="--color-neutral-500"
              glowColorLightVar="--color-neutral-600"
              colorDarkVar="--color-neutral-500"
              glowColorDarkVar="--color-sky-800"
              backgroundOpacity={0}
              speedMin={0.3}
              speedMax={1.6}
              speedScale={1}
            />

            <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
              <div>
                <h2 className="text-3xl sm:text-4xl font-normal tracking-tight text-neutral-400">
                  Ready to open a{' '}
                  <span className="font-bold text-white">vault</span>?
                </h2>
                <p className="mt-3 max-w-lg text-sm sm:text-base text-neutral-300">
                  Connect your wallet and manage your tokenized stock collateral on Solana.
                </p>
              </div>

              <div className="flex shrink-0">
                <Link
                  to="/app"
                  onClick={handleLaunchApp}
                  className="group inline-flex items-center gap-2.5 border border-white bg-white px-8 py-3 font-mono text-xs font-bold uppercase tracking-wider text-black transition-all duration-200 hover:bg-zinc-200"
                >
                  <span>Launch App</span>
                  <svg
                    className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1"
                    viewBox="0 0 16 16"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true"
                  >
                    <path
                      d="M3 8H13M13 8L8.5 3.5M13 8L8.5 12.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-zinc-900 py-6 mt-auto bg-black">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono text-zinc-500">
          <div className="flex items-center gap-3">
            <span className="font-bold text-white tracking-tight">DUSK</span>
            <span className="text-zinc-800">|</span>
            <span>© 2026</span>
          </div>

          <div className="hidden md:block text-zinc-500">
            Tokenized equity collateral on Solana
          </div>

          <div className="flex items-center">
            <a
              href="https://github.com/Yiranubari/Dusk"
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-400 hover:text-white transition-colors"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
