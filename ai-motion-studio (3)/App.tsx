
import React, { useState, useCallback } from 'react';
import { LoadingState, VideoResult, AspectRatio } from './types';
import { Button } from './components/Button';
import { VideoPlayer } from './components/VideoPlayer';
import { QuoteCard } from './components/QuoteCard';

const examplePrompts = [
    'A 3D logo reveal for a tech company called "Nexus"',
    'Floating data points connecting in a 3D space',
    'An abstract animation with glowing, ethereal shapes drifting in the dark',
    'Cinematic title: "THE VOID", with letters slowly fading in with a blur effect',
];

const aspectRatios: { id: AspectRatio, name: string }[] = [
    { id: '16:9', name: '16:9' },
    { id: '9:16', name: '9:16' },
    { id: '1:1', name: '1:1' },
];


const streamVideoGeneration = async (
  prompt: string,
  config: any,
  onProgress: (state: LoadingState) => void,
  onResult: (result: VideoResult) => void,
  onError: (error: string) => void
) => {
  const response = await fetch('/api/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, config }),
  });

  if (!response.body) {
    onError("Failed to get response stream.");
    return;
  }
  
  if (!response.ok) {
     const errorText = await response.text();
     try {
       const errorJson = JSON.parse(errorText);
       onError(`Server error: ${errorJson.error || errorText}`);
     } catch {
       onError(`Server error: ${response.status} ${response.statusText}. ${errorText}`);
     }
     return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const processStream = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const json = JSON.parse(line.substring(6));
              if (json.type === 'progress') {
                onProgress(json.data);
              } else if (json.type === 'result') {
                onResult(json.data);
                return; 
              } else if (json.type === 'error') {
                onError(json.data);
                return;
              }
            } catch (e) {
              console.error("Failed to parse stream data:", line, e);
            }
          }
        }
      }
  };

  await processStream();
};

const App: React.FC = () => {
  const [prompt, setPrompt] = useState<string>('');
  const [videoResult, setVideoResult] = useState<VideoResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingState, setLoadingState] = useState<LoadingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Video configuration state
  const [duration, setDuration] = useState(10);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [generateNarration, setGenerateNarration] = useState(false);
  const [textColor, setTextColor] = useState<string>('#FFFFFF');
  const [transparentBackground, setTransparentBackground] = useState(false);
  const [overrideBg, setOverrideBg] = useState<boolean>(false);
  const [bgColor, setBgColor] = useState<string>('#111827');

  
  const handleGenerate = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!prompt.trim() || loading) return;

    setLoading(true);
    setError(null);
    setVideoResult(null);
    const sceneCount = Math.max(2, Math.ceil(duration / 3));
    const totalSteps = 2 + sceneCount + (generateNarration ? 1 : 0);
    setLoadingState({step: 0, totalSteps, message: 'Initializing...'})
    
    const config = { 
      duration, 
      aspectRatio, 
      generateNarration, 
      textColor, 
      transparentBackground,
      backgroundColor: overrideBg ? bgColor : undefined,
    };
    
    await streamVideoGeneration(
        prompt,
        config,
        (state) => setLoadingState(state),
        (result) => {
            setVideoResult(result);
            setLoading(false);
            setLoadingState(null);
        },
        (err) => {
            setError(err);
            setLoading(false);
            setLoadingState(null);
        }
    );
  }, [prompt, loading, duration, aspectRatio, generateNarration, textColor, transparentBackground, overrideBg, bgColor]);
  
  const handleTryAgain = () => {
    setError(null);
    setVideoResult(null);
  }

  const showForm = !loading && !error && !videoResult;

  const renderContent = () => {
    if (loading && loadingState) {
        const progress = Math.round((loadingState.step / loadingState.totalSteps) * 100);
        return (
            <div className="text-center w-full max-w-lg px-4 flex flex-col items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-20 w-20 text-indigo-400 loader-animate" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.898 20.573L16.5 21.75l-.398-1.177a3.375 3.375 0 00-2.455-2.456L12.75 18l1.177-.398a3.375 3.375 0 002.455-2.456L16.5 14.25l.398 1.177a3.375 3.375 0 002.456 2.456L20.25 18l-1.177.398a3.375 3.375 0 00-2.456 2.456z" />
                </svg>
                <h2 className="text-2xl font-plex font-semibold mt-6 mb-2 text-indigo-300">Generating your motion graphic...</h2>
                <p className="text-gray-400 mb-6 min-h-[2rem]">{loadingState.message}</p>
                <div className="w-full bg-gray-700/50 rounded-full h-2.5 mt-2">
                    <div className="bg-gradient-to-r from-purple-500 to-indigo-500 h-2.5 rounded-full" style={{ width: `${progress}%`, transition: 'width 0.5s ease-in-out' }}></div>
                </div>
                <p className="text-sm text-gray-500 mt-3">{`Step ${loadingState.step} of ${loadingState.totalSteps}`}</p>
                <QuoteCard />
            </div>
        );
    }
    
    if (error) {
        return (
            <div className="text-center bg-gray-900/50 p-8 rounded-2xl border border-red-500/30 max-w-lg mx-4">
                <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <h2 className="mt-4 text-xl font-semibold text-red-400 font-plex">Generation Failed</h2>
                <p className="mt-2 text-gray-400 max-w-md whitespace-pre-wrap">{error}</p>
                <Button onClick={handleTryAgain} className="mt-6">
                    Try Again
                </Button>
            </div>
        )
    }

    if (videoResult) {
        return (
            <div className="w-full max-w-5xl mx-auto text-center">
                <div className="bg-gray-900 rounded-xl shadow-2xl overflow-hidden border border-gray-700/50 mb-8">
                    <div className="relative w-full bg-black flex items-center justify-center">
                        <VideoPlayer videoResult={videoResult} />
                    </div>
                </div>
                <div className="flex justify-center items-center gap-4">
                  <Button onClick={handleTryAgain}>
                      Create Another
                  </Button>
                  <Button disabled>Export MP4</Button>
                  <Button disabled>Export GIF</Button>
                </div>
            </div>
        );
    }

    return (
        <div className="text-center px-4">
             <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-16 w-16 text-indigo-500/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.898 20.573L16.5 21.75l-.398-1.177a3.375 3.375 0 00-2.455-2.456L12.75 18l1.177-.398a3.375 3.375 0 002.455-2.456L16.5 14.25l.398 1.177a3.375 3.375 0 002.456 2.456L20.25 18l-1.177.398a3.375 3.375 0 00-2.456 2.456z" />
            </svg>
            <h1 className="mt-4 text-4xl font-bold text-gray-200 font-plex tracking-tight">AI Motion Graphic Creator</h1>
            <p className="mt-2 text-lg text-gray-400 max-w-2xl mx-auto">Transform text into designer-quality motion graphics in seconds.</p>
            <div className="mt-10 max-w-2xl mx-auto">
                <p className="text-sm text-gray-500 mb-3">Or try an example:</p>
                <div className="flex flex-wrap justify-center gap-3">
                    {examplePrompts.map((p) => (
                        <button key={p} onClick={() => setPrompt(p)} className="px-4 py-2 bg-gray-800/60 border border-gray-700/50 rounded-full text-sm text-gray-300 hover:bg-gray-700/80 hover:border-gray-600 transition-all duration-200">
                            {p}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
  };
  
  const SettingsModal = () => (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setIsSettingsOpen(false)}>
      <div className="bg-gray-900 border border-gray-700/50 rounded-2xl shadow-2xl w-full max-w-2xl p-6 lg:p-8 relative" onClick={e => e.stopPropagation()}>
        <h2 className="text-2xl font-bold text-white mb-6 font-plex">Custom Settings</h2>
        <button onClick={() => setIsSettingsOpen(false)} className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-6">
              {/* Duration */}
              <div>
                <label htmlFor="duration" className="block text-sm font-medium text-gray-300 mb-2">Duration: <span className="font-bold text-indigo-400">{duration}s</span></label>
                <input id="duration" type="range" min="3" max="30" step="1" value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"/>
              </div>
              {/* Aspect Ratio */}
              <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Aspect Ratio</label>
                  <div className="grid grid-cols-3 items-center gap-2">
                      {aspectRatios.map(({id, name}) => ( <button key={id} type="button" onClick={() => setAspectRatio(id)} className={`w-full px-3 py-2 border rounded-md text-sm font-medium transition-colors duration-200 ${aspectRatio === id ? 'bg-indigo-600 border-transparent text-white' : 'bg-gray-800/60 border-gray-700/50 text-gray-300 hover:bg-gray-700/80'}`}> {name} </button>))}
                  </div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-6 items-center">
              {/* Text Color */}
              <div className="flex items-center gap-3">
                <label htmlFor="text-color" className="block text-sm font-medium text-gray-300">Text Color</label>
                <input id="text-color" type="color" value={textColor} onChange={e => setTextColor(e.target.value)} className="w-8 h-8 rounded border-none bg-gray-800 cursor-pointer"/>
              </div>
              {/* Narration */}
              <div className="flex items-center justify-between">
                <label htmlFor="narration" className="text-sm font-medium text-gray-300">Generate Narration</label>
                <button type="button" onClick={() => setGenerateNarration(!generateNarration)} className={`${generateNarration ? 'bg-indigo-600' : 'bg-gray-700'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-900`} role="switch" aria-checked={generateNarration}>
                  <span className={`${generateNarration ? 'translate-x-5' : 'translate-x-0'} pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}/>
                </button>
              </div>
              {/* Transparent BG */}
              <div className="flex items-center justify-between">
                <label htmlFor="transparent" className="text-sm font-medium text-gray-300">Transparent BG</label>
                <button type="button" onClick={() => setTransparentBackground(!transparentBackground)} className={`${transparentBackground ? 'bg-indigo-600' : 'bg-gray-700'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-900`} role="switch" aria-checked={transparentBackground}>
                  <span className={`${transparentBackground ? 'translate-x-5' : 'translate-x-0'} pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}/>
                </button>
              </div>
              {/* Background Color Override */}
              <div className="flex items-center justify-between col-span-1 md:col-span-2 lg:col-span-3">
                  <label htmlFor="override-bg" className="text-sm font-medium text-gray-300">Override Background Color (for scenes without images)</label>
                  <div className="flex items-center gap-3">
                      {overrideBg && <input id="bg-color" type="color" value={bgColor} onChange={e => setBgColor(e.target.value)} className="w-8 h-8 p-0 border-none rounded cursor-pointer bg-gray-800" />}
                      <button type="button" onClick={() => setOverrideBg(!overrideBg)} className={`${overrideBg ? 'bg-indigo-600' : 'bg-gray-700'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-900`} role="switch" aria-checked={overrideBg}>
                          <span className={`${overrideBg ? 'translate-x-5' : 'translate-x-0'} pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}/>
                      </button>
                  </div>
              </div>
            </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-950 text-gray-100">
      <main className="w-full max-w-5xl flex-grow flex items-center justify-center p-4">
          {renderContent()}
      </main>
      <footer className="w-full p-4 sticky bottom-0 left-0 bg-gray-950/30 backdrop-blur-lg border-t border-gray-700/50">
        <div className="w-full max-w-4xl mx-auto">
            <form onSubmit={handleGenerate}>
                <div className="relative flex items-center">
                    {showForm && (
                      <button type="button" onClick={() => setIsSettingsOpen(true)} className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full text-gray-400 hover:text-white hover:bg-gray-700/50 transition-all duration-200" aria-label="Open settings">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      </button>
                    )}
                    <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="e.g., An energetic title card for 'Launch Success' with a burst effect..."
                        className="w-full p-4 pl-14 pr-16 bg-gray-900 border border-gray-700/50 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors text-base shadow-lg resize-none"
                        disabled={loading || !!videoResult}
                        rows={2}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerate(e); }
                        }}
                    />
                    <button type="submit" disabled={loading || !prompt.trim() || !!videoResult} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-2 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-700 hover:to-indigo-700 disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-indigo-500" aria-label="Generate video">
                        {loading ? (
                           <svg className="animate-spin h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                           </svg>
                        ) : (
                           <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                             <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                           </svg>
                        )}
                    </button>
                </div>
            </form>
        </div>
      </footer>
      {isSettingsOpen && <SettingsModal />}
    </div>
  );
};

export default App;
