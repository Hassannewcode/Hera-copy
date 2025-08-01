
import { GoogleGenAI, Type } from '@google/genai';
import { LoadingState, VideoResult, AspectRatio } from '../types';

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

const systemInstruction = `You are a world-class motion design director. Your task is to conceptualize a high-end, visually stunning animation based on a user's prompt. You will respond with a single JSON object that strictly adheres to the provided JSON schema.

Core Principles:
1.  **Cinematic & Professional:** Aim for clean, elegant, and impactful visuals.
2.  **Fluid Motion:** Create smooth animations using multiple keyframes (e.g., at: 0, 0.5, 1). Motion should be fluid, not linear. Use ease-in-out style curves.
3.  **Depth & Effects:** Utilize 3D transformations (rotateX/Y, translateZ), filters (blur), text shadows for glows, and opacity for fades.
4.  **Layout:** Create dynamic layouts. Avoid just centering everything.
5.  **Camera:** Use camera animations (zoom, pan, rotate) to add energy.
6.  **Imagery:** If an image is needed, create a detailed, DALL-E 3 style prompt for an abstract, atmospheric background unless the user requests something specific.
7.  **Text Color:** The main text elements should use the color specified in the user's prompt.
`;


export const generateVideo = async (
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
): Promise<VideoResult> => {
  const ai = new GoogleGenAI({apiKey: process.env.API_KEY});
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
     const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: storyboardPrompt,
        config: {
            systemInstruction: systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: storyboardSchema
        }
    });
    storyboardResponseText = response.text;
  } catch (e) {
      console.error(e);
      throw new Error(`Failed to generate storyboard. The AI model failed to create an animation plan. Please try rephrasing your prompt.\nDetails: ${(e as Error).message}`);
  }
  
  const storyboard = JSON.parse(storyboardResponseText).scenes;

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

    if (sceneSpec.image_prompt) {
        onProgress({
            step: currentStep,
            totalSteps,
            message: `Generating image for scene ${i + 1}/${storyboard.length}...`
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
                animationElements: sceneSpec.animationElements,
                cameraAnimation: sceneSpec.camera_animation,
                imageUrl: `data:image/jpeg;base64,${base64ImageBytes}`,
                backgroundColor: sceneSpec.background_color,
            });

        } catch (error) {
            console.error(`Failed to generate image for scene ${i + 1}:`, error);
            scenes.push({
                animationElements: sceneSpec.animationElements,
                cameraAnimation: sceneSpec.camera_animation,
                backgroundColor: sceneSpec.background_color,
            });
        }
    } else {
        onProgress({
            step: currentStep,
            totalSteps,
            message: `Processing scene ${i + 1}/${storyboard.length}...`
        });
        scenes.push({
            animationElements: sceneSpec.animationElements,
            cameraAnimation: sceneSpec.camera_animation,
            backgroundColor: sceneSpec.background_color,
        });
        await sleep(250);
    }
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
};
