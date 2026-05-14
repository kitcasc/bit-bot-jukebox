import Sequencer from './components/Sequencer.jsx';

export default function App() {
  return (
    <main className="min-h-screen bg-[#141414] text-[#f7f7df]">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-3 border-b-4 border-[#f7f7df] pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-[#65e4a3]">
              8-bit music lab
            </p>
            <h1 className="mt-3 font-pixel text-2xl leading-relaxed text-[#ffe66d] sm:text-3xl">
              Bit-Bot Jukebox
            </h1>
          </div>
          <div className="font-mono text-sm text-[#c4c4a4]">
            16 tracks x 16 bits | square wave engine
          </div>
        </header>

        <Sequencer />
      </div>
    </main>
  );
}
