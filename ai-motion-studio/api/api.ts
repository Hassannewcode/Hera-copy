/**
 * @file api/api.ts
 * @description This file provides a client-side utility function to call the serverless video generation API.
 * It handles the streaming response and parses the data to update the UI.
 */

import type { LoadingState, VideoResult, AspectRatio } from '../types';

/**
 * A client-side function to initiate the video generation process on the server.
 * It returns a ReadableStream to handle real-time progress updates.
 * @param prompt The user's input prompt for the video.
 * @param config The video generation configuration.
 * @param onProgress A callback function to handle progress updates.
 * @returns A promise that resolves with the final VideoResult object.
 */
export async function generateVideo(
    prompt: string,
    config: {
        duration: number;
        aspectRatio: AspectRatio;
        generateNarration: boolean;
        textColor: string;
        transparentBackground: boolean;
        backgroundColor?: string;
    },
    onProgress: (state: LoadingState) => void
): Promise<VideoResult> {
    const response = await fetch('/api/handler', { // Use the relative path to the Vercel Edge Function
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt, config }),
    });

    if (!response.body) {
        throw new Error('Streaming response not available.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let result: VideoResult | undefined = undefined;

    while (true) {
        const { value, done } = await reader.read();
        if (done) {
            break;
        }

        const chunk = decoder.decode(value);
        const events = chunk.split('\n\n').filter(Boolean); // Split by Event Stream standard

        for (const event of events) {
            const jsonString = event.replace('data: ', '');
            if (jsonString) {
                const data = JSON.parse(jsonString);
                if (data.type === 'progress') {
                    onProgress(data.data as LoadingState);
                } else if (data.type === 'result') {
                    result = data.data as VideoResult;
                } else if (data.type === 'error') {
                    throw new Error(data.data);
                }
            }
        }
    }

    if (!result) {
        throw new Error('Video generation failed to return a result.');
    }
    return result;
}
