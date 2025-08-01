import { GoogleGenAI, Type } from '@google/genai';
import type { LoadingState, VideoResult, AspectRatio } from '../types';

// This tells Vercel this is an Edge Function
export const config = {
  runtime: 'edge',
};

const DURATION_PER_SCENE = 3;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const keyframeSchema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        at: { type: Type.NUMBER, description: "Keyframe position as a percentage of scene duration (0 to 1)" },
        style: { type: Type.OBJECT, properties: {
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
        } },
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
                  // Added 'image' to the enum for new element type
                  type: { type: Type.STRING, enum: ["text", "shape", "image"] },
                  text: { type: Type.STRING, nullable: true, description: "Text content if type is 'text'" },
                  shape: { type: Type.STRING, enum: ["rectangle", "circle"], nullable: true, description: "Shape type if type is 'shape'"},
                  // New field for generating a specific image for the element
                  image_prompt_for_element: { type: Type.STRING, nullable: true, description: "Prompt for an image generator for a specific element. Set to null if type is not 'image'." },
                  keyframes: keyframeSchema
                },
                required: ["id", "type", "keyframes"],
              }
            },
            camera_animation: { ...keyframeSchema, nullable: true, description: "Keyframes for the scene's camera movement (pan, zoom, rotate). Can be null." },
            image_prompt: { type: Type.STRING, description: "Prompt for a background image generator. Set to null if no image is needed.", nullable: true },
            background_color: { type: Type.STRING, description: "Background color as a CSS hex code if no image is used." },
          },
          required: ["animationElements", "background_color"],
        }
      }
    },
    required: ["scenes"]
};

const systemInstruction = `You are a world-class motion design director. Your task is to conceptualize a high-end, visually stunning animation based on a user's prompt. You will respond with a single JSON object that strictly adheres to the provided JSON schema.

Core Principles:
1.  **Cinematic & Professional:** Aim for clean, elegant, and impactful visuals.
2.  **Fluid Motion:** Create smooth animations using multiple keyframes (e.g., at: 0, 0.5, 1). Motion should be fluid, not linear. Use ease-in-out style curves.
3.  **Depth & Effects:** Utilize 3D transformations (rotateX/Y, translateZ), filters (blur), text shadows for glows, and opacity for fades.
4.  **Layout:** Create dynamic layouts. Avoid just centering everything.
5.  **Camera:** Use camera animations (zoom, pan, rotate) to add energy.
6.  **Imagery:** You can now create two types of images. Use 'image_prompt' for the background. Use 'image_prompt_for_element' for individual animated elements of type 'image'. For both, create a detailed, DALL-E 3 style prompt.
7.  **Text Color:** The main text elements should use the color specified in the user's prompt.
`;

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
  const ai = new GoogleGenAI({apiKey: process.env.API_KEY!});
  const sceneCount = Math.max(2, Math.ceil(config.duration / DURATION_PER_SCENE));
  const totalSteps = 2 + sceneCount + (config.generateNarration ? 1 : 0);
  
  onProgress({ step: 1, totalSteps, message: 'Designing motion graphics...' });

  const storyboardPrompt = `
The user wants a video about: "${prompt}".
The video will be ${config.duration} seconds long, with about ${DURATION_PER_SCENE} seconds per scene, so create ${sceneCount} scenes.
The primary text color for text elements should be ${config.textColor}.
`;

  let storyboardResponseText;
  try {
      const schemaInstruction = `You MUST respond with a single valid JSON object that strictly adheres to the following JSON schema. Do not add any other text, explanations, or markdown fences like \`\`\`json ... \`\`\` around the response. Just the raw JSON object. Schema: ${JSON.stringify(storyboardSchema)}`;
      const fullPrompt = `${storyboardPrompt}\n\n${schemaInstruction}`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: fullPrompt,
        config: {
            systemInstruction: systemInstruction,
            responseMimeType: 'application/json',
        }
    });

    let rawText = response.text.trim();
    if (rawText.startsWith('```json')) {
        rawText = rawText.substring(7, rawText.length - 3).trim();
    } else if (rawText.startsWith('```')) {
        rawText = rawText.substring(3, rawText.length - 3).trim();
    }
    storyboardResponseText = rawText;

  } catch (e) {
      console.error(e);
      throw new Error(`Failed to generate storyboard. The AI model failed to create an animation plan. Please try rephrasing your prompt.\nDetails: ${(e as Error).message}`);
  }
  
  let storyboard;
  try {
    storyboard = JSON.parse(storyboardResponseText).scenes;
    if (!storyboard) throw new Error("Parsed JSON is missing 'scenes' property.");
  } catch (e) {
      console.error("Failed to parse storyboard JSON:", storyboardResponseText);
      throw new Error(`The AI model returned an invalid response. Please try again.\nDetails: ${(e as Error).message}`);
  }

  let narration;
  if (config.generateNarration) {
      onProgress({ step: 2, totalSteps, message: 'Writing narration script...' });
      const narrationPrompt = `Based on the following scene descriptions (extracted from the main text element of each scene), write a concise and engaging narration script.
Provide one narration line per scene.
Scenes:
${storyboard.map((s: any, i: number) => {
    const textEl = s.animationElements.find((el: any) => el.type === 'text');
    return (i+1) + '. ' + (textEl ? textEl.text : 'A visual scene.');
}).join('\\n')}`;

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
        const narrationResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: narrationPrompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: narrationSchema
            }
        });
        narration = JSON.parse(narrationResponse.text).narration;
      } catch (e) {
        console.error(e);
        narration = undefined; 
      }
  }

  const scenes: any[] = [];
  const imageGenStepStart = 2 + (config.generateNarration ? 1 : 0);

  for (let i = 0; i < storyboard.length; i++) {
    const sceneSpec = storyboard[i];
    const currentStep = i + imageGenStepStart;

    // Handle background image generation
    if (sceneSpec.image_prompt) {
        onProgress({
            step: currentStep,
            totalSteps,
            message: `Generating background image for scene ${i + 1}/${storyboard.length}...`
        });
        
        try {
            const imageResponse = await ai.models.generateImages({
                model: 'imagen-3.0-generate-002',
                prompt: `${sceneSpec.image_prompt}, professional motion graphic background, high quality, visually stunning, abstract`,
                config: {
                    numberOfImages: 1,
                    outputMimeType: 'image/jpeg',
                    aspectRatio: config.aspectRatio,
                },
            });

            const base64ImageBytes = imageResponse.generatedImages[0].image.imageBytes;
            scenes.push({
                ...sceneSpec,
                imageUrl: `data:image/jpeg;base64,${base64ImageBytes}`,
            });

        } catch (error) {
            console.error(`Failed to generate image for scene ${i + 1}:`, error);
            scenes.push({
                ...sceneSpec,
                imageUrl: null, // Fallback to no image
            });
        }
    } else {
        scenes.push({
            ...sceneSpec,
            imageUrl: null, // No image specified
        });
        await sleep(250);
    }
  }

  // Handle image generation for individual elements
  for (const scene of scenes) {
      for (const element of scene.animationElements) {
          if (element.type === 'image' && element.image_prompt_for_element) {
              const imagePrompt = element.image_prompt_for_element;
              onProgress({
                  step: totalSteps, // Not a new step, but a sub-task
                  totalSteps,
                  message: `Generating image for element "${imagePrompt}"...`
              });
              try {
                  const imageResponse = await ai.models.generateImages({
                      model: 'imagen-3.0-generate-002',
                      prompt: `${imagePrompt}, professional motion graphic element, high quality, visually stunning, transparent background`,
                      config: {
                          numberOfImages: 1,
                          outputMimeType: 'image/jpeg', // Jpeg for now, but should ideally be transparent png
                          aspectRatio: config.aspectRatio,
                      },
                  });
                  const base64ImageBytes = imageResponse.generatedImages[0].image.imageBytes;
                  element.imageUrl = `data:image/jpeg;base64,${base64ImageBytes}`;
              } catch (error) {
                  console.error(`Failed to generate image for element "${imagePrompt}":`, error);
                  element.imageUrl = null; // Fallback
              }
          }
      }
      await sleep(250);
  }

  onProgress({ step: totalSteps, totalSteps, message: 'Finalizing video...' });
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


// The main function handler for the Vercel serverless function
export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: {'Content-Type': 'application/json'} });
  }

  try {
    const { prompt, config } = await req.json();
    if (!prompt || !config) {
      return new Response(JSON.stringify({ error: 'Missing prompt or config' }), { status: 400, headers: {'Content-Type': 'application/json'} });
    }

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        
        const onProgress = (state: LoadingState) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'progress', data: state })}\n\n`));
        };

        try {
          const result = await generateVideo(prompt, config, onProgress);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'result', data: result })}\n\n`));
          controller.close();
        } catch (error) {
           const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred during generation.';
           console.error('Error during video generation:', error);
           controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', data: errorMessage })}\n\n`));
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
    return new Response(JSON.stringify({ error: errorMessage }), { status: 400, headers: {'Content-Type': 'application/json'} });
  }
}
