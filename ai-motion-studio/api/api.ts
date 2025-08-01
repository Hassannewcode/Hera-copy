/**
 * @file handler.ts
 * @description This file defines a Vercel Edge Function handler for a video generation API.
 * It orchestrates a multi-step process using Google's Gemini and Imagen models
 * to create a storyboard with animations, narration, and images, streamed to the client.
 */

import { Type } from '@google/genai'; // Assuming this provides the JSON schema types
import type { LoadingState, VideoResult, AspectRatio } from '../types';

// This tells Vercel this is an Edge Function
export const config = {
    runtime: 'edge',
};

// --- CONSTANTS AND CONFIGURATION ---------------------------------------------
const DURATION_PER_SCENE = 3;
const API_RETRY_COUNT = 3;
const API_RETRY_DELAY_MS = 1000;
const GEMINI_MODEL = 'gemini-2.5-flash';
const IMAGEN_MODEL = 'imagen-3.0-generate-002';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.API_KEY}`;
const IMAGEN_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGEN_MODEL}:predict?key=${process.env.API_KEY}`;

// --- UTILITIES ---------------------------------------------------------------

/**
 * Creates a promise that resolves after a specified delay.
 * @param ms The time to sleep in milliseconds.
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Parses a string to JSON, safely handling potential markdown fences.
 * @param rawText The raw string response from the AI.
 * @returns The parsed JSON object.
 */
function parseJSONFromText(rawText: string): any {
    let cleanedText = rawText.trim();
    if (cleanedText.startsWith('```json')) {
        cleanedText = cleanedText.substring(7, cleanedText.length - 3).trim();
    } else if (cleanedText.startsWith('```')) {
        cleanedText = cleanedText.substring(3, cleanedText.length - 3).trim();
    }
    return JSON.parse(cleanedText);
}

/**
 * A robust fetch wrapper with exponential backoff for retries.
 * @param url The API endpoint URL.
 * @param options The fetch request options.
 * @param retries The number of times to retry on failure.
 * @param delay The initial delay in milliseconds for backoff.
 */
async function fetchWithRetry(url: string, options: RequestInit, retries = API_RETRY_COUNT, delay = API_RETRY_DELAY_MS): Promise<Response> {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.ok) {
                return response;
            }
            if (response.status >= 400 && response.status < 500) {
                // Do not retry on client errors
                throw new Error(`API returned client error: ${response.status} ${response.statusText}`);
            }
            throw new Error(`API call failed with status: ${response.status}`);
        } catch (error) {
            if (i === retries - 1) {
                throw error;
            }
            const backoffDelay = delay * Math.pow(2, i);
            console.warn(`Attempt ${i + 1} failed, retrying in ${backoffDelay}ms...`);
            await sleep(backoffDelay);
        }
    }
    // This line should technically be unreachable
    throw new Error('Fetch with retry failed after all attempts.');
}


// --- JSON SCHEMA DEFINITIONS -------------------------------------------------

const keyframeSchema = {
    type: Type.ARRAY,
    items: {
        type: Type.OBJECT,
        properties: {
            at: { type: Type.NUMBER, description: "Keyframe position as a percentage of scene duration (0 to 1)" },
            style: {
                type: Type.OBJECT,
                properties: {
                    transform: { type: Type.STRING, nullable: true, description: "CSS transform property. e.g. 'translateX(100px) rotate(90deg) scale(1.5)'" },
                    transformOrigin: { type: Type.STRING, nullable: true },
                    opacity: { type: Type.NUMBER, nullable: true },
                    backgroundColor: { type: Type.STRING, nullable: true, description: "CSS background color"},
                    width: { type: Type.STRING, nullable: true },
                    height: { type: Type.STRING, nullable: true },
                    borderRadius: { type: Type.STRING, nullable: true },
                    color: { type: Type.STRING, nullable: true },
                    filter: { type: Type.STRING, nullable: true, description: "CSS filter property, e.g., 'blur(5px)'" },
                    textShadow: { type: Type.STRING, nullable: true, description: "CSS text-shadow property, e.g., '2px 2px 4px #000000'" },
                }
            },
        },
        required: ["at", "style"],
    }
};

const storyboardSchema = {
    type: Type.OBJECT,
    properties: {
        scenes: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    animationElements: {
                        type: Type.ARRAY,
                        description: "List of elements to animate in the scene.",
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                id: { type: Type.STRING, description: "Unique ID for the element" },
                                type: { type: Type.STRING, enum: ["text", "shape"] },
                                text: { type: Type.STRING, nullable: true, description: "Text content if type is 'text'" },
                                shape: { type: Type.STRING, enum: ["rectangle", "circle"], nullable: true, description: "Shape type if type is 'shape'"},
                                keyframes: keyframeSchema
                            },
                            required: ["id", "type", "keyframes"],
                        }
                    },
                    camera_animation: { ...keyframeSchema, nullable: true, description: "Keyframes for the scene's camera movement (pan, zoom, rotate). Can be null." },
                    image_prompt: { type: Type.STRING, description: "Prompt for an image generator. Set to null if no image is needed.", nullable: true },
                    background_color: { type: Type.STRING, description: "Background color as a CSS hex code if no image is used." },
                },
                required: ["animationElements", "background_color"],
            }
        }
    },
    required: ["scenes"]
};

// --- AI INSTRUCTIONS AND PROMPTS ---------------------------------------------

const systemInstruction = `You are a world-class motion design director. Your task is to conceptualize a high-end, visually stunning animation based on a user's prompt. You will respond with a single JSON object that strictly adheres to the provided JSON schema.

Core Principles:
1.  **Cinematic & Professional:** Aim for clean, elegant, and impactful visuals.
2.  **Fluid Motion:** Create smooth animations using multiple keyframes (e.g., at: 0, 0.5, 1). Motion should be fluid, not linear. Use ease-in-out style curves.
3.  **Depth & Effects:** Utilize 3D transformations (rotateX/Y, translateZ), filters (blur), text shadows for glows, and opacity for fades.
4.  **Layout:** Create dynamic layouts. Avoid just centering everything.
5.  **Camera:** Use camera animations (zoom, pan, rotate) to add energy.
6.  **Imagery:** If an image is needed, create a detailed, high-quality prompt for an abstract, atmospheric background unless the user requests something specific.
7.  **Text Color:** The main text elements should use the color specified in the user's prompt.
`;


// --- CORE LOGIC --------------------------------------------------------------

/**
 * Generates video content step-by-step using AI models.
 * @param prompt The user's initial video prompt.
 * @param config Video generation configuration (duration, aspect ratio, etc.).
 * @param onProgress A callback to report progress updates.
 * @returns A promise that resolves with the final VideoResult object.
 */
async function internalGenerateVideo(
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
    // Determine the number of scenes based on total duration.
    const sceneCount = Math.max(2, Math.ceil(config.duration / DURATION_PER_SCENE));

    // Calculate total steps for the progress indicator.
    const totalSteps = 2 + (sceneCount * 2) + (config.generateNarration ? 1 : 0);
    let currentStep = 0;

    // STEP 1: Generate high-level scene ideas.
    currentStep++;
    onProgress({ step: currentStep, totalSteps, message: 'Brainstorming video concepts...' });

    const sceneIdeasPrompt = `The user wants a video about: "${prompt}". The video will be ${config.duration} seconds long. Based on that, generate a list of ${sceneCount} brief, one-sentence descriptions for scenes that tell a coherent story or create a compelling visual sequence. The descriptions should be creative and evocative.`;
    const sceneIdeasSchema = {
        type: Type.OBJECT,
        properties: {
            scene_ideas: {
                type: Type.ARRAY,
                description: "An array of brief, one-sentence descriptions for each video scene.",
                items: { type: Type.STRING }
            }
        },
        required: ["scene_ideas"]
    };

    let sceneIdeas: string[];
    try {
        const response = await fetchWithRetry(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    role: 'user',
                    parts: [{ text: sceneIdeasPrompt }]
                }],
                generationConfig: {
                    systemInstruction: "You are a creative director brainstorming a visual script.",
                    responseMimeType: "application/json",
                    responseSchema: sceneIdeasSchema
                }
            })
        });
        const result = await response.json();
        sceneIdeas = parseJSONFromText(result.candidates[0].content.parts[0].text).scene_ideas;
        if (!sceneIdeas || !Array.isArray(sceneIdeas) || sceneIdeas.length === 0) {
            throw new Error("AI failed to return valid scene ideas.");
        }
    } catch (e) {
        console.error("Failed to generate scene ideas:", e);
        throw new Error(`The AI failed to brainstorm concepts. Please try a different prompt.\nDetails: ${(e as Error).message}`);
    }

    // STEP 2: Generate detailed animation for each scene one-by-one
    const storyboard: any[] = [];
    const singleSceneSchema = storyboardSchema.properties.scenes.items;

    for (let i = 0; i < sceneIdeas.length; i++) {
        const sceneIdea = sceneIdeas[i];
        currentStep++;
        onProgress({ step: currentStep, totalSteps, message: `Designing scene ${i + 1}/${sceneIdeas.length}...` });

        const sceneGenPrompt = `User's main goal: "${prompt}"\nThis scene's specific concept: "${sceneIdea}"\nThe primary text color for text elements should be ${config.textColor}.\nGenerate the detailed animation data for this single scene.`;

        try {
            const schemaInstruction = `You MUST respond with a single valid JSON object that strictly adheres to the following JSON schema. Do not add any other text, explanations, or markdown fences. Just the raw JSON object. Schema: ${JSON.stringify(singleSceneSchema)}`;
            const fullPrompt = `${sceneGenPrompt}\n\n${schemaInstruction}`;

            const response = await fetchWithRetry(GEMINI_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        role: 'user',
                        parts: [{ text: fullPrompt }]
                    }],
                    generationConfig: {
                        systemInstruction: systemInstruction,
                        responseMimeType: 'application/json',
                    }
                })
            });

            const result = await response.json();
            const sceneData = parseJSONFromText(result.candidates[0].content.parts[0].text);
            storyboard.push(sceneData);

        } catch (e) {
            console.error(`Failed to generate data for scene ${i + 1}:`, e);
            throw new Error(`The AI failed while designing scene ${i + 1}. Please try again.\nDetails: ${(e as Error).message}`);
        }
    }

    // STEP 3: (Optional) Generate narration.
    let narration: string[] | undefined;
    if (config.generateNarration) {
        currentStep++;
        onProgress({ step: currentStep, totalSteps, message: 'Writing narration script...' });
        const narrationPrompt = `Based on the following scene descriptions (extracted from the main text element of each scene), write a concise and engaging narration script.
Provide one narration line per scene.
Scenes:
${storyboard.map((s: any, i: number) => {
    const textEl = s.animationElements.find((el: any) => el.type === 'text');
    return (i + 1) + '. ' + (textEl ? textEl.text : 'A visual scene.');
}).join('\n')}`;

        const narrationSchema = {
            type: Type.OBJECT,
            properties: {
                narration: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                }
            }
        };

        try {
            const narrationResponse = await fetchWithRetry(GEMINI_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        role: 'user',
                        parts: [{ text: narrationPrompt }]
                    }],
                    generationConfig: {
                        responseMimeType: "application/json",
                        responseSchema: narrationSchema
                    }
                })
            });

            const result = await narrationResponse.json();
            narration = parseJSONFromText(result.candidates[0].content.parts[0].text).narration;
        } catch (e) {
            console.error('Failed to generate narration:', e);
            narration = undefined;
        }
    }

    // STEP 4: Generate images concurrently for each scene.
    // This is a significant improvement over generating them sequentially.
    const scenes: any[] = await Promise.all(storyboard.map(async (sceneSpec, i) => {
        currentStep++;
        if (sceneSpec.image_prompt) {
            onProgress({
                step: currentStep,
                totalSteps,
                message: `Generating image for scene ${i + 1}/${storyboard.length}...`
            });
            try {
                const payload = {
                    instances: [{
                        prompt: `${sceneSpec.image_prompt}, professional motion graphic background, high quality, visually stunning, abstract`
                    }],
                    parameters: {
                        sampleCount: 1,
                        aspectRatio: config.aspectRatio,
                    }
                };

                const imageResponse = await fetchWithRetry(IMAGEN_API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const imageResult = await imageResponse.json();
                const base64ImageBytes = imageResult.predictions?.[0]?.bytesBase64Encoded;

                if (!base64ImageBytes) {
                    throw new Error("No image data returned from API.");
                }

                return {
                    animationElements: sceneSpec.animationElements,
                    cameraAnimation: sceneSpec.camera_animation,
                    imageUrl: `data:image/jpeg;base64,${base64ImageBytes}`,
                    backgroundColor: sceneSpec.background_color,
                };
            } catch (error) {
                console.error(`Failed to generate image for scene ${i + 1}:`, error);
                return {
                    animationElements: sceneSpec.animationElements,
                    cameraAnimation: sceneSpec.camera_animation,
                    backgroundColor: sceneSpec.background_color,
                };
            }
        } else {
            onProgress({
                step: currentStep,
                totalSteps,
                message: `Processing scene ${i + 1}/${storyboard.length}...`
            });
            await sleep(250); // Simulate a short delay for non-image scenes
            return {
                animationElements: sceneSpec.animationElements,
                cameraAnimation: sceneSpec.camera_animation,
                backgroundColor: sceneSpec.background_color,
            };
        }
    }));

    // STEP 5: Finalize and return.
    currentStep++;
    onProgress({ step: currentStep, totalSteps, message: 'Finalizing video...' });
    await sleep(500);

    return {
        scenes,
        narration,
        aspectRatio: config.aspectRatio,
        textColor: config.textColor,
        transparentBackground: config.transparentBackground,
        backgroundColor: config.backgroundColor,
    };
}


// --- VERECEL EDGE FUNCTION HANDLER -------------------------------------------

/**
 * The main handler for the Vercel Edge Function.
 * It sets up the streaming response and calls the internal video generation function.
 * @param req The incoming request object.
 * @returns A streamed response with progress updates and the final result.
 */
export default async function handler(req: Request) {
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
    }

    try {
        const { prompt, config } = await req.json();
        if (!prompt || !config) {
            return new Response(JSON.stringify({ error: 'Missing prompt or config' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        const stream = new ReadableStream({
            async start(controller) {
                const encoder = new TextEncoder();

                const onProgress = (state: LoadingState) => {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'progress', data: state })}\n\n`));
                };

                try {
                    const result = await internalGenerateVideo(prompt, config, onProgress);
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'result', data: result })}\n\n`));
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred during generation.';
                    console.error('Error during video generation:', error);
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', data: errorMessage })}\n\n`));
                } finally {
                    controller.close();
                }
            }
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
            },
        });

    } catch (error) {
        console.error('Error in handler:', error);
        const errorMessage = error instanceof Error ? error.message : 'Invalid request body';
        return new Response(JSON.stringify({ error: errorMessage }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
}

