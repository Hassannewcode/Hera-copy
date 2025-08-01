import React, { useState, useCallback } from 'react';
import { LoadingState, VideoResult, AspectRatio } from './types';
import { generateVideo } from './api/api'; // <-- Correct import from the new client-side file
import { Button } from './components/Button';
import { VideoPlayer } from './components/VideoPlayer';

// Mock UI components for this example
const Form = ({ onSubmit }) => {
    const [prompt, setPrompt] = useState('');
    const [duration, setDuration] = useState(15);
    const [textColor, setTextColor] = useState('#ffffff');
    const [generateNarration, setGenerateNarration] = useState(true);

    const handleSubmit = useCallback((e) => {
        e.preventDefault();
        onSubmit({ prompt, config: { duration, textColor, generateNarration, aspectRatio: '16:9', transparentBackground: false } });
    }, [prompt, duration, textColor, generateNarration, onSubmit]);

    return (
        <form onSubmit={handleSubmit}>
            <input type="text" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Enter video prompt" required />
            <Button type="submit">Generate Video</Button>
        </form>
    );
};

export default function App() {
    const [videoResult, setVideoResult] = useState<VideoResult | null>(null);
    const [loadingState, setLoadingState] = useState<LoadingState | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleGenerateVideo = useCallback(async ({ prompt, config }) => {
        setVideoResult(null);
        setError(null);
        setLoadingState({ step: 0, totalSteps: 1, message: 'Starting generation...' });

        try {
            const result = await generateVideo(prompt, config, (state) => {
                setLoadingState(state);
            });
            setVideoResult(result);
        } catch (err) {
            console.error(err);
            setError(err.message || 'An unexpected error occurred.');
        } finally {
            setLoadingState(null);
        }
    }, []);

    return (
        <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4">
            <h1 className="text-4xl font-bold mb-8">AI Motion Studio</h1>
            <Form onSubmit={handleGenerateVideo} />
            {loadingState && (
                <div className="mt-4 text-center">
                    <p>{loadingState.message}</p>
                    <p>Step {loadingState.step} of {loadingState.totalSteps}</p>
                </div>
            )}
            {error && <div className="mt-4 text-red-500 font-bold">{error}</div>}
            {videoResult && (
                <div className="mt-8">
                    <VideoPlayer videoResult={videoResult} />
                </div>
            )}
        </div>
    );
}
